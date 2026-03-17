import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden, badRequest } from '@/lib/api-helpers'

// PUT /api/bords/[bordId]/assignments/[assignmentId]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ bordId: string; assignmentId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { bordId, assignmentId } = await params
  const body = await req.json()

  const { data: bord } = await supabaseAdmin
    .from('bords')
    .select('id, owner_id')
    .eq('id', bordId)
    .maybeSingle()
  if (!bord) return notFound('Bord')
  if (bord.owner_id !== user.id) return forbidden()

  const { data: assignment } = await supabaseAdmin
    .from('task_assignments')
    .select('*')
    .eq('id', assignmentId)
    .eq('bord_id', bordId)
    .maybeSingle()
  if (!assignment) return notFound('Assignment')

  const updateData: Record<string, any> = {}
  const allowedFields: Record<string, string> = {
    content: 'content',
    assignedTo: 'assigned_to',
    priority: 'priority',
    dueDate: 'due_date',
    executionNote: 'execution_note',
  }

  for (const [clientField, dbField] of Object.entries(allowedFields)) {
    if (body[clientField] !== undefined) {
      if (clientField === 'dueDate') {
        updateData[dbField] = body[clientField] ? new Date(body[clientField]).toISOString() : null
      } else {
        updateData[dbField] = body[clientField]
      }
    }
  }

  // If assignment was already published, mark as draft again
  if (assignment.status === 'assigned') {
    updateData.status = 'draft'
    updateData.published_at = null
  }

  const { data: updated } = await supabaseAdmin
    .from('task_assignments')
    .update(updateData)
    .eq('id', assignmentId)
    .select()
    .single()

  // Increment change tracker
  const { data: tracker } = await supabaseAdmin
    .from('unpublished_change_tracker')
    .select('change_count')
    .eq('bord_id', bordId)
    .maybeSingle()

  await supabaseAdmin
    .from('unpublished_change_tracker')
    .upsert(
      { bord_id: bordId, change_count: (tracker?.change_count || 0) + 1, last_modified_at: new Date().toISOString() },
      { onConflict: 'bord_id' }
    )

  return NextResponse.json({
    assignment: {
      _id: updated!.id,
      bordId: updated!.bord_id || bordId,
      sourceType: updated!.source_type,
      sourceId: updated!.source_id,
      content: updated!.content,
      assignedTo: updated!.assigned_to,
      priority: updated!.priority,
      dueDate: updated!.due_date || null,
      executionNote: updated!.execution_note,
      status: updated!.status,
    },
  })
}

// DELETE /api/bords/[bordId]/assignments/[assignmentId] — soft-delete
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ bordId: string; assignmentId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { bordId, assignmentId } = await params

  const { data: bord } = await supabaseAdmin
    .from('bords')
    .select('id, owner_id')
    .eq('id', bordId)
    .maybeSingle()
  if (!bord) return notFound('Bord')
  if (bord.owner_id !== user.id) return forbidden()

  const { data: assignment } = await supabaseAdmin
    .from('task_assignments')
    .select('id')
    .eq('id', assignmentId)
    .eq('bord_id', bordId)
    .maybeSingle()
  if (!assignment) return notFound('Assignment')

  await supabaseAdmin
    .from('task_assignments')
    .update({ is_deleted: true })
    .eq('id', assignmentId)

  // Increment change tracker
  const { data: tracker } = await supabaseAdmin
    .from('unpublished_change_tracker')
    .select('change_count')
    .eq('bord_id', bordId)
    .maybeSingle()

  await supabaseAdmin
    .from('unpublished_change_tracker')
    .upsert(
      { bord_id: bordId, change_count: (tracker?.change_count || 0) + 1, last_modified_at: new Date().toISOString() },
      { onConflict: 'bord_id' }
    )

  return NextResponse.json({ success: true })
}
