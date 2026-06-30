import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden } from '@/lib/api-helpers'
import { logTaskActivity, notifyAndEmailTaskEvent } from '@/lib/task-activity'

// DELETE /api/execution/tasks/[taskId] — soft-delete an assignment (assigner or org owner/admin only)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { taskId } = await params

  const { data: assignment } = await supabaseAdmin
    .from('task_assignments')
    .select('*, bords(title)')
    .eq('id', taskId)
    .eq('is_deleted', false)
    .maybeSingle()

  if (!assignment) return notFound('Task')

  // Only the assigner or an org owner/admin can delete
  const isAssigner = assignment.assigned_by === user.id
  let canDelete = isAssigner

  if (!canDelete && assignment.organization_id) {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('owner_id')
      .eq('id', assignment.organization_id)
      .maybeSingle()

    if (org?.owner_id === user.id) {
      canDelete = true
    } else {
      const { data: membership } = await supabaseAdmin
        .from('employee_memberships')
        .select('role')
        .eq('organization_id', assignment.organization_id)
        .eq('user_id', user.id)
        .maybeSingle()
      canDelete = membership?.role === 'admin'
    }
  }

  if (!canDelete) return forbidden()

  // Soft delete
  const { error } = await supabaseAdmin
    .from('task_assignments')
    .update({ is_deleted: true })
    .eq('id', taskId)

  if (error) {
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 })
  }

  const actorName = user.name?.trim() || 'Someone'
  const orgId = assignment.organization_id ?? null
  const taskContent = assignment.content

  // Log activity + notify + email — all fire-and-forget, response sent immediately
  logTaskActivity({
    taskAssignmentId: taskId,
    organizationId: orgId,
    actorId: user.id,
    actorName,
    action: 'deleted',
  }).catch(() => {})

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
      action: 'deleted',
      taskContent,
      organizationId: orgId,
      orgName,
    })
  })()

  return NextResponse.json({ ok: true })
}
