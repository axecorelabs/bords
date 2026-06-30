import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'

const resetPasswordSchema = z.object({
  token: z.string().trim().min(32, 'Invalid reset token'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token, password } = resetPasswordSchema.parse(body)

    const tokenHash = sha256(token)
    const nowIso = new Date().toISOString()

    const { data: row, error: rowError } = await supabaseAdmin
      .from('password_reset_tokens')
      .select('id, user_id, expires_at, consumed_at')
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (rowError || !row || row.consumed_at || row.expires_at < nowIso) {
      return NextResponse.json(
        { error: 'This password reset link is invalid or has expired.' },
        { status: 400 }
      )
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(row.user_id, {
      password,
    })

    if (updateError) {
      console.error('Reset password update user error:', updateError)
      return NextResponse.json(
        { error: 'Unable to reset password right now. Please try again.' },
        { status: 500 }
      )
    }

    await supabaseAdmin
      .from('password_reset_tokens')
      .update({ consumed_at: nowIso })
      .eq('id', row.id)

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error('Reset password route error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
    }

    return NextResponse.json(
      { error: 'An error occurred while resetting your password.' },
      { status: 500 }
    )
  }
}
