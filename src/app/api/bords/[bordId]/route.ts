import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden } from '@/lib/api-helpers'

/**
 * DELETE /api/bords/[bordId]
 * Deletes a Bord and its associated BoardDocument.
 * Only the owner can delete.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ bordId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { bordId } = await params

  const { data: bord } = await supabaseAdmin
    .from('bords')
    .select('id, owner_id, local_board_id')
    .eq('id', bordId)
    .maybeSingle()

  if (!bord) return notFound('Bord')
  if (bord.owner_id !== user.id) return forbidden()

  // Delete both Bord and BoardDocument in parallel
  await Promise.all([
    supabaseAdmin.from('bords').delete().eq('id', bordId),
    supabaseAdmin
      .from('board_documents')
      .delete()
      .eq('owner_id', user.id)
      .eq('local_board_id', bord.local_board_id),
  ])

  return NextResponse.json({ ok: true })
}
