import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden } from '@/lib/api-helpers'

// POST /api/execution/tasks/[taskId]/complete — toggle task completion
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { taskId } = await params

  const { data: assignment } = await supabaseAdmin
    .from('task_assignments')
    .select('*')
    .eq('id', taskId)
    .maybeSingle()
  if (!assignment) return notFound('Task')
  const isAssignee = assignment.assigned_to === user.id
  const isOwner = assignment.assigned_by === user.id
  if (!isAssignee && !isOwner) return forbidden()

  const now = new Date().toISOString()
  const wasCompleted = assignment.status === 'completed'

  // Gate: block manual completion if checklist items are not all done
  if (!wasCompleted && assignment.description_type === 'checklist') {
    const items = (assignment.checklist_items || []) as { completed: boolean }[]
    if (items.length > 0 && !items.every((i) => i.completed)) {
      return NextResponse.json(
        { error: 'Complete all checklist items before marking this task as done' },
        { status: 400 }
      )
    }
  }

  const { data: updated } = await supabaseAdmin
    .from('task_assignments')
    .update(wasCompleted
      ? { status: 'assigned', completed_at: null }
      : { status: 'completed', completed_at: now }
    )
    .eq('id', taskId)
    .select()
    .single()

  if (wasCompleted) {
    return NextResponse.json({
      task: { _id: updated!.id, status: 'assigned', completedAt: null },
    })
  }

  // Notify the other party
  if (assignment.bord_id) {
    const { data: bord } = await supabaseAdmin
      .from('bords')
      .select('id, owner_id, title, organization_id')
      .eq('id', assignment.bord_id)
      .maybeSingle()

    if (bord) {
      const notifyUserId = isOwner ? assignment.assigned_to : bord.owner_id
      if (notifyUserId !== user.id) {
        await supabaseAdmin.from('notifications').insert({
          user_id: notifyUserId,
          type: 'task_completed',
          title: 'Task Completed',
          message: `A task has been completed in "${bord.title}": "${assignment.content.substring(0, 80)}"`,
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
    task: { _id: updated!.id, status: 'completed', completedAt: now },
  })
}
