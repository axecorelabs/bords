import { createClient } from '@/lib/supabase/server'
import { NextResponse, NextRequest } from 'next/server'
import { headers, cookies } from 'next/headers'
import { redis } from '@/lib/redis'

type CachedProfile = {
  first_name: string
  last_name: string
  image: string | null
}

type CachedAuth = { id: string; email: string }

async function readHeader(req: NextRequest | undefined, name: string): Promise<string | null> {
  if (req) return req.headers.get(name)
  try {
    const h = await headers()
    return h.get(name)
  } catch {
    return null
  }
}

// Extract the Supabase auth cookie value from the request or server cookie store.
// Used to key a short-lived Redis auth cache so supabase.auth.getUser() isn't
// called on every polled API request.
async function getAuthTokenSuffix(req?: NextRequest): Promise<string | null> {
  try {
    const all = req
      ? req.cookies.getAll()
      : (await cookies()).getAll()
    const authCookie = all.find(c => c.name.includes('-auth-token'))
    return authCookie ? authCookie.value.slice(-40) : null
  } catch {
    return null
  }
}

export async function getAuthUser(req?: NextRequest) {
  // Check if middleware already authenticated this user (header set by proxy.ts)
  const userIdFromHeader = await readHeader(req, 'X-Auth-User-ID')
  const userEmailFromHeader = await readHeader(req, 'X-Auth-User-Email')

  let userId: string | null = null
  let email: string | null = null

  if (userIdFromHeader && userEmailFromHeader) {
    userId = userIdFromHeader
    email = userEmailFromHeader
  } else {
    // Try Redis auth cache keyed by token suffix — avoids a Supabase Auth
    // round-trip on every poll. TTL 30s: a revoked session is valid for at most
    // that window, which is an acceptable trade-off for read-heavy API routes.
    const tokenSuffix = redis ? await getAuthTokenSuffix(req) : null
    const authCacheKey = tokenSuffix ? `auth:tok:${tokenSuffix}` : null

    if (authCacheKey) {
      try {
        const cached = await redis!.get<CachedAuth>(authCacheKey)
        if (cached) {
          userId = cached.id
          email = cached.email
        }
      } catch { /* non-fatal */ }
    }

    if (!userId) {
      const supabase = await createClient()
      const { data: { user }, error } = await supabase.auth.getUser()
      if (error || !user) return null
      userId = user.id
      email = user.email!

      if (authCacheKey) {
        try {
          await redis!.set(authCacheKey, { id: userId, email } satisfies CachedAuth, { ex: 30 })
        } catch { /* non-fatal */ }
      }
    }
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
