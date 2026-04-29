import nodemailer from 'nodemailer'
import crypto from 'crypto'
import { redis } from './redis'

// Create reusable transporter using ZeptoMail SMTP
const transporter = nodemailer.createTransport({
  host: 'smtp.zeptomail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.ZEPTOMAIL_SMTP_USER,
    pass: process.env.ZEPTOMAIL_SMTP_PASS,
  },
})

export interface SendEmailOptions {
  to: string
  subject: string
  html: string
  text?: string
}

/**
 * Send an email using nodemailer
 */
export async function sendEmail({ to, subject, html, text }: SendEmailOptions) {
  try {
    const info = await transporter.sendMail({
      from: `"BORDS" <${process.env.ZEPTOMAIL_FROM_EMAIL || 'noreply@bords.app'}>`,
      to,
      subject,
      html,
      text: text || stripHtml(html),
    })

    console.log('✅ Email sent successfully:', info.messageId)
    return { success: true, messageId: info.messageId }
  } catch (error) {
    console.error('❌ Email sending failed:', error)
    throw error
  }
}

/**
 * Strip HTML tags for plain text fallback
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

/**
 * Send an email only if an identical one hasn't been sent within `windowSec`.
 * Dedup key is derived from `to` + `subject`. Falls back to always-send if Redis is unavailable.
 */
export async function sendEmailDeduped(
  opts: SendEmailOptions,
  windowSec = 300
) {
  if (redis) {
    const hash = crypto.createHash('sha256').update(`${opts.to}:${opts.subject}`).digest('hex')
    const key = `email-dedup:${hash}`
    const already = await redis.set(key, '1', { ex: windowSec, nx: true })
    if (!already) {
      console.log(`⏭️  Dedup: skipped duplicate email to ${opts.to} (${opts.subject})`)
      return { success: true, deduplicated: true }
    }
  }
  return sendEmail(opts)
}

/**
 * Verify email configuration
 */
export async function verifyEmailConfig() {
  try {
    await transporter.verify()
    console.log('✅ Email server is ready')
    return true
  } catch (error) {
    console.error('❌ Email server verification failed:', error)
    return false
  }
}
