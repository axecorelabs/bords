import { NextRequest, NextResponse } from 'next/server'
import { render } from '@react-email/render'
import ChecklistReminderEmail from '@/emails/ChecklistReminder'
import { getAuthUser } from '@/lib/api-helpers'
import { sendEmail } from '@/lib/email'

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { checklistTitle, taskText, timeRemaining, deadline, boardUrl } = body

    if (!checklistTitle || !taskText || !timeRemaining || !deadline) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const userName = user.name || 'User'
    const userEmail = user.email

    const emailHtml = await render(
      ChecklistReminderEmail({
        userName,
        checklistTitle,
        taskText,
        timeRemaining,
        deadline,
        boardUrl,
      })
    )

    const result = await sendEmail({
      to: userEmail,
      subject: timeRemaining === 'overdue'
        ? `⚠️ Deadline Reached: ${taskText}`
        : `⏰ Reminder: ${taskText} due in ${timeRemaining}`,
      html: emailHtml,
    })

    return NextResponse.json({ success: true, messageId: result.messageId })
  } catch (error) {
    console.error('Error in send-reminder API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
