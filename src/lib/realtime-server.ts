/**
 * Server-to-server client for the realtime Worker (boards-realtime).
 *
 * On Cloudflare the Worker is reached through the `REALTIME` service binding
 * (no public hop, no auth to the edge). Everywhere else (next dev, Vercel) it
 * falls back to COLLAB_SERVER_URL over HTTP. Both paths authenticate with
 * INTERNAL_API_SECRET.
 */

interface ServiceBinding {
  fetch(input: string, init?: RequestInit): Promise<Response>
}

async function getBinding(): Promise<ServiceBinding | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const { env } = getCloudflareContext()
    return (env as { REALTIME?: ServiceBinding }).REALTIME ?? null
  } catch {
    return null // not running on Workers
  }
}

export async function realtimeFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${process.env.INTERNAL_API_SECRET}`)
  const withAuth = { ...init, headers }

  const binding = await getBinding()
  if (binding) return binding.fetch(`https://realtime.internal${path}`, withAuth)

  const base = process.env.COLLAB_SERVER_URL ?? process.env.NEXT_PUBLIC_COLLAB_SERVER_URL ?? 'http://localhost:4444'
  return fetch(`${base.replace(/\/$/, '')}${path}`, withAuth)
}

export interface MessagingEmit {
  type: 'new_message' | 'update_message'
  conversationId: string
  memberIds: string[]
  senderId: string
  payload: Record<string, unknown>
}

/** Fan a messaging event out to the members' live sockets. Throws on transport errors. */
export async function emitMessagingEvent(event: MessagingEmit): Promise<void> {
  const res = await realtimeFetch('/messaging/emit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
  if (!res.ok) throw new Error(`messaging emit failed: ${res.status}`)
}
