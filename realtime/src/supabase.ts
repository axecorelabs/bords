/**
 * Minimal PostgREST client for the handful of Supabase queries the realtime
 * Worker needs. Uses the service-role key, so it must only run server-side.
 */

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
}

/** Throws on transport/HTTP errors so callers never mistake an outage for "no document". */
export async function loadYDoc(env: Env, boardId: string): Promise<StoredYDoc> {
  const url = `${env.SUPABASE_URL}/rest/v1/yjs_documents?board_id=eq.${encodeURIComponent(boardId)}&select=state,version&limit=1`
  const res = await fetch(url, { headers: headers(env, { Accept: 'application/json' }) })
  if (!res.ok) throw new Error(`yjs_documents load failed: ${res.status} ${await res.text()}`)
  const rows = (await res.json()) as Array<{ state: unknown; version: number }>
  if (rows.length === 0) return { state: null, version: 0 }
  return { state: fromBytea(rows[0].state), version: rows[0].version ?? 0 }
}

export async function saveYDoc(
  env: Env,
  boardId: string,
  state: Uint8Array,
  stateVector: Uint8Array,
  version: number,
  lastModifiedBy: string | null
): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/yjs_documents?on_conflict=board_id`, {
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
  const mine = await fetch(
    `${env.SUPABASE_URL}/rest/v1/conversation_members?user_id=eq.${encodeURIComponent(userId)}&select=conversation_id&limit=500`,
    { headers: headers(env) }
  )
  if (!mine.ok) throw new Error(`conversation_members load failed: ${mine.status}`)
  const convIds = ((await mine.json()) as Array<{ conversation_id: string }>).map((r) => r.conversation_id)
  if (convIds.length === 0) return []

  const peers = await fetch(
    `${env.SUPABASE_URL}/rest/v1/conversation_members?conversation_id=in.(${convIds.join(',')})&user_id=neq.${encodeURIComponent(userId)}&select=user_id&limit=${cap * 4}`,
    { headers: headers(env) }
  )
  if (!peers.ok) throw new Error(`conversation peers load failed: ${peers.status}`)
  const ids = new Set(((await peers.json()) as Array<{ user_id: string }>).map((r) => r.user_id))
  return [...ids].slice(0, cap)
}
