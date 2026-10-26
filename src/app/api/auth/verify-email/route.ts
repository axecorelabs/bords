import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth/server'
import { authLimiter, checkRateLimit, getRateLimitKey } from '@/lib/rate-limit'

/**
 * GET /api/auth/verify-email?token=… — the link in the verification email.
 * (Same path Better Auth uses, so its generated links land here.) Verifies the
 * token and redirects to the verify-email page with the outcome.
 */
export async function GET(req: NextRequest) {
  const rateLimitRes = await checkRateLimit(authLimiter, getRateLimitKey(req))
  if (rateLimitRes) return rateLimitRes

  const origin = req.nextUrl.origin
  const token = req.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(`${origin}/verify-email?error=Invalid+verification+link`)
  }

  try {
    await auth.api.verifyEmail({ query: { token }, headers: req.headers })
  } catch {
    return NextResponse.redirect(`${origin}/verify-email?error=Verification+link+is+invalid+or+expired`)
  }

  return NextResponse.redirect(`${origin}/verify-email?verified=true`)
}
