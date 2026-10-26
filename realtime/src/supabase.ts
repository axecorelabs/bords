/**
 * Minimal PostgREST client for the handful of Supabase queries the realtime
 * Worker needs. Uses the service-role key, so it must only run server-side.
 */

/** Anything slower than this, or any 429/5xx, is logged (searchable in Workers observability) so limits show up early. */
const SLOW_MS = 800

export function logIfSlow(op: string, startedAt: number, status: number, extra?: Record<string, unknown>) {
  const ms = Date.now() - startedAt
  if (ms >= SLOW_MS || status === 429 || status >= 500) {
    console.warn(JSON.stringify({ evt: status >= 500 || status === 429 ? 'dependency_error' : 'dependency_slow', dep: 'supabase', op, ms, status, ...extra }))
  }
}

/** fetch() that reports slow or failing calls. Timing only advances across I/O on Workers, which is what we want here. */
async function timed(op: string, url: string, init: RequestInit): Promise<Response> {
  const started = Date.now()
  try {
    const res = await fetch(url, init)
    logIfSlow(op, started, res.status)
    return res
  } catch (err) {
    console.warn(JSON.stringify({ evt: 'dependency_error', dep: 'supabase', op, ms: Date.now() - started, status: 0, error: String(err).slice(0, 120) }))
    throw err
  }
}

function headers(env: Env, extra?: Record<string, string>): HeadersInit {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  }
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0')
  return out
}

function fromBytea(value: unknown): Uint8Array | null {
  // PostgREST returns bytea as a "\x<hex>" string.
  if (typeof value !== 'string' || !value.startsWith('\\x')) return null
  const hex = value.slice(2)
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export interface StoredYDoc {
  state: Uint8Array | null
  version: number
  /** Change-log rows applied on top of `state`, in order. */
  updates: Uint8Array[]
  /** Highest change-log row id included in `updates` (0 if none). */
  maxUpdateId: number
  /** False when the yjs_updates table doesn't exist yet: callers fall back to full snapshots. */
  logAvailable: boolean
}

const PAGE = 500

function isMissingTable(status: number, body: string) {
  return status === 404 || /PGRST205|42P01|does not exist/i.test(body)
}

/** Throws on transport/HTTP errors so callers never mistake an outage for "no document". */
export async function loadYDoc(env: Env, boardId: string): Promise<StoredYDoc> {
  const id = encodeURIComponent(boardId)
  const res = await timed('yjs_documents.load', `${env.SUPABASE_URL}/rest/v1/yjs_documents?board_id=eq.${id}&select=state,version&limit=1`, {
    headers: headers(env, { Accept: 'application/json' }),
  })
  if (!res.ok) throw new Error(`yjs_documents load failed: ${res.status} ${await res.text()}`)
  const rows = (await res.json()) as Array<{ state: unknown; version: number }>
  const snapshot = rows.length === 0 ? { state: null, version: 0 } : { state: fromBytea(rows[0].state), version: rows[0].version ?? 0 }

  // Change log, paged so a long log never becomes one giant response.
  const updates: Uint8Array[] = []
  let maxUpdateId = 0
  let after = 0
  for (;;) {
    const r = await timed(
      'yjs_updates.load',
      `${env.SUPABASE_URL}/rest/v1/yjs_updates?board_id=eq.${id}&id=gt.${after}&select=id,update&order=id.asc&limit=${PAGE}`,
      { headers: headers(env, { Accept: 'application/json' }) }
    )
    if (!r.ok) {
      const text = await r.text()
      if (isMissingTable(r.status, text)) return { ...snapshot, updates: [], maxUpdateId: 0, logAvailable: false }
      throw new Error(`yjs_updates load failed: ${r.status} ${text}`)
    }
    const page = (await r.json()) as Array<{ id: number; update: unknown }>
    for (const row of page) {
      const bytes = fromBytea(row.update)
      if (bytes) updates.push(bytes)
      maxUpdateId = Math.max(maxUpdateId, row.id)
    }
    if (page.length < PAGE) break
    after = page[page.length - 1].id
  }
  return { ...snapshot, updates, maxUpdateId, logAvailable: true }
}

/** Append one small update to the change log. Returns the new row id; null if the table doesn't exist. */
export async function appendYUpdate(env: Env, boardId: string, update: Uint8Array): Promise<number | null> {
  const res = await timed('yjs_updates.append', `${env.SUPABASE_URL}/rest/v1/yjs_updates?select=id`, {
    method: 'POST',
    headers: headers(env, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ board_id: boardId, update: `\\x${toHex(update)}` }),
  })
  if (!res.ok) {
    const text = await res.text()
    if (isMissingTable(res.status, text)) return null
    throw new Error(`yjs_updates append failed: ${res.status} ${text}`)
  }
  const rows = (await res.json()) as Array<{ id: number }>
  return rows[0]?.id ?? 0
}

/** Drop change-log rows that a snapshot now contains. Best-effort: leftovers are harmless (idempotent). */
export async function deleteYUpdates(env: Env, boardId: string, upToId: number): Promise<void> {
  if (upToId <= 0) return
  const res = await timed(
    'yjs_updates.cleanup',
    `${env.SUPABASE_URL}/rest/v1/yjs_updates?board_id=eq.${encodeURIComponent(boardId)}&id=lte.${upToId}`,
    { method: 'DELETE', headers: headers(env, { Prefer: 'return=minimal' }) }
  )
  if (!res.ok) console.warn('yjs_updates cleanup failed:', res.status, await res.text())
}

export async function saveYDoc(
  env: Env,
  boardId: string,
  state: Uint8Array,
  stateVector: Uint8Array,
  version: number,
  lastModifiedBy: string | null
): Promise<void> {
  const res = await timed('yjs_documents.save', `${env.SUPABASE_URL}/rest/v1/yjs_documents?on_conflict=board_id`, {
    method: 'POST',
    headers: headers(env, {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    }),
    body: JSON.stringify({
      board_id: boardId,
      state: `\\x${toHex(state)}`,
      state_vector: `\\x${toHex(stateVector)}`,
      version,
      last_modified_by: lastModifiedBy,
      updated_at: new Date().toISOString(),
    }),
  })
  if (!res.ok) throw new Error(`yjs_documents save failed: ${res.status} ${await res.text()}`)
}

/** Everyone who shares at least one conversation with `userId` (excluding the user). */
export async function loadConversationPeers(env: Env, userId: string, cap = 500): Promise<string[]> {
  const mine = await timed(
    'conversation_members.mine',
    `${env.SUPABASE_URL}/rest/v1/conversation_members?user_id=eq.${encodeURIComponent(userId)}&select=conversation_id&limit=500`,
    { headers: headers(env) }
  )
  if (!mine.ok) throw new Error(`conversation_members load failed: ${mine.status}`)
  const convIds = ((await mine.json()) as Array<{ conversation_id: string }>).map((r) => r.conversation_id)
  if (convIds.length === 0) return []

  const peers = await timed(
    'conversation_members.peers',
    `${env.SUPABASE_URL}/rest/v1/conversation_members?conversation_id=in.(${convIds.join(',')})&user_id=neq.${encodeURIComponent(userId)}&select=user_id&limit=${cap * 4}`,
    { headers: headers(env) }
  )
  if (!peers.ok) throw new Error(`conversation peers load failed: ${peers.status}`)
  const ids = new Set(((await peers.json()) as Array<{ user_id: string }>).map((r) => r.user_id))
  return [...ids].slice(0, cap)
}
