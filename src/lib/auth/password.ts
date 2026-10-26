import bcrypt from 'bcryptjs'

/**
 * Password hashing for Better Auth.
 *
 * On Cloudflare this calls the dedicated `boards-hasher` Worker through the HASHER service binding
 * (see hasher/src/index.ts): bcrypt costs ~0.35 s of CPU per call here, and doing that inside the main app
 * Worker would stall every other request sharing its instance. Hashes are plain bcrypt either way, so
 * the two paths are interchangeable and imported Supabase hashes verify unchanged.
 *
 * Anywhere without the binding (next dev, scripts, tests) it hashes locally. If the hasher is unreachable
 * we also fall back to hashing locally: slower for everyone else, but sign-in keeps working.
 */

const COST = 10

interface Hasher {
  fetch(input: string, init?: RequestInit): Promise<Response>
}

async function getHasher(): Promise<Hasher | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    return ((getCloudflareContext().env as { HASHER?: Hasher }).HASHER ?? null) as Hasher | null
  } catch {
    return null // not running on Workers
  }
}

async function callHasher<T>(hasher: Hasher, path: '/hash' | '/verify', body: Record<string, string>): Promise<T> {
  const res = await hasher.fetch(`https://hasher.internal${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`hasher ${path} failed: ${res.status}`)
  return (await res.json()) as T
}

export async function hashPassword(password: string): Promise<string> {
  const hasher = await getHasher()
  if (hasher) {
    try {
      return (await callHasher<{ hash: string }>(hasher, '/hash', { password })).hash
    } catch (err) {
      console.error('[auth] hasher unavailable, hashing locally:', err)
    }
  }
  return bcrypt.hash(password, COST)
}

export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  const hasher = await getHasher()
  if (hasher) {
    try {
      return (await callHasher<{ ok: boolean }>(hasher, '/verify', { password, hash })).ok
    } catch (err) {
      console.error('[auth] hasher unavailable, verifying locally:', err)
    }
  }
  return bcrypt.compare(password, hash)
}
