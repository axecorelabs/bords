import { supabaseAdmin } from '@/lib/supabase/admin'

/** The slice of the Supabase client this module uses (lets tests pass a fake). */
export type Db = Pick<typeof supabaseAdmin, 'from'>

export type BoardPermission = 'owner' | 'edit' | 'view'

export function canWrite(permission: BoardPermission | null): boolean {
  return permission === 'owner' || permission === 'edit'
}

/**
 * Unwrap a query result, FAILING on any error. A query that errored comes back as `data: null`, which is
 * indistinguishable from "no such row" (and for a board nobody has saved yet, "no such row" means "you may
 * create it"). So during a database error we must refuse, never fall through to a permissive answer.
 */
function ok<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`board permission lookup failed (${what}): ${r.error.message}`)
  return r.data
}

/**
 * Resolves what `userId` may do on the board identified by `boardId`
 * (the client-side `local_board_id`). Returns null when they have no access.
 * THROWS if the database can't answer: callers must treat that as "unavailable", not as "denied" or "allowed".
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
export async function resolveBoardPermission(
  boardId: string,
  userId: string,
  db: Db = supabaseAdmin
): Promise<BoardPermission | null> {
  const bord = ok(
    await db
      .from('bords')
      .select('id, owner_id, organization_id, context_type')
      .eq('local_board_id', boardId)
      .maybeSingle(),
    'bords'
  )

  if (!bord) return resolveUnregisteredBoard(boardId, userId, db)

  if (bord.owner_id === userId) return 'owner'

  const access = ok(
    await db.from('bord_access_list').select('permission').eq('bord_id', bord.id).eq('user_id', userId).maybeSingle(),
    'bord_access_list'
  )
  if (access) return access.permission as BoardPermission

  if (bord.context_type === 'organization' && bord.organization_id) {
    const org = ok(
      await db.from('organizations').select('owner_id').eq('id', bord.organization_id).maybeSingle(),
      'organizations'
    )
    if (org?.owner_id === userId) return 'edit'

    const membership = ok(
      await db
        .from('employee_memberships')
        .select('role')
        .eq('organization_id', bord.organization_id)
        .eq('user_id', userId)
        .maybeSingle(),
      'employee_memberships'
    )
    if (!membership) return null
    return membership.role === 'admin' ? 'edit' : 'view'
  }

  // Personal board: an owner/admin of an org the board's owner belongs to may edit it.
  const ownerMemberships = ok(
    await db.from('employee_memberships').select('organization_id').eq('user_id', bord.owner_id),
    'employee_memberships(owner)'
  )
  const ownerOrgIds = (ownerMemberships ?? []).map((m) => m.organization_id)
  if (ownerOrgIds.length === 0) return null

  const ownedOrgs = ok(
    await db.from('organizations').select('id').in('id', ownerOrgIds).eq('owner_id', userId),
    'organizations(owned)'
  )
  if (ownedOrgs && ownedOrgs.length > 0) return 'edit'

  const adminMembership = ok(
    await db
      .from('employee_memberships')
      .select('role')
      .in('organization_id', ownerOrgIds)
      .eq('user_id', userId)
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle(),
    'employee_memberships(admin)'
  )
  return adminMembership ? 'edit' : null
}

/** A board that has no `bords` row yet exists only on its creator's device and in yjs_documents. */
async function resolveUnregisteredBoard(boardId: string, userId: string, db: Db): Promise<BoardPermission | null> {
  const doc = ok(
    await db.from('board_documents').select('owner_id').eq('local_board_id', boardId).maybeSingle(),
    'board_documents'
  )
  if (doc) return doc.owner_id === userId ? 'owner' : null

  const ydoc = ok(
    await db.from('yjs_documents').select('last_modified_by').eq('board_id', boardId).maybeSingle(),
    'yjs_documents'
  )
  // Never synced anywhere: the first user to open it becomes its owner.
  if (!ydoc) return 'owner'
  return ydoc.last_modified_by === userId ? 'owner' : null
}
