// Secrets (`wrangler secret put` / .dev.vars) and optional bindings that `wrangler types`
// can't infer from wrangler.jsonc. Merged into both the global `Env` and `Cloudflare.Env`
// (partyserver's `this.env` is typed as the latter).
interface __ExtraEnv {
  NEXTAUTH_SECRET: string
  INTERNAL_API_SECRET: string
  SUPABASE_SERVICE_ROLE_KEY: string
  /** Optional overrides for change-log compaction (tests). */
  COMPACT_AFTER_UPDATES?: string
  COMPACT_AFTER_MS?: string
  /** Optional overrides for presence timing (tests). */
  PRESENCE_ONLINE_TTL_MS?: string
  PRESENCE_REFRESH_MS?: string
  /** Optional overrides for the access cache / save timing (tests). */
  ACCESS_CACHE_TTL_MS?: string
  ACCESS_STALE_MS?: string
  SAVE_DEBOUNCE_MS?: string
  SAVE_MAX_WAIT_MS?: string
  SAVE_RETRY_BASE_MS?: string
  /** Service binding to the Next.js Worker (optional; falls back to APP_URL). */
  APP?: Fetcher
}
interface Env extends __ExtraEnv {}
declare namespace Cloudflare {
  interface Env extends __ExtraEnv {}
}
