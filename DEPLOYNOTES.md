# Deploy Notes

## Current AI Worker Setup

- Worker endpoint: `/api/cron/ai-embeddings?batch=20`
- Auth: `Authorization: Bearer <CRON_SECRET>`
- Scheduler: cronjob.org (GET request with custom header)
- Expected healthy response shape:

```json
{"ok":true,"picked":18,"processed":18,"failed":0}
```

`picked` is jobs claimed in this run, `processed` is successful completions, `failed` is failed jobs this run.

## Security (Important)

### Immediate action required

Secrets were exposed in development context and must be rotated before production:

- `CRON_SECRET`
- `OPENROUTER_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `UPSTASH_REDIS_REST_TOKEN`
- `WASABI_SECRET_ACCESS_KEY`
- `LIVEKIT_API_SECRET`
- SMTP credentials (`EMAIL_SERVER_PASSWORD`, `ZEPTOMAIL_SMTP_PASS`)
- OAuth secret (`GOOGLE_CLIENT_SECRET`)
- Payment secret (`PAYSTACK_SECRET_KEY`)

After rotation:

1. Update local `.env.local`.
2. Update deployed environment variables.
3. Update cronjob.org header value for `Authorization`.
4. Invalidate old tokens/keys where provider supports revocation.

### Hardening checklist

- Use a strong random `NEXTAUTH_SECRET` in production.
- Keep `.env.local` out of source control and never paste real secrets into issues/chat/logs.
- Restrict cron endpoint to secret auth only (already implemented).
- Keep RLS enabled on AI pipeline tables (already added in migration).
- Use least-privilege keys where possible; avoid using broad service keys in client-exposed paths.

## Recommended cronjob.org configuration

- URL: `https://<your-domain>/api/cron/ai-embeddings?batch=20`
- Method: `GET`
- Header: `Authorization: Bearer <CRON_SECRET>`
- Frequency: every `1 minute` initially
- Timeout: `30-60s`
- Retry: `1` retry

Tuning guidance:

- If queue remains high for multiple runs, increase `batch` to `50` or `100`.
- If queue is usually near zero, reduce frequency to every `2-5 minutes`.

## Is this production grade?

Short answer: **not yet**, but close.

### What is already strong

- Authenticated AI endpoints
- Conversation membership checks before AI response
- Scoped org context (server-derived, not client-trusted)
- Rate limiting in place
- Response/prompt/retrieval caching
- Conversation compaction for token control
- Async embedding queue + worker endpoint

### What is still required for production readiness

1. Secret rotation and secure key management (mandatory).
2. Run all new migrations in production, including AI retrieval pipeline.
3. Add operational dashboards/alerts (worker failures, queue backlog, cache hit rate, p95 latency).
4. Confirm embedding model/provider quotas and failover behavior.
5. Add backup/retry runbook for worker outages.
6. Validate full deploy build in CI/CD environment.

Once those are done, this setup is a solid production baseline for the current feature scope.
