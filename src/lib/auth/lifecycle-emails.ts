import { render } from '@react-email/components'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail, sendEmailDeduped } from '@/lib/email'
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

/** "New sign-in" alert, deduplicated over a 5-minute window. */
export async function sendLoginAlert(user: MinimalUser, method: 'email' | 'google'): Promise<void> {
  const loginTime =
    new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'
  const html = await render(LoginAlertEmail({ name: displayName(user), loginTime, method }))
  await sendEmailDeduped({ to: user.email, subject: 'New sign-in to your BORDS account', html }, 300)
}
