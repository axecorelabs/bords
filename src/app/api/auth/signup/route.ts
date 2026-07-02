import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { getVerificationEmail } from '@/lib/email-templates'
import { authLimiter, checkRateLimit, getRateLimitKey } from '@/lib/rate-limit'

const signupSchema = z.object({
  firstName: z.string().trim().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().trim().min(2, 'Last name must be at least 2 characters'),
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

function getAppUrl(req: NextRequest): string {
  return (
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    req.nextUrl.origin ||
    'https://app10342.bords.app'
  ).replace(/\/+$/, '')
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export async function POST(req: NextRequest) {
  const rateLimitRes = await checkRateLimit(authLimiter, getRateLimitKey(req))
  if (rateLimitRes) return rateLimitRes

  try {
    const body = await req.json()
    const parsed = signupSchema.parse(body)
    const email = parsed.email.toLowerCase()
    const appUrl = getAppUrl(req)

    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, email, first_name, last_name')
      .eq('email', email)
      .maybeSingle()

    let userId: string
    if (existingProfile?.id) {
      const { data: existingAuth, error: existingAuthError } = await supabaseAdmin.auth.admin.getUserById(existingProfile.id)
      if (existingAuthError || !existingAuth?.user) {
        return NextResponse.json({ error: 'Unable to continue signup right now. Please try again.' }, { status: 500 })
      }

      if (existingAuth.user.email_confirmed_at) {
        return NextResponse.json({ error: 'An account with this email already exists. Please sign in.' }, { status: 409 })
      }

      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(existingProfile.id, {
        password: parsed.password,
        user_metadata: {
          ...(existingAuth.user.user_metadata || {}),
          first_name: parsed.firstName,
          last_name: parsed.lastName,
          full_name: `${parsed.firstName} ${parsed.lastName}`.trim(),
        },
      })

      if (updateError) {
        console.error('Signup update user error:', updateError)
        return NextResponse.json({ error: 'Unable to continue signup right now. Please try again.' }, { status: 500 })
      }

      await supabaseAdmin
        .from('profiles')
        .update({
          first_name: parsed.firstName,
          last_name: parsed.lastName,
        })
        .eq('id', existingProfile.id)

      userId = existingProfile.id
    } else {
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: parsed.password,
        email_confirm: false,
        user_metadata: {
          first_name: parsed.firstName,
          last_name: parsed.lastName,
          full_name: `${parsed.firstName} ${parsed.lastName}`.trim(),
        },
      })

      if (createError || !created.user) {
        console.error('Signup create user error:', createError)
        const msg = (createError?.message || '').toLowerCase()
        if (msg.includes('already') || msg.includes('registered')) {
          return NextResponse.json({ error: 'An account with this email already exists. Please sign in.' }, { status: 409 })
        }
        return NextResponse.json({ error: 'Unable to create account right now. Please try again.' }, { status: 500 })
      }

      userId = created.user.id
    }

    // Invalidate prior unconsumed tokens for this user.
    await supabaseAdmin
      .from('email_verification_tokens')
      .update({ consumed_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('consumed_at', null)

    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = sha256(rawToken)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    const { error: tokenError } = await supabaseAdmin
      .from('email_verification_tokens')
      .insert({
        user_id: userId,
        token_hash: tokenHash,
        expires_at: expiresAt,
      })

    if (tokenError) {
      console.error('Signup token insert error:', tokenError)
      return NextResponse.json({ error: 'Unable to create verification email right now. Please try again.' }, { status: 500 })
    }

    const verificationUrl = `${appUrl}/api/auth/verify-email?token=${rawToken}`
    await sendEmail({
      to: email,
      subject: 'Verify your BORDS email',
      html: getVerificationEmail({
        name: parsed.firstName,
        verificationUrl,
      }),
    })

    return NextResponse.json(
      {
        success: true,
        message: 'Account created! Please check your email to verify your account.',
      },
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
