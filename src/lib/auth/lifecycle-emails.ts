import { render } from '@react-email/components'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail, sendEmailDeduped } from '@/lib/email'
import { redis } from '@/lib/redis'
import WelcomeEmail from '@/emails/WelcomeEmail'
import LoginAlertEmail from '@/emails/LoginAlertEmail'

interface MinimalUser {
  id: string
  email: string
  name?: string | null
}

function displayName(user: MinimalUser): string {
  return user.name?.split(' ')[0] || user.email.split('@')[0] || 'there'
}

/** In-app notification + welcome email, once per user (idempotent). */
export async function sendWelcomeOnce(user: MinimalUser): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('notifications')
    .select('id')
    .eq('user_id', user.id)
    .eq('type', 'welcome')
    .maybeSingle()
  if (existing) return

  const name = displayName(user)
  // Best effort: the in-app notification must never block the email.
  const { error: notifError } = await supabaseAdmin.from('notifications').insert({
    user_id: user.id,
    type: 'welcome',
    title: 'Welcome to BORDS! 🎉',
    message: `Hey ${name}, welcome to BORDS! Start by creating your first board or exploring the workspace.`,
    metadata: {},
    is_read: false,
  })
  if (notifError) console.warn('[auth] welcome notification insert failed:', notifError.message)

  // The notification row is the primary "already welcomed" marker; the Redis dedupe
  // (7 days) keeps the email from repeating if that row can't be stored.
  const html = await render(WelcomeEmail({ name, email: user.email }))
  await sendEmailDeduped(
    { to: user.email, subject: 'Welcome to BORDS — Your visual workspace awaits!', html },
    60 * 60 * 24 * 7
  )
}

/** How long a device counts as "known" after it last triggered an alert. */
const KNOWN_DEVICE_SECONDS = 90 * 24 * 60 * 60

/** Stable, non-reversible fingerprint of where a sign-in came from (never store raw IPs / user agents). */
export async function deviceKey(ip: string | null | undefined, userAgent: string | null | undefined): Promise<string> {
  const data = new TextEncoder().encode(`${ip ?? ''}|${userAgent ?? ''}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * "New sign-in" alert. Sent only the first time a user signs in from a given device (IP + browser) in the
 * last 90 days, which is what the email is for. It also keeps routine logins cheap: rendering the React
 * email and opening an SMTP connection costs hundreds of milliseconds of CPU, and doing that on every
 * single sign-in was the main cost of a login once password hashing moved to its own Worker.
 * The device check IS the dedupe: a generic "same email within 5 minutes" window would also swallow an alert
 * for a DIFFERENT device that signs in right after (exactly when you most want to hear about it), so it only
 * applies when no device is known.
 */
export async function sendLoginAlert(user: MinimalUser, method: 'email' | 'google', device?: string): Promise<void> {
  if (device && redis) {
    try {
      const firstTime = await redis.set(`auth:device:${user.id}:${device}`, '1', { ex: KNOWN_DEVICE_SECONDS, nx: true })
      if (!firstTime) return // seen this device recently: no alert, no render, no SMTP
    } catch {
      // Redis hiccup: fall through and alert (a duplicate alert is better than a missed one)
    }
  }
  const loginTime =
    new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'
  const html = await render(LoginAlertEmail({ name: displayName(user), loginTime, method }))
  const mail = { to: user.email, subject: 'New sign-in to your BORDS account', html }
  if (device) await sendEmail(mail)
  else await sendEmailDeduped(mail, 300)
}
