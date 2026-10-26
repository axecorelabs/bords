import { jwtDecrypt } from 'jose'

/**
 * Collab tickets are minted by the Next.js app (src/app/api/collab/ticket):
 * a 5-minute JWE (dir / A256GCM) encrypted with a key HKDF-derived from
 * NEXTAUTH_SECRET. Node's `hkdf` and WebCrypto's HKDF produce the same key
 * for the same inputs, so the derivation below mirrors the minting side.
 */

export interface TicketClaims {
  userId: string
  email: string
  name: string
}

const encoder = new TextEncoder()
let cachedKey: { secret: string; key: Uint8Array } | null = null

async function deriveKey(secret: string): Promise<Uint8Array> {
  if (cachedKey?.secret === secret) return cachedKey.key
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: encoder.encode('NextAuth.js Generated Encryption Key'),
    },
    material,
    256
  )
  const key = new Uint8Array(bits)
  cachedKey = { secret, key }
  return key
}

/** Returns the ticket's claims, or null if it is missing, expired or invalid. */
export async function verifyTicket(token: string | null | undefined, secret: string): Promise<TicketClaims | null> {
  if (!token || !secret) return null
  try {
    const key = await deriveKey(secret)
    const { payload } = await jwtDecrypt(token, key, { clockTolerance: 5 })
    if (typeof payload.sub !== 'string' || !payload.sub) return null
    return {
      userId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : '',
      name: typeof payload.name === 'string' ? payload.name : '',
    }
  } catch {
    return null
  }
}

/** Constant-time comparison for the shared INTERNAL_API_SECRET. */
export function checkInternalAuth(request: Request, secret: string): boolean {
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const a = encoder.encode(header)
  const b = encoder.encode(expected)
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}
