import { getAppUrl, getEmailTemplate } from './base'

interface SubscriptionExpiryReminderProps {
  name: string
  planName: string
  daysRemaining: number
  endDate: string
}

export function getSubscriptionExpiryReminderEmail({
  name,
  planName,
  daysRemaining,
  endDate,
}: SubscriptionExpiryReminderProps): string {
  const appUrl = getAppUrl()
  const content = `
    <p>Hi <strong>${name}</strong>,</p>
    
    <p>This is a friendly reminder that your <strong>${planName}</strong> subscription will expire in <strong>${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'}</strong>.</p>
    
    <div style="background: #fef9c3; background: linear-gradient(135deg, rgba(254, 249, 195, 0.2) 0%, rgba(191, 219, 254, 0.1) 100%); border-radius: 12px; padding: 20px; margin: 24px 0; border: 1px solid rgba(191, 219, 254, 0.3);">
      <h3 style="font-family: 'Outfit', sans-serif; font-size: 18px; font-weight: 600; color: #000000; margin: 0 0 12px 0;">Subscription Details</h3>
      <p style="margin: 8px 0; color: #52525b;"><strong style="color: #18181b;">Plan:</strong> ${planName}</p>
      <p style="margin: 8px 0; color: #52525b;"><strong style="color: #18181b;">Expiry Date:</strong> ${endDate}</p>
      <p style="margin: 8px 0; color: #52525b;"><strong style="color: #18181b;">Days Remaining:</strong> ${daysRemaining}</p>
    </div>
    
    <p>To continue enjoying all your premium features, renew your subscription before it expires.</p>
    
    <p style="font-size: 14px; color: #71717a; margin-top: 24px;">
      After expiration, your account will automatically switch to the Free plan with limited features.
    </p>
  `

  return getEmailTemplate({
    title: 'Your Subscription is Expiring Soon',
    preheader: `${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} left on your ${planName} subscription`,
    content,
    ctaText: 'Renew Subscription',
    ctaUrl: `${appUrl}/pricing`,
  })
}
