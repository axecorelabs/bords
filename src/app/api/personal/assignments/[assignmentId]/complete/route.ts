import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden } from '@/lib/api-helpers'

/**
 * POST /api/personal/assignments/[assignmentId]/complete
 * Toggle completion of a personal assignment (reminder).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { assignmentId } = await params

  const { data: task } = await supabaseAdmin
    .from('task_assignments')
    .select('*')
    .eq('id', assignmentId)
    .eq('context_type', 'personal')
    .eq('is_deleted', false)
    .maybeSingle()
  if (!task) return notFound('Assignment')

  const isAssignee = task.assigned_to === user.id
  const isAssigner = task.assigned_by === user.id
  if (!isAssignee && !isAssigner) return forbidden()

  const now = new Date().toISOString()
  const wasCompleted = task.status === 'completed'

  const { data: updated } = await supabaseAdmin
    .from('task_assignments')
    .update(wasCompleted
      ? { status: 'assigned', completed_at: null }
      : { status: 'completed', completed_at: now }
    )
    .eq('id', assignmentId)
    .select()
    .single()

  // Notify the other party
  const notifyUserId = isAssignee ? task.assigned_by : task.assigned_to
  if (notifyUserId !== user.id && !wasCompleted) {
    const { data: actor } = await supabaseAdmin
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', user.id)
      .maybeSingle()
    const actorName = actor ? `${actor.first_name} ${actor.last_name}`.trim() : 'Someone'

    await supabaseAdmin.from('notifications').insert({
      user_id: notifyUserId,
      type: 'task_completed',
      title: 'Reminder Completed',
      message: `${actorName} completed: "${task.content.substring(0, 60)}${task.content.length > 60 ? '...' : ''}"`,
      metadata: { taskAssignmentId: task.id, sourceType: task.source_type, sourceId: task.source_id },
    })
  }

  return NextResponse.json({ assignment: updated })
}
