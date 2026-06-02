import { NextRequest, NextResponse } from 'next/server'
import { render } from '@react-email/components'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden, badRequest } from '@/lib/api-helpers'
import { generateToken } from '@/lib/auth'
import { sendEmail } from '@/lib/email'
import OrganizationInviteEmail from '@/emails/OrganizationInviteEmail'
import { actionLimiter, checkRateLimit } from '@/lib/rate-limit'
import { cacheInvalidatePattern } from '@/lib/cache'

// GET /api/organizations/[orgId]/employees — list employees
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { orgId } = await params

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, owner_id, name')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return notFound('Organization')

  const isOwner = org.owner_id === user.id

  let callerRole: string = isOwner ? 'owner' : 'member'
  if (!isOwner) {
    const { data: membership } = await supabaseAdmin
      .from('employee_memberships')
      .select('id, role')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) return forbidden()
    callerRole = membership.role || 'member'
  }

  const canManageMembers = isOwner || callerRole === 'admin'

  const { data: memberships } = await supabaseAdmin
    .from('employee_memberships')
    .select('id, organization_id, user_id, role, created_at')
    .eq('organization_id', orgId)

  // Fetch user profiles
  const userIds = (memberships || []).map(m => m.user_id)
  const { data: profiles } = userIds.length > 0
    ? await supabaseAdmin.from('profiles').select('id, email, first_name, last_name, image').in('id', userIds)
    : { data: [] }
  const profileMap = new Map((profiles || []).map(p => [p.id, p]))

  const employees = (memberships || []).map((m: any) => {
    const profile = profileMap.get(m.user_id)
    return {
      _id: m.id,
      organizationId: m.organization_id,
      userId: m.user_id,
      role: m.role || 'member',
      user: profile ? {
        _id: profile.id,
        email: profile.email,
        firstName: profile.first_name,
        lastName: profile.last_name,
        image: profile.image,
      } : { _id: m.user_id },
      createdAt: m.created_at,
    }
  })

  let pendingInvitations: any[] = []
  if (canManageMembers) {
    const { data: invitations } = await supabaseAdmin
      .from('invitations')
      .select('id, email, status, org_role, created_at')
      .eq('organization_id', orgId)
      .eq('role', 'employee')
      .eq('status', 'pending')

    pendingInvitations = (invitations || []).map((i: any) => ({
      _id: i.id,
      email: i.email,
      status: i.status,
      orgRole: i.org_role || 'member',
      createdAt: i.created_at,
    }))
  }

  return NextResponse.json(
    { employees, pendingInvitations, isOwner, callerRole, canManageMembers },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    }
  )
}

// POST /api/organizations/[orgId]/employees — invite an employee
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  // Rate limit by user ID
  const rateLimited = await checkRateLimit(actionLimiter, user.id)
  if (rateLimited) return rateLimited

  const { orgId } = await params
  const { email, orgRole } = await req.json()
  if (!email?.trim()) return badRequest('Email is required')
  const resolvedOrgRole = orgRole === 'admin' ? 'admin' : 'member'

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, owner_id, name')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return notFound('Organization')

  // Only owner and admins can invite
  const isOwner = org.owner_id === user.id
  if (!isOwner) {
    const { data: membership } = await supabaseAdmin
      .from('employee_memberships')
      .select('role')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership || membership.role !== 'admin') return forbidden()
    // Admins can only invite members, not other admins
    if (resolvedOrgRole === 'admin') {
      return badRequest('Only the organization owner can invite admins')
    }
  }

  const normalizedEmail = email.trim().toLowerCase()

  if (normalizedEmail === user.email?.toLowerCase()) {
    return badRequest('You cannot invite yourself')
  }

  // Check if already an employee
  const { data: existingProfile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (existingProfile) {
    const { data: existingMembership } = await supabaseAdmin
      .from('employee_memberships')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_id', existingProfile.id)
      .maybeSingle()
    if (existingMembership) {
      return badRequest('User is already an employee of this organization')
    }
  }

  // Check for existing pending invitation
  const { data: existingInvite } = await supabaseAdmin
    .from('invitations')
    .select('id')
    .eq('organization_id', orgId)
    .eq('email', normalizedEmail)
    .eq('status', 'pending')
    .maybeSingle()
  if (existingInvite) {
    return badRequest('Invitation already sent to this email')
  }

  const token = generateToken()
  const { data: invitation } = await supabaseAdmin
    .from('invitations')
    .insert({
      organization_id: orgId,
      email: normalizedEmail,
      role: 'employee',
      org_role: resolvedOrgRole,
      invited_by: user.id,
      token,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single()

  const inviterName = user.name || user.email || 'Someone'
  const baseUrl = process.env.NODE_ENV === 'development'
    ? 'http://localhost:3000'
    : 'https://app.bords.app'

  // In-app notification if user exists
  if (existingProfile) {
    await supabaseAdmin.from('notifications').insert({
      user_id: existingProfile.id,
      type: 'org_invitation',
      title: `Invitation to join ${org.name}`,
      message: `${inviterName} invited you to join ${org.name} as a team member`,
      metadata: {
        organizationId: orgId,
        organizationName: org.name,
        invitationId: invitation!.id,
      },
      is_read: false,
    })
  }

  // Send invitation email
  let emailSent = true
  let emailWarning: string | undefined
  try {
    const invitePageUrl = `${baseUrl}/invite/${token}`
    const emailHtml = await render(
      OrganizationInviteEmail({
        organizationName: org.name,
        inviterName,
        inviterEmail: user.email || '',
        role: 'employee',
        acceptUrl: invitePageUrl,
      })
    )

    await sendEmail({
      to: normalizedEmail,
      subject: `${inviterName} invited you to join ${org.name} on BORDS`,
      html: emailHtml,
    })
  } catch (error) {
    emailSent = false
    emailWarning = 'Invitation created, but email delivery failed. Please ask the user to check the invite page manually.'
    console.error('Failed to send invitation email:', error)
  }

  // Invalidate org dashboard cache for all users
  await cacheInvalidatePattern(`cache:org-dash:${orgId}:*`)

  return NextResponse.json({
    invitation: {
      _id: invitation!.id,
      email: normalizedEmail,
      status: 'pending',
      createdAt: invitation!.created_at,
    },
    emailSent,
    userExists: !!existingProfile,
    message: emailWarning || (existingProfile
      ? undefined
      : `${normalizedEmail} doesn't have a BORDS account yet. We've sent them an invitation to join!`),
  }, { status: 201 })
}
