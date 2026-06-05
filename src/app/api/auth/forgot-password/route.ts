import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createHash, randomBytes } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { getPasswordResetEmail } from '@/lib/email-templates'
import { enforceAuthEmailRateLimit, getClientIp } from '@/lib/auth-rate-limit'
import { redis } from '@/lib/redis'

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
})

const RECOVERY_RELAY_TTL_SECONDS = 60 * 30

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

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: normalizedEmail,
      options: {
        redirectTo: `${appUrl}/reset-password`,
      },
    })

    if (error) {
      console.error('Generate recovery link error:', error)
      return successResponse
    }

    const actionLink =
      (data as any)?.properties?.action_link ||
      (data as any)?.action_link ||
      null

    if (!actionLink) {
      console.error('Generate recovery link returned no action_link')
      return successResponse
    }

    // Relay page prevents email scanners from consuming one-time recovery links.
    // Preferred mode stores the real action link server-side and sends only a nonce.
    let relayUrl = `${appUrl}/reset-password/confirm?next=${encodeURIComponent(actionLink)}`
    if (redis) {
      try {
        const relayToken = randomBytes(32).toString('hex')
        const relayTokenHash = createHash('sha256').update(relayToken).digest('hex')
        const relayKey = `auth:recovery-relay:${relayTokenHash}`
        await redis.set(relayKey, actionLink, { ex: RECOVERY_RELAY_TTL_SECONDS })
        relayUrl = `${appUrl}/reset-password/confirm?t=${relayToken}`
      } catch (relayError) {
        console.error('Failed to create scanner-safe recovery relay token:', relayError)
      }
    }

    const name = normalizedEmail.split('@')[0] || 'there'

    await sendEmail({
      to: normalizedEmail,
      subject: 'Reset your BORDS password',
      html: getPasswordResetEmail({ name, resetUrl: relayUrl }),
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
