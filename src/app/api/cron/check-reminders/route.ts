import { NextResponse } from 'next/server'
import { render } from '@react-email/render'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import ChecklistReminderEmail from '@/emails/ChecklistReminder'
import ReminderEmail from '@/emails/ReminderEmail'
import { format } from 'date-fns'
import { createReminderInboxEntry } from '@/lib/reminder-inbox'

/**
 * Server-side cron: Scan all boards for upcoming deadlines and
 * send reminder emails independently of the client.
 *
 * Auth: Bearer token matching CRON_SECRET env var.
 */

const LOOKAHEAD_MINUTES = 35
const COOLDOWN_MS = 4 * 60 * 1000

const DEADLINE_INTERVALS = [
  { offsetMs: 30 * 60 * 1000, label: '30 minutes', urgent: false },
  { offsetMs: 10 * 60 * 1000, label: '10 minutes', urgent: true },
  { offsetMs: 5 * 60 * 1000,  label: '5 minutes',  urgent: true },
  { offsetMs: 0,               label: 'overdue',    urgent: true },
] as const

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const now = new Date()
    const windowEnd = new Date(now.getTime() + LOOKAHEAD_MINUTES * 60 * 1000)
    const windowStart = new Date(now.getTime() - 60 * 60 * 1000)

    // Fetch all board_documents with their content
    const { data: boards } = await supabaseAdmin
      .from('board_documents')
      .select('id, owner_id, checklists, kanban_boards, reminders')

    let sent = 0
    let skipped = 0
    let errors = 0

    for (const board of boards || []) {
      // Look up board owner's profile
      const { data: owner } = await supabaseAdmin
        .from('profiles')
        .select('id, email, first_name, last_name')
        .eq('id', board.owner_id)
        .maybeSingle()

      if (!owner?.email) continue

      const ownerName = `${owner.first_name || ''} ${owner.last_name || ''}`.trim() || 'User'
      const ownerEmail = owner.email
      const ownerId = owner.id
      const boardDocId = board.id

      // 1. Scan checklist items
      for (const checklist of (board.checklists as any[] || [])) {
        for (const item of (checklist.items || [])) {
          if (item.completed) continue
          const deadline = parseDeadline(item.dueDate, item.dueTime || item.deadline)
          if (!deadline) continue

          const result = await processDeadlineItem({
            boardDocId, source: 'checklist',
            parentTitle: checklist.title || 'Checklist',
            itemId: item.id, itemText: item.text,
            deadline, now, windowStart, windowEnd,
            recipientEmail: ownerEmail, recipientName: ownerName,
            senderId: ownerId, recipientId: ownerId,
          })
          sent += result.sent; skipped += result.skipped; errors += result.errors
        }
      }

      // 2. Scan kanban board tasks
      for (const kanban of (board.kanban_boards as any[] || [])) {
        for (const column of (kanban.columns || [])) {
          for (const task of (column.tasks || [])) {
            if (task.completed) continue
            const deadline = parseDeadline(task.dueDate)
            if (!deadline) continue

            const result = await processDeadlineItem({
              boardDocId, source: 'kanban',
              parentTitle: kanban.title || 'Kanban Board',
              itemId: task.id, itemText: task.title || task.text || 'Task',
              deadline, now, windowStart, windowEnd,
              recipientEmail: ownerEmail, recipientName: ownerName,
              senderId: ownerId, recipientId: ownerId,
            })
            sent += result.sent; skipped += result.skipped; errors += result.errors
          }
        }
      }

      // 3. Scan reminder widget items
      for (const reminder of (board.reminders as any[] || [])) {
        let recipientEmail = ownerEmail
        let recipientName = ownerName
        let recipientId = ownerId
        if (reminder.assignedTo?.email) {
          recipientEmail = reminder.assignedTo.email
          recipientName = `${reminder.assignedTo.firstName || ''} ${reminder.assignedTo.lastName || ''}`.trim() || 'User'
          if (reminder.assignedTo.userId) recipientId = reminder.assignedTo.userId
        }

        for (const item of (reminder.items || [])) {
          if (item.completed) continue
          const deadline = parseDeadline(item.dueDate, item.dueTime)
          if (!deadline) continue

          const result = await processDeadlineItem({
            boardDocId, source: 'reminder',
            parentTitle: reminder.title || 'Reminder',
            itemId: item.id, itemText: item.text,
            deadline, now, windowStart, windowEnd,
            recipientEmail, recipientName,
            senderName: ownerName,
            senderId: ownerId, recipientId,
          })
          sent += result.sent; skipped += result.skipped; errors += result.errors
        }
      }
    }

    return NextResponse.json({
      message: 'Reminder cron completed',
      sent, skipped, errors,
      checkedBoards: (boards || []).length,
      durationMs: Date.now() - now.getTime(),
      timestamp: now.toISOString(),
    })
  } catch (error: any) {
    console.error('Reminder cron error:', error)
    return NextResponse.json({ error: error.message || 'Cron failed' }, { status: 500 })
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ProcessItemArgs {
  boardDocId: string
  source: 'checklist' | 'kanban' | 'reminder'
  parentTitle: string
  itemId: string
  itemText: string
  deadline: Date
  now: Date
  windowStart: Date
  windowEnd: Date
  recipientEmail: string
  recipientName: string
  senderName?: string
  senderId: string
  recipientId: string
}

async function processDeadlineItem(args: ProcessItemArgs) {
  const {
    boardDocId, source, parentTitle, itemId, itemText, deadline,
    now, windowStart, windowEnd, recipientEmail, recipientName, senderName,
    senderId, recipientId,
  } = args

  let sent = 0, skipped = 0, errors = 0

  if (deadline < windowStart || deadline > windowEnd) {
    if (deadline >= windowStart) return { sent, skipped, errors }
    return { sent, skipped, errors }
  }

  const timeUntilMs = deadline.getTime() - now.getTime()

  for (const { offsetMs, label } of DEADLINE_INTERVALS) {
    const fireAtMs = deadline.getTime() - offsetMs
    const diffFromNow = fireAtMs - now.getTime()
    const shouldFire = Math.abs(diffFromNow) <= 5 * 60 * 1000
    const isOverdue = label === 'overdue' && timeUntilMs <= 0 && timeUntilMs > -60 * 60 * 1000

    if (!shouldFire && !isOverdue) continue

    // Dedup check
    const dedupKey = `${boardDocId}::${source}::${itemId}::${label}::${recipientEmail}`
    const cutoff = new Date(now.getTime() - COOLDOWN_MS).toISOString()
    const { data: recent } = await supabaseAdmin
      .from('sent_reminders')
      .select('id')
      .eq('key', dedupKey)
      .gte('sent_at', cutoff)
      .maybeSingle()
    if (recent) { skipped++; continue }

    try {
      const timeRemaining = label
      let emailHtml: string
      let subject: string

      if (source === 'checklist' || source === 'kanban') {
        const sourceLabel = source === 'checklist' ? 'Checklist' : 'Kanban Board'
        const isOver = label === 'overdue'

        emailHtml = await render(
          ChecklistReminderEmail({
            userName: recipientName,
            checklistTitle: `${sourceLabel}: ${parentTitle}`,
            taskText: itemText,
            timeRemaining,
            deadline: format(deadline, 'MMM d, yyyy @ h:mm a'),
            boardUrl: 'https://bords.app',
          })
        )

        subject = isOver
          ? `⚠️ Deadline Reached: ${itemText}`
          : `⏰ Reminder: ${itemText} due in ${timeRemaining}`
      } else {
        const isOver = label === 'overdue'
        emailHtml = await render(
          ReminderEmail({
            recipientName,
            senderName: senderName || 'Bords',
            reminderTitle: parentTitle,
            items: [{
              text: itemText,
              dueDate: format(deadline, 'MMM d, h:mm a'),
              overdue: isOver,
              completed: false,
            }],
            boardUrl: 'https://bords.app',
          })
        )

        subject = isOver
          ? `⚠️ Overdue reminder: ${parentTitle}`
          : `🔔 Reminder: ${itemText} due in ${timeRemaining}`
      }

      await sendEmail({ to: recipientEmail, subject, html: emailHtml })

      await supabaseAdmin.from('sent_reminders').insert({
        key: dedupKey,
        board_doc_id: boardDocId,
        source,
        item_id: itemId,
        interval_label: label,
        recipient_email: recipientEmail,
        sent_at: now.toISOString(),
        sent_by: 'cron',
      })

      try {
        await createReminderInboxEntry({
          source, parentTitle, itemText, itemId,
          timeRemaining: label, senderId, recipientId,
          recipientEmail, dueDate: deadline, boardDocId,
        })
      } catch (inboxErr: any) {
        console.warn(`Cron inbox entry failed [${source}/${itemId}/${label}]:`, inboxErr.message)
      }

      sent++
    } catch (err: any) {
      console.error(`Cron reminder send failed [${source}/${itemId}/${label}]:`, err.message)
      errors++
    }
  }

  return { sent, skipped, errors }
}

function parseDeadline(dateStr?: string | null, timeStr?: string | null): Date | null {
  if (!dateStr) return null
  try {
    if (dateStr.includes('T')) {
      const d = new Date(dateStr)
      return isNaN(d.getTime()) ? null : d
    }
    if (timeStr) {
      const d = new Date(`${dateStr}T${timeStr}`)
      return isNaN(d.getTime()) ? null : d
    }
    const d = new Date(`${dateStr}T23:59:59`)
    return isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}
