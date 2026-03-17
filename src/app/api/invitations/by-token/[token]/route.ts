import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// GET /api/invitations/by-token/[token] — fetch invitation details by token
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const { data: invitation } = await supabaseAdmin
    .from('invitations')
    .select('*')
    .eq('token', token)
    .maybeSingle()

  if (!invitation) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  }

  // Get org details
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .eq('id', invitation.organization_id)
    .maybeSingle()

  // Get inviter details
  const { data: inviter } = await supabaseAdmin
    .from('profiles')
    .select('first_name, last_name, email, image')
    .eq('id', invitation.invited_by)
    .maybeSingle()

  return NextResponse.json({
    invitation: {
      _id: invitation.id,
      organizationId: invitation.organization_id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expires_at,
      createdAt: invitation.created_at,
    },
    organization: org ? { _id: org.id, name: org.name } : null,
    inviter: inviter ? {
      name: `${inviter.first_name || ''} ${inviter.last_name || ''}`.trim() || inviter.email,
      email: inviter.email,
      image: inviter.image,
    } : null,
  })
}
