import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, forbidden } from '@/lib/api-helpers'
import { resolveBoardAccess } from '@/lib/board-helpers'

type Params = { params: Promise<{ id: string }> }

type StoredBoardTag = {
  board_id: string
  title: string
  organization_id: string | null
}

/** Verify the current user is a member of this conversation */
async function assertMember(convId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from('conversation_members')
    .select('role')
    .eq('conversation_id', convId)
    .eq('user_id', userId)
    .maybeSingle()
  return data ?? null
}

/**
 * GET /api/messages/conversations/[id]/messages
 * Returns paginated messages for a conversation.
 * Query params: ?before=<cursor_created_at>&limit=50
 */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { id } = await params
  const member = await assertMember(id, user.id)
  if (!member) return forbidden()

  const { searchParams } = new URL(req.url)
  const before = searchParams.get('before')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100)

  let query = supabaseAdmin
    .from('messages')
    .select(`
      id, conversation_id, sender_id, content, reply_to_id, is_deleted, edited_at, created_at, is_system_message, is_ai_message, metadata, board_tags,
      message_attachments ( id, file_name, file_size, mime_type, storage_path ),
      message_reactions ( id, user_id, emoji )
    `)
    .eq('conversation_id', id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (before) query = query.lt('created_at', before)

  const { data: messages, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch sender profiles
  const senderIds = [...new Set((messages ?? []).map((m) => m.sender_id))]
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, last_name, image')
    .in('id', senderIds)

  const profileMap = new Map(profiles?.map((p) => [p.id, p]) ?? [])
  const boardAccessCache = new Map<string, boolean>()

  const hydrateBoardTags = async (rawTags: unknown) => {
    if (!Array.isArray(rawTags)) return []
    const tags = rawTags as StoredBoardTag[]
    const out: Array<{ boardId: string; title: string; organizationId: string | null; hasAccess: boolean }> = []

    for (const tag of tags) {
      if (!tag || typeof tag.board_id !== 'string' || typeof tag.title !== 'string') continue
      let hasAccess = boardAccessCache.get(tag.board_id)
      if (typeof hasAccess !== 'boolean') {
        hasAccess = !!(await resolveBoardAccess(tag.board_id, user.id))
        boardAccessCache.set(tag.board_id, hasAccess)
      }
      out.push({
        boardId: tag.board_id,
        title: tag.title,
        organizationId: tag.organization_id ?? null,
        hasAccess,
      })
    }

    return out
  }

  const result = await Promise.all((messages ?? []).reverse().map(async (m) => {
    const p = profileMap.get(m.sender_id)
    return {
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      senderName: p ? `${p.first_name} ${p.last_name}`.trim() : '',
      senderImage: p?.image ?? null,
      content: m.is_deleted ? null : m.content,
      isDeleted: m.is_deleted,
      isSystemMessage: m.is_system_message ?? false,
      isAiMessage: m.is_ai_message ?? false,
      aiMeta: m.is_ai_message ? (m.metadata ?? null) : null,
      boardTags: m.is_deleted ? [] : await hydrateBoardTags(m.board_tags),
      replyToId: m.reply_to_id,
      editedAt: m.edited_at,
      createdAt: m.created_at,
      attachments: m.is_deleted ? [] : (m.message_attachments ?? []),
      reactions: m.is_deleted ? [] : (m.message_reactions ?? []),
    }
  }))

  // Mark as read
  await supabaseAdmin
    .from('conversation_reads')
    .upsert({ conversation_id: id, user_id: user.id, last_read_at: new Date().toISOString() })

  return NextResponse.json(result)
}

/**
 * POST /api/messages/conversations/[id]/messages
 * Send a new message.
 * Body: { content, replyToId? }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { id } = await params
  const member = await assertMember(id, user.id)
  if (!member) return forbidden()

  const body = await req.json()
  const { content, replyToId } = body
  const rawBoardTags: unknown[] = Array.isArray((body as any).boardTags) ? (body as any).boardTags : []

  if (!content?.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 })

  const requestedBoardIds: string[] = [
    ...new Set(
      rawBoardTags
        .map((t) => {
          if (!t || typeof t !== 'object') return ''
          const boardId = (t as { boardId?: unknown }).boardId
          return typeof boardId === 'string' ? boardId.trim() : ''
        })
        .filter((id): id is string => id.length > 0)
    ),
  ]

  if (requestedBoardIds.length > 8) {
    return NextResponse.json({ error: 'You can tag up to 8 boards per message' }, { status: 400 })
  }

  const verifiedBoardTags: StoredBoardTag[] = []
  if (requestedBoardIds.length > 0) {
    const deniedBoardId = await (async () => {
      for (const boardId of requestedBoardIds) {
        const access = await resolveBoardAccess(boardId, user.id)
        if (!access) return boardId
      }
      return null
    })()

    if (deniedBoardId) {
      return NextResponse.json({ error: `You do not have access to board ${deniedBoardId}` }, { status: 403 })
    }

    const { data: bords } = await supabaseAdmin
      .from('bords')
      .select('local_board_id, title, organization_id')
      .in('local_board_id', requestedBoardIds)

    const bordMap = new Map((bords ?? []).map((b: any) => [b.local_board_id, b]))

    for (const boardId of requestedBoardIds) {
      const b = bordMap.get(boardId)
      if (!b) continue
      verifiedBoardTags.push({
        board_id: b.local_board_id,
        title: b.title ?? 'Untitled board',
        organization_id: b.organization_id ?? null,
      })
    }
  }

  const { data: message, error } = await supabaseAdmin
    .from('messages')
    .insert({
      conversation_id: id,
      sender_id: user.id,
      content: content.trim(),
      reply_to_id: replyToId ?? null,
      board_tags: verifiedBoardTags,
    })
    .select()
    .single()

  if (error || !message) return NextResponse.json({ error: error?.message }, { status: 500 })

  // Touch conversation updated_at so it floats to top of list
  await supabaseAdmin
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id)

  // Auto-mark as read for sender
  await supabaseAdmin
    .from('conversation_reads')
    .upsert({ conversation_id: id, user_id: user.id, last_read_at: new Date().toISOString() })

  // ── Broadcast via Supabase Realtime REST API ──────────────────────────────
  // This bypasses postgres_changes/WAL entirely. We push directly to:
  //   1. conversation:{id}     → all clients viewing this conversation (new_message)
  //   2. user:{memberId}       → all other members' badge-count subscriptions
  const { data: convMembers } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', id)

  // ── Emit to collab-server messaging layer ────────────────────────────────
  // The collab server fans out to all connected WebSocket clients in the
  // conversation room and the relevant user rooms.
  const collabUrl = process.env.NEXT_PUBLIC_COLLAB_SERVER_URL ?? 'http://localhost:4444'
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  const broadcastPayload = {
    id: message.id,
    conversation_id: message.conversation_id,
    sender_id: message.sender_id,
    sender_name: user.name,
    content: message.content,
    reply_to_id: message.reply_to_id,
    is_deleted: message.is_deleted,
    is_system_message: message.is_system_message,
    board_tags: message.board_tags ?? [],
    edited_at: message.edited_at,
    created_at: message.created_at,
  }

  await fetch(`${collabUrl}/messaging/emit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      type: 'new_message',
      conversationId: id,
      memberIds: (convMembers ?? []).map((m) => m.user_id),
      senderId: user.id,
      payload: broadcastPayload,
    }),
  }).catch((err) => {
    // Non-fatal — message is already persisted in DB; clients can reload
    console.error('[messaging/emit] collab server unreachable:', err)
  })
  // ─────────────────────────────────────────────────────────────────────────

  return NextResponse.json(message, { status: 201 })
}
