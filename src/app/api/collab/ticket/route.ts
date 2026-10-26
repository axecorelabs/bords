import { getAuthUser } from '@/lib/api-helpers'
import { NextResponse } from 'next/server'
import { EncryptJWT } from 'jose'
import { actionLimiter, checkRateLimit } from '@/lib/rate-limit'

// Derive an encryption key for collab JWE tickets.
// Uses the same HKDF derivation the realtime Worker expects for jwtDecrypt
// (realtime/src/auth.ts). NEXTAUTH_SECRET is reused as the shared secret.
// Web Crypto is used (not node:crypto) so this runs identically on Node and Workers.
let encryptionKey: Uint8Array | null = null
async function getEncryptionKey(): Promise<Uint8Array> {
  if (encryptionKey) return encryptionKey
  const encoder = new TextEncoder()
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(process.env.NEXTAUTH_SECRET || ''),
    'HKDF',
    false,
    ['deriveBits']
  )
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: encoder.encode('NextAuth.js Generated Encryption Key'),
    },
    material,
    256
  )
  encryptionKey = new Uint8Array(derived)
  return encryptionKey
}

// Ensure Next.js never caches this route — every call must mint a fresh ticket
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(actionLimiter, user.id)
  if (rateLimitRes) return rateLimitRes

  const key = await getEncryptionKey()

  // Create a JWE (encrypted JWT) matching the format the collab server expects.
  // The server uses jwtDecrypt with the same HKDF-derived key to verify.
  const ticket = await new EncryptJWT({
    sub: user.id,
    email: user.email,
    name: user.name,
  })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .encrypt(key)

  return NextResponse.json({ ticket }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
