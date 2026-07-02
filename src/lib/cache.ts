import { redis } from './redis'

/**
 * Redis-backed cache helpers with graceful fallback when Redis is unavailable.
 * All functions are no-ops if redis is null.
 */

/** Get a cached value. Returns null on miss or if Redis is unavailable. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!redis) return null
  try {
    const value = await redis.get(key)
    return value as T | null
  } catch {
    return null
  }
}

/** Set a cached value with TTL in seconds. */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!redis) return
  try {
    await redis.set(key, JSON.stringify(value), { ex: ttlSeconds })
  } catch {
    // Cache write failure is non-critical
  }
}

/** Delete one or more cache keys (e.g. on mutation). */
export async function cacheInvalidate(...keys: string[]): Promise<void> {
  if (!redis || keys.length === 0) return
  try {
    await redis.del(...keys)
  } catch {
    // Invalidation failure is non-critical
  }
}

/** Delete all keys matching a prefix pattern (e.g. `cache:plans:*`). */
export async function cacheInvalidatePattern(pattern: string): Promise<void> {
  if (!redis) return
  try {
    let cursor = 0
    do {
      const [nextCursor, keys] = await redis.scan(cursor, { match: pattern, count: 100 })
      cursor = typeof nextCursor === 'number' ? nextCursor : Number(nextCursor)
      if (keys.length > 0) await redis.del(...keys)
    } while (cursor !== 0)
  } catch {
    // Pattern invalidation failure is non-critical
  }
}

// ── Cache key builders ──

export const CacheKeys = {
  plans: () => 'cache:plans',
  userPlan: (userId: string) => `cache:user-plan:${userId}`,
  subStatus: (userId: string) => `cache:sub-status:${userId}`,
  orgDashboard: (orgId: string, userId: string) => `cache:org-dash:${orgId}:${userId}`,
  orgMembers: (orgId: string, userId: string) => `cache:org-members:${orgId}:${userId}`,
  personalDashboard: (userId: string) => `cache:personal-dash:${userId}`,
  myTasks: (userId: string, filter: string, sort: string, orgId: string | null, scope: string) =>
    `cache:my-tasks:${userId}:${filter}:${sort}:${orgId ?? 'none'}:${scope}`,
  executionTasks: (userId: string, offset: number, limit: number) =>
    `cache:exec-tasks:${userId}:${offset}:${limit}`,
}

// ── TTLs (seconds) ──

export const CacheTTL = {
  PLANS: 300,               // 5 minutes — plans rarely change
  USER_PLAN: 120,           // 2 minutes — changes on subscription events
  SUB_STATUS: 120,          // 2 minutes — same source data as USER_PLAN
  ORG_DASHBOARD: 30,        // 30 seconds — stale-while-revalidate feel for heavy query
  ORG_MEMBERS: 60,          // 1 minute — changes on invite/remove
  PERSONAL_DASHBOARD: 20,   // 20 seconds — short TTL for real-time feel
  MY_TASKS: 28,             // 28 seconds — polled every 30s; invalidated on mutation
  EXECUTION_TASKS: 58,      // 58 seconds — polled every 60s; invalidated on mutation
}
