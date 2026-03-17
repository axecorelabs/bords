import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-helpers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyPayment } from '@/lib/paystack'
import { sendEmail } from '@/lib/email'
import { getPaymentSuccessEmail } from '@/lib/email-templates'
import { z } from 'zod'

const verifyPaymentSchema = z.object({
  reference: z.string().min(1, 'Payment reference is required'),
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
    const validation = verifyPaymentSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues[0].message },
        { status: 400 }
      )
    }

    const { reference } = validation.data

    // Find the payment record
    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('paystack_reference', reference)
      .maybeSingle()

    if (!payment) {
      return NextResponse.json(
        { error: 'Payment record not found' },
        { status: 404 }
      )
    }

    // Check if already verified
    if (payment.status === 'success') {
      return NextResponse.json({
        success: true,
        message: 'Payment already verified',
        data: {
          status: 'success',
          amount: payment.amount,
          currency: payment.currency,
        },
      })
    }

    // Verify payment with Paystack
    const paystackResponse = await verifyPayment(reference)

    if (!paystackResponse.status) {
      return NextResponse.json(
        { error: 'Payment verification failed' },
        { status: 400 }
      )
    }

    const { data } = paystackResponse

    // Update payment status
    const newStatus = data.status === 'success' ? 'success' : 'failed'
    await supabaseAdmin
      .from('payments')
      .update({
        status: newStatus,
        paid_at: data.status === 'success' ? new Date(data.paid_at).toISOString() : null,
        metadata: {
          ...(payment.metadata as Record<string, any>),
          paystackData: {
            gatewayResponse: data.gateway_response,
            channel: data.channel,
            fees: data.fees,
            customerCode: data.customer.customer_code,
          },
        },
      })
      .eq('id', payment.id)

    if (data.status === 'success') {
      // Get plan details
      const { data: planData } = await supabaseAdmin
        .from('plans')
        .select('*')
        .eq('id', payment.plan_id)
        .single()

      // Calculate subscription end date
      const startDate = new Date()
      const endDate = new Date(startDate)
      if (planData?.interval === 'monthly') {
        endDate.setMonth(endDate.getMonth() + 1)
      } else if (planData?.interval === 'yearly') {
        endDate.setFullYear(endDate.getFullYear() + 1)
      }

      // Create subscription
      const { data: subscription } = await supabaseAdmin
        .from('subscriptions')
        .insert({
          user_id: payment.user_id,
          plan_id: payment.plan_id!,
          status: 'active',
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          paystack_customer_code: data.customer.customer_code,
        })
        .select()
        .single()

      // Update payment with subscription ID
      if (subscription) {
        await supabaseAdmin
          .from('payments')
          .update({ subscription_id: subscription.id })
          .eq('id', payment.id)

        // Create subscription history
        await supabaseAdmin
          .from('subscription_history')
          .insert({
            user_id: payment.user_id,
            subscription_id: subscription.id,
            action: 'created',
            to_plan_id: payment.plan_id,
            metadata: {
              paymentReference: reference,
              amount: payment.amount,
              currency: payment.currency,
            },
          })
      }

      // Send payment success email
      try {
        const emailHtml = getPaymentSuccessEmail({
          name: user.name || user.email,
          planName: planData?.name || 'Unknown',
          amount: payment.amount,
          currency: payment.currency,
          startDate: startDate.toLocaleDateString(),
          endDate: endDate.toLocaleDateString(),
        })

        await sendEmail({
          to: user.email,
          subject: `Payment Successful - Welcome to ${planData?.name}`,
          html: emailHtml,
        })
      } catch (emailError) {
        console.error('Failed to send payment success email:', emailError)
      }

      return NextResponse.json({
        success: true,
        message: 'Payment verified successfully',
        data: {
          status: 'success',
          amount: payment.amount,
          currency: payment.currency,
          subscription: subscription ? {
            id: subscription.id,
            startDate: subscription.start_date,
            endDate: subscription.end_date,
            status: subscription.status,
          } : null,
        },
      })
    } else {
      return NextResponse.json({
        success: false,
        message: 'Payment was not successful',
        data: {
          status: data.status,
          gatewayResponse: data.gateway_response,
        },
      })
    }
  } catch (error: any) {
    console.error('Verify payment error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to verify payment' },
      { status: 500 }
    )
  }
}
