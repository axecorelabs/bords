import { supabaseAdmin } from '@/lib/supabase/admin'
import { randomUUID } from 'crypto'
import { generateAiText } from '@/lib/ai/gateway'

export type CapabilityResult = {
  handled: boolean
  text?: string
  action?: 'create_board' | 'board_details' | 'plan_draft'
  data?: {
    boardLocalId?: string
    boardTitle?: string
    organizationId?: string | null
    planArtifactId?: string
    planTitle?: string
  }
}

function normalizeSpace(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

function derivePlanTitle(goal: string): string {
  const trimmed = normalizeSpace(goal)
  if (!trimmed) return 'Execution Plan'
  const short = trimmed.length > 56 ? `${trimmed.slice(0, 56).trim()}...` : trimmed
  return short.replace(/^to\s+/i, '').replace(/^for\s+/i, '')
}

type PlanDraftContent = {
  summary: string
  outcomes: string[]
  workstreams: Array<{ title: string; checklist: string[] }>
  stickyNotes: Array<{ lane: string; text: string }>
  shapeHints: Array<{ type: string; label: string }>
  assignmentProposals: Array<{ roleHint: string; responsibility: string; confidence: number }>
}

type PlanDraftBuild = {
  content: PlanDraftContent
  source: 'ai' | 'fallback'
  reason?: string
}

function isLowCreditTokenError(err: unknown): boolean {
  const msg = String((err as any)?.message || '').toLowerCase()
  return msg.includes('(402)') ||
    (msg.includes('requires more credits') && msg.includes('fewer max_tokens')) ||
    (msg.includes('can only afford') && msg.includes('tokens'))
}

function parseAffordableTokenCount(err: unknown): number | null {
  const msg = String((err as any)?.message || '')
  const match = msg.match(/can only afford\s+(\d+)\s+tokens?/i)
  if (!match?.[1]) return null
  const n = Number(match[1])
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}

function buildCompactPlanSystemPrompt(): string {
  return [
    'You are an execution strategist.',
    'Return STRICT JSON only.',
    '',
    'Schema:',
    '{',
    '  "summary": string,',
    '  "outcomes": string[],',
    '  "workstreams": [{ "title": string, "checklist": string[] }],',
    '  "stickyNotes": [{ "lane": string, "text": string }],',
    '  "shapeHints": [{ "type": string, "label": string }],',
    '  "assignmentProposals": [{ "roleHint": string, "responsibility": string, "confidence": number }]',
    '}',
    '',
    'Compact requirements:',
    '- outcomes: exactly 3.',
    '- workstreams: exactly 3, each exactly 3 checklist tasks.',
    '- stickyNotes: 3 lines.',
    '- shapeHints: 2 lines.',
    '- assignmentProposals: 2 lines.',
    '- Keep text short and concrete.',
  ].join('\n')
}

async function tryBuildCompactPlanDraft(
  goal: string,
  orgId: string | null,
  err?: unknown,
): Promise<PlanDraftContent | null> {
  const affordable = parseAffordableTokenCount(err)
  const budget = affordable ? Math.max(90, Math.min(220, affordable - 20)) : 140

  const compactPrompt = [
    `Goal: ${goal}`,
    `Context: ${orgId ? 'organization workspace' : 'personal workspace'}`,
    'Keep all text concise. Return JSON only.',
  ].join('\n')

  try {
    const compact = await generateAiText({
      task: 'chat',
      systemPrompt: buildCompactPlanSystemPrompt(),
      messages: [{ role: 'user', content: compactPrompt }],
      maxTokens: budget,
      temperature: 0.15,
    })

    const compactParsed = JSON.parse(extractJsonObject(compact.text))
    return sanitizePlanDraft(compactParsed, goal, orgId)
  } catch {
    return null
  }
}

function isTemplateLikePlan(content: PlanDraftContent): boolean {
  const summary = normalizeSpace(content.summary || '').toLowerCase()
  const ws = (content.workstreams || []).map((w) => normalizeSpace(w.title || '').toLowerCase())
  const genericTitles = ['discovery and scope', 'build and iterate', 'launch and measure']
  const hasGenericTriplet = genericTitles.every((t) => ws.includes(t))
  return summary.startsWith('a practical plan to deliver:') || hasGenericTriplet
}

function buildPlanSystemPrompt(): string {
  return [
    'You are an execution strategist and program manager.',
    'Produce a concrete, domain-specific execution plan from a user goal.',
    'Avoid generic templates and vague advice.',
    'Output STRICT JSON only (no markdown, no code fences).',
    '',
    'Schema:',
    '{',
    '  "summary": string,',
    '  "outcomes": string[],',
    '  "workstreams": [{ "title": string, "checklist": string[] }],',
    '  "stickyNotes": [{ "lane": string, "text": string }],',
    '  "shapeHints": [{ "type": string, "label": string }],',
    '  "assignmentProposals": [{ "roleHint": string, "responsibility": string, "confidence": number }]',
    '}',
    '',
    'Requirements:',
    '- summary: 2-4 sentences that reflect the specific goal.',
    '- outcomes: 4-8 measurable outcomes.',
    '- workstreams: 4-7 streams, each with 5-10 actionable checklist items.',
    '- checklist items must be concrete tasks (verbs + deliverables).',
    '- include sequencing/time cues where useful (e.g., Week 1, pre-launch, launch day, week +2).',
    '- stickyNotes: 6-12 notes across lanes like Goals, Risks, Dependencies, Decisions, Metrics, Open Questions.',
    '- shapeHints: 3-6 visual structure hints for a board layout.',
    '- assignmentProposals: 4-8 role-based ownership proposals with realistic confidence 0.50-0.95.',
    '',
    'Domain adaptation rules:',
    '- If goal involves launch/marketing/product release/book launch, include audience, positioning, offer/package, channel strategy, content/assets, partnerships, launch operations, and post-launch measurement.',
    '- If goal involves technical delivery, include architecture, implementation, QA, rollout, and monitoring.',
    '- If missing details, include explicit assumptions and discovery tasks in early workstreams.',
    '',
    'Quality bar:',
    '- Every task should help someone execute immediately.',
    '- No filler items like "review progress" unless paired with a specific artifact/output.',
  ].join('\n')
}

function buildPlanDslSystemPrompt(): string {
  return [
    'You are an execution strategist and program manager.',
    'Create a concrete, domain-specific execution plan.',
    'Do not output JSON. Output ONLY in this exact text format:',
    'SUMMARY: <2-4 sentences>',
    'OUTCOMES:',
    '- <outcome 1>',
    '- <outcome 2>',
    'WORKSTREAM: <name>',
    '- <task>',
    '- <task>',
    'WORKSTREAM: <name>',
    '- <task>',
    'STICKY: <lane> | <text>',
    'SHAPE: <type> | <label>',
    'ASSIGN: <roleHint> | <responsibility> | <confidence 0.50-0.95>',
    '',
    'Rules:',
    '- 4-7 workstreams, each 5-10 concrete tasks.',
    '- 4-8 outcomes, measurable where possible.',
    '- 6-12 sticky lines, 3-6 shape lines, 4-8 assign lines.',
    '- Avoid generic filler. Tasks must be executable.',
  ].join('\n')
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed

  const codeFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (codeFenceMatch?.[1]) {
    const inner = codeFenceMatch[1].trim()
    if (inner.startsWith('{') && inner.endsWith('}')) return inner
  }

  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    return trimmed.slice(first, last + 1)
  }

  return trimmed
}

function toNonEmptyStrings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => (typeof v === 'string' ? normalizeSpace(v) : ''))
    .filter(Boolean)
    .slice(0, max)
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.7
  return Math.max(0.5, Math.min(0.95, value))
}

function parsePlanDsl(text: string, goal: string, orgId: string | null): PlanDraftContent | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  if (lines.length === 0) return null

  let summary = ''
  const outcomes: string[] = []
  const workstreams: Array<{ title: string; checklist: string[] }> = []
  const stickyNotes: Array<{ lane: string; text: string }> = []
  const shapeHints: Array<{ type: string; label: string }> = []
  const assignmentProposals: Array<{ roleHint: string; responsibility: string; confidence: number }> = []

  let currentWs: { title: string; checklist: string[] } | null = null
  let mode: 'outcomes' | 'workstream' | null = null

  for (const line of lines) {
    if (/^SUMMARY\s*:/i.test(line)) {
      summary = normalizeSpace(line.replace(/^SUMMARY\s*:/i, ''))
      mode = null
      continue
    }

    if (/^OUTCOMES\s*:/i.test(line)) {
      mode = 'outcomes'
      continue
    }

    if (/^WORKSTREAM\s*:/i.test(line)) {
      const title = normalizeSpace(line.replace(/^WORKSTREAM\s*:/i, '')) || `Workstream ${workstreams.length + 1}`
      currentWs = { title, checklist: [] }
      workstreams.push(currentWs)
      mode = 'workstream'
      continue
    }

    if (/^STICKY\s*:/i.test(line)) {
      const body = line.replace(/^STICKY\s*:/i, '')
      const [laneRaw, textRaw] = body.split('|').map((s) => normalizeSpace(s || ''))
      if (textRaw) stickyNotes.push({ lane: laneRaw || 'Notes', text: textRaw })
      mode = null
      continue
    }

    if (/^SHAPE\s*:/i.test(line)) {
      const body = line.replace(/^SHAPE\s*:/i, '')
      const [typeRaw, labelRaw] = body.split('|').map((s) => normalizeSpace(s || ''))
      if (labelRaw) shapeHints.push({ type: typeRaw || 'flow', label: labelRaw })
      mode = null
      continue
    }

    if (/^ASSIGN\s*:/i.test(line)) {
      const body = line.replace(/^ASSIGN\s*:/i, '')
      const [roleRaw, respRaw, confRaw] = body.split('|').map((s) => normalizeSpace(s || ''))
      if (respRaw) {
        assignmentProposals.push({
          roleHint: roleRaw || (orgId ? 'Organization owner/admin' : 'Board owner'),
          responsibility: respRaw,
          confidence: clampConfidence(Number(confRaw)),
        })
      }
      mode = null
      continue
    }

    if (/^-\s+/.test(line)) {
      const item = normalizeSpace(line.replace(/^-\s+/, ''))
      if (!item) continue
      if (mode === 'outcomes') {
        outcomes.push(item)
      } else if (mode === 'workstream' && currentWs) {
        currentWs.checklist.push(item)
      }
      continue
    }
  }

  const sane = sanitizePlanDraft({
    summary: summary || `A practical plan to deliver: ${normalizeSpace(goal)}`,
    outcomes,
    workstreams,
    stickyNotes,
    shapeHints,
    assignmentProposals,
  }, goal, orgId)

  if (sane.workstreams.length >= 2 && sane.outcomes.length >= 2) return sane
  return null
}

function sanitizePlanDraft(raw: any, goal: string, orgId: string | null): PlanDraftContent {
  const summary = typeof raw?.summary === 'string'
    ? normalizeSpace(raw.summary)
    : `A practical plan to deliver: ${normalizeSpace(goal)}`

  const outcomes = toNonEmptyStrings(raw?.outcomes, 8)

  const workstreams = Array.isArray(raw?.workstreams)
    ? raw.workstreams
      .map((w: any, i: number) => ({
        title: typeof w?.title === 'string' ? normalizeSpace(w.title) : `Workstream ${i + 1}`,
        checklist: toNonEmptyStrings(w?.checklist, 10),
      }))
      .filter((w: any) => w.checklist.length > 0)
      .slice(0, 7)
    : []

  const stickyNotes = Array.isArray(raw?.stickyNotes)
    ? raw.stickyNotes
      .map((n: any) => ({
        lane: typeof n?.lane === 'string' ? normalizeSpace(n.lane) : 'Notes',
        text: typeof n?.text === 'string' ? normalizeSpace(n.text) : '',
      }))
      .filter((n: any) => n.text)
      .slice(0, 12)
    : []

  const shapeHints = Array.isArray(raw?.shapeHints)
    ? raw.shapeHints
      .map((s: any) => ({
        type: typeof s?.type === 'string' ? normalizeSpace(s.type) : 'flow',
        label: typeof s?.label === 'string' ? normalizeSpace(s.label) : '',
      }))
      .filter((s: any) => s.label)
      .slice(0, 6)
    : []

  const assignmentProposals = Array.isArray(raw?.assignmentProposals)
    ? raw.assignmentProposals
      .map((a: any) => ({
        roleHint: typeof a?.roleHint === 'string' ? normalizeSpace(a.roleHint) : (orgId ? 'Organization owner/admin' : 'Board owner'),
        responsibility: typeof a?.responsibility === 'string' ? normalizeSpace(a.responsibility) : '',
        confidence: clampConfidence(a?.confidence),
      }))
      .filter((a: any) => a.responsibility)
      .slice(0, 8)
    : []

  return {
    summary,
    outcomes,
    workstreams,
    stickyNotes,
    shapeHints,
    assignmentProposals,
  }
}

function draftPlanFromGoal(goal: string, orgId: string | null): PlanDraftContent {
  const cleaned = normalizeSpace(goal)
  const words = cleaned.split(' ').filter(Boolean)
  const subject = words.slice(0, 6).join(' ') || 'the goal'

  return {
    summary: `A practical plan to deliver: ${cleaned}`,
    outcomes: [
      `Clear scope for ${subject}`,
      'Visible priorities and owner accountability',
      'Execution progress trackable by the team',
    ],
    workstreams: [
      {
        title: 'Discovery and scope',
        checklist: [
          'Define success criteria',
          'List assumptions and constraints',
          'Identify dependencies',
        ],
      },
      {
        title: 'Build and iterate',
        checklist: [
          'Create first implementation pass',
          'Review with stakeholders',
          'Address feedback and risks',
        ],
      },
      {
        title: 'Launch and measure',
        checklist: [
          'Publish final deliverable',
          'Define owner handoff',
          'Track outcomes and follow-ups',
        ],
      },
    ],
    stickyNotes: [
      { lane: 'Goals', text: cleaned },
      { lane: 'Risks', text: 'What could block this plan?' },
      { lane: 'Decisions', text: 'Which choices need explicit approval?' },
      { lane: 'Dependencies', text: 'Which teams/systems are required?' },
    ],
    shapeHints: [
      { type: 'flow', label: 'Discovery -> Build -> Launch' },
      { type: 'cluster', label: 'Group tasks by workstream' },
    ],
    assignmentProposals: [
      {
        roleHint: orgId ? 'Organization owner/admin' : 'Board owner',
        responsibility: 'Approve scope and milestones',
        confidence: 0.77,
      },
      {
        roleHint: 'Execution lead',
        responsibility: 'Own delivery timeline and cross-team coordination',
        confidence: 0.72,
      },
    ],
  }
}

async function draftPlanFromGoalWithAi(goal: string, orgId: string | null): Promise<PlanDraftContent> {
  const prompt = [
    `Goal: ${goal}`,
    `Context: ${orgId ? 'organization workspace' : 'personal workspace'}`,
    'Return only JSON that matches the schema.',
  ].join('\n')

  try {
    const result = await generateAiText({
      task: 'chat',
      systemPrompt: buildPlanSystemPrompt(),
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1400,
      temperature: 0.25,
    })

    const jsonText = extractJsonObject(result.text)
    const parsed = JSON.parse(jsonText)
    return sanitizePlanDraft(parsed, goal, orgId)
  } catch {
    return draftPlanFromGoal(goal, orgId)
  }
}

async function buildPlanDraft(goal: string, orgId: string | null): Promise<PlanDraftBuild> {
  const prompt = [
    `Goal: ${goal}`,
    `Context: ${orgId ? 'organization workspace' : 'personal workspace'}`,
    'Return only JSON that matches the schema.',
  ].join('\n')

  try {
    const result = await generateAiText({
      task: 'chat',
      systemPrompt: buildPlanSystemPrompt(),
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1400,
      temperature: 0.25,
    })

    const jsonText = extractJsonObject(result.text)
    const parsed = JSON.parse(jsonText)
    return {
      content: sanitizePlanDraft(parsed, goal, orgId),
      source: 'ai',
    }
  } catch (firstErr) {
    // Low-credit mode: OpenRouter may reject large token requests with 402.
    // Retry once with a compact prompt and a very small token budget.
    if (isLowCreditTokenError(firstErr)) {
      const compactParsed = await tryBuildCompactPlanDraft(goal, orgId, firstErr)
      if (compactParsed) {
        return {
          content: compactParsed,
          source: 'ai',
          reason: 'low_credit_compact_mode',
        }
      }
    }

    // Repair pass: ask the model to convert imperfect output into strict JSON schema.
    try {
      const firstAttempt = await generateAiText({
        task: 'chat',
        systemPrompt: buildPlanSystemPrompt(),
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 800,
        temperature: 0.15,
      })

      const repairPrompt = [
        'Convert the following planner output into STRICT JSON only, matching the schema exactly.',
        'Do not add markdown or code fences.',
        '',
        firstAttempt.text,
      ].join('\n')

      const repaired = await generateAiText({
        task: 'classify',
        systemPrompt: buildPlanSystemPrompt(),
        messages: [{ role: 'user', content: repairPrompt }],
        maxTokens: 700,
        temperature: 0,
      })

      const repairedJson = extractJsonObject(repaired.text)
      const repairedParsed = JSON.parse(repairedJson)
      return {
        content: sanitizePlanDraft(repairedParsed, goal, orgId),
        source: 'ai',
      }
    } catch (secondErr) {
      if (isLowCreditTokenError(secondErr) || isLowCreditTokenError(firstErr)) {
        const compactParsed = await tryBuildCompactPlanDraft(goal, orgId, secondErr)
        if (compactParsed) {
          return {
            content: compactParsed,
            source: 'ai',
            reason: 'low_credit_compact_mode',
          }
        }
      }

      // Last AI attempt using a parser-friendly DSL (not JSON).
      try {
        const dslPrompt = [
          `Goal: ${goal}`,
          `Context: ${orgId ? 'organization workspace' : 'personal workspace'}`,
          'Use the exact DSL format requested.',
        ].join('\n')

        const dsl = await generateAiText({
          task: 'taskify',
          systemPrompt: buildPlanDslSystemPrompt(),
          messages: [{ role: 'user', content: dslPrompt }],
          maxTokens: 900,
          temperature: 0.2,
        })

        const parsedDsl = parsePlanDsl(dsl.text, goal, orgId)
        if (parsedDsl) {
          return {
            content: parsedDsl,
            source: 'ai',
          }
        }
      } catch (dslErr) {
        if (isLowCreditTokenError(dslErr)) {
          const compactParsed = await tryBuildCompactPlanDraft(goal, orgId, dslErr)
          if (compactParsed) {
            return {
              content: compactParsed,
              source: 'ai',
              reason: 'low_credit_compact_mode',
            }
          }
        }
      }

      return {
        content: draftPlanFromGoal(goal, orgId),
        source: 'fallback',
        reason: `planner_json_parse_failed: ${String((secondErr as any)?.message || (firstErr as any)?.message || 'unknown')}`,
      }
    }
  }
}

async function insertPlanArtifact(params: {
  conversationId: string
  userId: string
  orgId: string | null
  title: string
  goal: string
  content: PlanDraftContent
  plannerSource: 'ai' | 'fallback'
  plannerReason?: string
}): Promise<{ id: string | null; error: string | null }> {
  const baseRow = {
    conversation_id: params.conversationId,
    user_id: params.userId,
    organization_id: params.orgId,
    title: params.title,
    goal: params.goal,
    content: params.content,
    status: 'draft',
  }

  const primary = await supabaseAdmin
    .from('ai_plan_artifacts')
    .insert({
      ...baseRow,
      metadata: {
        plannerSource: params.plannerSource,
        plannerReason: params.plannerReason || null,
      },
    } as never)
    .select('id')
    .single()

  if (!primary.error && primary.data?.id) {
    return { id: primary.data.id as string, error: null }
  }

  // Backward compatibility: if metadata column is not present in a lagging DB,
  // retry without metadata so plan creation still works.
  if (primary.error?.message?.includes("Could not find the 'metadata' column")) {
    const fallback = await supabaseAdmin
      .from('ai_plan_artifacts')
      .insert(baseRow as never)
      .select('id')
      .single()

    if (!fallback.error && fallback.data?.id) {
      return { id: fallback.data.id as string, error: null }
    }

    return { id: null, error: fallback.error?.message || 'Unknown insert error (fallback)' }
  }

  return { id: null, error: primary.error?.message || 'Unknown insert error' }
}

async function getPersonalWorkspaceId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('workspaces')
    .select('id')
    .eq('owner_id', userId)
    .eq('type', 'personal')
    .maybeSingle()
  return data?.id ?? null
}

async function createBoard(params: {
  userId: string
  orgId: string | null
  title: string
}): Promise<string> {
  const localBoardId = `ai-${randomUUID()}`
  const workspaceId = await getPersonalWorkspaceId(params.userId)
  const contextType = params.orgId ? 'organization' : 'personal'

  await Promise.all([
    supabaseAdmin
      .from('bords')
      .insert({
        owner_id: params.userId,
        local_board_id: localBoardId,
        title: params.title,
        context_type: contextType,
        organization_id: params.orgId,
      } as never),
    supabaseAdmin
      .from('board_documents')
      .insert({
        owner_id: params.userId,
        local_board_id: localBoardId,
        title: params.title,
        context_type: contextType,
        organization_id: params.orgId,
        workspace_id: workspaceId,
        visibility: 'private',
        shared_with: [],
        version: 1,
      } as never),
  ])

  return localBoardId
}

async function resolveBoardForUser(params: {
  userId: string
  orgId: string | null
  query: string
  taggedBoardIds: string[]
}): Promise<{ id: string; local_board_id: string; title: string; context_type: string; updated_at: string | null } | null> {
  if (params.taggedBoardIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('bords')
      .select('id, local_board_id, title, context_type, updated_at, organization_id')
      .in('id', params.taggedBoardIds)
      .limit(1)
      .maybeSingle()
    if (data) return data as any
  }

  const uuidMatch = params.query.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)
  if (uuidMatch) {
    const { data } = await supabaseAdmin
      .from('bords')
      .select('id, local_board_id, title, context_type, updated_at, organization_id')
      .eq('id', uuidMatch[0])
      .maybeSingle()
    if (data) return data as any
  }

  const titleQuery = params.query
    .replace(/^\/?board-details\s*/i, '')
    .replace(/^show\s+board\s+details\s*(for)?\s*/i, '')
    .replace(/^board\s+details\s*(for)?\s*/i, '')
    .trim()

  if (!titleQuery) return null

  let q = supabaseAdmin
    .from('bords')
    .select('id, local_board_id, title, context_type, updated_at, organization_id')
    .ilike('title', `%${titleQuery}%`)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (params.orgId) q = q.eq('organization_id', params.orgId)
  else q = q.is('organization_id', null)

  const { data } = await q.maybeSingle()
  return (data as any) ?? null
}

async function getBoardDetailsText(params: {
  boardId: string
  boardTitle: string
  localBoardId: string
  contextType: string
  updatedAt: string | null
}): Promise<string> {
  const { data: tasks } = await supabaseAdmin
    .from('task_assignments')
    .select('id, content, status, priority, due_date, assigned_to')
    .eq('bord_id', params.boardId)
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false })
    .limit(20)

  const total = tasks?.length ?? 0
  const statusCounts = (tasks ?? []).reduce(
    (acc, t) => {
      acc[t.status] = (acc[t.status] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  const topTasks = (tasks ?? [])
    .slice(0, 5)
    .map((t) => `- [${t.status}] ${t.content.slice(0, 120)}${t.content.length > 120 ? '...' : ''}`)

  return [
    `Board details for "${params.boardTitle}":`,
    `- Board UUID: ${params.boardId}`,
    `- Local board ID: ${params.localBoardId}`,
    `- Context: ${params.contextType}`,
    `- Last updated: ${params.updatedAt ?? 'unknown'}`,
    `- Tasks sampled: ${total}`,
    `- Status counts: draft=${statusCounts.draft ?? 0}, assigned=${statusCounts.assigned ?? 0}, completed=${statusCounts.completed ?? 0}`,
    topTasks.length > 0 ? 'Recent tasks:\n' + topTasks.join('\n') : 'Recent tasks: none',
    'Tip: tag this board with #<board-handle> in AI chat to include it in retrieval context.',
  ].join('\n')
}

export async function tryExecuteAiCapability(params: {
  userId: string
  conversationId: string
  orgId: string | null
  message: string
  taggedBoardIds: string[]
}): Promise<CapabilityResult> {
  const raw = normalizeSpace(params.message)
  const lower = raw.toLowerCase()

  const createMatch = raw.match(/^\/?create-board\s+(.+)$/i) || raw.match(/^create\s+board\s+(.+)$/i)
  if (createMatch) {
    const title = normalizeSpace(createMatch[1] ?? '')
    if (!title) return { handled: true, text: 'Please provide a board title. Example: /create-board Q2 Planning' }

    const localBoardId = await createBoard({
      userId: params.userId,
      orgId: params.orgId,
      title,
    })

    return {
      handled: true,
      action: 'create_board',
      data: {
        boardLocalId: localBoardId,
        boardTitle: title,
        organizationId: params.orgId,
      },
      text: [
        `Created board "${title}" successfully.`,
        `- Local board ID: ${localBoardId}`,
        `- Context: ${params.orgId ? 'organization' : 'personal'}`,
        'You can now open it from your board list and start adding notes/tasks.',
      ].join('\n'),
    }
  }

  const planMatch = raw.match(/^\/?plan\s+(.+)$/i) || raw.match(/^draft\s+plan\s+(.+)$/i)
  if (planMatch) {
    const goal = normalizeSpace(planMatch[1] ?? '')
    if (!goal) {
      return {
        handled: true,
        text: 'Please describe the goal. Example: /plan Launch an onboarding revamp for enterprise customers',
      }
    }

    const title = derivePlanTitle(goal)
    const draft = await buildPlanDraft(goal, params.orgId)

    // Never persist deterministic fallback/template drafts as user-facing plan artifacts.
    if (draft.source !== 'ai' || isTemplateLikePlan(draft.content)) {
      console.warn('[AI capabilities] plan_generation_rejected', {
        source: draft.source,
        reason: draft.reason,
        goal,
      })
      return {
        handled: true,
        text: [
          'I could not generate a high-quality AI plan right now, so I did not save a generic fallback draft.',
          'Please retry in a moment with the same goal (or add extra constraints like audience, timeline, and success metrics).',
        ].join('\n'),
      }
    }

    const content = draft.content

    const artifactInsert = await insertPlanArtifact({
      conversationId: params.conversationId,
      userId: params.userId,
      orgId: params.orgId,
      title,
      goal,
      content,
      plannerSource: draft.source,
      plannerReason: draft.reason,
    })

    if (!artifactInsert.id) {
      console.error('[AI capabilities] Failed to save ai_plan_artifacts row:', artifactInsert.error)
      return {
        handled: true,
        text: 'I could not save the plan draft right now. Please try again in a moment.',
      }
    }

    return {
      handled: true,
      action: 'plan_draft',
      data: {
        planArtifactId: artifactInsert.id,
        planTitle: title,
        organizationId: params.orgId,
      },
      text: [
        `Draft plan created: "${title}"`,
        `- Goal: ${goal}`,
        `- Planner source: ${draft.source}`,
        '- Includes outcomes, workstreams, sticky notes, and assignment proposals.',
        '- Next: review and approve this draft before creating a board from it.',
      ].join('\n'),
    }
  }

  const wantsDetails =
    /^\/?board-details\b/i.test(raw) ||
    /^show\s+board\s+details\b/i.test(lower) ||
    /^board\s+details\b/i.test(lower)

  if (wantsDetails) {
    const board = await resolveBoardForUser({
      userId: params.userId,
      orgId: params.orgId,
      query: raw,
      taggedBoardIds: params.taggedBoardIds,
    })

    if (!board) {
      return {
        handled: true,
        text: 'I could not resolve the board. Use /board-details <board name>, /board-details <uuid>, or tag a board in the message.',
      }
    }

    const text = await getBoardDetailsText({
      boardId: board.id,
      boardTitle: board.title,
      localBoardId: board.local_board_id,
      contextType: board.context_type,
      updatedAt: board.updated_at,
    })

    return { handled: true, action: 'board_details', text }
  }

  return { handled: false }
}
