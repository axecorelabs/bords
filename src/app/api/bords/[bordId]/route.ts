import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden } from '@/lib/api-helpers'
import { notifyOrgOwnersAndAdmins } from '@/lib/org-notifications'

/**
 * DELETE /api/bords/[bordId]
 * Deletes a Bord and its associated BoardDocument + Y.js state.
 * Allowed for: board owner, org owner, or org admin.
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
    .select('id, owner_id, local_board_id, organization_id, context_type')
    .eq('id', bordId)
    .maybeSingle()

  if (!bord) return notFound('Bord')

  const isOwner = bord.owner_id === user.id

  // Org owner/admin check
  let isOrgOwner = false
  let isOrgAdmin = false
  if (!isOwner && bord.organization_id) {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('owner_id')
      .eq('id', bord.organization_id)
      .maybeSingle()
    isOrgOwner = org?.owner_id === user.id

    if (!isOrgOwner) {
      const { data: membership } = await supabaseAdmin
        .from('employee_memberships')
        .select('role')
        .eq('organization_id', bord.organization_id)
        .eq('user_id', user.id)
        .maybeSingle()
      isOrgAdmin = membership?.role === 'admin'
    }
  }

  if (!isOwner && !isOrgOwner && !isOrgAdmin) return forbidden()

  // Capture title before deletion for the notification
  const { data: bordDetails } = await supabaseAdmin
    .from('bords')
    .select('title')
    .eq('id', bordId)
    .maybeSingle()
  const bordTitle = bordDetails?.title || 'Untitled'

  // Delete Bord (CASCADE handles access_list, assignments, etc.),
  // BoardDocument, and Y.js document state in parallel
  await Promise.all([
    supabaseAdmin.from('bords').delete().eq('id', bordId),
    supabaseAdmin
      .from('board_documents')
      .delete()
      .eq('local_board_id', bord.local_board_id),
    supabaseAdmin
      .from('yjs_documents')
      .delete()
      .eq('board_id', bord.local_board_id),
  ])

  // Notify org owners & admins about the removal (fire-and-forget)
  if (bord.organization_id) {
    notifyOrgOwnersAndAdmins(
      supabaseAdmin, bord.organization_id, user.id,
      'board_removed',
      'Board removed from organization',
      `removed the board "${bordTitle}"`,
      { boardTitle: bordTitle }
    )
  }

  return NextResponse.json({ ok: true })
}
