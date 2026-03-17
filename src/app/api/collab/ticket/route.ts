import { getAuthUser } from '@/lib/api-helpers'
import { NextResponse } from 'next/server'
import { EncryptJWT } from 'jose'
import { hkdf } from 'crypto'
import { promisify } from 'util'

const hkdfAsync = promisify(hkdf)

// Derive an encryption key for collab JWE tickets.
// Uses the same HKDF derivation the collab server expects for jwtDecrypt.
// During migration, NEXTAUTH_SECRET is reused so the collab server needs no changes.
let encryptionKey: Uint8Array | null = null
async function getEncryptionKey(): Promise<Uint8Array> {
  if (encryptionKey) return encryptionKey
  const derived = await hkdfAsync(
    'sha256',
    process.env.NEXTAUTH_SECRET || '',
    '',
    'NextAuth.js Generated Encryption Key',
    32
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
