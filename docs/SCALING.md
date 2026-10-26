# Scaling notes: logins and the Supabase dependency

Measured on production (Workers CPU time as reported by `wrangler tail`; wall time is mostly network and ignored here).

## Logins

- **bcrypt costs ~110 ms CPU per hash** on Workers (hasher median 116 ms). It cannot be made cheaper without weakening it:
  native scrypt at comparable strength costs about the same, and Workers caps PBKDF2 at 100k iterations (below the recommended minimum).
- So the goal is containment, not speed:
  - **`boards-hasher` Worker** (`hasher/`): all hashing/verifying runs there, reached only through the `HASHER` service binding
    (no routes, no workers.dev). The main app just awaits the result, so a login burst delays other logins, not the app.
    If the hasher is unreachable the app hashes locally (slower, but sign-in keeps working). Deploy it before the app.
  - **Admission control** (`src/lib/auth/admission.ts`), checked before any hashing: 10 attempts / 15 min per account
    (a successful sign-in clears it; defeats credential stuffing spread over many IPs), and a global budget of
    `AUTH_HASH_PER_SECOND` (default 60) hashes/s so a flood turns into "try again in a few seconds" instead of unbounded cost.
    Redis down = admit (a limiter outage must not lock everyone out). Better Auth's own per-IP limits still apply.
  - **"New sign-in" emails only for a new device** (IP + browser, 90 days): rendering the React email and opening SMTP was
    hundreds of ms of CPU on every login.
- **Cold starts are the remaining CPU.** A new instance of the main app Worker costs ~300-800 ms CPU to start (24 MB bundle); a warm
  request is ~35-50 ms. Under sustained traffic instances stay warm. Reducing it means shrinking the bundle (lazy-load rarely used libraries).

## Supabase as the shared dependency

What goes to Supabase, and what protects it:

| Traffic | Protection |
|---|---|
| Session checks (every request) | Signed cookie cache (5 min) -> Redis -> Postgres. Postgres is rarely hit. |
| Board access checks (every socket connect) | Per-instance cache (30 s) + shared Redis cache (30 s, denials 5 s). During an outage a recently granted user keeps working (last-known, 1 h); anyone else gets close code **1013** ("try again later", the client keeps retrying) and the rooms endpoint answers **503**, never "forbidden". Permission lookups **fail closed**: a database error can no longer be mistaken for "no such board". |
| Board saves | One small change-log row per save (not the whole board), snapshots folded every ~2 min; saves are debounced 5 s / 30 s because edits are already journalled in the board's Durable Object. Failed saves retry with exponential, jittered backoff (5 s -> 60 s) so recovery isn't a stampede. |
| Presence | 16 sharded registries; contact lists cached 10 min. |

**Visibility.** Slow (>= 800 ms) or failing (429/5xx) Supabase calls are logged as JSON
(`{"evt":"dependency_slow" | "dependency_error","dep":"supabase","op":...,"ms":...,"status":...}`) by the realtime Worker and the app.
Search them in Workers Observability. `GET /health` on the realtime Worker also reports `supabaseMs`.

## Levers on the Supabase side (dashboard, not code)

- Watch **Reports -> Database / API**: CPU, connections, API requests. Sustained DB CPU > ~60% or connection saturation = time to raise the compute size.
- Use the pooled connection string / Supavisor for anything that connects to Postgres directly (nothing does today; all access is PostgREST).
- Set a usage alert so a traffic spike emails you before it becomes an outage.
