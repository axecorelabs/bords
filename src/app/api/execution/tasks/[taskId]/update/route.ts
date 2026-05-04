import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden, badRequest } from '@/lib/api-helpers'

// PUT /api/execution/tasks/[taskId]/update — assignee or owner updates a task (move column, edit content)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { taskId } = await params
  const body = await req.json()
  const { columnId, columnTitle, content } = body

  if (!columnId && !content) {
    return badRequest('At least one of columnId or content is required')
  }

  const { data: assignment } = await supabaseAdmin
    .from('task_assignments')
    .select('*')
    .eq('id', taskId)
    .maybeSingle()
  if (!assignment) return notFound('Task')
  const isAssignee = assignment.assigned_to === user.id
  const isOwner = assignment.assigned_by === user.id
  if (!isAssignee && !isOwner) return forbidden()
  if (assignment.status === 'completed') {
    return NextResponse.json({ error: 'Cannot update a completed task' }, { status: 400 })
  }

  let notificationMessage = ''
  const employeeUpdates: Record<string, any> = { ...(assignment.employee_updates || {}) }
  const updateData: Record<string, any> = {}

  // Column move
  if (columnId && assignment.source_type === 'kanban_task') {
    const oldCol = assignment.column_title || 'unknown'
    updateData.column_id = columnId
    updateData.column_title = columnTitle || columnId
    // Only track as employee update when the assignee makes the change
    if (isAssignee) {
      employeeUpdates.columnId = columnId
      employeeUpdates.columnTitle = columnTitle || columnId
      employeeUpdates.updatedAt = new Date().toISOString()
    } else if (assignment.context_type === 'organization') {
      // Owner/assigner move should become authoritative for org tasks.
      // Clear assignee column overrides so both parties resolve to the same column.
      const ownerSyncedUpdates: Record<string, any> = { ...(assignment.employee_updates || {}) }
      delete ownerSyncedUpdates.columnId
      delete ownerSyncedUpdates.columnTitle
      ownerSyncedUpdates.updatedAt = new Date().toISOString()
      updateData.employee_updates = ownerSyncedUpdates
    }
    notificationMessage = `Task moved from "${oldCol}" to "${columnTitle || columnId}"`
  }

  // Content edit
  if (content && content.trim() !== assignment.content) {
    if (isAssignee) {
      employeeUpdates.content = content.trim()
      employeeUpdates.updatedAt = new Date().toISOString()
    } else {
      updateData.content = content.trim()
    }
    notificationMessage = notificationMessage
      ? `${notificationMessage} and content updated`
      : 'Task content updated'
  }

  if (isAssignee) {
    updateData.employee_updates = employeeUpdates
  }

  const { data: updated } = await supabaseAdmin
    .from('task_assignments')
    .update(updateData)
    .eq('id', taskId)
    .select()
    .single()

  // Notify the other party about the update
  if (notificationMessage && assignment.bord_id) {
    const { data: bord } = await supabaseAdmin
      .from('bords')
      .select('id, owner_id, title, organization_id')
      .eq('id', assignment.bord_id)
      .maybeSingle()

    if (bord) {
      // Notify assignee if owner made the change, or owner if assignee made the change
      const notifyUserId = isOwner ? assignment.assigned_to : bord.owner_id
      if (notifyUserId !== user.id) {
        await supabaseAdmin.from('notifications').insert({
          user_id: notifyUserId,
          type: 'task_updated',
          title: 'Task Updated',
          message: `${notificationMessage} in "${bord.title}": "${assignment.content.substring(0, 60)}"`,
          metadata: {
            bordId: bord.id,
            taskAssignmentId: assignment.id,
            bordTitle: bord.title,
            organizationId: bord.organization_id,
            sourceType: assignment.source_type,
            sourceId: assignment.source_id,
          },
        })
      }
    }
  }

  return NextResponse.json({
    task: {
      _id: updated!.id,
      columnId: updated!.employee_updates?.columnId || updated!.column_id,
      columnTitle: updated!.employee_updates?.columnTitle || updated!.column_title,
      employeeUpdates: {
        content: updated!.employee_updates?.content,
        columnId: updated!.employee_updates?.columnId,
        columnTitle: updated!.employee_updates?.columnTitle,
        updatedAt: updated!.employee_updates?.updatedAt,
      },
    },
  })
}
