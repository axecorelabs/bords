import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createHash, randomBytes } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { getPasswordResetEmail } from '@/lib/email-templates'
import { enforceAuthEmailRateLimit, getClientIp } from '@/lib/auth-rate-limit'

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
})

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000

function isLocalhostUrl(value: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email } = forgotPasswordSchema.parse(body)
    const normalizedEmail = email.toLowerCase().trim()
    const ip = getClientIp(req)

    const requestOrigin = (req.nextUrl.origin || '').replace(/\/+$/, '')
    const candidates = [
      process.env.APP_URL,
      requestOrigin,
      process.env.NEXTAUTH_URL,
      process.env.NEXT_PUBLIC_APP_URL,
      'https://app10342.bords.app',
    ]
      .filter((value): value is string => Boolean(value && value.trim()))
      .map((value) => value.replace(/\/+$/, ''))

    const appUrl =
      candidates.find((value) => {
        if (requestOrigin && !isLocalhostUrl(requestOrigin)) {
          return !isLocalhostUrl(value)
        }
        return true
      }) || 'https://app10342.bords.app'

    // Always return a generic success message to avoid account enumeration.
    const successResponse = NextResponse.json(
      {
        success: true,
        message: 'If an account exists with this email, you will receive password reset instructions.',
      },
      { status: 200 }
    )

    const limit = await enforceAuthEmailRateLimit('forgot-password', normalizedEmail, ip)
    if (limit.limited) {
      return NextResponse.json({ error: limit.message }, { status: 429 })
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, email')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (profileError) {
      console.error('Forgot password profile lookup error:', profileError)
      return successResponse
    }

    if (!profile?.id) {
      return successResponse
    }

    const nowIso = new Date().toISOString()
    await supabaseAdmin
      .from('password_reset_tokens')
      .update({ consumed_at: nowIso })
      .eq('user_id', profile.id)
      .is('consumed_at', null)

    const rawToken = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString()

    const { error: tokenError } = await supabaseAdmin
      .from('password_reset_tokens')
      .insert({
        user_id: profile.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
      })

    if (tokenError) {
      console.error('Password reset token insert error:', tokenError)
      return successResponse
    }

    const resetUrl = `${appUrl}/reset-password?token=${rawToken}`
    const name = profile.first_name || normalizedEmail.split('@')[0] || 'there'

    await sendEmail({
      to: normalizedEmail,
      subject: 'Reset your BORDS password',
      html: getPasswordResetEmail({ name, resetUrl }),
    })

    return successResponse
  } catch (error) {
    console.error('Forgot password error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'An error occurred while processing forgot password request' },
      { status: 500 }
    )
  }
}
