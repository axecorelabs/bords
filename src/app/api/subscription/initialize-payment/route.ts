import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-helpers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { initializePayment, generatePaymentReference } from '@/lib/paystack'
import { z } from 'zod'

const initializePaymentSchema = z.object({
  planId: z.string().min(1, 'Plan ID is required'),
})

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser()
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Parse and validate request body
    const body = await request.json()
    const validation = initializePaymentSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues[0].message },
        { status: 400 }
      )
    }

    const { planId } = validation.data

    // Get the plan
    const { data: plan } = await supabaseAdmin
      .from('plans')
      .select('*')
      .eq('id', planId)
      .maybeSingle()

    if (!plan || !plan.is_active) {
      return NextResponse.json(
        { error: 'Invalid or inactive plan' },
        { status: 404 }
      )
    }

    const userId = user.id

    // Generate payment reference
    const reference = generatePaymentReference(userId)

    // Convert amount to kobo (Paystack uses kobo for NGN)
    const amountInKobo = plan.price * 100

    // Create payment record
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from('payments')
      .insert({
        user_id: userId,
        plan_id: plan.id,
        amount: plan.price,
        currency: plan.currency,
        status: 'pending',
        paystack_reference: reference,
        metadata: {
          planName: plan.name,
          interval: plan.interval,
        },
      })
      .select()
      .single()

    if (paymentError) throw paymentError

    // Initialize Paystack payment
    const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/subscription/verify?reference=${reference}`
    
    const paystackResponse = await initializePayment({
      email: user.email,
      amount: amountInKobo,
      reference,
      callback_url: callbackUrl,
      metadata: {
        userId,
        planId: plan.id,
        planName: plan.name,
        paymentId: payment.id,
      },
      channels: ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer'],
    })

    // Update payment with access code
    await supabaseAdmin
      .from('payments')
      .update({ paystack_access_code: paystackResponse.data.access_code })
      .eq('id', payment.id)

    return NextResponse.json({
      success: true,
      data: {
        authorizationUrl: paystackResponse.data.authorization_url,
        accessCode: paystackResponse.data.access_code,
        reference: paystackResponse.data.reference,
        amount: plan.price,
        currency: plan.currency,
      },
    })
  } catch (error: any) {
    console.error('Initialize payment error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to initialize payment' },
      { status: 500 }
    )
  }
}
