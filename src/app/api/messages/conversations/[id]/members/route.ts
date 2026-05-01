import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/api-helpers'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/messages/conversations/[id]/members
 * Add members to a group conversation.
 * Allowed: group admin OR organization owner/admin.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const caller = await getAuthUser()
  if (!caller) return unauthorized()

  const { id: conversationId } = await params
  const body = await req.json().catch(() => ({}))
  const rawMemberIds: unknown[] = Array.isArray((body as any).memberIds) ? (body as any).memberIds : []
  const memberIds: string[] = rawMemberIds.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)

  if (memberIds.length === 0) return badRequest('memberIds is required')

  const { data: conv } = await supabaseAdmin
    .from('conversations')
    .select('id, type, organization_id')
    .eq('id', conversationId)
    .maybeSingle()

  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (conv.type !== 'group') return badRequest('Only group conversations support adding members')

  const { data: callerMember } = await supabaseAdmin
    .from('conversation_members')
    .select('role')
    .eq('conversation_id', conversationId)
    .eq('user_id', caller.id)
    .maybeSingle()

  if (!callerMember) return forbidden()

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
        .eq('user_id', caller.id)
        .maybeSingle(),
    ])
    canManage = org?.owner_id === caller.id || emp?.role === 'admin'
  }

  if (!canManage) return forbidden()

  const uniqueIds = [...new Set(memberIds)].filter((uid) => uid !== caller.id)

  const { data: existingMembers } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId)

  const existingSet = new Set((existingMembers || []).map((m: any) => m.user_id))
  const toAdd = uniqueIds.filter((uid) => !existingSet.has(uid))

  // For org groups, only organization members can be added.
  let filteredToAdd = toAdd
  if (conv.organization_id && toAdd.length > 0) {
    const { data: validMembers } = await supabaseAdmin
      .from('employee_memberships')
      .select('user_id')
      .eq('organization_id', conv.organization_id)
      .in('user_id', toAdd)

    const validSet = new Set((validMembers || []).map((m: any) => m.user_id))
    filteredToAdd = toAdd.filter((uid) => validSet.has(uid))
  }

  if (filteredToAdd.length > 0) {
    await supabaseAdmin
      .from('conversation_members')
      .insert(filteredToAdd.map((uid) => ({
        conversation_id: conversationId,
        user_id: uid,
        role: 'member',
      })))
  }

  return NextResponse.json({ ok: true, addedCount: filteredToAdd.length })
}
