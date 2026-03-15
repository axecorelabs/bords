import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

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
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session — required to keep auth alive
  const { data: { user } } = await supabase.auth.getUser()

  // If no user and the route is protected, redirect to login
  if (!user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
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
     * - /favicon.ico, /bordclear.png, /bord*.png (static files)
     */
    '/((?!login|signup|forgot-password|reset-password|verify-email|pricing|shared|api/auth|api/cron|api/subscription/plans|api/boards/public|_next|favicon.ico|bordclear.png|bord.*\\.png).*)',
  ],
}
