import { getAppUrl, getEmailTemplate } from './base'

interface WelcomeEmailProps {
  name: string
  email: string
}

export function getWelcomeEmail({ name, email }: WelcomeEmailProps): string {
  const appUrl = getAppUrl()
  const content = `
    <p>Hi ${name}! 👋</p>
    
    <p>
      Welcome to <strong>Boards</strong>! We're thrilled to have you join our community of productive individuals.
    </p>
    
    <p>
      Your account has been successfully created with the email: <strong>${email}</strong>
    </p>
    
    <div class="security-notice">
      <p>
        <strong>🎯 Here's what you can do with Boards:</strong><br/>
        • Create unlimited boards and organize your work<br/>
        • Add sticky notes, checklists, and kanban boards<br/>
        • Connect items with visual links<br/>
        • Draw on your canvas<br/>
        • Switch between light and dark themes
      </p>
    </div>
    
    <p>
      Ready to get started? Click the button below to dive in and create your first board!
    </p>
  `

  return getEmailTemplate({
    title: 'Welcome to Boards!',
    preheader: 'Your account has been successfully created',
    content,
    ctaText: 'Start Creating',
    ctaUrl: appUrl,
  })
}
