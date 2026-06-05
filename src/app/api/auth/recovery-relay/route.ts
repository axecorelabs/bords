import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'

export async function POST(req: NextRequest) {
  const origin = req.nextUrl.origin

  const form = await req.formData()
  const relayToken = form.get('t')

  if (typeof relayToken !== 'string' || !/^[a-f0-9]{64}$/i.test(relayToken)) {
    return NextResponse.redirect(`${origin}/login?error=Invalid+recovery+link`)
  }

  if (!redis) {
    return NextResponse.redirect(`${origin}/login?error=Reset+link+temporarily+unavailable`)
  }

  const relayTokenHash = createHash('sha256').update(relayToken).digest('hex')
  const relayKey = `auth:recovery-relay:${relayTokenHash}`

  const actionLink = await redis.get<string>(relayKey)
  if (!actionLink) {
    return NextResponse.redirect(`${origin}/login?error=Recovery+link+expired+or+invalid`)
  }

  try {
    await redis.del(relayKey)
  } catch {
    // Best-effort delete keeps tokens one-time when Redis is healthy.
  }

  // Use 303 so browser follows with GET to the Supabase verify URL.
  return NextResponse.redirect(actionLink, { status: 303 })
}
