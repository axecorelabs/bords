import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, forbidden } from '@/lib/api-helpers'

type Params = { params: Promise<{ id: string }> }

type BordRow = {
  id: string
  local_board_id: string
  title: string | null
  organization_id: string | null
  owner_id: string
  visibility: string | null
  context_type: string | null
}

function normalizeHandle(title: string) {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
  return cleaned || 'board'
}

export async function GET(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user) return unauthorized()

  const { id: conversationId } = await params

  const [memberRes, convRes] = await Promise.all([
    supabaseAdmin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId),
    supabaseAdmin
      .from('conversations')
      .select('id, organization_id')
      .eq('id', conversationId)
      .maybeSingle(),
  ])

  const members = memberRes.data ?? []
  const conv = convRes.data

  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  if (!members.some((m: any) => m.user_id === user.id)) return forbidden()

  const memberIds = members.map((m: any) => m.user_id)
  let canGrantAccess = false
  if (conv.organization_id) {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('owner_id')
      .eq('id', conv.organization_id)
      .maybeSingle()
    canGrantAccess = org?.owner_id === user.id
  }

  // Sender-accessible boards (same access model as /api/bords)
  const [ownedRes, directMemberRes, accessRes, membershipsRes, ownedOrgsRes] = await Promise.all([
    supabaseAdmin
      .from('bords')
      .select('id, local_board_id, title, organization_id, owner_id, visibility, context_type')
      .eq('owner_id', user.id),
    supabaseAdmin
      .from('bord_members')
      .select('bord_id, bords!inner(id, local_board_id, title, organization_id, owner_id, visibility, context_type)')
      .eq('user_id', user.id),
    supabaseAdmin
      .from('bord_access_list')
      .select('bord_id, permission, bords!inner(id, local_board_id, title, organization_id, owner_id, visibility, context_type)')
      .eq('user_id', user.id),
    supabaseAdmin
      .from('employee_memberships')
      .select('organization_id, role')
      .eq('user_id', user.id),
    supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('owner_id', user.id),
  ])

  const membershipOrgIds = (membershipsRes.data ?? []).map((m: any) => m.organization_id)
  const ownedOrgIds = (ownedOrgsRes.data ?? []).map((o: any) => o.id)
  const orgIds = [...new Set([...membershipOrgIds, ...ownedOrgIds])]

  let orgWideBoards: BordRow[] = []
  if (orgIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('bords')
      .select('id, local_board_id, title, organization_id, owner_id, visibility, context_type')
      .in('organization_id', orgIds)
      .eq('context_type', 'organization')
      .eq('visibility', 'org')
    orgWideBoards = (data ?? []) as BordRow[]
  }

  const senderBoards = new Map<string, BordRow>()
  const pushSenderBoard = (row: any) => {
    if (!row?.id || !row?.local_board_id) return
    senderBoards.set(row.id, row as BordRow)
  }

  for (const b of ownedRes.data ?? []) pushSenderBoard(b)
  for (const m of directMemberRes.data ?? []) pushSenderBoard((m as any).bords)
  for (const a of accessRes.data ?? []) pushSenderBoard((a as any).bords)
  for (const b of orgWideBoards) pushSenderBoard(b)

  let candidateBoards = [...senderBoards.values()]

  // In org conversations, keep board tags scoped to that organization.
  if (conv.organization_id) {
    candidateBoards = candidateBoards.filter((b) => b.organization_id === conv.organization_id)
  }

  if (candidateBoards.length === 0) {
    return NextResponse.json({ boards: [], canGrantAccess })
  }

  const candidateBoardIds = candidateBoards.map((b) => b.id)

  // Access map for conversation members per board
  const [boardMembersRes, boardAclRes] = await Promise.all([
    supabaseAdmin
      .from('bord_members')
      .select('bord_id, user_id')
      .in('bord_id', candidateBoardIds)
      .in('user_id', memberIds),
    supabaseAdmin
      .from('bord_access_list')
      .select('bord_id, user_id')
      .in('bord_id', candidateBoardIds)
      .in('user_id', memberIds),
  ])

  const memberAccessMap = new Map<string, Set<string>>()
  const addAccess = (bordId: string, userId: string) => {
    const set = memberAccessMap.get(bordId) ?? new Set<string>()
    set.add(userId)
    memberAccessMap.set(bordId, set)
  }

  for (const b of candidateBoards) {
    addAccess(b.id, b.owner_id)
  }
  for (const row of boardMembersRes.data ?? []) {
    addAccess((row as any).bord_id, (row as any).user_id)
  }
  for (const row of boardAclRes.data ?? []) {
    addAccess((row as any).bord_id, (row as any).user_id)
  }

  // Org-visible boards are accessible by org owners/admins/members in that org.
  const orgVisibleBoards = candidateBoards.filter((b) => b.visibility === 'org' && b.organization_id)
  const orgVisibleOrgIds = [...new Set(orgVisibleBoards.map((b) => b.organization_id).filter(Boolean))] as string[]

  if (orgVisibleOrgIds.length > 0) {
    const [orgOwnersRes, orgMembersRes] = await Promise.all([
      supabaseAdmin
        .from('organizations')
        .select('id, owner_id')
        .in('id', orgVisibleOrgIds),
      supabaseAdmin
        .from('employee_memberships')
        .select('organization_id, user_id')
        .in('organization_id', orgVisibleOrgIds)
        .in('user_id', memberIds),
    ])

    const orgOwnerMap = new Map((orgOwnersRes.data ?? []).map((o: any) => [o.id, o.owner_id]))
    const orgMemberMap = new Map<string, Set<string>>()

    for (const row of orgMembersRes.data ?? []) {
      const orgId = (row as any).organization_id
      const set = orgMemberMap.get(orgId) ?? new Set<string>()
      set.add((row as any).user_id)
      orgMemberMap.set(orgId, set)
    }

    for (const board of orgVisibleBoards) {
      const orgId = board.organization_id as string
      const ownerId = orgOwnerMap.get(orgId)
      if (ownerId) addAccess(board.id, ownerId)
      const orgUsers = orgMemberMap.get(orgId)
      if (orgUsers) {
        for (const uid of orgUsers) addAccess(board.id, uid)
      }
    }
  }

  const totalMembers = memberIds.length

  const boards = candidateBoards
    .map((b) => {
      const accessSet = memberAccessMap.get(b.id) ?? new Set<string>()
      let accessibleCount = 0
      for (const uid of memberIds) {
        if (accessSet.has(uid)) accessibleCount += 1
      }

      const scope = accessibleCount === totalMembers
        ? 'everyone'
        : accessibleCount > 1
          ? 'some_members'
          : 'only_you'

      return {
        boardId: b.local_board_id,
        title: b.title ?? 'Untitled board',
        organizationId: b.organization_id,
        handle: normalizeHandle(b.title ?? 'board'),
        accessibility: {
          scope,
          accessibleCount,
          totalMembers,
        },
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title))

  return NextResponse.json({ boards, canGrantAccess })
}
