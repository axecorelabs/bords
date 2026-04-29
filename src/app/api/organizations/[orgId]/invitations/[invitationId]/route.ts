import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden } from '@/lib/api-helpers'

// DELETE /api/organizations/[orgId]/invitations/[invitationId] — revoke a pending invitation
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; invitationId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { orgId, invitationId } = await params

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, owner_id')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return notFound('Organization')

  // Owner and admins can revoke invitations
  if (org.owner_id !== user.id) {
    const { data: membership } = await supabaseAdmin
      .from('employee_memberships')
      .select('role')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership || membership.role !== 'admin') return forbidden()
  }

  const { data: invitation } = await supabaseAdmin
    .from('invitations')
    .select('id')
    .eq('id', invitationId)
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .maybeSingle()
  if (!invitation) return notFound('Invitation')

  // Delete the invitation
  await supabaseAdmin.from('invitations').delete().eq('id', invitationId)

  // Remove any pending org_invitation notifications for this invitation
  const { data: notifs } = await supabaseAdmin
    .from('notifications')
    .select('id, metadata')
    .eq('type', 'org_invitation')
    .eq('is_read', false)

  for (const n of notifs || []) {
    const meta = n.metadata as any
    if (meta?.invitationId === invitationId) {
      await supabaseAdmin.from('notifications').delete().eq('id', n.id)
    }
  }

  return NextResponse.json({ success: true })
}
