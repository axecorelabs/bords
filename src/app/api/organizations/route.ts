import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, badRequest } from '@/lib/api-helpers'

// GET /api/organizations — list orgs the user owns or is an employee of
export async function GET() {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const [ownedRes, membershipRes] = await Promise.all([
    supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('owner_id', user.id),
    supabaseAdmin
      .from('employee_memberships')
      .select('organization_id, role, organizations(*)')
      .eq('user_id', user.id),
  ])

  const mapOrg = (o: any, role: string) => ({
    ...o, _id: o.id, ownerId: o.owner_id, description: o.description ?? null, logoUrl: o.logo_url ?? null, role,
  })

  const owned = (ownedRes.data || []).map((o: any) => mapOrg(o, 'owner'))

  const memberOrgs = (membershipRes.data || [])
    .map((m: any) => {
      const o = m.organizations
      if (!o) return null
      return mapOrg(o, m.role || 'member')
    })
    .filter(Boolean)

  return NextResponse.json({ organizations: [...owned, ...memberOrgs] })
}

// POST /api/organizations — create a new org
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { name, description, logoUrl } = await req.json()
  if (!name?.trim()) return badRequest('Organization name is required')

  const row: Record<string, unknown> = { name: name.trim(), owner_id: user.id }
  if (description?.trim()) row.description = description.trim()
  if (logoUrl) row.logo_url = logoUrl

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .insert(row)
    .select()
    .single()

  return NextResponse.json({
    organization: {
      _id: org!.id,
      name: org!.name,
      description: org!.description ?? null,
      logoUrl: org!.logo_url ?? null,
      ownerId: org!.owner_id,
      createdAt: org!.created_at,
    },
  }, { status: 201 })
}
