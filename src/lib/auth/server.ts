import { betterAuth } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { sendEmail } from '@/lib/email'
import { getVerificationEmail, getPasswordResetEmail, getPasswordResetSuccessEmail } from '@/lib/email-templates'
import { runInBackground } from '@/lib/background'
import { sendLoginAlert, sendWelcomeOnce } from './lifecycle-emails'
import { createBaseOptions } from './base-options'

const baseOptions = createBaseOptions()

/** The full instance: everything in baseOptions plus email flows, social login and lifecycle hooks. */
export const auth = betterAuth({
  ...baseOptions,

  emailAndPassword: {
    ...baseOptions.emailAndPassword,
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
    // Sign-in alert email. Runs after the session exists, for password and Google logins.
    after: createAuthMiddleware(async (ctx) => {
      const session = ctx.context.newSession
      if (!session) return
      if (ctx.path === '/sign-in/email') {
        await runInBackground(sendLoginAlert(session.user, 'email'))
      } else if (ctx.path.startsWith('/callback/')) {
        await runInBackground(sendLoginAlert(session.user, 'google'))
      }
    }),
  },
})

function firstName(user: { name?: string | null; email: string }): string {
  return user.name?.split(' ')[0] || user.email.split('@')[0] || 'there'
}

export type Session = typeof auth.$Infer.Session
