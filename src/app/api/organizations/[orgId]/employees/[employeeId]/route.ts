import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden, badRequest } from '@/lib/api-helpers'
import { cacheInvalidatePattern } from '@/lib/cache'

// DELETE /api/organizations/[orgId]/employees/[employeeId]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; employeeId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { orgId, employeeId } = await params

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, owner_id')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return notFound('Organization')

  const isOwner = org.owner_id === user.id

  // Check if caller is admin
  let isAdmin = false
  if (!isOwner) {
    const { data: callerMembership } = await supabaseAdmin
      .from('employee_memberships')
      .select('role')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle()
    isAdmin = callerMembership?.role === 'admin'
    if (!isAdmin) return forbidden()
  }

  const { data: membership } = await supabaseAdmin
    .from('employee_memberships')
    .select('id, role, user_id')
    .eq('id', employeeId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!membership) return notFound('Employee membership')

  // Admins cannot remove other admins — only owner can
  if (isAdmin && !isOwner && membership.role === 'admin') {
    return forbidden()
  }

  // Nobody can remove the org owner's membership (shouldn't exist, but safeguard)
  if (membership.user_id === org.owner_id) {
    return forbidden()
  }

  await supabaseAdmin.from('employee_memberships').delete().eq('id', employeeId)

  // Keep org dashboard/member views consistent after removal.
  await cacheInvalidatePattern(`cache:org-dash:${orgId}:*`)

  return NextResponse.json({ success: true })
}

// PATCH /api/organizations/[orgId]/employees/[employeeId] — update employee role
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; employeeId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { orgId, employeeId } = await params
  const { role } = await req.json()

  if (!role || !['admin', 'member'].includes(role)) {
    return badRequest('Role must be "admin" or "member"')
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, owner_id')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return notFound('Organization')

  // Only org owner can change roles
  if (org.owner_id !== user.id) return forbidden()

  const { data: membership } = await supabaseAdmin
    .from('employee_memberships')
    .select('id, user_id')
    .eq('id', employeeId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!membership) return notFound('Employee membership')

  // Can't change the owner's own role
  if (membership.user_id === org.owner_id) {
    return badRequest('Cannot change the organization owner\'s role')
  }

  await supabaseAdmin
    .from('employee_memberships')
    .update({ role })
    .eq('id', employeeId)

  return NextResponse.json({ success: true, role })
}
