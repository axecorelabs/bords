import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, forbidden } from '@/lib/api-helpers'

type Params = { params: Promise<{ id: string; msgId: string }> }

/**
 * POST /api/messages/conversations/[id]/messages/[msgId]/react
 * Toggle a reaction on a message. If the same emoji already exists, remove it.
 * Body: { emoji }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { id, msgId } = await params

  // Verify membership
  const { data: member } = await supabaseAdmin
    .from('conversation_members')
    .select('role')
    .eq('conversation_id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!member) return forbidden()

  const { emoji } = await req.json()
  if (!emoji) return NextResponse.json({ error: 'emoji required' }, { status: 400 })

  // Check if reaction exists
  const { data: existing } = await supabaseAdmin
    .from('message_reactions')
    .select('id')
    .eq('message_id', msgId)
    .eq('user_id', user.id)
    .eq('emoji', emoji)
    .maybeSingle()

  let action: 'added' | 'removed'
  if (existing) {
    await supabaseAdmin.from('message_reactions').delete().eq('id', existing.id)
    action = 'removed'
  } else {
    await supabaseAdmin.from('message_reactions').insert({ message_id: msgId, user_id: user.id, emoji })
    action = 'added'
  }

  // Re-load reactions for this message and fan out through messaging WS.
  const { data: reactions } = await supabaseAdmin
    .from('message_reactions')
    .select('id, user_id, emoji')
    .eq('message_id', msgId)

  const { data: convMembers } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', id)

  const collabUrl = process.env.NEXT_PUBLIC_COLLAB_SERVER_URL ?? 'http://localhost:4444'
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  await fetch(`${collabUrl}/messaging/emit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      type: 'update_message',
      conversationId: id,
      memberIds: (convMembers ?? []).map((m) => m.user_id),
      senderId: user.id,
      payload: {
        id: msgId,
        conversation_id: id,
        reactions: (reactions ?? []).map((r) => ({
          id: r.id,
          user_id: r.user_id,
          emoji: r.emoji,
        })),
      },
    }),
  }).catch(() => {
    // Non-fatal: reaction persists in DB even if realtime fanout fails.
  })

  return NextResponse.json({ action })
}

/**
 * DELETE /api/messages/conversations/[id]/messages/[msgId]/react
 * Remove all reactions by the current user on a message.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { msgId } = await params

  await supabaseAdmin
    .from('message_reactions')
    .delete()
    .eq('message_id', msgId)
    .eq('user_id', user.id)

  return NextResponse.json({ ok: true })
}
