import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { redis } from '@/lib/redis'

export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)
  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeaders },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // For API routes: try to resolve user from a short-lived Redis cache keyed by
  // the access token cookie, avoiding a round-trip to Supabase Auth on every poll.
  // TTL is 30s — a revoked session may be honoured for at most that window.
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/')
  const authCookie = request.cookies.getAll().find(c => c.name.includes('-auth-token'))
  type CachedAuth = { id: string; email: string }
  let cachedAuth: CachedAuth | null = null

  if (isApiRoute && redis && authCookie) {
    // Use the last 32 chars of the cookie value as a stable, non-reversible key
    const tokenSuffix = authCookie.value.slice(-32)
    try {
      cachedAuth = await redis.get<CachedAuth>(`auth:tok:${tokenSuffix}`)
    } catch { /* non-fatal */ }
  }

  let user: { id: string; email?: string } | null = null

  if (cachedAuth) {
    user = { id: cachedAuth.id, email: cachedAuth.email }
  } else {
    // Full auth validation — also refreshes the session cookie if needed
    const { data } = await supabase.auth.getUser()
    user = data.user ?? null

    if (user && isApiRoute && redis && authCookie) {
      const tokenSuffix = authCookie.value.slice(-32)
      try {
        await redis.set(`auth:tok:${tokenSuffix}`, { id: user.id, email: user.email ?? '' }, { ex: 30 })
      } catch { /* non-fatal */ }
    }
  }

  // Cache user ID in request header to avoid duplicate auth calls in route handlers
  if (user?.id) {
    requestHeaders.set('X-Auth-User-ID', user.id)
    requestHeaders.set('X-Auth-User-Email', user.email || '')
    supabaseResponse = NextResponse.next({
      request: { headers: requestHeaders },
    })
  }

  // If no user and the route is protected, redirect to login
  if (!user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  const isEmailVerified = !!(
    (user as any).email_confirmed_at ||
    (user as any).confirmed_at ||
    (user as any).user_metadata?.email_verified
  )

  if (!isEmailVerified) {
    const verifyUrl = new URL('/verify-email', request.url)
    verifyUrl.searchParams.set('email', user.email || '')
    return NextResponse.redirect(verifyUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - /login, /signup, /forgot-password, /reset-password, /verify-email (auth pages)
     * - /pricing (public pricing page)
     * - /shared/* (public shared boards)
     * - /api/auth/* (auth API routes + callback)
     * - /api/cron/* (cron job endpoints — use Bearer token auth)
     * - /api/subscription/plans (public plans endpoint)
     * - /api/boards/public/* (public board viewer API)
     * - /_next/* (Next.js internals)
     * - Static assets (*.js, *.css, images, fonts, sourcemaps)
     * - /favicon.ico, /bordclear.png, /bord*.png (static files)
     */
    '/((?!login|signup|forgot-password|reset-password|verify-email|pricing|shared|api/auth|api/cron|api/subscription/plans|api/boards/public|_next/static|_next/image|favicon.ico|bordclear.png|bord.*\\.png|.*\\.(?:js|css|map|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|txt|xml)$).*)',
  ],
}
