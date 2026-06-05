import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'

export async function POST(req: NextRequest) {
  const origin = req.nextUrl.origin

  let relayToken: string | null = null
  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => null) as { t?: unknown } | null
    relayToken = typeof body?.t === 'string' ? body.t : null
  } else {
    const form = await req.formData()
    const candidate = form.get('t')
    relayToken = typeof candidate === 'string' ? candidate : null
  }

  if (!relayToken || !/^[a-f0-9]{64}$/i.test(relayToken)) {
    return NextResponse.json({ error: 'Invalid recovery link' }, { status: 400 })
  }

  if (!redis) {
    return NextResponse.json({ error: 'Reset link temporarily unavailable' }, { status: 503 })
  }

  const relayTokenHash = createHash('sha256').update(relayToken).digest('hex')
  const relayKey = `auth:recovery-relay:${relayTokenHash}`

  const actionLink = await redis.get<string>(relayKey)
  if (!actionLink) {
    return NextResponse.json({ error: 'Recovery link expired or invalid' }, { status: 410 })
  }

  try {
    await redis.del(relayKey)
  } catch {
    // Best-effort delete keeps tokens one-time when Redis is healthy.
  }

  let targetUrl = actionLink
  try {
    const parsed = new URL(actionLink)
    const isSupabaseVerify =
      parsed.pathname === '/auth/v1/verify' || parsed.pathname.endsWith('/auth/v1/verify')

    if (isSupabaseVerify) {
      parsed.searchParams.set('redirect_to', `${origin}/reset-password`)
      targetUrl = parsed.toString()
    }
  } catch {
    // If parsing fails, fall back to original generated action link.
  }

  return NextResponse.json({ url: targetUrl })
}
