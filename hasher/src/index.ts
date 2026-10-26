import bcrypt from 'bcryptjs'

/**
 * Password hashing, on its own Worker.
 *
 * bcrypt is deliberately expensive (about 0.35 s of CPU per call on Workers). A Worker handles several
 * requests at once on a single thread, so doing that work inside the main app Worker makes every other
 * request in the same instance wait. Here it only ever delays other logins; the app just awaits the
 * result without blocking anything. This Worker is also tiny, so a new instance starts almost instantly
 * (the main app's bundle is ~24 MB).
 *
 * Reachable only through a service binding: no routes, no workers.dev URL (see wrangler.jsonc).
 */

export interface Env {}

const COST = 10 // same as the hashes imported from Supabase ($2a$10$…)

function bad(status: number, error: string) {
  return Response.json({ error }, { status })
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return bad(405, 'POST only')
    const path = new URL(request.url).pathname

    let body: { password?: unknown; hash?: unknown }
    try {
      body = await request.json()
    } catch {
      return bad(400, 'Invalid JSON')
    }
    if (typeof body.password !== 'string' || body.password.length === 0) return bad(400, 'password required')
    if (new TextEncoder().encode(body.password).length > 1024) return bad(400, 'password too long') // bound the work an input can cause

    if (path === '/hash') {
      return Response.json({ hash: await bcrypt.hash(body.password, COST) })
    }
    if (path === '/verify') {
      if (typeof body.hash !== 'string' || !/^\$2[aby]\$\d{2}\$/.test(body.hash)) return Response.json({ ok: false })
      // Only run the (expensive) comparison for cost factors we expect, so a crafted hash can't make us spin
      const cost = Number(body.hash.slice(4, 6))
      if (cost < 4 || cost > 12) return Response.json({ ok: false })
      return Response.json({ ok: await bcrypt.compare(body.password, body.hash) })
    }
    return bad(404, 'unknown route')
  },
} satisfies ExportedHandler<Env>

