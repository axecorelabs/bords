import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { NextResponse } from 'next/server'
import { EncryptJWT } from 'jose'
import { hkdf } from 'crypto'
import { promisify } from 'util'

const hkdfAsync = promisify(hkdf)

// Derive the same encryption key that NextAuth v4 uses for session JWEs.
// The collab server decrypts with jwtDecrypt using the identical derivation.
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
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = session.user as any
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
