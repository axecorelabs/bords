import { NextRequest, NextResponse } from 'next/server'
import { render } from '@react-email/render'
import ChecklistReminderEmail from '@/emails/ChecklistReminder'
import ReminderEmail from '@/emails/ReminderEmail'
import { getAuthUser } from '@/lib/api-helpers'
import { sendEmail } from '@/lib/email'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redis } from '@/lib/redis'
import { createReminderInboxEntry } from '@/lib/reminder-inbox'

/**
 * Unified reminder-sending endpoint.
 * Picks the right email template based on `source`: "checklist" | "kanban" | "reminder".
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      source, title, items, recipient, message, timeRemaining,
      boardDocId, itemId,
    } = body

    if (!source || !title || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Missing required fields: source, title, items' }, { status: 400 })
    }

    const senderName = user.name || 'Someone'
    const toEmail = recipient?.email || user.email
    const toName = recipient?.name || user.name || 'User'

    // If sending to someone else, verify they exist AND the sender has a relationship with them
    if (recipient?.email && recipient.email !== user.email) {
      const { data: recipientUser } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('email', recipient.email)
        .maybeSingle()
      if (!recipientUser) {
        return NextResponse.json({ error: 'Recipient not found' }, { status: 404 })
      }

      // Authorization: recipient must be a friend or share an org with the sender
      const recipientId = recipientUser.id
      const [{ data: friendship }, { data: recipientOrgs }] = await Promise.all([
        supabaseAdmin
          .from('friendships')
          .select('id')
          .or(`and(requester_id.eq.${user.id},addressee_id.eq.${recipientId}),and(requester_id.eq.${recipientId},addressee_id.eq.${user.id})`)
          .eq('status', 'accepted')
          .maybeSingle(),
        supabaseAdmin
          .from('employee_memberships')
          .select('organization_id')
          .eq('user_id', recipientId),
      ])

      let sharedOrg = false
      if (!friendship && recipientOrgs && recipientOrgs.length > 0) {
        const recipientOrgIds = recipientOrgs.map((m: any) => m.organization_id)
        const { data: senderOrg } = await supabaseAdmin
          .from('employee_memberships')
          .select('id')
          .eq('user_id', user.id)
          .in('organization_id', recipientOrgIds)
          .limit(1)
          .maybeSingle()
        sharedOrg = !!senderOrg
      }

      if (!friendship && !sharedOrg) {
        return NextResponse.json({ error: 'You do not have permission to send reminders to this user' }, { status: 403 })
      }
    }

    // Dedup check via Redis — O(1) key lookup, no DB round-trip
    const COOLDOWN_SECONDS = 240
    if (boardDocId && itemId && redis) {
      const dedupKey = `reminder:sent:${boardDocId}::${source}::${itemId}::${timeRemaining || 'manual'}::${toEmail}`
      const seen = await redis.get(dedupKey).catch(() => null)
      if (seen) {
        return NextResponse.json({ success: true, deduplicated: true, messageId: null })
      }
    }

    // Render the correct template
    let emailHtml: string
    let subject: string

    if (source === 'checklist' || source === 'kanban') {
      const item = items[0]
      const isOverdue = timeRemaining === 'overdue'
      const sourceLabel = source === 'checklist' ? 'Checklist' : 'Kanban Board'

      emailHtml = await render(
        ChecklistReminderEmail({
          userName: toName,
          checklistTitle: `${sourceLabel}: ${title}`,
          taskText: item.text,
          timeRemaining: timeRemaining || 'upcoming',
          deadline: item.dueDate || 'No deadline set',
          boardUrl: 'https://bords.app',
        })
      )

      if (recipient?.email && recipient.email !== user.email) {
        subject = isOverdue
          ? `⚠️ ${senderName} — Deadline reached: ${item.text}`
          : `⏰ ${senderName} — Reminder: ${item.text} due in ${timeRemaining}`
      } else {
        subject = isOverdue
          ? `⚠️ Deadline Reached: ${item.text}`
          : `⏰ Reminder: ${item.text} due in ${timeRemaining}`
      }
    } else {
      const hasOverdue = items.some((i: { overdue?: boolean; completed?: boolean }) => i.overdue && !i.completed)

      emailHtml = await render(
        ReminderEmail({
          recipientName: toName,
          senderName,
          reminderTitle: title,
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

      if (recipient?.email && recipient.email !== user.email) {
        subject = hasOverdue
          ? `⚠️ ${senderName} sent you an overdue reminder: ${title}`
          : `🔔 ${senderName} sent you a reminder: ${title}`
      } else {
        subject = hasOverdue
          ? `⚠️ Overdue reminder: ${title}`
          : `🔔 Reminder: ${title}`
      }
    }

    const result = await sendEmail({ to: toEmail, subject, html: emailHtml })

    // Mark as sent in Redis so duplicate triggers within the cooldown window are skipped
    if (boardDocId && itemId && redis) {
      const dedupKey = `reminder:sent:${boardDocId}::${source}::${itemId}::${timeRemaining || 'manual'}::${toEmail}`
      await redis.set(dedupKey, '1', { ex: COOLDOWN_SECONDS }).catch(() => {})
    }

    // Create inbox entries for recipient
    try {
      let recipientUserId = user.id
      if (recipient?.email && recipient.email !== user.email) {
        const { data: recipientUser } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('email', recipient.email)
          .maybeSingle()
        if (recipientUser) recipientUserId = recipientUser.id
      }

      await createReminderInboxEntry({
        source,
        parentTitle: title,
        itemText: items[0]?.text || title,
        itemId: itemId || `${source}-${Date.now()}`,
        timeRemaining: timeRemaining || 'manual',
        senderId: user.id,
        recipientId: recipientUserId,
        recipientEmail: toEmail,
        dueDate: items[0]?.dueDate ? new Date(items[0].dueDate) : null,
        boardDocId: boardDocId || undefined,
      })
    } catch (e) {
      console.warn('Failed to create reminder inbox entry:', e)
    }

    return NextResponse.json({ success: true, messageId: result.messageId })
  } catch (error) {
    console.error('Error in unified reminders/send API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
