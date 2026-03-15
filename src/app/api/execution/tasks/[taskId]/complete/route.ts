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
  if (assignment.assigned_to !== user.id) return forbidden()

  const now = new Date().toISOString()
  const wasCompleted = assignment.status === 'completed'

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

  // Notify the bord owner
  if (assignment.bord_id) {
    const { data: bord } = await supabaseAdmin
      .from('bords')
      .select('id, owner_id, title, organization_id')
      .eq('id', assignment.bord_id)
      .maybeSingle()

    if (bord) {
      await supabaseAdmin.from('notifications').insert({
        user_id: bord.owner_id,
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

  return NextResponse.json({
    task: { _id: updated!.id, status: 'completed', completedAt: now },
  })
}
