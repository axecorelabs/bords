import { supabaseAdmin } from '@/lib/supabase/admin'

export interface ChecklistItem {
  id: string
  text: string
  completed: boolean
}

export interface CreateTaskAssignmentInput {
  bordId?: string | null
  workspaceId?: string | null
  organizationId?: string | null
  contextType: 'personal' | 'organization'
  sourceType: 'note' | 'checklist_item' | 'kanban_task' | 'reminder_item'
  sourceId: string
  content: string
  assignedTo: string
  assignedBy: string
  priority?: 'low' | 'normal' | 'high'
  dueDate?: string | null
  executionNote?: string | null
  descriptionType?: 'text' | 'checklist'
  checklistItems?: ChecklistItem[]
  status?: 'draft' | 'assigned' | 'completed'
  publishedAt?: string | null
  columnId?: string | null
  columnTitle?: string | null
  availableColumns?: unknown[]
}

function trimPreview(text: string, max = 80) {
  return text.length > max ? `${text.slice(0, max)}...` : text
}

export async function notifyTaskAssigned(params: {
  assignedTo: string
  assignedBy: string
  actorName?: string | null
  content: string
  taskAssignmentId: string
  sourceType: CreateTaskAssignmentInput['sourceType']
  sourceId: string
  extraMetadata?: Record<string, unknown>
  bestEffort?: boolean
}) {
  const {
    assignedTo,
    assignedBy,
    actorName,
    content,
    taskAssignmentId,
    sourceType,
    sourceId,
    extraMetadata,
    bestEffort = false,
  } = params

  if (assignedTo === assignedBy) return

  const senderName = actorName?.trim() || 'Someone'
  const notification = {
    user_id: assignedTo,
    type: 'task_assigned',
    title: 'Task Assigned',
    message: `${senderName} assigned you a task: "${trimPreview(content)}"`,
    metadata: {
      taskAssignmentId,
      sourceType,
      sourceId,
      ...(extraMetadata ?? {}),
    },
  }

  if (bestEffort) {
    // Fire-and-forget: don't await, don't throw
    supabaseAdmin.from('notifications').insert(notification).then(() => {}, () => {})
    return
  }

  const { error } = await supabaseAdmin.from('notifications').insert(notification)
  if (error) throw new Error(error.message)
}

export async function createTaskAssignment(params: {
  assignment: CreateTaskAssignmentInput
  actorName?: string | null
  notify?: boolean
  notifyBestEffort?: boolean
  notificationMetadata?: Record<string, unknown>
}) {
  const {
    assignment,
    actorName,
    notify = true,
    notifyBestEffort = false,
    notificationMetadata,
  } = params

  const now = new Date().toISOString()
  const payload = {
    bord_id: assignment.bordId ?? null,
    workspace_id: assignment.workspaceId ?? null,
    organization_id: assignment.organizationId ?? null,
    context_type: assignment.contextType,
    source_type: assignment.sourceType,
    source_id: assignment.sourceId,
    content: assignment.content.trim(),
    assigned_to: assignment.assignedTo,
    assigned_by: assignment.assignedBy,
    priority: assignment.priority ?? 'normal',
    due_date: assignment.dueDate ? new Date(assignment.dueDate).toISOString() : null,
    execution_note: assignment.executionNote ?? null,
    description_type: assignment.descriptionType ?? 'text',
    checklist_items: assignment.checklistItems ?? [],
    status: assignment.status ?? 'assigned',
    published_at: assignment.publishedAt ?? now,
    column_id: assignment.columnId ?? null,
    column_title: assignment.columnTitle ?? null,
    available_columns: assignment.availableColumns ?? [],
  }

  const { data, error } = await supabaseAdmin
    .from('task_assignments')
    .insert(payload)
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create assignment')
  }

  if (notify) {
    await notifyTaskAssigned({
      assignedTo: assignment.assignedTo,
      assignedBy: assignment.assignedBy,
      actorName,
      content: assignment.content,
      taskAssignmentId: data.id,
      sourceType: assignment.sourceType,
      sourceId: assignment.sourceId,
      extraMetadata: notificationMetadata,
      bestEffort: notifyBestEffort,
    })
  }

  return data
}
