import posthog from 'posthog-js'

const token = process.env.NEXT_PUBLIC_POSTHOG_TOKEN
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'
const replayEnabled = process.env.NEXT_PUBLIC_POSTHOG_SESSION_REPLAY === 'true'

if (token) {
  posthog.init(token, {
    api_host: host,
    defaults: '2026-01-30',
    capture_pageview: false,
    disable_session_recording: !replayEnabled,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '*',
    },
  })
}
