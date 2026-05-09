import posthog from 'posthog-js'

export type AnalyticsEvent =
  | 'page_viewed'
  | 'user_identified'
  | 'signup_started'
  | 'signup_completed'
  | 'signup_failed'
  | 'google_oauth_started'
  | 'google_oauth_failed'
  | 'board_created'
  | 'board_opened'
  | 'board_shared'
  | 'invite_sent'
  | 'collab_session_started'
  | 'collab_session_offline'
  | 'subscription_checkout_started'
  | 'subscription_checkout_failed'

type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>

export function isAnalyticsEnabled(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!(process.env.NEXT_PUBLIC_POSTHOG_TOKEN || process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN)
  )
}

export function trackEvent(event: AnalyticsEvent, properties: AnalyticsProperties = {}): void {
  if (!isAnalyticsEnabled()) return
  posthog.capture(event, sanitizeProperties(properties))
}

export function identifyUser(user: {
  id?: string | null
  email?: string | null
  name?: string | null
} | null): void {
  if (!isAnalyticsEnabled()) return

  if (!user?.id) {
    posthog.reset()
    return
  }

  const personProperties: AnalyticsProperties = {}
  if (user.name) personProperties.name = user.name
  if (process.env.NEXT_PUBLIC_POSTHOG_CAPTURE_EMAILS === 'true' && user.email) {
    personProperties.email = user.email
  }

  posthog.identify(user.id, personProperties)
  trackEvent('user_identified')
}

function sanitizeProperties(properties: AnalyticsProperties): AnalyticsProperties {
  const clean: AnalyticsProperties = {}
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined) continue
    clean[key] = value
  }
  return clean
}
