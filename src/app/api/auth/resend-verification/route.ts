import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth/server'
import { enforceAuthEmailRateLimit, getClientIp } from '@/lib/auth-rate-limit'

const resendSchema = z.object({
  email: z.string().email('Invalid email address'),
})

export async function POST(req: NextRequest) {
  try {
    const { email } = resendSchema.parse(await req.json())
    const normalizedEmail = email.toLowerCase()

    const limit = await enforceAuthEmailRateLimit('resend-verification', normalizedEmail, getClientIp(req))
    if (limit.limited) {
      return NextResponse.json({ error: limit.message }, { status: 429 })
    }

    // Better Auth no-ops for unknown or already-verified emails (no enumeration).
    await auth.api.sendVerificationEmail({
      body: { email: normalizedEmail, callbackURL: '/verify-email?verified=true' },
      headers: req.headers,
    })

    return NextResponse.json(
      { success: true, message: 'Verification email sent! Please check your inbox.' },
      { status: 200 }
    )
  } catch (error) {
    console.error('Resend verification error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
    }

    return NextResponse.json({ error: 'An error occurred while resending verification email' }, { status: 500 })
  }
}
