# Cloudflare deployment

Two Workers, both in this repo:

| Worker | Dir | What it is |
|---|---|---|
| `boards` | `/` | The Next.js app, built with `@opennextjs/cloudflare` |
| `boards-realtime` | `/realtime` | Durable Objects: board sync (Yjs), messaging, presence |

LiveKit (calls) is unchanged. Supabase is unchanged (auth, Postgres, `yjs_documents`).

## How realtime works

```
browser ──ws /ws/:boardId?token=<ticket>──► boards-realtime ──► BoardRoom DO (one per board)
browser ──ws /messaging (subprotocol)─────► boards-realtime ──► MessagingHub DO (one per user)
boards (Next) ──service binding REALTIME──► POST /messaging/emit ──► MessagingHub DOs
boards-realtime ──service binding APP─────► POST /api/internal/board-access   (permission check)
BoardRoom ──────────────────────────────► Supabase yjs_documents (load on start, debounced save)
```

- **Auth** is unchanged: `/api/collab/ticket` mints a 5-minute JWE from `NEXTAUTH_SECRET`; the Worker verifies it (`realtime/src/auth.ts`).
  Board ticket rides in the query string (the y-websocket protocol offers no other slot); messaging offers it as a WebSocket subprotocol.
- **Rejections are close codes**: `4001` bad/expired ticket, `4003` no access. The client stops reconnecting on both.
- **Permissions** live in one place: `src/lib/board-permission.ts` (used by `save-state` and `/api/internal/board-access`).
- **Persistence**: `BoardRoom` loads from `yjs_documents` on start (and fails closed if Supabase is down, so an outage can't overwrite a board with an empty doc), saves 1.5s after the last edit (max 8s), and flushes immediately when the last client leaves. It pings `/api/internal/board-dirty` after each save.
- **Hibernation**: idle boards and idle users cost nothing. Messaging clients send a text `ping` every 25s, answered by the runtime without waking the object.
- **Presence**: `PresenceRegistry` (one global DO) tracks who's online; hubs only touch it on first connect / last disconnect.

## First deploy

Order matters: `boards-realtime` first (the Next Worker has a service binding to it).

```bash
# 1. realtime Worker
cd realtime
# set APP_URL, SUPABASE_URL, ALLOWED_ORIGINS in wrangler.jsonc "vars" (production values)
pnpm wrangler secret put NEXTAUTH_SECRET            # same value as the Next app
pnpm wrangler secret put INTERNAL_API_SECRET        # same value as the Next app
pnpm wrangler secret put SUPABASE_SERVICE_ROLE_KEY
pnpm wrangler deploy
# then add the service binding "APP" -> "boards" (see comment in wrangler.jsonc) and redeploy

# 2. Next.js Worker (repo root)
#    Set the same env vars you have on Vercel as Worker secrets/vars
#    (NEXT_PUBLIC_* must be present at BUILD time, in .env.production or the shell).
#    NEXT_PUBLIC_COLLAB_WS_URL -> wss://<realtime hostname>   (no trailing /ws)
#    COLLAB_SERVER_URL is only a fallback when the service binding is unavailable.
pnpm cf:deploy
```

Give `boards-realtime` a custom domain (e.g. `realtime.example.com`) so browsers can reach it, and add the app's origin to `ALLOWED_ORIGINS`.

## Local

```bash
pnpm cf:preview                 # Next app on the real Workers runtime (workerd)
cd realtime && pnpm dev         # realtime Worker; secrets in realtime/.dev.vars
cd realtime && pnpm test:e2e    # boots the Worker against a mock backend, ~40 checks
```

`.dev.vars` (gitignored) is the Workers equivalent of `.env.local` for `wrangler dev`.

## Decommissioned

- The Fastify/Hocuspocus collab server (`@hocuspocus/provider`, `y-websocket` removed from the client).
- Redis pub/sub for the collab server. (Upstash is still used for rate limiting and caching in the Next app.)

## Known follow-ups

- Cron endpoints (`/api/cron/*`) still rely on cronjob.org calling the Worker URL. Move to Cron Triggers/Queues when convenient.
- Revoking a user's board access doesn't disconnect an already-open socket until it reconnects (ticket lasts 5 min, permission is checked on every connect).
- Legacy `board_documents → Y.Doc` auto-migration (done by the old server on first load) is not ported; clients seed the room from their local IndexedDB state on first sync.
- `nodemailer` (SMTP) is still used for email; see if it runs on Workers (`nodejs_compat` supports `node:net`/`tls` sockets) or move to ZeptoMail's HTTP API.
