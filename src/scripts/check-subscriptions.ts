import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { 
  getSubscriptionExpiryReminderEmail, 
  getSubscriptionExpiredEmail 
} from '@/lib/email-templates'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

/**
 * Cron job to check for expiring and expired subscriptions
 * Should be run daily
 */
export async function checkSubscriptions() {
  try {
    const now = new Date()
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

    // Find subscriptions expiring in 3 days (with plan data)
    const { data: expiringSoon } = await supabase
      .from('subscriptions')
      .select('*, plans(*)')
      .eq('status', 'active')
      .gte('end_date', now.toISOString())
      .lte('end_date', threeDaysFromNow.toISOString())

    console.log(`Found ${(expiringSoon || []).length} subscriptions expiring soon`)

    // Send reminder emails
    for (const subscription of expiringSoon || []) {
      try {
        const { data: user } = await supabase
          .from('profiles')
          .select('email, first_name, last_name')
          .eq('id', subscription.user_id)
          .single()

        if (!user) continue
        const plan = subscription.plans as any
        const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email

        const daysRemaining = Math.ceil(
          (new Date(subscription.end_date!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        )

        const emailHtml = getSubscriptionExpiryReminderEmail({
          name: userName,
          planName: plan.name,
          daysRemaining,
          endDate: new Date(subscription.end_date!).toLocaleDateString(),
        })

        await sendEmail({
          to: user.email,
          subject: `Your ${plan.name} subscription expires in ${daysRemaining} days`,
          html: emailHtml,
        })

        console.log(`Sent expiry reminder to ${user.email}`)
      } catch (error) {
        console.error('Failed to send expiry reminder:', error)
      }
    }

    // Find expired subscriptions
    const { data: expired } = await supabase
      .from('subscriptions')
      .select('*, plans(*)')
      .eq('status', 'active')
      .lt('end_date', now.toISOString())

    console.log(`Found ${(expired || []).length} expired subscriptions`)

    // Update expired subscriptions
    for (const subscription of expired || []) {
      try {
        const { data: user } = await supabase
          .from('profiles')
          .select('email, first_name, last_name')
          .eq('id', subscription.user_id)
          .single()

        if (!user) continue
        const plan = subscription.plans as any
        const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email

        // Update subscription status
        await supabase
          .from('subscriptions')
          .update({ status: 'expired', updated_at: now.toISOString() })
          .eq('id', subscription.id)

        // Create history record
        await supabase.from('subscription_history').insert({
          user_id: subscription.user_id,
          subscription_id: subscription.id,
          action: 'expired',
          from_plan_id: subscription.plan_id,
          metadata: {
            expiredAt: now.toISOString(),
            autoExpired: true,
          },
        })

        // Send expiration email
        const emailHtml = getSubscriptionExpiredEmail({
          name: userName,
          planName: plan.name,
          expiredDate: new Date(subscription.end_date!).toLocaleDateString(),
        })

        await sendEmail({
          to: user.email,
          subject: `Your ${plan.name} subscription has expired`,
          html: emailHtml,
        })

        console.log(`Expired subscription for ${user.email}`)
      } catch (error) {
        console.error('Failed to process expired subscription:', error)
      }
    }

    return {
      success: true,
      expiringSoon: (expiringSoon || []).length,
      expired: (expired || []).length,
    }
  } catch (error) {
    console.error('Subscription check error:', error)
    throw error
  }
}

// CLI execution
if (require.main === module) {
  checkSubscriptions()
    .then((result) => {
      console.log('✅ Subscription check completed:', result)
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Subscription check failed:', error)
      process.exit(1)
    })
}
