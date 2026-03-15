import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden } from '@/lib/api-helpers'

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
  if (org.owner_id !== user.id) return forbidden()

  const { data: membership } = await supabaseAdmin
    .from('employee_memberships')
    .select('id')
    .eq('id', employeeId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!membership) return notFound('Employee membership')

  await supabaseAdmin.from('employee_memberships').delete().eq('id', employeeId)

  return NextResponse.json({ success: true })
}
