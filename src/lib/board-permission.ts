import { supabaseAdmin } from '@/lib/supabase/admin'

export type BoardPermission = 'owner' | 'edit' | 'view'

export function canWrite(permission: BoardPermission | null): boolean {
  return permission === 'owner' || permission === 'edit'
}

/**
 * Resolves what `userId` may do on the board identified by `boardId`
 * (the client-side `local_board_id`). Returns null when they have no access.
 *
 * Single source of truth for board permissions: used by the save-state REST
 * route and by the realtime Worker (via /api/internal/board-access).
 *
 *  - owner of the bord                          → owner
 *  - bord_access_list entry                     → its permission
 *  - org board: org owner / org admin           → edit; any other org member → view
 *  - personal board: owner's org owner / admin  → edit
 *  - no bord record yet (brand-new local board) → owner, unless someone else already holds it
 */
export async function resolveBoardPermission(boardId: string, userId: string): Promise<BoardPermission | null> {
  const { data: bord } = await supabaseAdmin
    .from('bords')
    .select('id, owner_id, organization_id, context_type')
    .eq('local_board_id', boardId)
    .maybeSingle()

  if (!bord) return resolveUnregisteredBoard(boardId, userId)

  if (bord.owner_id === userId) return 'owner'

  const { data: access } = await supabaseAdmin
    .from('bord_access_list')
    .select('permission')
    .eq('bord_id', bord.id)
    .eq('user_id', userId)
    .maybeSingle()
  if (access) return access.permission as BoardPermission

  if (bord.context_type === 'organization' && bord.organization_id) {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('owner_id')
      .eq('id', bord.organization_id)
      .maybeSingle()
    if (org?.owner_id === userId) return 'edit'

    const { data: membership } = await supabaseAdmin
      .from('employee_memberships')
      .select('role')
      .eq('organization_id', bord.organization_id)
      .eq('user_id', userId)
      .maybeSingle()
    if (!membership) return null
    return membership.role === 'admin' ? 'edit' : 'view'
  }

  // Personal board: an owner/admin of an org the board's owner belongs to may edit it.
  const { data: ownerMemberships } = await supabaseAdmin
    .from('employee_memberships')
    .select('organization_id')
    .eq('user_id', bord.owner_id)
  const ownerOrgIds = (ownerMemberships ?? []).map((m) => m.organization_id)
  if (ownerOrgIds.length === 0) return null

  const { data: ownedOrgs } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .in('id', ownerOrgIds)
    .eq('owner_id', userId)
  if (ownedOrgs && ownedOrgs.length > 0) return 'edit'

  const { data: adminMembership } = await supabaseAdmin
    .from('employee_memberships')
    .select('role')
    .in('organization_id', ownerOrgIds)
    .eq('user_id', userId)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  return adminMembership ? 'edit' : null
}

/** A board that has no `bords` row yet exists only on its creator's device and in yjs_documents. */
async function resolveUnregisteredBoard(boardId: string, userId: string): Promise<BoardPermission | null> {
  const { data: doc } = await supabaseAdmin
    .from('board_documents')
    .select('owner_id')
    .eq('local_board_id', boardId)
    .maybeSingle()
  if (doc) return doc.owner_id === userId ? 'owner' : null

  const { data: ydoc } = await supabaseAdmin
    .from('yjs_documents')
    .select('last_modified_by')
    .eq('board_id', boardId)
    .maybeSingle()
  // Never synced anywhere: the first user to open it becomes its owner.
  if (!ydoc) return 'owner'
  return ydoc.last_modified_by === userId ? 'owner' : null
}
