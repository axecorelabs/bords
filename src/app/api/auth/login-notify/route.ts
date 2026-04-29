import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { render } from '@react-email/components'
import { sendEmail, sendEmailDeduped } from '@/lib/email'
import LoginAlertEmail from '@/emails/LoginAlertEmail'
import { authLimiter, getRateLimitKey, checkRateLimit } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  // Rate limit by IP before auth check
  const rateLimited = await checkRateLimit(authLimiter, getRateLimitKey(req))
  if (rateLimited) return rateLimited

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { method } = await req.json().catch(() => ({ method: 'email' }))

  const firstName = user.user_metadata?.first_name
    || user.user_metadata?.full_name?.split(' ')[0]
    || ''
  const name = firstName || user.email?.split('@')[0] || 'there'

  const loginTime = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }) + ' UTC'

  try {
    const html = await render(
      LoginAlertEmail({
        name,
        loginTime,
        method: method || 'email',
      })
    )

    await sendEmailDeduped({
      to: user.email!,
      subject: 'New sign-in to your BORDS account',
      html,
    }, 300) // 5-minute dedup window

    return NextResponse.json({ sent: true })
  } catch (err) {
    console.error('Login alert email error:', err)
    return NextResponse.json({ sent: false })
  }
}
