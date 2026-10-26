import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { authLimiter, checkRateLimit, getRateLimitKey } from '@/lib/rate-limit'

const signupSchema = z.object({
  firstName: z.string().trim().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().trim().min(2, 'Last name must be at least 2 characters'),
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

const VERIFIED_CALLBACK = '/verify-email?verified=true'

/**
 * POST /api/auth/signup — thin wrapper over Better Auth's sign-up so the
 * signup page keeps its request/response contract. Better Auth sends the
 * verification email (emailVerification.sendOnSignUp).
 */
export async function POST(req: NextRequest) {
  const rateLimitRes = await checkRateLimit(authLimiter, getRateLimitKey(req))
  if (rateLimitRes) return rateLimitRes

  try {
    const parsed = signupSchema.parse(await req.json())
    const email = parsed.email.toLowerCase()
    const name = `${parsed.firstName} ${parsed.lastName}`.trim()

    const { data: existing } = await supabaseAdmin
      .from('ba_user')
      .select('id, email_verified')
      .eq('email', email)
      .maybeSingle()

    if (existing?.email_verified) {
      return NextResponse.json({ error: 'An account with this email already exists. Please sign in.' }, { status: 409 })
    }

    if (existing) {
      // Started signing up before but never verified: take the new password and
      // names, then send a fresh verification email.
      const ctx = await auth.$context
      await ctx.internalAdapter.updatePassword(existing.id, await ctx.password.hash(parsed.password))
      await supabaseAdmin
        .from('ba_user')
        .update({ name, first_name: parsed.firstName, last_name: parsed.lastName })
        .eq('id', existing.id)
      await supabaseAdmin
        .from('profiles')
        .update({ first_name: parsed.firstName, last_name: parsed.lastName })
        .eq('id', existing.id)
      await auth.api.sendVerificationEmail({
        body: { email, callbackURL: VERIFIED_CALLBACK },
        headers: req.headers,
      })
    } else {
      await auth.api.signUpEmail({
        body: {
          email,
          password: parsed.password,
          name,
          firstName: parsed.firstName,
          lastName: parsed.lastName,
          callbackURL: VERIFIED_CALLBACK,
        },
        headers: req.headers,
      })
    }

    return NextResponse.json(
      { success: true, message: 'Account created! Please check your email to verify your account.' },
      { status: 200 }
    )
  } catch (error) {
    console.error('Signup route error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
    }

    return NextResponse.json({ error: 'An error occurred while creating your account.' }, { status: 500 })
  }
}
