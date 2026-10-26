# Auth: Better Auth on Supabase Postgres

Supabase Auth is replaced by [Better Auth](https://better-auth.com). Supabase stays as the Postgres host.

## Shape

- **Server**: `src/lib/auth/server.ts` (the `auth` instance), mounted at `/api/auth/[...all]`.
- **Database**: a small PostgREST-backed adapter (`src/lib/auth/postgrest-adapter.ts`), so auth works over plain HTTP on Workers and Node. Tables: `ba_user`, `ba_session`, `ba_account`, `ba_verification` (RLS on, no policies: service role only).
- **IDs**: user UUIDs are unchanged, so every FK to `profiles(id)` still holds.
- **Passwords**: bcrypt (`$2a$10$…`), copied inside Postgres from `auth.users.encrypted_password`. Imported users sign in with their existing password. New hashes are bcrypt too.
- **Google**: existing Google identities are imported as `google` accounts (`account_id` = Google `sub`), so they sign in unchanged.
- **Sessions**: signed cookie cache (5 min) + Upstash Redis lookup, Postgres is the source of truth. Everyone is signed out once at cutover.
- **Emails** (verification, reset, welcome, sign-in alert) reuse the existing templates and `sendEmail`.
- **Multi-domain**: `baseURL.allowedHosts` in `server.ts` (bords.app, www.bords.app, boards.axecorelabs.com, localhost). Cookies are per host.
- **Rate limits**: Better Auth rules (per route, in Redis) plus the existing `authLimiter` on the wrapper routes.

### Routes

Better Auth owns `/api/auth/*` (sign-in/email, sign-in/social, callback/google, sign-out, session, …). These app routes remain as thin wrappers so the existing pages didn't change: `signup`, `resend-verification`, `forgot-password`, `reset-password` (POST `{token,password}`), and `verify-email` (the emailed link). Removed: `callback`, `recovery-callback`, `recovery-relay`, `login-notify`, `/reset-password/confirm`.

### What replaced Supabase browser realtime

The browser can no longer hold a Supabase JWT, so the three client subscriptions moved to the realtime Worker:

| Was | Now |
|---|---|
| `notifications` channel (ActivitySidebar) | `notification_change` event on the messaging socket |
| `board_comments` (Dock, Comments) | `custom-message` on the board room's provider (`src/lib/board-events.ts`) |

A Postgres trigger (`push_realtime_event`, via `pg_net`) posts row changes to `POST /events` on the Worker, so it works regardless of which route wrote the row.

## Migrations (apply in this order)

1. `20261026000001_better_auth.sql`: tables, user/password/Google import, one-way mirror `auth.users → ba_*`, profile/workspace creation for Better Auth-native signups. Drops `profiles_id_fkey` (the FK to `auth.users`).
2. `20261026000002_realtime_push.sql`: `pg_net` triggers + `realtime_push_config`. After applying, set the target (not committed):
   ```sql
   insert into realtime_push_config (id, url, secret)
   values (1, 'https://realtime.axecorelabs.com', '<INTERNAL_API_SECRET>');
   ```

3. `20261026000003_welcome_notification_type.sql`: allows `'welcome'` in the notifications check constraint (the old flows inserted it but the constraint rejected it, so no welcome notification was ever stored).

The mirror triggers keep the legacy Vercel app (Supabase Auth) working during the transition: users/passwords/verification created or changed there flow into `ba_*`. They swallow their own errors, so they can never block a legacy signup. Changes made on the new app (e.g. a password reset) do **not** flow back, so cut over once, then retire the legacy app.

> **Heads-up on the migration history.** The production `supabase_migrations` table lacks 15 migrations (`20260502000001` … `20260701000002`) whose objects exist in the database. `supabase db push` would try to re-run them. Record them as applied first (`supabase migration repair --status applied <versions>`, history-table metadata only), then `supabase db push --include-all`. `password_reset_tokens` (`20260605120000`) was **never created** in production, so password reset on the legacy app has been silently failing; it's created (idempotently) by that push and is unused after cutover.

## Environment

- `BETTER_AUTH_SECRET` (new, 32+ random bytes). Worker secret + `.env.local`.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (existing).
- Unchanged: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_API_SECRET`, Upstash, SMTP.
- `NEXTAUTH_SECRET` is still used to sign the realtime ticket (`/api/collab/ticket`).
- No `BETTER_AUTH_URL`: the base URL is derived from the request host (allow-listed).

## Provider consoles (manual)

- **Google Cloud**: add `https://<host>/api/auth/callback/google` as an authorized redirect URI for each host that offers Google sign-in (boards.axecorelabs.com, bords.app, www.bords.app). The old Supabase callback can stay until the legacy app is retired.
- **Supabase dashboard**: nothing needed for Better Auth. (The Auth URL allow-list only matters for the legacy app.)

## Cutover checklist

1. Apply migrations (above) and set `realtime_push_config`.
2. Deploy realtime Worker (`/events`), then the app Worker with `BETTER_AUTH_SECRET`.
3. Smoke test: sign in with an existing password user, an existing Google user, sign up + verify, password reset, sign out. Open a shared board, post a comment from a second user, create a notification.
4. Move DNS / cron / webhooks, retire the Vercel app.
5. Cleanup migration: drop `ba_sync_auth_users`, `ba_sync_auth_identities` triggers and `ba_sync_user*` functions; add `profiles.id → ba_user(id)` FK; stop depending on `auth.users`.

## Tests

- DB: the two migrations were exercised against Postgres 16 with stubbed `auth`/`profiles`/`workspaces` and `pg_net` (import, mirror on insert/update/identity, native signup, failure isolation, anon denied).
- App: `scripts/auth-integration.ts` runs Better Auth + the adapter against real PostgREST. It needs the DB migration applied to a throwaway Postgres and a PostgREST in front of it:
  ```bash
  docker run -d --name ba-test -e POSTGRES_PASSWORD=pw postgres:16-alpine
  # apply a stub of the supabase schema + supabase/migrations/20261026000001_better_auth.sql, then:
  docker run -d --name ba-rest -p 3002:3000 --network <same> -e PGRST_DB_URI=… -e PGRST_JWT_SECRET=… postgrest/postgrest
  SERVICE_KEY=<service_role jwt> npx tsx scripts/auth-integration.ts
  ```
- Realtime: `cd realtime && pnpm test:e2e` (includes `/events`).

## Known trade-offs

- Revoking a session can take up to 5 minutes to take effect on a request that carries a valid signed cookie (cookie cache). Lower `session.cookieCache.maxAge` if that matters.
- Bcrypt runs in pure JS (`bcryptjs`) on Workers, ~100–300 ms CPU per sign-in; needs the Workers Paid plan (already required by bundle size).
- Unverified legacy users must request a fresh verification email; their old tokens (`email_verification_tokens`) don't carry over.
