import { getAppUrl, getEmailTemplate } from './base'

interface EmailVerifiedProps {
  name: string
}

export function getEmailVerifiedEmail({ name }: EmailVerifiedProps): string {
  const appUrl = getAppUrl()
  const content = `
    <p>Hi ${name}! 🎉</p>
    
    <p>
      Great news! Your email address has been successfully verified.
    </p>
    
    <p>
      You now have full access to all <strong>Boards</strong> features. Here's what you can do:
    </p>
    
    <div class="security-notice">
      <p>
        <strong>✨ Your Boards Account is Ready:</strong><br/>
        • Create and manage unlimited boards<br/>
        • Organize with sticky notes, checklists, and kanban boards<br/>
        • Draw and connect items visually<br/>
        • Collaborate and share your work<br/>
        • Access your boards from anywhere
      </p>
    </div>
    
    <p>
      Ready to boost your productivity? Log in to your account and start creating!
    </p>
  `

  return getEmailTemplate({
    title: 'Email Verified Successfully! 🎉',
    preheader: 'Your account is now fully activated',
    content,
    ctaText: 'Go to Dashboard',
    ctaUrl: appUrl,
  })
}
