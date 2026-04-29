import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
  Hr,
} from '@react-email/components'

interface FriendRequestEmailProps {
  recipientName: string
  senderName: string
  acceptUrl: string
}

export default function FriendRequestEmail({
  recipientName = 'Friend',
  senderName = 'Someone',
  acceptUrl = 'https://bords.app',
}: FriendRequestEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {senderName} wants to add you as a friend on BORDS
      </Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Heading style={logo}>BORDS</Heading>
            <Text style={tagline}>Your visual workspace</Text>
          </Section>

          {/* Main Content */}
          <Section style={content}>
            <Text style={badge}>👋 FRIEND REQUEST</Text>
            <Heading style={heading}>
              {senderName} wants to connect with you
            </Heading>

            <Text style={paragraph}>
              Hi <strong>{recipientName}</strong>,{' '}
              <strong>{senderName}</strong> has sent you a friend request on BORDS.
              Once you accept, you&apos;ll be able to collaborate and share boards together.
            </Text>

            <Section style={infoBox}>
              <Text style={infoTitle}>What friends can do:</Text>
              <Text style={infoItem}>
                🎨 Share boards and collaborate visually
              </Text>
              <Text style={infoItem}>
                📋 Assign tasks to each other on shared boards
              </Text>
              <Text style={infoItem}>
                💬 Stay connected through your BORDS workspace
              </Text>
            </Section>

            <Section style={buttonContainer}>
              <Button href={acceptUrl} style={button}>
                View Request →
              </Button>
            </Section>

            <Text style={helpText}>
              If you don&apos;t know this person, you can safely ignore this request.
            </Text>
          </Section>

          {/* Footer */}
          <Section style={footer}>
            <Hr style={footerDivider} />
            <Text style={footerNote}>
              You&apos;re receiving this because {senderName} sent you a friend
              request on BORDS.
            </Text>
            <Text style={footerNote}>
              © 2026 BORDS. All rights reserved.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

// Styles (consistent with other BORDS emails)
const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
}

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
  maxWidth: '600px',
}

const header = {
  padding: '32px 48px 24px',
  textAlign: 'center' as const,
  backgroundColor: '#000000',
}

const logo = {
  fontSize: '32px',
  fontWeight: 'bold',
  color: '#ffffff',
  margin: '0 0 8px',
  letterSpacing: '2px',
}

const tagline = {
  fontSize: '14px',
  color: '#60a5fa',
  margin: '0',
  fontWeight: '500',
}

const content = {
  padding: '0 48px',
}

const badge = {
  display: 'inline-block',
  backgroundColor: '#dbeafe',
  color: '#1e40af',
  padding: '6px 12px',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: '600',
  letterSpacing: '0.5px',
  marginTop: '32px',
  marginBottom: '16px',
}

const heading = {
  fontSize: '24px',
  fontWeight: '700',
  color: '#1f2937',
  margin: '0 0 24px',
  lineHeight: '1.3',
}

const paragraph = {
  fontSize: '16px',
  lineHeight: '1.6',
  color: '#6b7280',
  margin: '0 0 24px',
}

const infoBox = {
  backgroundColor: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: '12px',
  padding: '24px',
  marginBottom: '32px',
}

const infoTitle = {
  fontSize: '16px',
  fontWeight: '600',
  color: '#1f2937',
  margin: '0 0 16px',
}

const infoItem = {
  fontSize: '15px',
  lineHeight: '1.8',
  color: '#6b7280',
  margin: '0 0 12px',
}

const buttonContainer = {
  textAlign: 'center' as const,
  marginBottom: '32px',
}

const button = {
  backgroundColor: '#3b82f6',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '14px 32px',
  lineHeight: '1.5',
}

const helpText = {
  fontSize: '14px',
  lineHeight: '1.6',
  color: '#9ca3af',
  margin: '0',
  textAlign: 'center' as const,
}

const footer = {
  padding: '0 48px',
  marginTop: '32px',
}

const footerDivider = {
  borderColor: '#e5e7eb',
  margin: '32px 0 24px',
}

const footerNote = {
  fontSize: '12px',
  lineHeight: '1.6',
  color: '#9ca3af',
  margin: '0 0 8px',
  textAlign: 'center' as const,
}
