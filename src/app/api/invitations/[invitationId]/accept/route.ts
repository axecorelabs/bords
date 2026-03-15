import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, badRequest } from '@/lib/api-helpers'

// POST /api/invitations/[invitationId]/accept — accept an organization invitation
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ invitationId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { invitationId } = await params

  const { data: invitation } = await supabaseAdmin
    .from('invitations')
    .select('*')
    .eq('id', invitationId)
    .maybeSingle()

  if (!invitation) return notFound('Invitation')

  // Verify the invitation is for this user's email
  if (invitation.email !== user.email?.toLowerCase()) {
    return badRequest('This invitation is not for your account')
  }

  if (invitation.status === 'accepted') {
    return badRequest('Invitation has already been accepted')
  }

  if (invitation.status === 'expired' || new Date() > new Date(invitation.expires_at)) {
    await supabaseAdmin
      .from('invitations')
      .update({ status: 'expired' })
      .eq('id', invitationId)
    return badRequest('Invitation has expired')
  }

  // Verify the org still exists
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, owner_id')
    .eq('id', invitation.organization_id)
    .maybeSingle()
  if (!org) return notFound('Organization')

  // Check if already a member
  const { data: existingMembership } = await supabaseAdmin
    .from('employee_memberships')
    .select('id')
    .eq('organization_id', invitation.organization_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existingMembership) {
    await supabaseAdmin
      .from('invitations')
      .update({ status: 'accepted' })
      .eq('id', invitationId)
    return NextResponse.json({
      message: 'You are already a member of this organization',
      organizationId: invitation.organization_id,
    })
  }

  // Create the membership
  await supabaseAdmin.from('employee_memberships').insert({
    organization_id: invitation.organization_id,
    user_id: user.id,
  })

  // Mark invitation as accepted
  await supabaseAdmin
    .from('invitations')
    .update({ status: 'accepted' })
    .eq('id', invitationId)

  // Mark org_invitation notifications for this user as read
  const { data: notifs } = await supabaseAdmin
    .from('notifications')
    .select('id, metadata')
    .eq('user_id', user.id)
    .eq('type', 'org_invitation')
    .eq('is_read', false)

  for (const n of notifs || []) {
    const meta = n.metadata as any
    if (meta?.invitationId === invitationId) {
      await supabaseAdmin
        .from('notifications')
        .update({ is_read: true })
        .eq('id', n.id)
    }
  }

  // Notify the org owner
  const userName = user.name || user.email
  await supabaseAdmin.from('notifications').insert({
    user_id: org.owner_id,
    type: 'invitation_accepted',
    title: 'Invitation accepted',
    message: `${userName} has joined ${org.name}`,
    metadata: {
      organizationId: invitation.organization_id,
      organizationName: org.name,
    },
    is_read: false,
  })

  return NextResponse.json({
    message: `You have joined ${org.name}`,
    organizationId: invitation.organization_id,
    organizationName: org.name,
  })
}
