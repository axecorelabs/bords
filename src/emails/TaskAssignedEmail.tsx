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

interface TaskItem {
  content: string
  type: 'new' | 'updated' | 'removed'
}

interface TaskAssignedEmailProps {
  assigneeName: string
  bordTitle: string
  orgName?: string
  tasks: TaskItem[]
  inboxUrl: string
}

export default function TaskAssignedEmail({
  assigneeName = 'Team Member',
  bordTitle = 'Project Board',
  orgName = '',
  tasks = [{ content: 'Sample task', type: 'new' }],
  inboxUrl = 'https://bords.app',
}: TaskAssignedEmailProps) {
  const newTasks = tasks.filter(t => t.type === 'new')
  const updatedTasks = tasks.filter(t => t.type === 'updated')
  const removedTasks = tasks.filter(t => t.type === 'removed')

  const previewText = newTasks.length > 0
    ? `You have ${newTasks.length} new task${newTasks.length > 1 ? 's' : ''} in "${bordTitle}"`
    : `Tasks updated in "${bordTitle}"`

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Heading style={logo}>BORDS</Heading>
            <Text style={tagline}>Your visual workspace</Text>
          </Section>

          {/* Main Content */}
          <Section style={content}>
            <Text style={badge}>📋 TASK ASSIGNMENT</Text>
            <Heading style={heading}>
              {newTasks.length > 0
                ? `New tasks assigned to you`
                : `Your tasks have been updated`}
            </Heading>

            <Text style={paragraph}>
              Hi <strong>{assigneeName}</strong>, tasks have been published in{' '}
              <strong>&quot;{bordTitle}&quot;</strong>
              {orgName ? ` (${orgName})` : ''} that involve you.
            </Text>

            <Section style={infoBox}>
              {newTasks.length > 0 && (
                <>
                  <Text style={infoTitle}>
                    ✅ New Tasks ({newTasks.length})
                  </Text>
                  {newTasks.map((task, i) => (
                    <Text key={i} style={infoItem}>
                      • {task.content.length > 100 ? task.content.substring(0, 100) + '…' : task.content}
                    </Text>
                  ))}
                </>
              )}
              {updatedTasks.length > 0 && (
                <>
                  <Text style={{ ...infoTitle, marginTop: newTasks.length > 0 ? '16px' : '0' }}>
                    🔄 Updated Tasks ({updatedTasks.length})
                  </Text>
                  {updatedTasks.map((task, i) => (
                    <Text key={i} style={infoItem}>
                      • {task.content.length > 100 ? task.content.substring(0, 100) + '…' : task.content}
                    </Text>
                  ))}
                </>
              )}
              {removedTasks.length > 0 && (
                <>
                  <Text style={{ ...infoTitle, marginTop: (newTasks.length > 0 || updatedTasks.length > 0) ? '16px' : '0' }}>
                    ❌ Removed Tasks ({removedTasks.length})
                  </Text>
                  {removedTasks.map((task, i) => (
                    <Text key={i} style={infoItem}>
                      • {task.content.length > 100 ? task.content.substring(0, 100) + '…' : task.content}
                    </Text>
                  ))}
                </>
              )}
            </Section>

            <Section style={buttonContainer}>
              <Button href={inboxUrl} style={button}>
                View in Execution Inbox →
              </Button>
            </Section>

            <Text style={helpText}>
              You can manage your task notifications in your BORDS settings.
            </Text>
          </Section>

          {/* Footer */}
          <Section style={footer}>
            <Hr style={footerDivider} />
            <Text style={footerNote}>
              You&apos;re receiving this because tasks were assigned to you on BORDS.
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
  margin: '0 0 12px',
}

const infoItem = {
  fontSize: '15px',
  lineHeight: '1.8',
  color: '#6b7280',
  margin: '0 0 8px',
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
