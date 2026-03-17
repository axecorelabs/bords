import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, badRequest } from '@/lib/api-helpers'

// GET /api/bords — list bords the user owns, is a BordMember of, or is on the accessList for
export async function GET() {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const [ownedRes, memberRes, accessRes] = await Promise.all([
    supabaseAdmin.from('bords').select('*').eq('owner_id', user.id),
    supabaseAdmin
      .from('bord_members')
      .select('bord_id, bords(*)')
      .eq('user_id', user.id),
    supabaseAdmin
      .from('bord_access_list')
      .select('bord_id, permission, bords(*)')
      .eq('user_id', user.id),
  ])

  const owned = ownedRes.data || []
  const memberBords: any[] = (memberRes.data || []).map((m: any) => m.bords).filter(Boolean).flat()
  const accessibleEntries: any[] = (accessRes.data || []).filter((a: any) => a.bords && a.bords.owner_id !== user.id)

  const seenIds = new Set<string>()
  const allBords: any[] = []

  const formatBord = (b: any, role: string, accessList?: any[]) => ({
    ...b,
    _id: b.id,
    organizationId: b.organization_id || '',
    ownerId: b.owner_id,
    localBoardId: b.local_board_id,
    contextType: b.context_type || 'personal',
    accessList: accessList || [],
    lastPublishedAt: b.last_published_at || null,
    role,
  })

  for (const b of owned) {
    seenIds.add(b.id)
    // Fetch access list for owned bords
    const { data: acl } = await supabaseAdmin
      .from('bord_access_list')
      .select('user_id, permission')
      .eq('bord_id', b.id)
    allBords.push(formatBord(b, 'owner', (acl || []).map(a => ({ userId: a.user_id, permission: a.permission }))))
  }

  for (const b of memberBords) {
    if (seenIds.has(b.id)) continue
    seenIds.add(b.id)
    allBords.push(formatBord(b, 'collaborator'))
  }

  for (const entry of accessibleEntries) {
    const b = entry.bords
    if (seenIds.has(b.id)) continue
    seenIds.add(b.id)
    allBords.push(formatBord(b, 'member'))
  }

  return NextResponse.json({ bords: allBords })
}

// POST /api/bords — link a local board to an org (creates server-side Bord reference)
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const { organizationId, localBoardId, title } = body

  if (!organizationId || !localBoardId || !title?.trim()) {
    return badRequest('organizationId, localBoardId, and title are required')
  }

  // Verify user is org owner or member
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, owner_id')
    .eq('id', organizationId)
    .maybeSingle()

  if (!org) return badRequest('Invalid organization')

  const isOwner = org.owner_id === user.id
  if (!isOwner) {
    const { data: membership } = await supabaseAdmin
      .from('employee_memberships')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) return badRequest('Invalid organization')
  }

  // Check if already linked
  const { data: existing } = await supabaseAdmin
    .from('bords')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('local_board_id', localBoardId)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({
      bord: {
        _id: existing.id,
        organizationId: existing.organization_id || '',
        localBoardId: existing.local_board_id,
        title: existing.title,
        ownerId: existing.owner_id,
        lastPublishedAt: existing.last_published_at || null,
      },
    })
  }

  const { data: bord, error } = await supabaseAdmin
    .from('bords')
    .insert({
      organization_id: organizationId,
      local_board_id: localBoardId,
      title: title.trim(),
      owner_id: user.id,
    })
    .select()
    .single()

  if (error) throw error

  return NextResponse.json({
    bord: {
      _id: bord.id,
      organizationId: bord.organization_id || '',
      localBoardId: bord.local_board_id,
      title: bord.title,
      ownerId: bord.owner_id,
      lastPublishedAt: null,
    },
  }, { status: 201 })
}
