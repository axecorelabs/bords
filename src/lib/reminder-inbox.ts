import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * Shared helper: Create inbox entries (TaskAssignment + Notification) when a
 * reminder email fires — used by both client-side /api/reminders/send and
 * server-side /api/cron/check-reminders.
 */

export interface CreateReminderInboxParams {
  source: string
  parentTitle: string
  itemText: string
  itemId: string
  timeRemaining: string
  senderId: string
  recipientId: string
  recipientEmail?: string
  dueDate?: Date | null
  boardDocId?: string
}

export async function createReminderInboxEntry(params: CreateReminderInboxParams) {
  const {
    source, parentTitle, itemText, itemId, timeRemaining,
    senderId, recipientId, recipientEmail, dueDate, boardDocId,
  } = params

  const sourceTypeMap: Record<string, string> = {
    checklist: 'checklist_item',
    kanban: 'kanban_task',
    reminder: 'reminder_item',
  }
  const sourceType = sourceTypeMap[source] || 'reminder_item'

  // Dedup: Don't create duplicate inbox entries for the same item + interval
  const dedupSourceId = `${itemId}::${timeRemaining}`
  const { data: existingEntry } = await supabaseAdmin
    .from('task_assignments')
    .select('id')
    .eq('source_type', sourceType)
    .eq('source_id', dedupSourceId)
    .eq('assigned_to', recipientId)
    .eq('is_deleted', false)
    .maybeSingle()
  if (existingEntry) return { created: false, reason: 'duplicate' }

  // Determine context (personal vs organization)
  let contextType: 'personal' | 'organization' = 'personal'
  let organizationId: string | null = null
  let workspaceId: string | null = null
  let boardOwnerId: string | null = null

  if (boardDocId) {
    const { data: boardDoc } = await supabaseAdmin
      .from('board_documents')
      .select('context_type, organization_id, workspace_id, owner_id')
      .eq('id', boardDocId)
      .maybeSingle()
    if (boardDoc) {
      contextType = (boardDoc.context_type as any) || 'personal'
      organizationId = boardDoc.organization_id || null
      workspaceId = boardDoc.workspace_id || null
      boardOwnerId = boardDoc.owner_id
    }
  }

  if (!workspaceId && contextType === 'personal') {
    const { data: personalWs } = await supabaseAdmin
      .from('workspaces')
      .select('id')
      .eq('owner_id', recipientId)
      .eq('type', 'personal')
      .maybeSingle()
    if (personalWs) workspaceId = personalWs.id
  }

  const isOverdue = timeRemaining === 'overdue'
  const notificationType = isOverdue ? 'reminder_overdue' : 'reminder_due'
  const content = `${parentTitle}: ${itemText}`

  const { data: sender } = await supabaseAdmin
    .from('profiles')
    .select('first_name, last_name')
    .eq('id', senderId)
    .maybeSingle()
  const senderName = sender ? `${sender.first_name || ''} ${sender.last_name || ''}`.trim() : 'Bords'

  const isSelfAssigned = senderId === recipientId
  const isOrgBoard = contextType === 'organization'
  const isOwnerOfOrgBoard = isOrgBoard && boardOwnerId === recipientId

  const created: string[] = []

  // Create work inbox entry (for org boards)
  if (isOrgBoard) {
    const { data: orgEntry } = await supabaseAdmin
      .from('task_assignments')
      .insert({
        bord_id: null,
        workspace_id: workspaceId,
        organization_id: organizationId,
        context_type: 'organization',
        source_type: sourceType,
        source_id: dedupSourceId,
        content,
        assigned_to: recipientId,
        assigned_by: senderId,
        priority: isOverdue ? 'high' : 'normal',
        due_date: dueDate?.toISOString() || null,
        execution_note: isOverdue
          ? `⚠️ Deadline reached for: ${itemText}`
          : `⏰ Due in ${timeRemaining}: ${itemText}`,
        status: 'assigned',
        published_at: new Date().toISOString(),
      })
      .select()
      .single()
    created.push('organization')

    await supabaseAdmin.from('notifications').insert({
      user_id: recipientId,
      type: notificationType,
      title: isOverdue ? `⚠️ Overdue: ${itemText}` : `⏰ Due in ${timeRemaining}: ${itemText}`,
      message: isSelfAssigned
        ? `Your ${source} item "${itemText}" in "${parentTitle}" is ${isOverdue ? 'overdue' : `due in ${timeRemaining}`}`
        : `${senderName}'s ${source} item "${itemText}" in "${parentTitle}" is ${isOverdue ? 'overdue' : `due in ${timeRemaining}`}`,
      metadata: {
        taskAssignmentId: orgEntry!.id,
        sourceType,
        sourceId: dedupSourceId,
        organizationId: organizationId || undefined,
      },
    })
  }

  // Create personal inbox entry
  if (!isOrgBoard || isOwnerOfOrgBoard) {
    let personalWsId = contextType === 'personal' ? workspaceId : null
    if (!personalWsId) {
      const { data: personalWs } = await supabaseAdmin
        .from('workspaces')
        .select('id')
        .eq('owner_id', recipientId)
        .eq('type', 'personal')
        .maybeSingle()
      if (personalWs) personalWsId = personalWs.id
    }

    const personalDedupId = isOrgBoard ? `${dedupSourceId}::personal` : dedupSourceId

    let existingPersonal = null
    if (isOrgBoard) {
      const { data } = await supabaseAdmin
        .from('task_assignments')
        .select('id')
        .eq('source_type', sourceType)
        .eq('source_id', personalDedupId)
        .eq('assigned_to', recipientId)
        .eq('context_type', 'personal')
        .eq('is_deleted', false)
        .maybeSingle()
      existingPersonal = data
    }

    if (!existingPersonal) {
      const { data: personalEntry } = await supabaseAdmin
        .from('task_assignments')
        .insert({
          bord_id: null,
          workspace_id: personalWsId,
          context_type: 'personal',
          source_type: sourceType,
          source_id: isOrgBoard ? personalDedupId : dedupSourceId,
          content,
          assigned_to: recipientId,
          assigned_by: senderId,
          priority: isOverdue ? 'high' : 'normal',
          due_date: dueDate?.toISOString() || null,
          execution_note: isOverdue
            ? `⚠️ Deadline reached for: ${itemText}`
            : `⏰ Due in ${timeRemaining}: ${itemText}`,
          status: 'assigned',
          published_at: new Date().toISOString(),
        })
        .select()
        .single()
      created.push('personal')

      if (!isOrgBoard) {
        await supabaseAdmin.from('notifications').insert({
          user_id: recipientId,
          type: notificationType,
          title: isOverdue ? `⚠️ Overdue: ${itemText}` : `⏰ Due in ${timeRemaining}: ${itemText}`,
          message: isSelfAssigned
            ? `Your ${source} item "${itemText}" in "${parentTitle}" is ${isOverdue ? 'overdue' : `due in ${timeRemaining}`}`
            : `${senderName} — ${source} item "${itemText}" in "${parentTitle}" is ${isOverdue ? 'overdue' : `due in ${timeRemaining}`}`,
          metadata: {
            taskAssignmentId: personalEntry!.id,
            sourceType,
            sourceId: isOrgBoard ? personalDedupId : dedupSourceId,
          },
        })
      }
    }
  }

  return { created: true, inboxes: created }
}
