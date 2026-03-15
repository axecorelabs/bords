import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

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
        // Email verification — redirect to verify-email success page
        return NextResponse.redirect(`${origin}/verify-email?verified=true`)
      }
      // Default: OAuth or other — go to requested page
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Auth code exchange failed — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=Auth+callback+failed`)
}
