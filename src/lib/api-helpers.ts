import { NextResponse, NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { redis } from '@/lib/redis'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { auth } from '@/lib/auth/server'

type CachedProfile = {
  first_name: string
  last_name: string
  image: string | null
}

/**
 * Resolve the signed-in user from the Better Auth session cookie.
 * Session cookies are signed and cached for a few minutes, so most calls
 * never touch the database. Returns null when there is no valid session.
 */
export async function getAuthUser(req?: NextRequest) {
  const session = await auth.api.getSession({ headers: req ? req.headers : await headers() })
  if (!session?.user) return null

  const userId = session.user.id
  const email = session.user.email

  // Profile (display name / avatar live on `profiles`) with a short-lived cache.
  const profileCacheKey = `profile:${userId}`
  let profile: CachedProfile | null = null

  if (redis) {
    try {
      profile = await redis.get<CachedProfile>(profileCacheKey)
    } catch {
      profile = null
    }
  }

  if (!profile) {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('first_name, last_name, image')
      .eq('id', userId)
      .single()
    profile = data

    if (profile && redis) {
      try {
        await redis.set(profileCacheKey, profile, { ex: 300 })
      } catch {
        // Non-fatal: request can continue without cache persistence.
      }
    }
  }

  return {
    id: userId,
    email,
    name: profile ? `${profile.first_name} ${profile.last_name}`.trim() : session.user.name,
    image: profile?.image || session.user.image || '',
  }
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export function notFound(resource = 'Resource') {
  return NextResponse.json({ error: `${resource} not found` }, { status: 404 })
}
