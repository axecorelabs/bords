import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { getVerificationEmail } from '@/lib/email-templates'
import { enforceAuthEmailRateLimit, getClientIp } from '@/lib/auth-rate-limit'

const resendSchema = z.object({
  email: z.string().email('Invalid email address'),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email } = resendSchema.parse(body)
    const normalizedEmail = email.toLowerCase()
    const ip = getClientIp(req)

    const appUrl = (
      process.env.APP_URL ||
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      req.nextUrl.origin ||
      'https://app10342.bords.app'
    ).replace(/\/+$/, '')

    const successResponse = NextResponse.json(
      {
        success: true,
        message: 'Verification email sent! Please check your inbox.',
      },
      { status: 200 }
    )

    const limit = await enforceAuthEmailRateLimit('resend-verification', normalizedEmail, ip)
    if (limit.limited) {
      return NextResponse.json({ error: limit.message }, { status: 429 })
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, email')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (!profile?.id) return successResponse

    const { data: authRes, error: authErr } = await supabaseAdmin.auth.admin.getUserById(profile.id)
    if (authErr || !authRes?.user) return successResponse

    if (authRes.user.email_confirmed_at) {
      return successResponse
    }

    const nowIso = new Date().toISOString()
    await supabaseAdmin
      .from('email_verification_tokens')
      .update({ consumed_at: nowIso })
      .eq('user_id', profile.id)
      .is('consumed_at', null)

    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    const { error: tokenError } = await supabaseAdmin
      .from('email_verification_tokens')
      .insert({ user_id: profile.id, token_hash: tokenHash, expires_at: expiresAt })

    if (tokenError) {
      console.error('Resend verification token error:', tokenError)
      return NextResponse.json({ error: 'Unable to resend verification email right now.' }, { status: 500 })
    }

    const verificationUrl = `${appUrl}/api/auth/verify-email?token=${rawToken}`
    await sendEmail({
      to: normalizedEmail,
      subject: 'Verify your BORDS email',
      html: getVerificationEmail({
        name: profile.first_name || normalizedEmail.split('@')[0] || 'there',
        verificationUrl,
      }),
    })

    return successResponse
  } catch (error) {
    console.error('Resend verification error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'An error occurred while resending verification email' },
      { status: 500 }
    )
  }
}
