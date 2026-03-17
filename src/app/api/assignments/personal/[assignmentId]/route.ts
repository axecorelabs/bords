import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden } from '@/lib/api-helpers'

/**
 * DELETE /api/assignments/personal/[assignmentId] — soft-delete a personal assignment
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { assignmentId } = await params

  const { data: assignment } = await supabaseAdmin
    .from('task_assignments')
    .select('id, assigned_by, context_type')
    .eq('id', assignmentId)
    .maybeSingle()

  if (!assignment) return notFound('Assignment')
  if (assignment.assigned_by !== user.id) return forbidden()
  if (assignment.context_type !== 'personal') return forbidden()

  await supabaseAdmin
    .from('task_assignments')
    .update({ is_deleted: true })
    .eq('id', assignmentId)

  return NextResponse.json({ success: true })
}
