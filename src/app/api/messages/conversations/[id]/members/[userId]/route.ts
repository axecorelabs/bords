import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/api-helpers'

type Params = { params: Promise<{ id: string; userId: string }> }

async function canManageConversation(callerId: string, conversationId: string) {
  const { data: conv } = await supabaseAdmin
    .from('conversations')
    .select('id, type, organization_id')
    .eq('id', conversationId)
    .maybeSingle()

  if (!conv || conv.type !== 'group') return { ok: false, conv }

  const { data: callerMember } = await supabaseAdmin
    .from('conversation_members')
    .select('role')
    .eq('conversation_id', conversationId)
    .eq('user_id', callerId)
    .maybeSingle()

  if (!callerMember) return { ok: false, conv }

  let canManage = callerMember.role === 'admin'
  if (!canManage && conv.organization_id) {
    const [{ data: org }, { data: emp }] = await Promise.all([
      supabaseAdmin
        .from('organizations')
        .select('owner_id')
        .eq('id', conv.organization_id)
        .maybeSingle(),
      supabaseAdmin
        .from('employee_memberships')
        .select('role')
        .eq('organization_id', conv.organization_id)
        .eq('user_id', callerId)
        .maybeSingle(),
    ])
    canManage = org?.owner_id === callerId || emp?.role === 'admin'
  }

  return { ok: canManage, conv }
}

/**
 * PATCH /api/messages/conversations/[id]/members/[userId]
 * Update member role (admin/member) in a group conversation.
 * Allowed: group admin OR organization owner/admin.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const caller = await getAuthUser()
  if (!caller) return unauthorized()

  const { id: conversationId, userId } = await params
  const body = await req.json().catch(() => ({}))
  const role = body?.role

  if (role !== 'admin' && role !== 'member') {
    return badRequest('role must be admin or member')
  }

  const management = await canManageConversation(caller.id, conversationId)
  if (!management.conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!management.ok) return forbidden()

  const { data: target } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id, role')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  if (target.role === role) return NextResponse.json({ ok: true })

  if (target.role === 'admin' && role === 'member') {
    const { data: admins } = await supabaseAdmin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .eq('role', 'admin')

    if ((admins?.length ?? 0) <= 1) {
      return badRequest('Group must have at least one admin')
    }
  }

  await supabaseAdmin
    .from('conversation_members')
    .update({ role })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)

  return NextResponse.json({ ok: true })
}

/**
 * DELETE /api/messages/conversations/[id]/members/[userId]
 * Remove a member from a group conversation.
 * Allowed: group admin OR organization owner/admin.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const caller = await getAuthUser()
  if (!caller) return unauthorized()

  const { id: conversationId, userId } = await params

  const management = await canManageConversation(caller.id, conversationId)
  if (!management.conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (management.conv.type !== 'group') return badRequest('Only group conversations support member removal')
  if (userId === caller.id) return badRequest('Use leave group to remove yourself')
  if (!management.ok) return forbidden()

  const { data: target } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id, role')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!target) return NextResponse.json({ ok: true })

  await supabaseAdmin
    .from('conversation_members')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)

  // Keep at least one admin in the group.
  const { data: admins } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .eq('role', 'admin')

  if ((admins?.length ?? 0) === 0) {
    const { data: oldest } = await supabaseAdmin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (oldest?.user_id) {
      await supabaseAdmin
        .from('conversation_members')
        .update({ role: 'admin' })
        .eq('conversation_id', conversationId)
        .eq('user_id', oldest.user_id)
    }
  }

  return NextResponse.json({ ok: true })
}
