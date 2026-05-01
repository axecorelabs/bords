import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/api-helpers'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { id: conversationId } = await params
  const body = await req.json().catch(() => ({}))
  const boardIds = Array.isArray(body?.boardIds)
    ? [...new Set(body.boardIds.filter((v: any) => typeof v === 'string' && v.trim()).map((v: string) => v.trim()))]
    : []

  if (boardIds.length === 0) return badRequest('boardIds is required')

  const [{ data: conv }, { data: memberRows }] = await Promise.all([
    supabaseAdmin
      .from('conversations')
      .select('id, organization_id')
      .eq('id', conversationId)
      .maybeSingle(),
    supabaseAdmin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId),
  ])

  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  if (!conv.organization_id) return badRequest('Grant access is only supported for organization conversations')

  const isMember = (memberRows ?? []).some((m: any) => m.user_id === user.id)
  if (!isMember) return forbidden()

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('owner_id')
    .eq('id', conv.organization_id)
    .maybeSingle()

  if (org?.owner_id !== user.id) {
    return forbidden()
  }

  const memberIds = (memberRows ?? []).map((m: any) => m.user_id).filter((id: string) => id !== user.id)
  if (memberIds.length === 0) return NextResponse.json({ ok: true, grants: [] })

  const { data: bords } = await supabaseAdmin
    .from('bords')
    .select('id, local_board_id, owner_id, visibility, organization_id')
    .in('local_board_id', boardIds)
    .eq('organization_id', conv.organization_id)

  const bordByLocalId = new Map((bords ?? []).map((b: any) => [b.local_board_id, b]))

  const { data: accessRows } = await supabaseAdmin
    .from('bord_access_list')
    .select('bord_id, user_id')
    .in('bord_id', (bords ?? []).map((b: any) => b.id))
    .in('user_id', memberIds)

  const { data: bordMemberRows } = await supabaseAdmin
    .from('bord_members')
    .select('bord_id, user_id')
    .in('bord_id', (bords ?? []).map((b: any) => b.id))
    .in('user_id', memberIds)

  const existingMap = new Map<string, Set<string>>()
  const addExisting = (bordId: string, userId: string) => {
    const set = existingMap.get(bordId) ?? new Set<string>()
    set.add(userId)
    existingMap.set(bordId, set)
  }

  for (const row of accessRows ?? []) {
    addExisting((row as any).bord_id, (row as any).user_id)
  }
  for (const row of bordMemberRows ?? []) {
    addExisting((row as any).bord_id, (row as any).user_id)
  }
  for (const b of bords ?? []) {
    addExisting((b as any).id, (b as any).owner_id)
  }

  const grants: Array<{ boardId: string; grantedCount: number; skippedCount: number }> = []

  for (const localBoardId of boardIds) {
    const bord = bordByLocalId.get(localBoardId)
    if (!bord) continue

    // Org-visible boards are already open to org members.
    if (bord.visibility === 'org') {
      grants.push({ boardId: localBoardId, grantedCount: 0, skippedCount: memberIds.length })
      continue
    }

    const already = existingMap.get(bord.id) ?? new Set<string>()
    const missing = memberIds.filter((uid) => !already.has(uid))

    if (missing.length > 0) {
      await supabaseAdmin
        .from('bord_access_list')
        .upsert(
          missing.map((uid) => ({
            bord_id: bord.id,
            user_id: uid,
            permission: 'view',
          })),
          { onConflict: 'bord_id,user_id' }
        )
    }

    grants.push({
      boardId: localBoardId,
      grantedCount: missing.length,
      skippedCount: memberIds.length - missing.length,
    })
  }

  return NextResponse.json({ ok: true, grants })
}
