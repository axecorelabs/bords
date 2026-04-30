import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden, badRequest } from '@/lib/api-helpers'

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

  const { bordId } = await params

  const { data: bord } = await supabaseAdmin
    .from('bords')
    .select('id, owner_id, organization_id, visibility')
    .eq('id', bordId)
    .maybeSingle()

  if (!bord) return notFound('Bord')
  if (bord.owner_id !== user.id) return forbidden()

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

  const employees = (memberships || []).map((m: any) => ({
    userId: m.profiles?.id || m.user_id,
    email: m.profiles?.email,
    firstName: m.profiles?.first_name,
    lastName: m.profiles?.last_name,
    image: m.profiles?.image,
  }))

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
  if (bord.owner_id !== user.id) return forbidden()

  // Validate all userIds are actual org employees
  if (normalizedList && normalizedList.length > 0) {
    const userIds = normalizedList.map((e: any) => e.userId)
    const { data: validMemberships } = await supabaseAdmin
      .from('employee_memberships')
      .select('user_id')
      .eq('organization_id', bord.organization_id!)
      .in('user_id', userIds)

    const validUserIds = new Set((validMemberships || []).map((m: any) => m.user_id))
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

  return NextResponse.json({
    visibility: visibility ?? bord.visibility,
    accessList: normalizedList?.map((entry: any) => ({
      userId: entry.userId,
      permission: entry.permission,
    })) ?? null,
  })
}
