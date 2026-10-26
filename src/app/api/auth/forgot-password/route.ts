import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth/server'
import { enforceAuthEmailRateLimit, getClientIp } from '@/lib/auth-rate-limit'

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
})

export async function POST(req: NextRequest) {
  try {
    const { email } = forgotPasswordSchema.parse(await req.json())
    const normalizedEmail = email.toLowerCase().trim()

    // Always the same response for known and unknown emails (no enumeration).
    const successResponse = NextResponse.json(
      {
        success: true,
        message: 'If an account exists with this email, you will receive password reset instructions.',
      },
      { status: 200 }
    )

    const limit = await enforceAuthEmailRateLimit('forgot-password', normalizedEmail, getClientIp(req))
    if (limit.limited) {
      return NextResponse.json({ error: limit.message }, { status: 429 })
    }

    try {
      await auth.api.requestPasswordReset({
        body: { email: normalizedEmail, redirectTo: '/reset-password' },
        headers: req.headers,
      })
    } catch (err) {
      console.error('Forgot password error:', err)
    }

    return successResponse
  } catch (error) {
    console.error('Forgot password error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
    }

    return NextResponse.json({ error: 'An error occurred while processing forgot password request' }, { status: 500 })
  }
}
