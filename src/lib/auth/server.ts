import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { sendEmail } from '@/lib/email'
import { getVerificationEmail, getPasswordResetEmail, getPasswordResetSuccessEmail } from '@/lib/email-templates'
import { runInBackground } from '@/lib/background'
import { deviceKey, sendLoginAlert, sendWelcomeOnce } from './lifecycle-emails'
import { createBaseOptions } from './base-options'
import { hashPassword, verifyPassword } from './password'
import { AdmissionError, createAdmission, emailKey } from './admission'
import { redis } from '@/lib/redis'

const baseOptions = createBaseOptions()

const admission = createAdmission(redis, { globalPerSecond: Number(process.env.AUTH_HASH_PER_SECOND) || 60 })

/** The full instance: everything in baseOptions plus email flows, social login and lifecycle hooks. */
export const auth = betterAuth({
  ...baseOptions,

  emailAndPassword: {
    ...baseOptions.emailAndPassword,
    // Supabase stored bcrypt ($2a$10$…); keeping bcrypt means imported users sign in unchanged.
    // Hashing runs on the dedicated hasher Worker so its CPU cost can't stall the rest of the app.
    password: { hash: hashPassword, verify: verifyPassword },
    sendResetPassword: async ({ user, url }) => {
      await runInBackground(
        sendEmail({
          to: user.email,
          subject: 'Reset your BORDS password',
          html: getPasswordResetEmail({ name: firstName(user), resetUrl: url }),
        })
      )
    },
    onPasswordReset: async ({ user }) => {
      await runInBackground(
        sendEmail({
          to: user.email,
          subject: 'Your BORDS password was changed',
          html: getPasswordResetSuccessEmail({ name: firstName(user) }),
        })
      )
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: false,
    autoSignInAfterVerification: false,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url }) => {
      await runInBackground(
        sendEmail({
          to: user.email,
          subject: 'Verify your BORDS email',
          html: getVerificationEmail({ name: firstName(user), verificationUrl: url }),
        })
      )
    },
    afterEmailVerification: async (user) => {
      await runInBackground(sendWelcomeOnce(user))
    },
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Google users arrive verified, so there's no verify-email step to hang the welcome on.
      mapProfileToUser: (profile) => ({
        firstName: profile.given_name ?? '',
        lastName: profile.family_name ?? '',
      }),
    },
  },

  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          if (user.emailVerified) await runInBackground(sendWelcomeOnce(user))
        },
      },
    },
  },

  hooks: {
    // Refuse excess password work before any hashing happens (see admission.ts).
    before: createAuthMiddleware(async (ctx) => {
      try {
        if (ctx.path === '/sign-in/email') {
          const email = (ctx.body as { email?: unknown } | undefined)?.email
          if (typeof email === 'string') await admission.checkSignIn(await emailKey(email))
          else await admission.checkGlobal()
        } else if (ctx.path === '/sign-up/email' || ctx.path === '/reset-password') {
          await admission.checkGlobal()
        }
      } catch (err) {
        if (err instanceof AdmissionError) {
          throw new APIError('TOO_MANY_REQUESTS', { message: err.message }, { 'Retry-After': String(err.retryAfterSeconds) })
        }
        throw err
      }
    }),
    // Sign-in alert email. Runs after the session exists, for password and Google logins.
    after: createAuthMiddleware(async (ctx) => {
      const session = ctx.context.newSession
      if (!session) return
      const headers = ctx.request?.headers ?? ctx.headers
      const device = await deviceKey(headers?.get('cf-connecting-ip') ?? headers?.get('x-forwarded-for'), headers?.get('user-agent'))
      if (ctx.path === '/sign-in/email') {
        await admission.clearAccount(await emailKey(session.user.email))
        await runInBackground(sendLoginAlert(session.user, 'email', device))
      } else if (ctx.path.startsWith('/callback/')) {
        await runInBackground(sendLoginAlert(session.user, 'google', device))
      }
    }),
  },
})

function firstName(user: { name?: string | null; email: string }): string {
  return user.name?.split(' ')[0] || user.email.split('@')[0] || 'there'
}

export type Session = typeof auth.$Infer.Session
