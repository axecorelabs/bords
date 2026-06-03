import { getAppUrl, getEmailTemplate } from './base'

interface PaymentSuccessEmailProps {
  name: string
  planName: string
  amount: number
  currency: string
  startDate: string
  endDate: string
}

export function getPaymentSuccessEmail({
  name,
  planName,
  amount,
  currency,
  startDate,
  endDate,
}: PaymentSuccessEmailProps): string {
  const appUrl = getAppUrl()
  const content = `
    <p>Hi <strong>${name}</strong>,</p>
    
    <p>Your payment has been processed successfully! Welcome to <strong>${planName}</strong>.</p>
    
    <div style="background: #fafafa; border-radius: 12px; padding: 20px; margin: 24px 0;">
      <h3 style="font-family: 'Outfit', sans-serif; font-size: 18px; font-weight: 600; color: #000000; margin: 0 0 12px 0;">Payment Details</h3>
      <p style="margin: 8px 0; color: #52525b;"><strong style="color: #18181b;">Plan:</strong> ${planName}</p>
      <p style="margin: 8px 0; color: #52525b;"><strong style="color: #18181b;">Amount:</strong> ${currency} ${amount.toLocaleString()}</p>
      <p style="margin: 8px 0; color: #52525b;"><strong style="color: #18181b;">Start Date:</strong> ${startDate}</p>
      <p style="margin: 8px 0; color: #52525b;"><strong style="color: #18181b;">End Date:</strong> ${endDate}</p>
    </div>
    
    <p>You now have access to all the features included in your plan. Start creating and organizing with BORDS!</p>
    
    <div class="security-notice">
      <p>
        <strong style="color: #18181b;">Receipt:</strong> A detailed receipt has been sent to your email. You can also view your billing history in your account settings.
      </p>
    </div>
  `

  return getEmailTemplate({
    title: 'Payment Successful! 🎉',
    preheader: `Your ${planName} subscription is now active`,
    content,
    ctaText: 'Go to Dashboard',
    ctaUrl: `${appUrl}/dashboard`,
  })
}
