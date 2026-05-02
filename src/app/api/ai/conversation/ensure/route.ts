import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized } from '@/lib/api-helpers'

/**
 * The fixed UUID for the Bords AI virtual profile.
 * Must match the row inserted in migration 20260502000001_bords_ai_system_profile.sql
 */
export const BORDS_AI_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

/**
 * POST /api/ai/conversation/ensure
 * Finds or creates the AI DM conversation for the current user (+ optional org).
 * Returns the full conversation object (same shape as GET /api/messages/conversations).
 *
 * Body: { organizationId?: string }
 */
export async function POST(req: Request) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const body = await req.json().catch(() => ({}))
  const organizationId: string | null = body.organizationId ?? null

  // ── 1. Look for an existing AI conversation this user is a member of ──────
  const { data: memberships } = await supabaseAdmin
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', user.id)

  const convIds = memberships?.map((m) => m.conversation_id) ?? []

  let existingConvId: string | null = null

  if (convIds.length > 0) {
    let q = supabaseAdmin
      .from('conversations')
      .select('id')
      .in('id', convIds)
      .eq('is_ai_conversation', true)

    if (organizationId) {
      q = q.eq('organization_id', organizationId)
    } else {
      q = q.is('organization_id', null)
    }

    const { data: existing } = await q.limit(1).maybeSingle()
    existingConvId = existing?.id ?? null
  }

  // ── 2. Create one if it doesn't exist ────────────────────────────────────
  if (!existingConvId) {
    const { data: conv, error: convErr } = await supabaseAdmin
      .from('conversations')
      .insert({
        type: 'dm',
        name: null,
        description: null,
        organization_id: organizationId,
        workspace_id: null,
        created_by: user.id,
        is_ai_conversation: true,
      })
      .select('id')
      .single()

    if (convErr || !conv) {
      return NextResponse.json({ error: convErr?.message ?? 'Failed to create AI conversation' }, { status: 500 })
    }

    existingConvId = conv.id

    // Add the real user + the AI system profile as members
    const { error: membersErr } = await supabaseAdmin
      .from('conversation_members')
      .insert([
        { conversation_id: existingConvId, user_id: user.id, role: 'member' },
        { conversation_id: existingConvId, user_id: BORDS_AI_PROFILE_ID, role: 'member' },
      ])

    if (membersErr) {
      // Clean up the orphaned conversation
      await supabaseAdmin.from('conversations').delete().eq('id', existingConvId)
      return NextResponse.json({ error: membersErr.message }, { status: 500 })
    }

    // Post a welcome system message
    await supabaseAdmin.from('messages').insert({
      conversation_id: existingConvId,
      sender_id: BORDS_AI_PROFILE_ID,
      content: "Hi! I'm Bords AI. Ask me anything about your boards, tasks, or just chat. I'm here to help.",
      is_system_message: true,
      is_ai_message: true,
    })
  }

  // ── 3. Return the conversation in API shape ───────────────────────────────
  const { data: conv } = await supabaseAdmin
    .from('conversations')
    .select('id, type, name, description, avatar_url, organization_id, workspace_id, created_by, created_at, updated_at, is_ai_conversation')
    .eq('id', existingConvId)
    .single()

  const { data: lastMsg } = await supabaseAdmin
    .from('messages')
    .select('id, content, sender_id, created_at')
    .eq('conversation_id', existingConvId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    id: conv!.id,
    type: conv!.type,
    name: 'Bords AI',
    description: null,
    avatarUrl: null,
    organizationId: conv!.organization_id,
    workspaceId: conv!.workspace_id,
    createdBy: conv!.created_by,
    createdAt: conv!.created_at,
    updatedAt: conv!.updated_at,
    isAiConversation: true,
    members: [
      {
        userId: BORDS_AI_PROFILE_ID,
        role: 'member',
        profile: { firstName: 'Bords', lastName: 'AI', image: null, email: 'ai@bords.app' },
      },
      { userId: user.id, role: 'member', profile: null },
    ],
    lastMessage: lastMsg
      ? { id: lastMsg.id, content: lastMsg.content, senderId: lastMsg.sender_id, senderName: 'Bords AI', createdAt: lastMsg.created_at }
      : null,
    unreadCount: 0,
  })
}
