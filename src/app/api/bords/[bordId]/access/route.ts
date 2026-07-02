import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden, badRequest } from '@/lib/api-helpers'
import { cacheInvalidatePattern } from '@/lib/cache'
import { apiLimiter, checkRateLimit, getRateLimitKey } from '@/lib/rate-limit'

async function canManageBordAccess(bord: { owner_id: string; organization_id: string | null }, userId: string): Promise<boolean> {
  if (bord.owner_id === userId) return true
  if (!bord.organization_id) return false

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('owner_id')
    .eq('id', bord.organization_id)
    .maybeSingle()

  if (org?.owner_id === userId) return true

  const { data: membership } = await supabaseAdmin
    .from('employee_memberships')
    .select('role')
    .eq('organization_id', bord.organization_id)
    .eq('user_id', userId)
    .maybeSingle()

  return membership?.role === 'admin'
}

/**
 * GET /api/bords/[bordId]/access
 * Returns the current access list for a bord + all org employees (for the picker).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bordId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const rateLimitRes = await checkRateLimit(apiLimiter, getRateLimitKey(req, user.id))
  if (rateLimitRes) return rateLimitRes

  const { bordId } = await params

  const { data: bord } = await supabaseAdmin
    .from('bords')
    .select('id, owner_id, organization_id, visibility')
    .eq('id', bordId)
    .maybeSingle()

  if (!bord) return notFound('Bord')
  if (!(await canManageBordAccess(bord, user.id))) return forbidden()

  // Get current access list
  const { data: accessList } = await supabaseAdmin
    .from('bord_access_list')
    .select('user_id, permission')
    .eq('bord_id', bordId)

  // Get all org employees with profile info
  const { data: memberships } = await supabaseAdmin
    .from('employee_memberships')
    .select('user_id, profiles(id, email, first_name, last_name, image)')
    .eq('organization_id', bord.organization_id!)

  // Exclude the org owner from the employees picker — their access is immutable
  // and is always enforced server-side (re-upserted on every PUT).
  let orgOwnerId: string | null = null
  if (bord.organization_id) {
    const { data: orgRow } = await supabaseAdmin
      .from('organizations')
      .select('owner_id')
      .eq('id', bord.organization_id)
      .maybeSingle()
    orgOwnerId = orgRow?.owner_id ?? null
  }

  const employees = (memberships || []).map((m: any) => ({
    userId: m.profiles?.id || m.user_id,
    email: m.profiles?.email,
    firstName: m.profiles?.first_name,
    lastName: m.profiles?.last_name,
    image: m.profiles?.image,
  })).filter((e: any) => e.userId !== orgOwnerId)

  return NextResponse.json({
    visibility: bord.visibility || 'private',
    accessList: (accessList || []).map((entry: any) => ({
      userId: entry.user_id,
      permission: entry.permission || 'view',
    })),
    employees,
  })
}

/**
 * PUT /api/bords/[bordId]/access
 * Update the access list for a bord.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ bordId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const rateLimitRes = await checkRateLimit(apiLimiter, getRateLimitKey(req, user.id))
  if (rateLimitRes) return rateLimitRes

  const { bordId } = await params
  const body = await req.json()
  const { accessList, visibility } = body

  // accessList is optional — omit it to update visibility only
  const hasAccessListUpdate = accessList !== undefined

  if (hasAccessListUpdate && !Array.isArray(accessList)) {
    return badRequest('accessList must be an array of { userId, permission } entries')
  }

  if (visibility !== undefined && !['private', 'org'].includes(visibility)) {
    return badRequest('visibility must be "private" or "org"')
  }

  // Normalize
  const normalizedList = hasAccessListUpdate
    ? (accessList as any[]).map((entry: any) => {
        if (typeof entry === 'string') return { userId: entry, permission: 'view' as const }
        return { userId: entry.userId, permission: entry.permission || 'view' }
      })
    : null

  const { data: bord } = await supabaseAdmin
    .from('bords')
    .select('id, owner_id, organization_id, visibility')
    .eq('id', bordId)
    .maybeSingle()

  if (!bord) return notFound('Bord')
  if (!(await canManageBordAccess(bord, user.id))) return forbidden()

  // Validate all userIds are actual org employees or the org owner
  if (normalizedList && normalizedList.length > 0 && bord.organization_id) {
    const userIds = normalizedList.map((e: any) => e.userId)

    // Fetch org owner so they are always considered a valid access list entry
    const { data: orgRow } = await supabaseAdmin
      .from('organizations')
      .select('owner_id')
      .eq('id', bord.organization_id)
      .maybeSingle()
    const orgOwnerId = orgRow?.owner_id ?? null

    const { data: validMemberships } = await supabaseAdmin
      .from('employee_memberships')
      .select('user_id')
      .eq('organization_id', bord.organization_id)
      .in('user_id', userIds)

    const validUserIds = new Set((validMemberships || []).map((m: any) => m.user_id))
    if (orgOwnerId) validUserIds.add(orgOwnerId)

    const invalidIds = userIds.filter((id: string) => !validUserIds.has(id))
    if (invalidIds.length > 0) {
      return badRequest('Some user IDs are not members of this organization')
    }
  }

  // Validate permissions
  if (normalizedList) {
    for (const entry of normalizedList) {
      if (!['view', 'edit'].includes(entry.permission)) {
        return badRequest('permission must be "view" or "edit"')
      }
    }
  }

  // Execute updates sequentially to avoid race condition on access list
  if (normalizedList !== null) {
    await supabaseAdmin.from('bord_access_list').delete().eq('bord_id', bordId)
  }

  if (visibility !== undefined && visibility !== bord.visibility) {
    await supabaseAdmin.from('bords').update({ visibility }).eq('id', bordId)
  }

  if (normalizedList !== null && normalizedList.length > 0) {
    await supabaseAdmin.from('bord_access_list').insert(
      normalizedList.map((entry: any) => ({
        bord_id: bordId,
        user_id: entry.userId,
        permission: entry.permission,
      }))
    )
  }

  // Always guarantee the org owner retains edit access — re-upsert unconditionally
  // so they cannot be removed even if their ID was omitted from the submitted list.
  if (normalizedList !== null && bord.organization_id) {
    const { data: orgRow } = await supabaseAdmin
      .from('organizations')
      .select('owner_id')
      .eq('id', bord.organization_id)
      .maybeSingle()
    if (orgRow?.owner_id) {
      await supabaseAdmin
        .from('bord_access_list')
        .upsert(
          { bord_id: bordId, user_id: orgRow.owner_id, permission: 'edit' } as never,
          { onConflict: 'bord_id,user_id' }
        )
    }
  }

  if (bord.organization_id) {
    await cacheInvalidatePattern(`cache:org-dash:${bord.organization_id}:*`)
  }

  return NextResponse.json({
    visibility: visibility ?? bord.visibility,
    accessList: normalizedList?.map((entry: any) => ({
      userId: entry.userId,
      permission: entry.permission,
    })) ?? null,
  })
}
