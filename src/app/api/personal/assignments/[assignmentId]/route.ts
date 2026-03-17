import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden } from '@/lib/api-helpers'

/**
 * PUT /api/personal/assignments/[assignmentId]
 * Update a personal assignment. Changes are immediate.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { assignmentId } = await params
  const body = await req.json()

  const { data: task } = await supabaseAdmin
    .from('task_assignments')
    .select('*')
    .eq('id', assignmentId)
    .eq('context_type', 'personal')
    .eq('is_deleted', false)
    .maybeSingle()
  if (!task) return notFound('Assignment')
  if (task.assigned_by !== user.id) return forbidden()

  const updateData: Record<string, any> = {}
  const { content, dueDate, executionNote } = body
  if (content !== undefined) updateData.content = content
  if (dueDate !== undefined) updateData.due_date = dueDate
  if (executionNote !== undefined) updateData.execution_note = executionNote

  const { data: updated } = await supabaseAdmin
    .from('task_assignments')
    .update(updateData)
    .eq('id', assignmentId)
    .select()
    .single()

  return NextResponse.json({ assignment: updated })
}

/**
 * DELETE /api/personal/assignments/[assignmentId]
 * Soft-delete a personal assignment.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { assignmentId } = await params

  const { data: task } = await supabaseAdmin
    .from('task_assignments')
    .select('id, assigned_by')
    .eq('id', assignmentId)
    .eq('context_type', 'personal')
    .eq('is_deleted', false)
    .maybeSingle()
  if (!task) return notFound('Assignment')
  if (task.assigned_by !== user.id) return forbidden()

  await supabaseAdmin
    .from('task_assignments')
    .update({ is_deleted: true })
    .eq('id', assignmentId)

  return NextResponse.json({ success: true })
}
