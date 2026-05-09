import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type {
  BoardContent,
  BoardDocumentClient,
  BoardDocumentContentRow,
  BoardDocumentRow,
  BoardItem,
  BoardPermission,
} from '@/types/board-content'

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/* ── Fast content hash for change detection ── */
export function computeContentHash(board: BoardContent): string {
  const payload = JSON.stringify({
    checklists:   board.checklists   || [],
    kanbanBoards: board.kanbanBoards || [],
    stickyNotes:  board.stickyNotes  || [],
    mediaItems:   board.mediaItems   || [],
    textElements: board.textElements || [],
    richTexts:    board.richTexts    || [],
    drawings:     board.drawings     || [],
    connections:  board.connections  || [],
    reminders:    board.reminders    || [],
    nativeTldraw: board.nativeTldraw || null,
    itemIds:      board.itemIds      || {},
    bg:           [board.backgroundImage, board.backgroundColor, board.backgroundOverlay, board.backgroundOverlayColor, board.backgroundBlurLevel],
    settings:     [board.connectionLineSettings, board.gridSettings, board.themeSettings],
    zIndex:       board.zIndexData   || {},
  })
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16)
}

/**
 * Map a Supabase board_documents row → camelCase format expected by the client.
 * Preserves _id / owner fields for backward compatibility with MongoDB shape.
 */
export function boardDocToClient(row: BoardDocumentRow): BoardDocumentClient {
  return {
    _id: row.id,
    owner: row.owner_id,
    localBoardId: row.local_board_id,
    name: row.title,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    contextType: row.context_type,
    visibility: row.visibility,
    shareToken: row.share_token,
    sharedWith: row.shared_with || [],
    publicUrl: row.public_url,
    // Content
    checklists: asArray(row.checklists),
    kanbanBoards: asArray(row.kanban_boards),
    stickyNotes: asArray(row.sticky_notes),
    mediaItems: asArray(row.media_items),
    textElements: asArray(row.text_elements),
    drawings: asArray(row.drawings),
    comments: row.comments || [],
    connections: asArray(row.connections),
    reminders: asArray(row.reminders),
    tables: asArray(row.tables),
    richTexts: asArray(row.rich_texts),
    nativeTldraw: row.native_tldraw,
    // Settings
    connectionLineSettings: asObject(row.connection_line_settings),
    gridSettings: asObject(row.grid_settings),
    themeSettings: asObject(row.theme_settings),
    zIndexData: asObject(row.z_index_data),
    // Background
    backgroundImage: row.background_image,
    backgroundColor: row.background_color,
    backgroundOverlay: row.background_overlay || false,
    backgroundOverlayColor: row.background_overlay_color,
    backgroundBlurLevel: row.background_blur_level,
    // Sync metadata
    contentHash: row.content_hash,
    lastSyncedAt: row.last_synced_at,
    version: row.version || 1,
    itemIds: asObject(row.item_ids),
    // Timestamps
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Build a Supabase update/insert payload from client board content data.
 */
export function boardContentToRow(board: BoardContent): Partial<BoardDocumentContentRow> {
  return {
    checklists: board.checklists || [],
    kanban_boards: board.kanbanBoards || [],
    sticky_notes: board.stickyNotes || [],
    media_items: board.mediaItems || [],
    text_elements: board.textElements || [],
    drawings: board.drawings || [],
    connections: board.connections || [],
    reminders: board.reminders || [],
    tables: board.tables || [],
    rich_texts: board.richTexts || [],
    native_tldraw: board.nativeTldraw || null,
    connection_line_settings: board.connectionLineSettings || {},
    grid_settings: board.gridSettings || {},
    theme_settings: board.themeSettings || {},
    z_index_data: board.zIndexData || { counter: 0, entries: [] },
    item_ids: board.itemIds || {},
    background_image: board.backgroundImage || null,
    background_color: board.backgroundColor || null,
    background_overlay: board.backgroundOverlay || false,
    background_overlay_color: board.backgroundOverlayColor || null,
    background_blur_level: board.backgroundBlurLevel || null,
  }
}

/**
 * Resolve board access for a user — checks owner, shared_with JSONB, and bord_access_list.
 * Uses supabaseAdmin to bypass RLS (caller already authenticated via getAuthUser).
 */
export async function resolveBoardAccess(
  boardId: string,
  userId: string
): Promise<{ doc: BoardDocumentRow; permission: BoardPermission } | null> {
  // 1) Owner match
  const { data: owned } = await supabaseAdmin
    .from('board_documents')
    .select('*')
    .eq('local_board_id', boardId)
    .eq('owner_id', userId)
    .maybeSingle()

  if (owned) return { doc: owned, permission: 'owner' }

  // 2) shared_with JSONB match
  const { data: shared } = await supabaseAdmin
    .from('board_documents')
    .select('*')
    .eq('local_board_id', boardId)
    .contains('shared_with', [{ userId }])
    .maybeSingle()

  if (shared) {
    const sharedWith = Array.isArray(shared.shared_with) ? shared.shared_with : []
    const entry = sharedWith.find((s: unknown) => {
      return typeof s === 'object' && s !== null && 'userId' in s && (s as { userId?: string }).userId === userId
    }) as { permission?: string } | undefined
    const perm = entry?.permission === 'edit' ? 'edit' : 'view'
    return { doc: shared, permission: perm }
  }

  // 3) bord_access_list (org-level sharing)
  const { data: accessEntries } = await supabaseAdmin
    .from('bord_access_list')
    .select('permission, bords!inner(id, owner_id, local_board_id)')
    .eq('user_id', userId)
    .eq('bords.local_board_id', boardId)
    .limit(1)

  if (accessEntries && accessEntries.length > 0) {
    const access = accessEntries[0]
    const bordOwnerId = (access.bords as { owner_id?: string } | null)?.owner_id
    if (!bordOwnerId) return null
    const { data: doc } = await supabaseAdmin
      .from('board_documents')
      .select('*')
      .eq('local_board_id', boardId)
      .eq('owner_id', bordOwnerId)
      .maybeSingle()

    if (doc) {
      const perm = access.permission === 'edit' ? 'edit' : 'view'
      return { doc, permission: perm }
    }
  }

  // 4) Org membership fallback — only for org-visible boards.
  // Private/shared org boards must be accessed via explicit share paths above.
  // First try boards with organization_id set
  let bord: {
    id: string
    owner_id: string
    organization_id: string | null
    context_type: string | null
    visibility: string | null
  } | null = null
  const { data: orgBord } = await supabaseAdmin
    .from('bords')
    .select('id, owner_id, organization_id, context_type, visibility')
    .eq('local_board_id', boardId)
    .not('organization_id', 'is', null)
    .maybeSingle()
  bord = orgBord

  // If not found, try any board and check shared org membership
  if (!bord) {
    const { data: anyBord } = await supabaseAdmin
      .from('bords')
      .select('id, owner_id, organization_id, context_type, visibility')
      .eq('local_board_id', boardId)
      .maybeSingle()
    if (anyBord && anyBord.owner_id !== userId) {
      bord = anyBord
    }
  }

  if (bord) {
    let orgPermission: 'edit' | 'view' | null = null
    const visibility = bord.visibility || 'private'

    if (bord.organization_id) {
      if (visibility !== 'org') {
        return null
      }

      // Board has org context — check directly
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('owner_id')
        .eq('id', bord.organization_id)
        .maybeSingle()

      if (org?.owner_id === userId) {
        orgPermission = 'edit'
      } else {
        const { data: membership } = await supabaseAdmin
          .from('employee_memberships')
          .select('role')
          .eq('organization_id', bord.organization_id)
          .eq('user_id', userId)
          .maybeSingle()

        if (membership) {
          orgPermission = membership.role === 'admin' ? 'edit' : 'view'
        }
      }
    } else {
      // Board missing org context — check if owner and requester share an org
      const { data: ownerMemberships } = await supabaseAdmin
        .from('employee_memberships')
        .select('organization_id')
        .eq('user_id', bord.owner_id)

      if (ownerMemberships && ownerMemberships.length > 0) {
        const ownerOrgIds = ownerMemberships.map((m) => m.organization_id)
        const { data: ownedOrgs } = await supabaseAdmin
          .from('organizations')
          .select('id')
          .in('id', ownerOrgIds)
          .eq('owner_id', userId)

        if (ownedOrgs && ownedOrgs.length > 0) {
          orgPermission = 'edit'
        } else {
          const { data: reqMembership } = await supabaseAdmin
            .from('employee_memberships')
            .select('role')
            .in('organization_id', ownerOrgIds)
            .eq('user_id', userId)
            .limit(1)
            .maybeSingle()
          if (reqMembership) {
            orgPermission = reqMembership.role === 'admin' ? 'edit' : 'view'
          }
        }
      }
    }

    if (orgPermission) {
      const { data: doc } = await supabaseAdmin
        .from('board_documents')
        .select('*')
        .eq('local_board_id', boardId)
        .eq('owner_id', bord.owner_id)
        .maybeSingle()

      if (doc) {
        return { doc, permission: orgPermission }
      }
    }
  }

  return null
}

export function isBoardItem(value: unknown): value is BoardItem {
  return typeof value === 'object' && value !== null
}

export function jsonArrayToBoardItems(value: unknown): BoardItem[] {
  return Array.isArray(value) ? value.filter(isBoardItem) : []
}
