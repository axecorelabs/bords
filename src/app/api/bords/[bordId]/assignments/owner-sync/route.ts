import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden, badRequest } from '@/lib/api-helpers'

/**
 * POST /api/bords/[bordId]/assignments/owner-sync
 *
 * Owner-side sync: when the board owner manually toggles a checklist item
 * or moves a kanban task between columns, keep the corresponding
 * task_assignments in sync.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bordId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { bordId } = await params
  const body = await req.json()
  const { sourceType, sourceId, action, completed, columnId, columnTitle } = body

  if (!sourceType || !sourceId || !action) {
    return badRequest('sourceType, sourceId, and action are required')
  }

  const { data: bord } = await supabaseAdmin
    .from('bords')
    .select('id, owner_id')
    .eq('id', bordId)
    .maybeSingle()
  if (!bord) return notFound('Bord')
  if (bord.owner_id !== user.id) return forbidden()

  // Find all active (non-deleted) assignments for this source item
  const { data: assignments } = await supabaseAdmin
    .from('task_assignments')
    .select('*')
    .eq('bord_id', bordId)
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('is_deleted', false)

  if (!assignments || assignments.length === 0) {
    return NextResponse.json({ updated: 0 })
  }

  let updated = 0

  for (const assignment of assignments) {
    if (action === 'toggle_complete') {
      if (assignment.status === 'assigned' || assignment.status === 'completed') {
        await supabaseAdmin
          .from('task_assignments')
          .update({ status: completed ? 'completed' : 'assigned' })
          .eq('id', assignment.id)
        updated++
      }
    } else if (action === 'move_column') {
      if (columnId) {
        await supabaseAdmin
          .from('task_assignments')
          .update({
            column_id: columnId,
            column_title: columnTitle || null,
          })
          .eq('id', assignment.id)
        updated++
      }
    }
  }

  return NextResponse.json({ updated })
}
