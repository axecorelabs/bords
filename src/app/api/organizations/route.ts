import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, badRequest } from '@/lib/api-helpers'
import { apiLimiter, checkRateLimit, getRateLimitKey } from '@/lib/rate-limit'

// GET /api/organizations — list orgs the user owns or is an employee of
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorized()

  const rateLimitRes = await checkRateLimit(apiLimiter, getRateLimitKey(req, user.id))
  if (rateLimitRes) return rateLimitRes

  const { searchParams } = new URL(req.url)
  const offset = Math.max(0, Number(searchParams.get('offset') || '0') || 0)
  const requestedLimit = Number(searchParams.get('limit') || '50') || 50
  const limit = Math.min(Math.max(1, requestedLimit), 100)
  const sourceUpperBound = offset + limit

  const [ownedRes, membershipRes] = await Promise.all([
    supabaseAdmin
      .from('organizations')
      .select('*')
      .range(offset, sourceUpperBound)
      .eq('owner_id', user.id),
    supabaseAdmin
      .from('employee_memberships')
      .select('organization_id, role, organizations(*)')
      .range(offset, sourceUpperBound)
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

  const mergedById = new Map<string, any>()
  for (const org of memberOrgs as any[]) {
    mergedById.set(org._id, org)
  }
  // Owner role has higher precedence than membership role for same org.
  for (const org of owned as any[]) {
    mergedById.set(org._id, org)
  }

  const merged = Array.from(mergedById.values())
  const organizations = merged.slice(0, limit)
  const hasMore = merged.length > limit || (ownedRes.data?.length || 0) > limit || (membershipRes.data?.length || 0) > limit

  return NextResponse.json({
    organizations,
    pagination: {
      offset,
      limit,
      hasMore,
    },
  })
}

// POST /api/organizations — create a new org
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorized()

  const rateLimitRes = await checkRateLimit(apiLimiter, getRateLimitKey(req, user.id))
  if (rateLimitRes) return rateLimitRes

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
