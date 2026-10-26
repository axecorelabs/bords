import { NextResponse, type NextRequest } from 'next/server'
import { getSessionAuth } from '@/lib/auth/session-only'

export async function proxy(request: NextRequest) {
  // Signed session cookie is verified (and cached for a few minutes), so this
  // rarely hits the database. Route handlers re-check via getAuthUser().
  const session = await getSessionAuth().api.getSession({ headers: request.headers })

  // If no user and the route is protected, redirect to login
  if (!session?.user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (!session.user.emailVerified) {
    const verifyUrl = new URL('/verify-email', request.url)
    verifyUrl.searchParams.set('email', session.user.email || '')
    return NextResponse.redirect(verifyUrl)
  }

  return NextResponse.next()
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
     * - /api/internal/* (service-to-service endpoints — use INTERNAL_API_SECRET bearer auth)
     * - /api/subscription/plans (public plans endpoint)
     * - /api/boards/public/* (public board viewer API)
     * - /_next/* (Next.js internals)
     * - Static assets (*.js, *.css, images, fonts, sourcemaps)
     * - /favicon.ico, /bordclear.png, /bord*.png (static files)
     */
    '/((?!login|signup|forgot-password|reset-password|verify-email|pricing|shared|api/auth|api/cron|api/internal|api/subscription/plans|api/boards/public|_next/static|_next/image|favicon.ico|bordclear.png|bord.*\\.png|.*\\.(?:js|css|map|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|txt|xml)$).*)',
  ],
}
