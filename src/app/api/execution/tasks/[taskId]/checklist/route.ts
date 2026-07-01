import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden, badRequest } from '@/lib/api-helpers'
import { logTaskActivity } from '@/lib/task-activity'

// PATCH /api/execution/tasks/[taskId]/checklist
// Assignee toggles a single checklist item. Auto-completes the task when all items are done.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { taskId } = await params
  const body = await req.json().catch(() => ({}))
  const { itemId, completed } = body

  if (!itemId || typeof completed !== 'boolean') {
    return badRequest('itemId and completed (boolean) are required')
  }

  const { data: assignment } = await supabaseAdmin
    .from('task_assignments')
    .select('id, assigned_to, assigned_by, organization_id, description_type, checklist_items, status, source_type, skip_review, content')
    .eq('id', taskId)
    .eq('is_deleted', false)
    .maybeSingle()

  if (!assignment) return notFound('Task')
  if (assignment.assigned_to !== user.id) return forbidden()
  if (assignment.description_type !== 'checklist') return badRequest('Task does not have a checklist description')
  if (assignment.status === 'completed') {
    return NextResponse.json({ error: 'Task is already completed' }, { status: 400 })
  }

  const items = (assignment.checklist_items || []) as { id: string; text: string; completed: boolean }[]
  const targetItem = items.find((i) => i.id === itemId)
  if (!targetItem) return notFound('Checklist item')

  const updatedItems = items.map((i) => i.id === itemId ? { ...i, completed } : i)
  const allComplete = updatedItems.length > 0 && updatedItems.every((i) => i.completed)

  const skipReview = (assignment as any).skip_review ?? false
  const updateData: Record<string, any> = { checklist_items: updatedItems }
  if (allComplete) {
    updateData.status = skipReview ? 'completed' : 'review'
    if (skipReview) updateData.completed_at = new Date().toISOString()
  } else if (completed && ['assigned', 'backlog', 'pending'].includes(assignment.status)
    && (assignment as any).source_type === 'kanban_task') {
    updateData.status = 'in_progress'
  } else if (!completed && assignment.status === 'review') {
    // Item unchecked after reaching review — revert to in_progress
    updateData.status = 'in_progress'
  }

  const { error } = await supabaseAdmin
    .from('task_assignments')
    .update(updateData)
    .eq('id', taskId)

  if (error) {
    console.error('[checklist PATCH] update failed:', error.message, error.details)
    return NextResponse.json({ error: 'Failed to update checklist item' }, { status: 500 })
  }

  if (allComplete) {
    const actorName = user.name?.trim() || 'Someone'
    const orgId = assignment.organization_id ?? null

    if (skipReview) {
      logTaskActivity({
        taskAssignmentId: taskId,
        organizationId: orgId,
        actorId: user.id,
        actorName,
        action: 'completed',
      }).catch(() => {})

      if (assignment.assigned_by !== user.id) {
        supabaseAdmin.from('notifications').insert({
          user_id: assignment.assigned_by,
          type: 'task_completed',
          title: 'Task Completed',
          message: `${actorName} completed all checklist items: "${assignment.content.substring(0, 80)}"`,
          metadata: { taskAssignmentId: taskId, organizationId: orgId },
          is_read: false,
        }).then(() => {}, () => {})
      }
    } else {
      // Task moved to review — notify assigner it's ready for their approval
      logTaskActivity({
        taskAssignmentId: taskId,
        organizationId: orgId,
        actorId: user.id,
        actorName,
        action: 'submitted_for_review',
      }).catch(() => {})

      if (assignment.assigned_by !== user.id) {
        supabaseAdmin.from('notifications').insert({
          user_id: assignment.assigned_by,
          type: 'task_completed',
          title: 'Ready for Review',
          message: `${actorName} completed all checklist items and submitted "${assignment.content.substring(0, 80)}" for review`,
          metadata: { taskAssignmentId: taskId, organizationId: orgId },
          is_read: false,
        }).then(() => {}, () => {})
      }
    }
  }

  const newStatus = updateData.status ?? assignment.status
  return NextResponse.json({ checklistItems: updatedItems, taskCompleted: allComplete && skipReview, status: newStatus })
}
