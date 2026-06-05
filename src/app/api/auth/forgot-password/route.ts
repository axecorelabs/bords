import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { getPasswordResetEmail } from '@/lib/email-templates'
import { enforceAuthEmailRateLimit, getClientIp } from '@/lib/auth-rate-limit'

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email } = forgotPasswordSchema.parse(body)
    const normalizedEmail = email.toLowerCase().trim()
    const ip = getClientIp(req)

    const appUrl = (
      process.env.APP_URL ||
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      req.nextUrl.origin ||
      'https://app10342.bords.app'
    ).replace(/\/+$/, '')

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
        redirectTo: `${appUrl}/api/auth/recovery-callback`,
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
    const relayUrl = `${appUrl}/reset-password/confirm?next=${encodeURIComponent(actionLink)}`
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
