import { type BetterAuthOptions } from 'better-auth'
import type { SecondaryStorage } from '@better-auth/core/db'
import bcrypt from 'bcryptjs'
import { postgrestAdapter } from './postgrest-adapter'
import { redis } from '@/lib/redis'

/**
 * Better Auth options shared by every instance. Deliberately free of email /
 * react-email imports: the proxy's bundle can't carry them, and it only needs
 * to validate sessions (see session-only.ts).
 */

/**
 * Every host the app is served from. bords.app is the main domain; the
 * axecorelabs.com host is the Cloudflare deployment. Cookies are per host, and
 * Google must have `https://<host>/api/auth/callback/google` registered for
 * each one that offers Google sign-in.
 */
const allowedHosts = [
  'app.bords.app',
  'bords.app',
  'www.bords.app',
  'boards.axecorelabs.com',
  'localhost:3000',
  'localhost:3001',
]

function protocolFor(host: string) {
  return host.startsWith('localhost') ? 'http' : 'https'
}

function buildSecondaryStorage(): SecondaryStorage | undefined {
  if (!redis) return undefined
  const r = redis
  // Upstash auto-parses JSON on read; Better Auth wants the raw string back.
  const asString = (value: unknown) =>
    value === null || value === undefined ? null : typeof value === 'string' ? value : JSON.stringify(value)
  return {
    get: async (key) => asString(await r.get<unknown>(key)),
    getAndDelete: async (key) => asString(await r.getdel<unknown>(key)),
    increment: async (key, ttl) => {
      const count = await r.incr(key)
      if (count === 1) await r.expire(key, ttl)
      return count
    },
    set: async (key, value, ttl) => {
      if (ttl) await r.set(key, value, { ex: ttl })
      else await r.set(key, value)
    },
    delete: async (key) => {
      await r.del(key)
    },
  }
}

/**
 * A function, not a constant: on Cloudflare Workers `process.env` is only populated once a request
 * is being handled, so anything reading env at module-evaluation time (the proxy's bundle
 * evaluates early) would see undefined secrets.
 */
export function createBaseOptions() {
  return {
  appName: 'BORDS',
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: {
    allowedHosts,
    fallback: process.env.NEXT_PUBLIC_APP_URL || 'https://app.bords.app',
  },
  trustedOrigins: allowedHosts.map((h) => `${protocolFor(h)}://${h}`),

  database: postgrestAdapter({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  }),

  // Upstash Redis backs rate limiting and a fast session lookup. Postgres stays the
  // source of truth for sessions (storeSessionInDatabase), so Redis can be flushed safely.
  secondaryStorage: buildSecondaryStorage(),
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    storage: redis ? 'secondary-storage' : 'memory',
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-up/email': { window: 60, max: 5 },
      '/request-password-reset': { window: 60, max: 3 },
      '/send-verification-email': { window: 60, max: 3 },
      '/reset-password': { window: 60, max: 5 },
    },
  },

  advanced: {
    // Existing Supabase user ids are UUIDs and every FK in the app points at them.
    database: { generateId: 'uuid' },
    // With a dynamic baseURL the cookie prefix (__Secure-) can't be derived when an instance
    // is built, and the proxy bundle doesn't see NODE_ENV=production. Decide it explicitly so
    // every instance reads and writes the same cookie names.
    useSecureCookies: (process.env.NEXT_PUBLIC_APP_URL ?? '').startsWith('https://'),
    ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
  },

  user: {
    modelName: 'ba_user',
    fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
    additionalFields: {
      firstName: { type: 'string' as const, required: false, defaultValue: '', fieldName: 'first_name', input: true },
      lastName: { type: 'string' as const, required: false, defaultValue: '', fieldName: 'last_name', input: true },
    },
  },
  session: {
    modelName: 'ba_session',
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      userId: 'user_id',
    },
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    storeSessionInDatabase: true,
    // Signed cookie lets most requests skip the DB; revocation takes up to 5 min to propagate.
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  account: {
    modelName: 'ba_account',
    fields: {
      accountId: 'account_id',
      providerId: 'provider_id',
      userId: 'user_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    // Someone who signed up with a password can later use Google with the same (verified) email.
    accountLinking: { enabled: true, trustedProviders: ['google'] },
  },
  verification: {
    modelName: 'ba_verification',
    fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
  },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
    requireEmailVerification: true,
    autoSignIn: false,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    // Supabase stored bcrypt ($2a$10$…); keeping bcrypt means imported users sign in unchanged.
    password: {
      hash: (password: string) => bcrypt.hash(password, 10),
      verify: ({ hash, password }: { hash: string; password: string }) => bcrypt.compare(password, hash),
    },
  },
} satisfies BetterAuthOptions
}
