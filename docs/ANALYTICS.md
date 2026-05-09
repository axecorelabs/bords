# BORDS Analytics

PostHog is used for product analytics only: feature usage, funnels, activation, and lightweight session insight.

## Environment Variables

Set these in local development and production:

```env
NEXT_PUBLIC_POSTHOG_TOKEN=<ph_project_token>
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Optional:

```env
NEXT_PUBLIC_POSTHOG_SESSION_REPLAY=true
NEXT_PUBLIC_POSTHOG_CAPTURE_EMAILS=true
```

Defaults are privacy-conservative:
- session replay is disabled unless `NEXT_PUBLIC_POSTHOG_SESSION_REPLAY=true`
- inputs are masked
- DOM text is masked in recordings
- email is not sent to PostHog unless `NEXT_PUBLIC_POSTHOG_CAPTURE_EMAILS=true`

## Event Rules

Safe to send:
- IDs
- workspace context
- plan/tier
- booleans
- counts
- durations
- feature names

Never send:
- sticky note text
- checklist item text
- kanban task titles/descriptions
- message bodies
- AI prompts or responses
- uploaded file names or media contents

## Current Events

- `page_viewed`
- `user_identified`
- `board_created`
- `board_opened`
- `collab_session_started`
- `collab_session_offline`
