import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { redis } from '@/lib/redis'

const EMAIL_COOLDOWN_SECONDS = 60
const IP_WINDOW_SECONDS = 15 * 60
const IP_WINDOW_MAX_REQUESTS = 10

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim()
  }

  return req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || 'unknown'
}

export async function enforceAuthEmailRateLimit(
  action: 'forgot-password' | 'resend-verification',
  email: string,
  ip: string
): Promise<{ limited: false } | { limited: true; message: string }> {
  if (!redis) return { limited: false }

  const normalizedEmail = email.toLowerCase().trim()
  const emailHash = sha256(normalizedEmail)
  const ipHash = sha256(ip || 'unknown')

  const emailCooldownKey = `ratelimit:${action}:email:${emailHash}:cooldown`
  const ipWindowKey = `ratelimit:${action}:ip:${ipHash}:window`

  const cooldownValue = await redis.get<string | null>(emailCooldownKey)
  if (cooldownValue) {
    return {
      limited: true,
      message: 'Please wait about a minute before requesting another email.',
    }
  }

  const ipCount = await redis.incr(ipWindowKey)
  if (ipCount === 1) {
    await redis.expire(ipWindowKey, IP_WINDOW_SECONDS)
  }

  if (ipCount > IP_WINDOW_MAX_REQUESTS) {
    return {
      limited: true,
      message: 'Too many requests from this network. Please wait a few minutes and try again.',
    }
  }

  await redis.set(emailCooldownKey, '1', { ex: EMAIL_COOLDOWN_SECONDS })

  return { limited: false }
}
