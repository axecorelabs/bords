import { NextRequest, NextResponse } from 'next/server'
import { render } from '@react-email/render'
import ReminderEmail from '@/emails/ReminderEmail'
import { getAuthUser } from '@/lib/api-helpers'
import { sendEmail } from '@/lib/email'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { reminderTitle, items, recipientEmail, recipientName, message } = body

    if (!reminderTitle || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Missing required fields: reminderTitle, items' }, { status: 400 })
    }

    const senderName = user.name || 'Someone'
    const toEmail = recipientEmail || user.email
    const toName = recipientName || user.name || 'User'

    // If sending to a friend, verify they exist
    if (recipientEmail && recipientEmail !== user.email) {
      const { data: recipient } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('email', recipientEmail)
        .maybeSingle()
      if (!recipient) {
        return NextResponse.json({ error: 'Recipient not found' }, { status: 404 })
      }
    }

    const emailHtml = await render(
      ReminderEmail({
        recipientName: toName,
        senderName,
        reminderTitle,
        items: items.map((item: { text: string; dueDate?: string; overdue?: boolean; completed?: boolean }) => ({
          text: item.text,
          dueDate: item.dueDate,
          overdue: item.overdue,
          completed: item.completed,
        })),
        message,
        boardUrl: 'https://bords.app',
      })
    )

    const hasOverdue = items.some((i: { overdue?: boolean; completed?: boolean }) => i.overdue && !i.completed)

    const subject = recipientEmail && recipientEmail !== user.email
      ? hasOverdue
        ? `⚠️ ${senderName} sent you an overdue reminder: ${reminderTitle}`
        : `🔔 ${senderName} sent you a reminder: ${reminderTitle}`
      : hasOverdue
        ? `⚠️ Overdue reminder: ${reminderTitle}`
        : `🔔 Reminder: ${reminderTitle}`

    const result = await sendEmail({ to: toEmail, subject, html: emailHtml })

    return NextResponse.json({ success: true, messageId: result.messageId })
  } catch (error) {
    console.error('Error in send-board-reminder API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
