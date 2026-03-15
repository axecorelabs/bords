import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-helpers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveBoardAccess } from '@/lib/board-helpers'

export const dynamic = 'force-dynamic'

/**
 * GET /api/boards/[boardId]/comments/unread
 *
 * Returns the unread comment count for the authenticated user.
 * Unread = comments created after the user's last_read_at.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const user = await getAuthUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { boardId } = await params

    // Verify board access
    const access = await resolveBoardAccess(boardId, user.id)
    if (!access) {
      return NextResponse.json({ error: 'Board not found or no access' }, { status: 404 })
    }

    // Get the user's last_read_at for this board
    const { data: readState } = await supabaseAdmin
      .from('board_comment_reads')
      .select('last_read_at')
      .eq('user_id', user.id)
      .eq('board_id', boardId)
      .maybeSingle()

    const lastReadAt = readState?.last_read_at ?? '1970-01-01T00:00:00Z'

    // Count comments created after last_read_at
    const { count, error } = await supabaseAdmin
      .from('board_comments')
      .select('*', { count: 'exact', head: true })
      .eq('board_id', boardId)
      .eq('owner_id', access.doc.owner_id)
      .gt('created_at', lastReadAt)

    if (error) throw error

    // Also get total count
    const { count: total } = await supabaseAdmin
      .from('board_comments')
      .select('*', { count: 'exact', head: true })
      .eq('board_id', boardId)
      .eq('owner_id', access.doc.owner_id)

    return NextResponse.json({ unread: count ?? 0, total: total ?? 0 })
  } catch (error: any) {
    console.error('[comments/unread GET] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST /api/boards/[boardId]/comments/unread
 *
 * Mark all comments as read for the authenticated user.
 * Upserts the user's last_read_at to now().
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const user = await getAuthUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { boardId } = await params

    const { error } = await supabaseAdmin
      .from('board_comment_reads')
      .upsert(
        { user_id: user.id, board_id: boardId, last_read_at: new Date().toISOString() },
        { onConflict: 'user_id,board_id' }
      )

    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('[comments/unread POST] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
