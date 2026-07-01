import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden, badRequest } from '@/lib/api-helpers'
import { logTaskActivity, notifyAndEmailTaskEvent, TaskActivityChanges } from '@/lib/task-activity'

// PUT /api/execution/tasks/[taskId]/update — update a task (assignee or assigner)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { taskId } = await params
  const body = await req.json()
  const { columnId, columnTitle, content, dueDate, priority, executionNote, descriptionType, checklistItems, skipReview } = body

  const hasUpdate = columnId || content || dueDate !== undefined || priority !== undefined || executionNote !== undefined || descriptionType !== undefined || checklistItems !== undefined || skipReview !== undefined
  if (!hasUpdate) {
    return badRequest('At least one field is required')
  }

  const { data: assignment } = await supabaseAdmin
    .from('task_assignments')
    .select('*, bords(title)')
    .eq('id', taskId)
    .eq('is_deleted', false)
    .maybeSingle()

  if (!assignment) return notFound('Task')

  const isAssignee = assignment.assigned_to === user.id
  const isAssigner = assignment.assigned_by === user.id

  // Org owners/admins also count as assigners for edit purposes
  let isOrgManager = false
  if (!isAssignee && !isAssigner && assignment.organization_id) {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('owner_id')
      .eq('id', assignment.organization_id)
      .maybeSingle()
    if (org?.owner_id === user.id) {
      isOrgManager = true
    } else {
      const { data: membership } = await supabaseAdmin
        .from('employee_memberships')
        .select('role')
        .eq('organization_id', assignment.organization_id)
        .eq('user_id', user.id)
        .maybeSingle()
      isOrgManager = membership?.role === 'admin'
    }
  }

  if (!isAssignee && !isAssigner && !isOrgManager) return forbidden()

  if (assignment.status === 'completed' && (isAssigner || isOrgManager)) {
    return NextResponse.json({ error: 'Cannot update a completed task' }, { status: 400 })
  }

  const employeeUpdates: Record<string, any> = { ...(assignment.employee_updates || {}) }
  const updateData: Record<string, any> = {}
  const changes: TaskActivityChanges = {}
  let notificationMessage = ''

  // ── Column move (assignee or owner) ─────────────────────────────────────────
  if (columnId && assignment.source_type === 'kanban_task') {
    const oldCol = assignment.column_title || 'unknown'
    updateData.column_id = columnId
    updateData.column_title = columnTitle || columnId
    if (isAssignee) {
      employeeUpdates.columnId = columnId
      employeeUpdates.columnTitle = columnTitle || columnId
      employeeUpdates.updatedAt = new Date().toISOString()
    } else {
      const ownerSyncedUpdates: Record<string, any> = { ...(assignment.employee_updates || {}) }
      delete ownerSyncedUpdates.columnId
      delete ownerSyncedUpdates.columnTitle
      ownerSyncedUpdates.updatedAt = new Date().toISOString()
      updateData.employee_updates = ownerSyncedUpdates
    }
    notificationMessage = `Task moved from "${oldCol}" to "${columnTitle || columnId}"`
  }

  // ── Content edit ─────────────────────────────────────────────────────────────
  if (content && content.trim() !== assignment.content) {
    changes.content = { before: assignment.content, after: content.trim() }
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

  // ── Due date (assigner/org manager only) ─────────────────────────────────────
  if (dueDate !== undefined && (isAssigner || isOrgManager)) {
    const newDue = dueDate ? new Date(dueDate).toISOString() : null
    const oldDue = assignment.due_date ?? null
    if (newDue !== oldDue) {
      changes.dueDate = { before: oldDue, after: newDue }
      updateData.due_date = newDue
      notificationMessage = notificationMessage ? `${notificationMessage}, due date updated` : 'Due date updated'
    }
  }

  // ── Priority (assigner/org manager only) ──────────────────────────────────────
  if (priority !== undefined && (isAssigner || isOrgManager)) {
    const validPriority = ['low', 'normal', 'high'].includes(priority) ? priority : null
    if (validPriority && validPriority !== assignment.priority) {
      changes.priority = { before: assignment.priority, after: validPriority }
      updateData.priority = validPriority
      notificationMessage = notificationMessage ? `${notificationMessage}, priority updated` : 'Priority updated'
    }
  }

  // ── Execution note (assigner/org manager only, text mode) ────────────────────
  if (executionNote !== undefined && (isAssigner || isOrgManager)) {
    const newNote = typeof executionNote === 'string' && executionNote.trim() ? executionNote.trim() : null
    const oldNote = assignment.execution_note ?? null
    if (newNote !== oldNote) {
      changes.executionNote = { before: oldNote, after: newNote }
      updateData.execution_note = newNote
      notificationMessage = notificationMessage ? `${notificationMessage}, description updated` : 'Description updated'
    }
  }

  // ── Checklist description (assigner/org manager only) ─────────────────────────
  if (descriptionType !== undefined && (isAssigner || isOrgManager)) {
    const newType = descriptionType === 'checklist' ? 'checklist' : 'text'
    if (newType !== (assignment as any).description_type) {
      updateData.description_type = newType
      notificationMessage = notificationMessage ? `${notificationMessage}, description type changed` : 'Description type changed'
    }
    if (newType === 'checklist' && Array.isArray(checklistItems)) {
      const sanitised = checklistItems
        .filter((i: any) => typeof i.text === 'string' && i.text.trim())
        .map((i: any) => ({ id: i.id, text: i.text.trim(), completed: Boolean(i.completed) }))
      updateData.checklist_items = sanitised
      updateData.execution_note = null
    } else if (newType === 'text') {
      updateData.checklist_items = []
    }
  }

  // ── Skip review toggle (assigner/org manager only) ───────────────────────────
  if (skipReview !== undefined && (isAssigner || isOrgManager)) {
    updateData.skip_review = Boolean(skipReview)
  }

  if (isAssignee) {
    updateData.employee_updates = employeeUpdates
  }

  const { data: updated, error } = await supabaseAdmin
    .from('task_assignments')
    .update(updateData)
    .eq('id', taskId)
    .select()
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 })
  }

  // ── Activity log + notifications + email (all fire-and-forget) ──────────────
  const hasEditableChanges = Object.keys(changes).length > 0
  if (hasEditableChanges || notificationMessage) {
    const actorName = user.name?.trim() || 'Someone'
    const taskContent = updated.content || assignment.content
    const orgId = assignment.organization_id ?? null

    logTaskActivity({
      taskAssignmentId: taskId,
      organizationId: orgId,
      actorId: user.id,
      actorName,
      action: 'edited',
      changes,
    }).catch(() => {})

    if (hasEditableChanges) {
      // Fetch org name inside the async path so it doesn't add response latency
      ;(async () => {
        const orgName = orgId
          ? (await supabaseAdmin.from('organizations').select('name').eq('id', orgId).maybeSingle()).data?.name
          : undefined
        notifyAndEmailTaskEvent({
          taskAssignmentId: taskId,
          assignedTo: assignment.assigned_to,
          assignedBy: assignment.assigned_by,
          actorId: user.id,
          actorName,
          action: 'edited',
          taskContent,
          organizationId: orgId,
          orgName,
        })
      })()
    } else if (assignment.bord_id) {
      // Column move: legacy in-app notification only (no email)
      const bord = assignment.bords as any
      if (bord) {
        const notifyUserId = isAssigner || isOrgManager ? assignment.assigned_to : assignment.assigned_by
        if (notifyUserId !== user.id) {
          supabaseAdmin.from('notifications').insert({
            user_id: notifyUserId,
            type: 'task_updated',
            title: 'Task Updated',
            message: `${notificationMessage} in "${bord.title}": "${assignment.content.substring(0, 60)}"`,
            metadata: {
              bordId: assignment.bord_id,
              taskAssignmentId: assignment.id,
              bordTitle: bord.title,
              organizationId: assignment.organization_id,
              sourceType: assignment.source_type,
              sourceId: assignment.source_id,
            },
          }).then(() => {}, () => {})
        }
      }
    }
  }

  return NextResponse.json({
    task: {
      _id: updated.id,
      content: updated.employee_updates?.content ?? updated.content,
      priority: updated.priority,
      dueDate: updated.due_date ?? null,
      executionNote: updated.execution_note ?? null,
      columnId: updated.employee_updates?.columnId ?? updated.column_id,
      columnTitle: updated.employee_updates?.columnTitle ?? updated.column_title,
    },
  })
}
