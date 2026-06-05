import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const origin = req.nextUrl.origin

  if (!token) {
    return NextResponse.redirect(`${origin}/verify-email?error=Invalid+verification+link`)
  }

  const tokenHash = sha256(token)
  const nowIso = new Date().toISOString()

  const { data: row, error: rowError } = await supabaseAdmin
    .from('email_verification_tokens')
    .select('id, user_id, expires_at, consumed_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (rowError || !row || row.consumed_at || row.expires_at < nowIso) {
    return NextResponse.redirect(`${origin}/verify-email?error=Verification+link+is+invalid+or+expired`)
  }

  const { error: confirmError } = await supabaseAdmin.auth.admin.updateUserById(row.user_id, {
    email_confirm: true,
  })

  if (confirmError) {
    console.error('Verify email update user error:', confirmError)
    return NextResponse.redirect(`${origin}/verify-email?error=Unable+to+verify+email.+Please+try+again`)
  }

  await supabaseAdmin
    .from('email_verification_tokens')
    .update({ consumed_at: nowIso })
    .eq('id', row.id)

  return NextResponse.redirect(`${origin}/verify-email?verified=true`)
}
