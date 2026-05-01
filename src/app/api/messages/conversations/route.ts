import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, badRequest } from '@/lib/api-helpers'

/**
 * GET /api/messages/conversations
 * Returns all conversations the current user is a member of, with last message + unread count.
 * Query params:
 *   ?context=org&orgId=<uuid>   → org group channels + DMs within that org
 *   ?context=personal            → personal group chats + DMs within personal workspace
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { searchParams } = new URL(req.url)
  const context = searchParams.get('context')   // 'org' | 'personal'
  const orgId   = searchParams.get('orgId')

  // Get all conversation IDs this user belongs to
  const { data: memberships } = await supabaseAdmin
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', user.id)

  if (!memberships?.length) return NextResponse.json([])

  const convIds = memberships.map((m) => m.conversation_id)

  // Build conversation query with context filter
  let convQuery = supabaseAdmin
    .from('conversations')
    .select('id, type, name, description, avatar_url, organization_id, workspace_id, created_by, created_at, updated_at')
    .in('id', convIds)
    .order('updated_at', { ascending: false })

  if (context === 'org' && orgId) {
    convQuery = convQuery.eq('organization_id', orgId)
  } else if (context === 'personal') {
    convQuery = convQuery.is('organization_id', null)
  }

  const { data: conversations, error } = await convQuery
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!conversations?.length) return NextResponse.json([])

  // Fetch last message for each conversation
  const { data: lastMessages } = await supabaseAdmin
    .from('messages')
    .select('id, conversation_id, content, sender_id, created_at, is_deleted')
    .in('conversation_id', conversations.map((c) => c.id))
    .order('created_at', { ascending: false })

  // Fetch unread counts (messages after user's last_read_at)
  const { data: reads } = await supabaseAdmin
    .from('conversation_reads')
    .select('conversation_id, last_read_at')
    .eq('user_id', user.id)
    .in('conversation_id', conversations.map((c) => c.id))

  const readsMap = new Map(reads?.map((r) => [r.conversation_id, r.last_read_at]) ?? [])

  // Fetch all members for these conversations (for DM display names / avatars)
  const { data: allMembers } = await supabaseAdmin
    .from('conversation_members')
    .select('conversation_id, user_id, role')
    .in('conversation_id', conversations.map((c) => c.id))

  // Fetch profiles for all unique member user IDs
  const memberUserIds = [...new Set((allMembers ?? []).map((m) => m.user_id))]
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, last_name, image, email')
    .in('id', memberUserIds)

  const profileMap = new Map(
    profiles?.map((p) => [
      p.id,
      {
        id: p.id,
        firstName: p.first_name,
        lastName: p.last_name,
        image: p.image,
        email: p.email,
      },
    ]) ?? []
  )

  // Build per-conversation unread counts
  const unreadCounts = new Map<string, number>()
  if (lastMessages) {
    const lastReadByConv = readsMap
    for (const conv of conversations) {
      const lastRead = lastReadByConv.get(conv.id)
      const unread = lastMessages.filter(
        (m) =>
          m.conversation_id === conv.id &&
          m.sender_id !== user.id &&
          !m.is_deleted &&
          (!lastRead || new Date(m.created_at) > new Date(lastRead))
      ).length
      unreadCounts.set(conv.id, unread)
    }
  }

  // Shape the response
  const result = conversations.map((conv) => {
    const members = (allMembers ?? [])
      .filter((m) => m.conversation_id === conv.id)
      .map((m) => ({
        userId: m.user_id,
        role: m.role as 'admin' | 'member',
        profile: profileMap.get(m.user_id) ?? null,
      }))

    const lastMsg = lastMessages?.find(
      (m) => m.conversation_id === conv.id && !m.is_deleted
    ) ?? null

    // For DMs, derive display name from the other participant
    let displayName = conv.name
    if (conv.type === 'dm' && !displayName) {
      const other = members.find((m) => m.userId !== user.id)
      const p = other?.profile
      displayName = p ? `${p.firstName} ${p.lastName}`.trim() : 'Direct Message'
    }

    const lastMsgProfile = lastMsg ? profileMap.get(lastMsg.sender_id) : null

    return {
      id: conv.id,
      type: conv.type,
      name: displayName,
      description: conv.description,
      avatarUrl: conv.avatar_url,
      organizationId: conv.organization_id,
      workspaceId: conv.workspace_id,
      createdBy: conv.created_by,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      members,
      lastMessage: lastMsg
        ? {
            id: lastMsg.id,
            content: lastMsg.content,
            senderId: lastMsg.sender_id,
            senderName: lastMsgProfile
              ? `${lastMsgProfile.firstName} ${lastMsgProfile.lastName}`.trim()
              : '',
            createdAt: lastMsg.created_at,
          }
        : null,
      unreadCount: unreadCounts.get(conv.id) ?? 0,
    }
  })

  return NextResponse.json(result)
}

/**
 * POST /api/messages/conversations
 * Create a new conversation (DM or group channel).
 * Body: { type, memberIds, name?, description?, organizationId?, workspaceId? }
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const { type, memberIds, name, description, organizationId, workspaceId } = body

  if (!type || !['dm', 'group'].includes(type)) return badRequest('type must be dm or group')
  if (!Array.isArray(memberIds) || memberIds.length === 0) return badRequest('memberIds required')
  if (type === 'group' && !name?.trim()) return badRequest('name required for group')

  // For DMs, check if one already exists between these exact two users
  if (type === 'dm') {
    const otherUserId = memberIds.find((id: string) => id !== user.id)
    if (!otherUserId) return badRequest('Need at least one other member for a DM')

    const { data: existing } = await supabaseAdmin.rpc('find_dm_conversation', {
      user_a: user.id,
      user_b: otherUserId,
      p_org_id: organizationId ?? null,
    })
    if (existing) return NextResponse.json(existing)
  }

  // Create conversation
  const { data: conv, error: convErr } = await supabaseAdmin
    .from('conversations')
    .insert({
      type,
      name: name?.trim() ?? null,
      description: description?.trim() ?? null,
      organization_id: organizationId ?? null,
      workspace_id: workspaceId ?? null,
      created_by: user.id,
    })
    .select()
    .single()

  if (convErr || !conv) return NextResponse.json({ error: convErr?.message ?? 'Failed to create conversation' }, { status: 500 })

  // Add members (ensure creator is included as admin)
  const allMemberIds = [...new Set([user.id, ...memberIds])]
  const memberRows = allMemberIds.map((uid: string) => ({
    conversation_id: conv.id,
    user_id: uid,
    role: uid === user.id ? 'admin' : 'member',
  }))

  await supabaseAdmin.from('conversation_members').insert(memberRows)

  // Fire-and-forget: queue activity notifications for group members (non-creator)
  if (type === 'group') {
    void (async () => {
      try {
        const creatorProfile = await supabaseAdmin
          .from('profiles')
          .select('first_name, last_name')
          .eq('id', user.id)
          .maybeSingle()
          .then((r) => r.data)

        const creatorName = creatorProfile
          ? `${creatorProfile.first_name || ''} ${creatorProfile.last_name || ''}`.trim() || 'Someone'
          : 'Someone'

        const groupTitle = name?.trim() ?? 'a group'
        const recipients = allMemberIds.filter((uid: string) => uid !== user.id)

        if (recipients.length === 0) return

        const notifications = recipients.map((uid: string) => ({
          user_id: uid,
          type: 'group_chat_added' as const,
          title: 'Added to a group chat',
          message: `${creatorName} added you to "${groupTitle}"`,
          metadata: {
            conversationId: conv.id,
            conversationName: groupTitle,
            createdBy: user.id,
            creatorName,
          },
          is_read: false,
        }))

        await supabaseAdmin.from('notifications').insert(notifications)
      } catch {
        // Swallow — notifications are best-effort
      }
    })()
  }

  return NextResponse.json({ id: conv.id, ...conv }, { status: 201 })
}
