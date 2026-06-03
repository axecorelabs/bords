import { getAppUrl, getEmailTemplate } from './base'

interface SubscriptionRenewedProps {
  name: string
  planName: string
  amount: number
  currency: string
  nextBillingDate: string
}

export function getSubscriptionRenewedEmail({
  name,
  planName,
  amount,
  currency,
  nextBillingDate,
}: SubscriptionRenewedProps): string {
  const appUrl = getAppUrl()
  const content = `
    <p>Hi <strong>${name}</strong>,</p>
    
    <p>Your <strong>${planName}</strong> subscription has been successfully renewed! Thank you for continuing with BORDS.</p>
    
    <div style="background: #fafafa; border-radius: 12px; padding: 20px; margin: 24px 0;">
      <h3 style="font-family: 'Outfit', sans-serif; font-size: 18px; font-weight: 600; color: #000000; margin: 0 0 12px 0;">Renewal Details</h3>
      <p style="margin: 8px 0; color: #52525b;"><strong style="color: #18181b;">Plan:</strong> ${planName}</p>
      <p style="margin: 8px 0; color: #52525b;"><strong style="color: #18181b;">Amount Charged:</strong> ${currency} ${amount.toLocaleString()}</p>
      <p style="margin: 8px 0; color: #52525b;"><strong style="color: #18181b;">Next Billing Date:</strong> ${nextBillingDate}</p>
    </div>
    
    <p>Your premium features and access remain uninterrupted. Continue creating amazing work with BORDS!</p>
    
    <div class="security-notice">
      <p>
        <strong style="color: #18181b;">Receipt:</strong> A detailed receipt for this renewal has been sent to your email. You can view your billing history in account settings.
      </p>
    </div>
  `

  return getEmailTemplate({
    title: 'Subscription Renewed Successfully',
    preheader: `Your ${planName} subscription has been renewed`,
    content,
    ctaText: 'View Dashboard',
    ctaUrl: `${appUrl}/dashboard`,
  })
}
