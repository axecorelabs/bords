import { createClient } from '@/lib/supabase/server'
import { NextResponse, NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { redis } from '@/lib/redis'

type CachedProfile = {
  first_name: string
  last_name: string
  image: string | null
}

async function readHeader(req: NextRequest | undefined, name: string): Promise<string | null> {
  if (req) return req.headers.get(name)
  try {
    const h = await headers()
    return h.get(name)
  } catch {
    return null
  }
}

export async function getAuthUser(req?: NextRequest) {
  // Check if middleware already authenticated this user (header set by proxy.ts)
  // This avoids a duplicate auth.getUser() call to Supabase per request
  const userIdFromHeader = await readHeader(req, 'X-Auth-User-ID')
  const userEmailFromHeader = await readHeader(req, 'X-Auth-User-Email')

  let userId: string | null = null
  let email: string | null = null

  if (userIdFromHeader && userEmailFromHeader) {
    // Use cached auth from middleware
    userId = userIdFromHeader
    email = userEmailFromHeader
  } else {
    // Fallback: call auth API if header not present (e.g., in API routes called without middleware)
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return null
    userId = user.id
    email = user.email!
  }

  // Fetch profile with short-lived cache to reduce repeated reads.
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
    const supabase = await createClient()
    const { data } = await supabase
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
    name: profile ? `${profile.first_name} ${profile.last_name}`.trim() : '',
    image: profile?.image || '',
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
