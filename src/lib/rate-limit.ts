import { Ratelimit } from '@upstash/ratelimit'
import { redis } from './redis'
import { NextRequest, NextResponse } from 'next/server'

// Rate limiter instances — only created if Redis is available
// Each has a different window/limit based on sensitivity

/** Auth routes: 5 requests per 60 seconds per IP */
export const authLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, '60 s'),
      prefix: 'rl:auth',
    })
  : null

/** General API routes: 30 requests per 60 seconds per user */
export const apiLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(30, '60 s'),
      prefix: 'rl:api',
    })
  : null

/** Sensitive actions (invites, friend requests): 10 per 60 seconds */
export const actionLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, '60 s'),
      prefix: 'rl:action',
    })
  : null

/**
 * Get a rate limit identifier from a request.
 * Uses user ID if available, falls back to IP.
 */
export function getRateLimitKey(req: NextRequest, userId?: string): string {
  if (userId) return userId
  const forwarded = req.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  return ip
}

/**
 * Check rate limit and return 429 response if exceeded.
 * Returns null if allowed, or a NextResponse if blocked.
 * Fails closed: if Redis is unavailable, returns 503 to prevent abuse.
 */
export async function checkRateLimit(
  limiter: Ratelimit | null,
  key: string
): Promise<NextResponse | null> {
  if (!limiter) {
    // Redis not configured — fail closed to prevent abuse
    return NextResponse.json(
      { error: 'Rate limiter unavailable. Please try again later.' },
      { status: 503 }
    )
  }

  let success: boolean, limit: number, remaining: number, reset: number
  try {
    ;({ success, limit, remaining, reset } = await limiter.limit(key))
  } catch {
    // Redis unreachable — fail closed (reject the request)
    return NextResponse.json(
      { error: 'Rate limiter unreachable. Please try again later.' },
      { status: 503 }
    )
  }

  if (!success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': remaining.toString(),
          'X-RateLimit-Reset': reset.toString(),
          'Retry-After': Math.ceil((reset - Date.now()) / 1000).toString(),
        },
      }
    )
  }

  return null
}
