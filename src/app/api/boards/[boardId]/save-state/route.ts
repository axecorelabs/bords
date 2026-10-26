import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-helpers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { extractBoardContentFromYDoc } from '@/lib/ydoc-extract'
import { boardContentToRow, computeContentHash } from '@/lib/board-helpers'
import { canWrite, resolveBoardPermission } from '@/lib/board-permission'

export const dynamic = 'force-dynamic'

/**
 * POST /api/boards/[boardId]/save-state
 *
 * Persists Y.Doc state for a board via REST (used for personal/non-shared
 * boards that don't maintain a WebSocket connection).
 *
 * Body: { state: string } — base64-encoded Y.Doc state (Y.encodeStateAsUpdate)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const user = await getAuthUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { boardId } = await params
    if (!boardId) {
      return NextResponse.json({ error: 'Missing boardId' }, { status: 400 })
    }

    const body = await req.json()
    const { state, stateVector } = body

    if (!state || typeof state !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid state' }, { status: 400 })
    }

    // Permission check: user must own the board or have edit access
    const permission = await resolveBoardPermission(boardId, user.id)
    if (!canWrite(permission)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Canonical ownership/context for the board_documents projection below
    const { data: bord } = await supabaseAdmin
      .from('bords')
      .select('owner_id, organization_id, context_type, visibility')
      .eq('local_board_id', boardId)
      .maybeSingle()

    // Convert base64 state to PostgreSQL BYTEA hex format (\x...)
    // This matches how the collab server stores Y.js state, ensuring
    // both REST save and WebSocket persist use the same encoding.
    const stateHex = '\\x' + Buffer.from(state, 'base64').toString('hex')
    const stateVectorHex = stateVector
      ? '\\x' + Buffer.from(stateVector, 'base64').toString('hex')
      : null

    const { data: existing } = await supabaseAdmin
      .from('yjs_documents')
      .select('id, version')
      .eq('board_id', boardId)
      .maybeSingle()

    if (existing) {
      await supabaseAdmin
        .from('yjs_documents')
        .update({
          state: stateHex,
          state_vector: stateVectorHex,
          last_modified_by: user.id,
          version: (existing.version || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
    } else {
      await supabaseAdmin
        .from('yjs_documents')
        .insert({
          board_id: boardId,
          state: stateHex,
          state_vector: stateVectorHex,
          last_modified_by: user.id,
          version: 1,
        })
    }

    // ── Sync structured content → board_documents for AI indexing ──
    // Decode the Y.Doc and upsert board_documents so the AI retrieval
    // pipeline can read manually-created board content (not just plan boards).
    try {
      const extracted = extractBoardContentFromYDoc(state)
      const canonicalOwnerId = bord?.owner_id || user.id
      const canonicalOrgId = bord?.organization_id || null
      const canonicalContextType = (bord?.context_type as string) || 'personal'
      const canonicalVisibility = bord?.visibility || 'private'
      const boardContent = {
        stickyNotes:  extracted.stickyNotes,
        checklists:   extracted.checklists,
        kanbanBoards: extracted.kanbanBoards,
        textElements: extracted.textElements,
        mediaItems:   extracted.mediaItems,
        connections:  extracted.connections,
        drawings:     extracted.drawings,
        reminders:    extracted.reminders,
        tables:       extracted.tables,
        richTexts:    extracted.richTexts,
        nativeTldraw: extracted.nativeTldraw,
      }
      const contentHash = computeContentHash(boardContent)
      const contentRow = boardContentToRow(boardContent)

      const { data: existingDoc } = await supabaseAdmin
        .from('board_documents')
        .select('id, version, content_hash')
        .eq('local_board_id', boardId)
        .maybeSingle()

      let resolvedWorkspaceId: string | null = null
      if (canonicalContextType === 'personal') {
        const { data: personalWs } = await supabaseAdmin
          .from('workspaces')
          .select('id')
          .eq('owner_id', canonicalOwnerId)
          .eq('type', 'personal')
          .maybeSingle()
        resolvedWorkspaceId = personalWs?.id || null
      }

      // Skip upsert if content hasn't changed
      if (!existingDoc || existingDoc.content_hash !== contentHash) {
        const title = (extracted.boardMeta?.name as string) || boardId

        if (existingDoc) {
          await supabaseAdmin
            .from('board_documents')
            .update({
              ...contentRow,
              title,
              owner_id: canonicalOwnerId,
              workspace_id: resolvedWorkspaceId,
              organization_id: canonicalOrgId,
              context_type: canonicalContextType,
              visibility: canonicalVisibility,
              content_hash: contentHash,
              last_synced_at: new Date().toISOString(),
              version: (existingDoc.version || 0) + 1,
            })
            .eq('id', existingDoc.id)
        } else {
          await supabaseAdmin
            .from('board_documents')
            .insert({
              ...contentRow,
              owner_id: canonicalOwnerId,
              local_board_id: boardId,
              title,
              workspace_id: resolvedWorkspaceId,
              organization_id: canonicalOrgId,
              context_type: canonicalContextType,
              visibility: canonicalVisibility,
              shared_with: [],
              content_hash: contentHash,
              last_synced_at: new Date().toISOString(),
              version: 1,
            })
        }
      }
    } catch (syncErr) {
      // Non-fatal: log but don't fail the save
      console.warn('[save-state] board_documents sync failed:', syncErr)
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('[save-state] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
