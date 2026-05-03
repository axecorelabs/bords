/**
 * AI Context Builder
 *
 * Builds a role-aware system prompt for Bords AI by fetching live data from
 * Supabase. The amount of data exposed to the model is gated by the user's
 * role in the organisation:
 *
 *   org_owner  → all boards in org, all members, all tasks
 *   admin      → org boards they can access, member list, org tasks
 *   member     → only boards they have explicit access to, only their own tasks
 *
 * Board data is included when the caller supplies taggedBoardIds (explicit IDs
 * from the client) or when the user message contains #handle patterns that
 * resolve to a board in their accessible set.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'

const PROMPT_BUDGET = {
  maxPromptChars: 8000,
  maxBoardsInContext: 4,
  maxTasksPerBoard: 18,
  maxOrgMembers: 30,
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrgRole = 'owner' | 'admin' | 'member' | 'none'

export interface AiContextInput {
  userId: string
  orgId?: string | null
  /** Board UUIDs explicitly tagged by the client (e.g. from the board chip picker). */
  taggedBoardIds?: string[]
  /** Raw user message text — used to parse implicit #handle board references. */
  userMessage?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract lowercase #handle tokens from a message string. */
function extractHandles(text: string): string[] {
  const matches = text.match(/#([a-zA-Z0-9_-]+)/g) ?? []
  return matches.map((m) => m.slice(1).toLowerCase())
}

/** Truncate a string to a max length for token safety. */
function trunc(s: string | null | undefined, max = 120): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}

function extractPlainText(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const node = value as { text?: unknown; content?: unknown[] }
  const parts: string[] = []
  if (typeof node.text === 'string') parts.push(node.text)
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => parts.push(...extractPlainText(child)))
  }
  return parts
}

// ── Main builder ──────────────────────────────────────────────────────────────

export async function buildAiSystemPrompt(input: AiContextInput): Promise<string> {
  const { userId, orgId, taggedBoardIds = [], userMessage = '' } = input

  const sections: string[] = []

  // ── 1. Persona ──────────────────────────────────────────────────────────────
  sections.push(`\
You are Bords AI, the built-in assistant for the Bords collaboration platform.

## Capabilities
- Answer questions about boards, tasks, and team activity visible in your context
- Summarise board content, task status, and workload
- Help draft tasks, action items, plans, and messages
- Analyse progress and blockers across boards

## Behaviour rules
- Only reference data shown in this prompt; never fabricate board titles, task content, or member names
- Be concise, actionable, and collaborative in tone
- If the user asks about data not in your context, say so clearly and suggest they tag the relevant board with #boardTitle
- Respect role-based access: only surface data the user is entitled to see`)

  // ── 2. User identity ────────────────────────────────────────────────────────
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('first_name, last_name, email')
    .eq('id', userId)
    .single()

  const userName = profile
    ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.email
    : 'Unknown user'

  // ── 3. Org context + role ──────────────────────────────────────────────────
  let orgRole: OrgRole = 'none'
  let orgName: string | null = null

  if (orgId) {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name, owner_id')
      .eq('id', orgId)
      .single()

    orgName = org?.name ?? null

    if (org?.owner_id === userId) {
      orgRole = 'owner'
    } else {
      const { data: membership } = await supabaseAdmin
        .from('employee_memberships')
        .select('role')
        .eq('organization_id', orgId)
        .eq('user_id', userId)
        .maybeSingle()

      if (membership?.role === 'admin') orgRole = 'admin'
      else if (membership) orgRole = 'member'
    }

    // Member count (only show to admin/owner)
    let memberCount: number | null = null
    if (orgRole === 'owner' || orgRole === 'admin') {
      const { count } = await supabaseAdmin
        .from('employee_memberships')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', orgId)
      memberCount = count ?? null
    }

    sections.push(`\
## Current user
Name: ${userName}
Role in "${orgName ?? 'this organisation'}": ${orgRole}${memberCount !== null ? `\nOrganisation members: ${memberCount}` : ''}`)
  } else {
    sections.push(`\
## Current user
Name: ${userName}
Context: personal workspace`)
  }

  // ── 4. Resolve board IDs to include in context ─────────────────────────────
  // Combine explicit tagged IDs with any #handle tokens found in the message.
  const explicitIds = new Set(taggedBoardIds.filter(Boolean))
  const handles = extractHandles(userMessage)

  // Determine which boards this user can access
  let accessibleBoardIds: string[] = []

  if (orgId && (orgRole === 'owner' || orgRole === 'admin')) {
    // Admin/owner can access all org boards
    const { data: orgBoards } = await supabaseAdmin
      .from('bords')
      .select('id')
      .eq('organization_id', orgId)
    accessibleBoardIds = (orgBoards ?? []).map((b) => b.id)
  } else {
    // Members or personal context: only boards from the active scope.
    const { data: accessRows } = await supabaseAdmin
      .from('bord_access_list')
      .select('bord_id')
      .eq('user_id', userId)
    const candidateIds = (accessRows ?? []).map((r) => r.bord_id)

    const { data: ownedBoards } = await supabaseAdmin
      .from('bords')
      .select('id')
      .eq('owner_id', userId)
    for (const b of ownedBoards ?? []) candidateIds.push(b.id)

    const scopedCandidateIds = [...new Set(candidateIds)]
    if (scopedCandidateIds.length > 0) {
      let boardScopeQuery = supabaseAdmin
        .from('bords')
        .select('id')
        .in('id', scopedCandidateIds)

      if (orgId) {
        boardScopeQuery = boardScopeQuery.eq('organization_id', orgId)
      } else {
        boardScopeQuery = boardScopeQuery.is('organization_id', null)
      }

      const { data: scopedBoards } = await boardScopeQuery
      accessibleBoardIds = (scopedBoards ?? []).map((b) => b.id)
    }
  }

  // Resolve #handle tokens against accessible board titles/local IDs
  if (handles.length > 0 && accessibleBoardIds.length > 0) {
    const { data: boardMeta } = await supabaseAdmin
      .from('bords')
      .select('id, title, local_board_id')
      .in('id', accessibleBoardIds)

    for (const h of handles) {
      const match = (boardMeta ?? []).find(
        (b) =>
          b.title?.toLowerCase().replace(/\s+/g, '-') === h ||
          b.title?.toLowerCase() === h ||
          b.local_board_id?.toLowerCase() === h
      )
      if (match) explicitIds.add(match.id)
    }
  }

  // Filter down to only boards the user can actually access
  const boardIdsToFetch = [...explicitIds]
    .filter((id) => accessibleBoardIds.includes(id))
    .slice(0, PROMPT_BUDGET.maxBoardsInContext)

  // ── 5. Board context ────────────────────────────────────────────────────────
  if (boardIdsToFetch.length > 0) {
    const { data: boards } = await supabaseAdmin
      .from('bords')
      .select('id, owner_id, local_board_id, title, created_at, updated_at')
      .in('id', boardIdsToFetch)

    const resolvedBoards = boards ?? []
    const boardIds = resolvedBoards.map((board) => board.id)
    const localBoardIds = resolvedBoards.map((board) => (board as any).local_board_id).filter(Boolean)
    const ownerIds = resolvedBoards.map((board) => (board as any).owner_id).filter(Boolean)

    const [boardDocsResult, tasksResult] = await Promise.all([
      localBoardIds.length > 0 && ownerIds.length > 0
        ? supabaseAdmin
          .from('board_documents')
          .select('owner_id, local_board_id, updated_at, sticky_notes, checklists, kanban_boards, text_elements, rich_texts')
          .in('local_board_id', localBoardIds)
          .in('owner_id', ownerIds)
          .order('updated_at', { ascending: false })
        : Promise.resolve({ data: [] as any[] }),
      boardIds.length > 0
        ? supabaseAdmin
          .from('task_assignments')
          .select(`
            bord_id,
            content,
            status,
            source_type,
            column_title,
            assigned_to,
            assigned_by,
            created_at,
            profiles!task_assignments_assigned_to_fkey (first_name, last_name)
          `)
          .in('bord_id', boardIds)
          .order('created_at', { ascending: false })
          .limit(boardIds.length * PROMPT_BUDGET.maxTasksPerBoard)
        : Promise.resolve({ data: [] as any[] }),
    ])

    const boardDocsByKey = new Map<string, any>()
    for (const row of (boardDocsResult.data ?? []) as any[]) {
      const key = `${row.owner_id}:${row.local_board_id}`
      if (!boardDocsByKey.has(key)) boardDocsByKey.set(key, row)
    }

    const tasksByBoardId = new Map<string, any[]>()
    for (const row of (tasksResult.data ?? []) as any[]) {
      const list = tasksByBoardId.get(row.bord_id) ?? []
      if (list.length < PROMPT_BUDGET.maxTasksPerBoard) {
        list.push(row)
        tasksByBoardId.set(row.bord_id, list)
      }
    }

    for (const board of resolvedBoards) {
      const lines: string[] = [`### Board: "${board.title}"`]
      const boardDoc = boardDocsByKey.get(`${(board as any).owner_id}:${(board as any).local_board_id}`)

      const textSummary = Array.isArray((boardDoc as any)?.text_elements)
        ? (boardDoc as any).text_elements
          .map((entry: any) => typeof entry?.text === 'string' ? trunc(entry.text, 220) : '')
          .filter(Boolean)
          .slice(0, 2)
        : []

      const richTextSummary = Array.isArray((boardDoc as any)?.rich_texts)
        ? (boardDoc as any).rich_texts
          .map((entry: any) => trunc(extractPlainText(entry?.content).join(' '), 220))
          .filter(Boolean)
          .slice(0, 2)
        : []

      const checklistTitles = Array.isArray((boardDoc as any)?.checklists)
        ? (boardDoc as any).checklists
          .map((entry: any) => {
            const title = typeof entry?.title === 'string' ? trunc(entry.title, 80) : 'Untitled checklist'
            const itemCount = Array.isArray(entry?.items) ? entry.items.length : 0
            return `${title} (${itemCount})`
          })
          .slice(0, 6)
        : []

      const kanbanSummary = Array.isArray((boardDoc as any)?.kanban_boards)
        ? (boardDoc as any).kanban_boards
          .map((kanban: any) => {
            const title = typeof kanban?.title === 'string' ? trunc(kanban.title, 80) : 'Kanban board'
            const columns = Array.isArray(kanban?.columns) ? kanban.columns : []
            return `${title}: ${columns.map((c: any) => `${trunc(c?.title || 'Column', 24)} (${Array.isArray(c?.tasks) ? c.tasks.length : 0})`).join(', ')}`
          })
          .slice(0, 2)
        : []

      const stickySummary = Array.isArray((boardDoc as any)?.sticky_notes)
        ? (boardDoc as any).sticky_notes
          .map((entry: any) => typeof entry?.text === 'string' ? trunc(entry.text, 90) : '')
          .filter(Boolean)
          .slice(0, 4)
        : []

      if (textSummary[0] || richTextSummary[0]) {
        lines.push(`Intent: ${textSummary[0] || richTextSummary[0]}`)
      }
      if (checklistTitles.length > 0) {
        lines.push(`Checklists: ${checklistTitles.join('; ')}`)
      }
      if (kanbanSummary.length > 0) {
        lines.push(`Workflow: ${kanbanSummary.join(' | ')}`)
      }
      if (stickySummary.length > 0) {
        lines.push(`Key notes: ${stickySummary.join(' | ')}`)
      }

      // Tasks on this board
      const tasks = tasksByBoardId.get(board.id) ?? []

      if (tasks && tasks.length > 0) {
        lines.push(`Tasks (${tasks.length} shown):`)
        for (const t of tasks) {
          const assigneeProfile = (t as any).profiles
          const assigneeName = assigneeProfile
            ? `${assigneeProfile.first_name ?? ''} ${assigneeProfile.last_name ?? ''}`.trim()
            : 'Unassigned'
          const inColumn = t.column_title ? ` [${t.column_title}]` : ''
          const isOwn = t.assigned_to === userId
          // Members only see their own tasks
          if (orgRole === 'member' && !isOwn) continue
          lines.push(`- [${t.status}]${inColumn} "${trunc(t.content)}" → ${assigneeName} (${t.source_type})`)
        }
      } else {
        lines.push('Tasks: none')
      }

      sections.push(lines.join('\n'))
    }
  } else if (handles.length > 0 || taggedBoardIds.length > 0) {
    // User tried to tag a board but it wasn't accessible
    sections.push(`## Note\nThe board(s) referenced could not be found or you do not have access to them.`)
  }

  // ── 6. Org member list (admin/owner only) ──────────────────────────────────
  if (orgId && (orgRole === 'owner' || orgRole === 'admin')) {
    const { data: members } = await supabaseAdmin
      .from('employee_memberships')
      .select('user_id, role, profiles (first_name, last_name, email)')
      .eq('organization_id', orgId)
      .limit(PROMPT_BUDGET.maxOrgMembers)

    if (members && members.length > 0) {
      const memberLines = (members as any[]).map((m) => {
        const p = m.profiles
        const name = p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email : m.user_id
        return `- ${name} (${m.role})`
      })
      sections.push(`## Organisation members\n${memberLines.join('\n')}`)
    }
  }

  const prompt = sections.join('\n\n')
  return prompt.length > PROMPT_BUDGET.maxPromptChars
    ? `${prompt.slice(0, PROMPT_BUDGET.maxPromptChars)}\n\n[Context truncated for token budget]`
    : prompt
}
