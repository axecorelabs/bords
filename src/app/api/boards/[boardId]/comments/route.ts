import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-helpers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveBoardAccess } from '@/lib/board-helpers'

export const dynamic = 'force-dynamic'

/**
 * GET /api/boards/[boardId]/comments
 *
 * Returns comments for a board from the board_comments table.
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

    const { data: comments, error } = await supabaseAdmin
      .from('board_comments')
      .select('*')
      .eq('board_id', boardId)
      .eq('owner_id', access.doc.owner_id)
      .order('created_at', { ascending: true })

    if (error) throw error

    return NextResponse.json({ comments: comments || [] })
  } catch (error: any) {
    console.error('[comments GET] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST /api/boards/[boardId]/comments
 *
 * Add a new comment. Inserts into board_comments table.
 * Supabase Realtime pushes the change to subscribers automatically.
 * Body: { text, itemId?, parentId?, mentions? }
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
    const body = await req.json()
    const { text, itemId, parentId, mentions } = body

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Missing comment text' }, { status: 400 })
    }

    const access = await resolveBoardAccess(boardId, user.id)
    if (!access) {
      return NextResponse.json({ error: 'Board not found or no access' }, { status: 404 })
    }

    const { data: comment, error } = await supabaseAdmin
      .from('board_comments')
      .insert({
        board_id: boardId,
        owner_id: access.doc.owner_id,
        user_id: user.id,
        user_name: user.name || user.email || 'Anonymous',
        user_avatar: user.image || null,
        text,
        item_id: itemId || null,
        parent_id: parentId || null,
        mentions: mentions || [],
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ comment }, { status: 201 })
  } catch (error: any) {
    console.error('[comments POST] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * DELETE /api/boards/[boardId]/comments
 *
 * Remove a comment by ID. Only the comment author or board owner can delete.
 * Body: { commentId }
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const user = await getAuthUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { boardId } = await params
    const body = await req.json()
    const { commentId } = body

    if (!commentId) {
      return NextResponse.json({ error: 'Missing commentId' }, { status: 400 })
    }

    const access = await resolveBoardAccess(boardId, user.id)
    if (!access) {
      return NextResponse.json({ error: 'Board not found or no access' }, { status: 404 })
    }

    // Fetch the comment to verify ownership
    const { data: comment, error: fetchErr } = await supabaseAdmin
      .from('board_comments')
      .select('id, user_id')
      .eq('id', commentId)
      .eq('board_id', boardId)
      .single()

    if (fetchErr || !comment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

    const isOwner = access.doc.owner_id === user.id
    const isAuthor = comment.user_id === user.id

    if (!isOwner && !isAuthor) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error: delErr } = await supabaseAdmin
      .from('board_comments')
      .delete()
      .eq('id', commentId)

    if (delErr) throw delErr

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('[comments DELETE] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
