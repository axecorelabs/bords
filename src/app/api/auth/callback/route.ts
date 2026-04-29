import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { render } from '@react-email/components'
import { sendEmail, sendEmailDeduped } from '@/lib/email'
import WelcomeEmail from '@/emails/WelcomeEmail'
import LoginAlertEmail from '@/emails/LoginAlertEmail'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'
  const type = searchParams.get('type') // 'signup', 'recovery', 'magiclink', etc.

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Route based on the type of auth event
      if (type === 'recovery') {
        // Password reset — send to reset-password form
        return NextResponse.redirect(`${origin}/reset-password`)
      }
      if (type === 'signup') {
        // Email verification — send welcome email + notification
        try {
          const { data: { user } } = await supabase.auth.getUser()
          if (user) {
            const firstName = user.user_metadata?.first_name || ''
            const name = firstName || user.email?.split('@')[0] || 'there'

            // Welcome notification
            await supabaseAdmin.from('notifications').insert({
              user_id: user.id,
              type: 'welcome',
              title: 'Welcome to BORDS! 🎉',
              message: `Hey ${name}, welcome to BORDS! Start by creating your first board or exploring the workspace.`,
              metadata: {},
              is_read: false,
            })

            // Welcome email
            const html = await render(
              WelcomeEmail({
                name,
                email: user.email || '',
              })
            )
            sendEmail({
              to: user.email!,
              subject: 'Welcome to BORDS — Your visual workspace awaits!',
              html,
            })
          }
        } catch (err) {
          console.error('Welcome email/notification error:', err)
        }

        return NextResponse.redirect(`${origin}/verify-email?verified=true`)
      }
      // Default: OAuth or other — go to requested page
      // For first-time OAuth users (e.g. Google signup), send welcome email + notification
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: existingWelcome } = await supabaseAdmin
          .from('notifications')
          .select('id')
          .eq('user_id', user.id)
          .eq('type', 'welcome')
          .maybeSingle()

        const firstName = user.user_metadata?.first_name
          || user.user_metadata?.full_name?.split(' ')[0]
          || ''
        const name = firstName || user.email?.split('@')[0] || 'there'

        if (!existingWelcome) {
          // First-time OAuth user — send welcome email + notification
          try {
            await supabaseAdmin.from('notifications').insert({
              user_id: user.id,
              type: 'welcome',
              title: 'Welcome to BORDS! 🎉',
              message: `Hey ${name}, welcome to BORDS! Start by creating your first board or exploring the workspace.`,
              metadata: {},
              is_read: false,
            })

            const html = await render(
              WelcomeEmail({
                name,
                email: user.email || '',
              })
            )
            sendEmail({
              to: user.email!,
              subject: 'Welcome to BORDS — Your visual workspace awaits!',
              html,
            })
          } catch (err) {
            console.error('OAuth welcome email/notification error:', err)
          }
        } else {
          // Returning OAuth user — send login alert
          try {
            const loginTime = new Date().toLocaleString('en-US', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'UTC',
            }) + ' UTC'

            const alertHtml = await render(
              LoginAlertEmail({
                name,
                loginTime,
                method: 'google',
              })
            )
            sendEmailDeduped({
              to: user.email!,
              subject: 'New sign-in to your BORDS account',
              html: alertHtml,
            }, 300)
          } catch (err) {
            console.error('OAuth login alert error:', err)
          }
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Auth code exchange failed — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=Auth+callback+failed`)
}
