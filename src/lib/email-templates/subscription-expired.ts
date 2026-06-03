import { getAppUrl, getEmailTemplate } from './base'

interface SubscriptionExpiredProps {
  name: string
  planName: string
  expiredDate: string
}

export function getSubscriptionExpiredEmail({
  name,
  planName,
  expiredDate,
}: SubscriptionExpiredProps): string {
  const appUrl = getAppUrl()
  const content = `
    <p>Hi <strong>${name}</strong>,</p>
    
    <p>Your <strong>${planName}</strong> subscription expired on <strong>${expiredDate}</strong>.</p>
    
    <div style="background: #fafafa; border-radius: 12px; padding: 20px; margin: 24px 0;">
      <h3 style="font-family: 'Outfit', sans-serif; font-size: 18px; font-weight: 600; color: #000000; margin: 0 0 12px 0;">What This Means</h3>
      <ul style="margin: 12px 0; padding-left: 20px; color: #52525b;">
        <li style="margin-bottom: 8px;">Your account has been switched to the <strong style="color: #18181b;">Free plan</strong></li>
        <li style="margin-bottom: 8px;">Limited to 3 boards and 50 tasks per board</li>
        <li style="margin-bottom: 8px;">Advanced features are no longer available</li>
        <li style="margin-bottom: 8px;">Your data is safe and will be restored when you resubscribe</li>
      </ul>
    </div>
    
    <p>Ready to get back to full productivity? Reactivate your subscription anytime to restore all your premium features.</p>
    
    <div class="security-notice">
      <p>
        <strong style="color: #18181b;">Need help?</strong> If you have any questions about your subscription or billing, our support team is here to assist you.
      </p>
    </div>
  `

  return getEmailTemplate({
    title: 'Your Subscription Has Expired',
    preheader: `Your ${planName} subscription has expired`,
    content,
    ctaText: 'Reactivate Subscription',
    ctaUrl: `${appUrl}/pricing`,
  })
}
