import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden, badRequest } from '@/lib/api-helpers'

/**
 * PUT /api/personal/assignments/[assignmentId]/update
 * Update a personal assignment (move kanban column, edit content).
 * Only the assignee or assigner can update.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { assignmentId } = await params
  const body = await req.json()
  const { columnId, columnTitle, content } = body

  if (!columnId && !content) {
    return badRequest('At least one of columnId or content is required')
  }

  const { data: assignment } = await supabaseAdmin
    .from('task_assignments')
    .select('*')
    .eq('id', assignmentId)
    .eq('context_type', 'personal')
    .eq('is_deleted', false)
    .maybeSingle()

  if (!assignment) return notFound('Assignment')

  const isAssignee = assignment.assigned_to === user.id
  const isAssigner = assignment.assigned_by === user.id
  if (!isAssignee && !isAssigner) return forbidden()

  if (assignment.status === 'completed') {
    return NextResponse.json({ error: 'Cannot update a completed task' }, { status: 400 })
  }

  const updates: Record<string, any> = {}
  let notificationMessage = ''

  // Column move
  if (columnId && assignment.source_type === 'kanban_task') {
    const oldCol = assignment.column_title || 'unknown'
    updates.column_id = columnId
    updates.column_title = columnTitle || columnId
    notificationMessage = `Task moved from "${oldCol}" to "${columnTitle || columnId}"`
  }

  // Content edit
  if (content && content.trim() !== assignment.content) {
    updates.content = content.trim()
    notificationMessage = notificationMessage
      ? `${notificationMessage} and content updated`
      : 'Task content updated'
  }

  if (Object.keys(updates).length > 0) {
    await supabaseAdmin
      .from('task_assignments')
      .update(updates)
      .eq('id', assignmentId)
  }

  // Notify the other party
  if (notificationMessage) {
    const notifyUserId = isAssignee ? assignment.assigned_by : assignment.assigned_to
    if (notifyUserId !== user.id) {
      const { data: actor } = await supabaseAdmin
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', user.id)
        .maybeSingle()
      const actorName = actor ? `${actor.first_name} ${actor.last_name}`.trim() : 'Someone'

      await supabaseAdmin.from('notifications').insert({
        user_id: notifyUserId,
        type: 'task_updated',
        title: 'Task Updated',
        message: `${actorName}: ${notificationMessage} — "${(updates.content || assignment.content).substring(0, 60)}"`,
        metadata: {
          taskAssignmentId: assignmentId,
          sourceType: assignment.source_type,
          sourceId: assignment.source_id,
        },
      })
    }
  }

  return NextResponse.json({
    task: {
      _id: assignmentId,
      columnId: updates.column_id ?? assignment.column_id,
      columnTitle: updates.column_title ?? assignment.column_title,
      content: updates.content ?? assignment.content,
    },
  })
}
