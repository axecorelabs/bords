import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth/server'
import { authLimiter, checkRateLimit, getRateLimitKey } from '@/lib/rate-limit'

const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, 'Invalid reset token'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

/**
 * POST /api/auth/reset-password — { token, password }. The token is Better
 * Auth's, delivered to /reset-password?token=… by the emailed link.
 */
export async function POST(req: NextRequest) {
  const rateLimitRes = await checkRateLimit(authLimiter, getRateLimitKey(req))
  if (rateLimitRes) return rateLimitRes

  try {
    const { token, password } = resetPasswordSchema.parse(await req.json())

    try {
      await auth.api.resetPassword({ body: { newPassword: password, token }, headers: req.headers })
    } catch {
      return NextResponse.json({ error: 'This password reset link is invalid or has expired.' }, { status: 400 })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error('Reset password route error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
    }

    return NextResponse.json({ error: 'An error occurred while resetting your password.' }, { status: 500 })
  }
}
