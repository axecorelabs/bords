import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'

const resendSchema = z.object({
  email: z.string().email('Invalid email address'),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email } = resendSchema.parse(body)

    // Use Supabase's built-in resend verification
    const { error } = await supabaseAdmin.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'}/api/auth/callback?type=signup`,
      },
    })

    if (error) {
      console.error('Resend verification error:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Verification email sent! Please check your inbox.',
      },
      { status: 200 }
    )
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
