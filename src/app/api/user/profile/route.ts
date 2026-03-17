import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized } from '@/lib/api-helpers'

/**
 * PUT /api/user/profile
 * Update the authenticated user's profile (first_name, last_name, image).
 */
export async function PUT(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const updates: Record<string, string> = {}

  if (typeof body.firstName === 'string') updates.first_name = body.firstName.trim().slice(0, 100)
  if (typeof body.lastName === 'string') updates.last_name = body.lastName.trim().slice(0, 100)
  if (typeof body.image === 'string') updates.image = body.image

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', user.id)
    .select('id, email, first_name, last_name, image')
    .single()

  if (error) {
    console.error('[user/profile] Update error:', error)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }

  return NextResponse.json({
    _id: data.id,
    email: data.email,
    firstName: data.first_name,
    lastName: data.last_name,
    image: data.image,
  })
}
