import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, badRequest } from '@/lib/api-helpers'

/**
 * GET /api/workspaces
 * Returns both workspaces for the current user (personal + org_container).
 * Auto-provisions them if they don't exist yet.
 * Includes orgs the user owns AND orgs where the user is an employee/member.
 */
export async function GET() {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  // Fetch existing workspaces
  const { data: existing } = await supabaseAdmin
    .from('workspaces')
    .select('*')
    .eq('owner_id', user.id)

  let personal = existing?.find((w: any) => w.type === 'personal')
  let orgContainer = existing?.find((w: any) => w.type === 'organization_container')

  // Auto-provision workspaces if missing
  if (!personal) {
    const { data } = await supabaseAdmin
      .from('workspaces')
      .insert({ owner_id: user.id, type: 'personal', name: 'Personal' })
      .select()
      .single()
    personal = data
  }

  if (!orgContainer) {
    const { data } = await supabaseAdmin
      .from('workspaces')
      .insert({ owner_id: user.id, type: 'organization_container', name: 'Organizations' })
      .select()
      .single()
    orgContainer = data
  }

  // Fetch owned orgs + orgs where user is an employee/member
  const [ownedOrgsRes, membershipsRes] = await Promise.all([
    supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('employee_memberships')
      .select('organization_id, role, organizations(*)')
      .eq('user_id', user.id),
  ])

  const ownedOrgs = ownedOrgsRes.data || []

  // Deduplicate
  const ownedIds = new Set(ownedOrgs.map((o: any) => o.id))
  const allOrgs = [
    ...ownedOrgs.map((o: any) => ({
      _id: o.id,
      name: o.name,
      ownerId: o.owner_id,
      isOwner: true,
    })),
    ...(membershipsRes.data || [])
      .filter((m: any) => m.organizations && !ownedIds.has(m.organizations.id))
      .map((m: any) => ({
        _id: m.organizations.id,
        name: m.organizations.name,
        ownerId: m.organizations.owner_id,
        isOwner: false,
        role: m.role || 'member',
      })),
  ]

  return NextResponse.json({
    workspaces: {
      personal: {
        _id: personal?.id,
        type: personal?.type,
        name: personal?.name,
      },
      organizationContainer: {
        _id: orgContainer?.id,
        type: orgContainer?.type,
        name: orgContainer?.name,
        organizations: allOrgs,
      },
    },
  })
}

/**
 * PUT /api/workspaces
 * Update workspace name (personal workspace only).
 */
export async function PUT(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { workspaceId, name } = await req.json()
  if (!workspaceId || !name?.trim()) {
    return badRequest('workspaceId and name are required')
  }

  const { data: workspace, error } = await supabaseAdmin
    .from('workspaces')
    .update({ name: name.trim() })
    .eq('id', workspaceId)
    .eq('owner_id', user.id)
    .select()
    .single()

  if (error || !workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  return NextResponse.json({ workspace })
}
