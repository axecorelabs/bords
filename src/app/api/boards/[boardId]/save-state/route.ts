import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-helpers'
import { supabaseAdmin } from '@/lib/supabase/admin'

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
    const { data: bord } = await supabaseAdmin
      .from('bords')
      .select('id, owner_id, local_board_id')
      .eq('local_board_id', boardId)
      .maybeSingle()

    if (bord) {
      const isOwner = bord.owner_id === user.id
      if (!isOwner) {
        const { data: access } = await supabaseAdmin
          .from('bord_access_list')
          .select('permission')
          .eq('bord_id', bord.id)
          .eq('user_id', user.id)
          .maybeSingle()
        if (!access || access.permission !== 'edit') {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      }
    } else {
      // No Bord record — check BoardDocument ownership as fallback
      const { data: doc } = await supabaseAdmin
        .from('board_documents')
        .select('id')
        .eq('local_board_id', boardId)
        .eq('owner_id', user.id)
        .maybeSingle()
      if (!doc) {
        // Board doesn't exist in cloud at all — allow creation (user owns it locally)
      }
    }

    // Upsert the Y.js document state (state is already base64 string → store as text)
    const { data: existing } = await supabaseAdmin
      .from('yjs_documents')
      .select('id, version')
      .eq('board_id', boardId)
      .maybeSingle()

    if (existing) {
      await supabaseAdmin
        .from('yjs_documents')
        .update({
          state,
          state_vector: stateVector || null,
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
          state,
          state_vector: stateVector || null,
          last_modified_by: user.id,
          version: 1,
        })
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('[save-state] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
