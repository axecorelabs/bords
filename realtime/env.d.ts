// Secrets (`wrangler secret put` / .dev.vars) and optional bindings that `wrangler types`
// can't infer from wrangler.jsonc. Merged into both the global `Env` and `Cloudflare.Env`
// (partyserver's `this.env` is typed as the latter).
interface __ExtraEnv {
  NEXTAUTH_SECRET: string
  INTERNAL_API_SECRET: string
  SUPABASE_SERVICE_ROLE_KEY: string
  /** Service binding to the Next.js Worker (optional; falls back to APP_URL). */
  APP?: Fetcher
}
interface Env extends __ExtraEnv {}
declare namespace Cloudflare {
  interface Env extends __ExtraEnv {}
}
