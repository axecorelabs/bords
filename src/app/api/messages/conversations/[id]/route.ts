import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/api-helpers'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/messages/conversations/[id]
 * Returns conversation metadata + members.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user) return unauthorized()

  const { id } = await params

  const [{ data: member }, { data: conv }] = await Promise.all([
    supabaseAdmin
      .from('conversation_members')
      .select('role')
      .eq('conversation_id', id)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabaseAdmin
      .from('conversations')
      .select('*')
      .eq('id', id)
      .maybeSingle(),
  ])

  if (!member) return forbidden()

  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: members } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id, role, joined_at')
    .eq('conversation_id', id)

  const memberIds = (members ?? []).map((m) => m.user_id)
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, last_name, image, email')
    .in('id', memberIds)

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

  let canManageGroup = member.role === 'admin'
  if (!canManageGroup && conv.organization_id) {
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
        .eq('user_id', user.id)
        .maybeSingle(),
    ])
    canManageGroup = org?.owner_id === user.id || emp?.role === 'admin'
  }

  return NextResponse.json({
    ...conv,
    viewerRole: member.role as 'admin' | 'member',
    canManageGroup,
    members: (members ?? []).map((m) => ({
      userId: m.user_id,
      role: m.role as 'admin' | 'member',
      profile: profileMap.get(m.user_id) ?? null,
    })),
  })
}

/**
 * PATCH /api/messages/conversations/[id]
 * Update group metadata (currently name + description).
 * Allowed: group admin OR organization owner/admin.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user) return unauthorized()

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : null
  const avatarUrl = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : ''

  if (!name) return badRequest('name is required')

  const [{ data: conv }, { data: member }] = await Promise.all([
    supabaseAdmin
      .from('conversations')
      .select('id, type, organization_id, is_ai_conversation')
      .eq('id', id)
      .maybeSingle(),
    supabaseAdmin
      .from('conversation_members')
      .select('role')
      .eq('conversation_id', id)
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (conv.type !== 'group' && !(conv as any).is_ai_conversation) {
    return badRequest('Only group or AI conversations can be edited')
  }

  if (!member) return forbidden()

  let canManage = member.role === 'admin'
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
        .eq('user_id', user.id)
        .maybeSingle(),
    ])
    canManage = org?.owner_id === user.id || emp?.role === 'admin'
  }

  if (!canManage) return forbidden()

  const updates: Record<string, unknown> = {
    name,
    updated_at: new Date().toISOString(),
  }

  if (!(conv as any).is_ai_conversation) {
    updates.description = description
  }

  if (Object.prototype.hasOwnProperty.call(body, 'avatarUrl')) {
    updates.avatar_url = avatarUrl || null
  }

  const { data: updated, error } = await supabaseAdmin
    .from('conversations')
    .update(updates)
    .eq('id', id)
    .select('id, name, description, avatar_url, updated_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, conversation: updated })
}

/**
 * DELETE /api/messages/conversations/[id]
 * Leave a conversation (removes current user from members).
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user) return unauthorized()

  const { id } = await params

  const { data: member } = await supabaseAdmin
    .from('conversation_members')
    .select('role')
    .eq('conversation_id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!member) return forbidden()

  // Prevent removing the last admin from a group; auto-promote oldest member if needed.
  const { data: conv } = await supabaseAdmin
    .from('conversations')
    .select('type')
    .eq('id', id)
    .maybeSingle()

  if (conv?.type === 'group' && member.role === 'admin') {
    const { data: admins } = await supabaseAdmin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', id)
      .eq('role', 'admin')

    if ((admins?.length ?? 0) <= 1) {
      const { data: nextAdmin } = await supabaseAdmin
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', id)
        .neq('user_id', user.id)
        .order('joined_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (nextAdmin?.user_id) {
        await supabaseAdmin
          .from('conversation_members')
          .update({ role: 'admin' })
          .eq('conversation_id', id)
          .eq('user_id', nextAdmin.user_id)
      }
    }
  }

  await supabaseAdmin
    .from('conversation_members')
    .delete()
    .eq('conversation_id', id)
    .eq('user_id', user.id)

  return NextResponse.json({ ok: true })
}
