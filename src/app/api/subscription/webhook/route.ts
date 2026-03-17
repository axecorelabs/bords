import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyWebhookSignature } from '@/lib/paystack'
import { sendEmail } from '@/lib/email'
import { getPaymentSuccessEmail } from '@/lib/email-templates'

export async function POST(request: NextRequest) {
  try {
    // Get the raw body for signature verification
    const body = await request.text()
    const signature = request.headers.get('x-paystack-signature')

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing signature' },
        { status: 400 }
      )
    }

    // Verify webhook signature
    const isValid = verifyWebhookSignature(body, signature)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      )
    }

    // Parse the event
    const event = JSON.parse(body)
    const { event: eventType, data } = event

    console.log('Paystack webhook event:', eventType)

    switch (eventType) {
      case 'charge.success': {
        // Find the payment record with plan + user info
        const { data: payment } = await supabaseAdmin
          .from('payments')
          .select('*')
          .eq('paystack_reference', data.reference)
          .maybeSingle()

        if (!payment) {
          console.error('Payment not found for reference:', data.reference)
          return NextResponse.json({ success: true })
        }

        // Skip if already processed
        if (payment.status === 'success') {
          return NextResponse.json({ success: true })
        }

        // Update payment
        await supabaseAdmin
          .from('payments')
          .update({
            status: 'success',
            paid_at: new Date(data.paid_at).toISOString(),
            metadata: {
              ...(payment.metadata as Record<string, any>),
              webhookData: data,
            },
          })
          .eq('id', payment.id)

        // Get plan and user data
        const { data: planData } = await supabaseAdmin
          .from('plans')
          .select('*')
          .eq('id', payment.plan_id)
          .maybeSingle()

        const { data: userData } = await supabaseAdmin
          .from('profiles')
          .select('email, first_name, last_name')
          .eq('id', payment.user_id)
          .maybeSingle()

        // Calculate subscription dates
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

        if (subscription) {
          await supabaseAdmin
            .from('payments')
            .update({ subscription_id: subscription.id })
            .eq('id', payment.id)

          // Create history
          await supabaseAdmin
            .from('subscription_history')
            .insert({
              user_id: payment.user_id,
              subscription_id: subscription.id,
              action: 'created',
              to_plan_id: payment.plan_id,
              metadata: {
                paymentReference: data.reference,
                amount: payment.amount,
                webhookEvent: eventType,
              },
            })
        }

        // Send email
        try {
          if (userData && planData) {
            const displayName = [userData.first_name, userData.last_name].filter(Boolean).join(' ') || userData.email
            const emailHtml = getPaymentSuccessEmail({
              name: displayName,
              planName: planData.name,
              amount: payment.amount,
              currency: payment.currency,
              startDate: startDate.toLocaleDateString(),
              endDate: endDate.toLocaleDateString(),
            })

            await sendEmail({
              to: userData.email,
              subject: `Payment Successful - Welcome to ${planData.name}`,
              html: emailHtml,
            })
          }
        } catch (emailError) {
          console.error('Failed to send webhook payment email:', emailError)
        }

        break
      }

      case 'subscription.disable':
      case 'subscription.not_renew': {
        // Handle subscription cancellation
        const { data: subscription } = await supabaseAdmin
          .from('subscriptions')
          .select('*')
          .eq('paystack_subscription_code', data.subscription_code)
          .maybeSingle()

        if (subscription) {
          await supabaseAdmin
            .from('subscriptions')
            .update({
              status: 'canceled',
              canceled_at: new Date().toISOString(),
            })
            .eq('id', subscription.id)

          await supabaseAdmin
            .from('subscription_history')
            .insert({
              user_id: subscription.user_id,
              subscription_id: subscription.id,
              action: 'canceled',
              metadata: {
                webhookEvent: eventType,
                reason: 'User canceled subscription',
              },
            })
        }

        break
      }

      default:
        console.log('Unhandled webhook event:', eventType)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Webhook error:', error)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}
