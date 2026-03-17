import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden, badRequest } from '@/lib/api-helpers'

// GET /api/organizations/[orgId]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { orgId } = await params

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return notFound('Organization')
  if (org.owner_id !== user.id) return forbidden()

  return NextResponse.json({
    organization: { ...org, _id: org.id, ownerId: org.owner_id },
  })
}

// PUT /api/organizations/[orgId]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { orgId } = await params
  const body = await req.json()
  if (!body.name?.trim()) return badRequest('Name is required')

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, owner_id')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return notFound('Organization')
  if (org.owner_id !== user.id) return forbidden()

  const { data: updated } = await supabaseAdmin
    .from('organizations')
    .update({ name: body.name.trim() })
    .eq('id', orgId)
    .select()
    .single()

  return NextResponse.json({
    organization: { _id: updated!.id, name: updated!.name, ownerId: updated!.owner_id },
  })
}

// DELETE /api/organizations/[orgId]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { orgId } = await params

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, owner_id')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return notFound('Organization')
  if (org.owner_id !== user.id) return forbidden()

  await supabaseAdmin.from('organizations').delete().eq('id', orgId)

  return NextResponse.json({ success: true })
}
