import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized } from '@/lib/api-helpers'
import { generateAiText } from '@/lib/ai/gateway'

type Params = { params: Promise<{ id: string }> }

function normalizeSpace(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

function toNonEmptyStrings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => (typeof v === 'string' ? normalizeSpace(v) : '')).filter(Boolean).slice(0, max)
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.7
  return Math.max(0.5, Math.min(0.95, value))
}

function sanitizePlanContent(raw: unknown, goalFallback: string) {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const summary = typeof r.summary === 'string' ? normalizeSpace(r.summary) : `A plan for: ${goalFallback}`
  const outcomes = toNonEmptyStrings(r.outcomes, 8)
  const workstreams = Array.isArray(r.workstreams)
    ? r.workstreams
        .map((w: Record<string, unknown>, i: number) => ({
          title: typeof w.title === 'string' ? normalizeSpace(w.title) : `Workstream ${i + 1}`,
          checklist: toNonEmptyStrings(w.checklist, 12),
        }))
        .filter((w) => w.checklist.length > 0)
        .slice(0, 7)
    : []
  const stickyNotes = Array.isArray(r.stickyNotes)
    ? r.stickyNotes
        .map((n: Record<string, unknown>) => ({
          lane: typeof n.lane === 'string' ? normalizeSpace(n.lane) : 'Notes',
          text: typeof n.text === 'string' ? normalizeSpace(n.text) : '',
        }))
        .filter((n) => n.text)
        .slice(0, 12)
    : []
  const shapeHints = Array.isArray(r.shapeHints)
    ? r.shapeHints
        .map((s: Record<string, unknown>) => ({
          type: typeof s.type === 'string' ? normalizeSpace(s.type) : 'flow',
          label: typeof s.label === 'string' ? normalizeSpace(s.label) : '',
        }))
        .filter((s) => s.label)
        .slice(0, 6)
    : []
  const assignmentProposals = Array.isArray(r.assignmentProposals)
    ? r.assignmentProposals
        .map((a: Record<string, unknown>) => ({
          roleHint: typeof a.roleHint === 'string' ? normalizeSpace(a.roleHint) : 'Team member',
          responsibility: typeof a.responsibility === 'string' ? normalizeSpace(a.responsibility) : '',
          confidence: clampConfidence(a.confidence),
        }))
        .filter((a) => a.responsibility)
        .slice(0, 8)
    : []

  if (workstreams.length < 1 || outcomes.length < 1) return null
  return { summary, outcomes, workstreams, stickyNotes, shapeHints, assignmentProposals }
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fence?.[1]) {
    const inner = fence[1].trim()
    if (inner.startsWith('{') && inner.endsWith('}')) return inner
  }
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) return trimmed.slice(first, last + 1)
  return trimmed
}

function parsePlanDsl(text: string, goalFallback: string) {
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
          roleHint: roleRaw || 'Team member',
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
      if (mode === 'outcomes') outcomes.push(item)
      if (mode === 'workstream' && currentWs) currentWs.checklist.push(item)
    }
  }

  return sanitizePlanContent({
    summary: summary || `A plan for: ${goalFallback}`,
    outcomes,
    workstreams,
    stickyNotes,
    shapeHints,
    assignmentProposals,
  }, goalFallback)
}

async function assertConversationMember(conversationId: string, userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
}

// POST /api/ai/plans/[id]/revise — AI revises the plan based on user feedback
export async function POST(req: Request, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { id } = await params
  const body = await req.json().catch(() => null)
  const feedback = typeof body?.feedback === 'string' ? body.feedback.trim() : ''
  if (!feedback) {
    return NextResponse.json({ error: 'feedback is required' }, { status: 400 })
  }

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('ai_plan_artifacts')
    .select('id, conversation_id, status, goal, content, organization_id')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Plan artifact not found' }, { status: 404 })
  }

  const isMember = await assertConversationMember(existing.conversation_id, user.id)
  if (!isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (existing.status === 'applied') {
    return NextResponse.json({ error: 'Cannot revise a plan that has already been applied to a board' }, { status: 400 })
  }

  const currentContent = existing.content ?? {}

  const systemPrompt = [
    'You are an execution strategist. The user is reviewing an execution plan and has requested changes.',
    'You will receive the current plan as JSON and user feedback. Return a REVISED plan as STRICT JSON only (no markdown, no code fences).',
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
    'Rules:',
    '- Apply the user feedback precisely. Do not change parts the user did not mention.',
    '- Keep all existing workstreams unless user asks to remove/change them.',
    '- outcomes: 4-8 measurable outcomes.',
    '- workstreams: 4-7 streams, each with 5-10 actionable tasks.',
    '- assignmentProposals: 4-8 role-based proposals with confidence 0.50-0.95.',
    '- Output ONLY the JSON object. No explanation.',
  ].join('\n')

  const userMessage = [
    `Original goal: ${existing.goal}`,
    '',
    'Current plan JSON:',
    JSON.stringify({
      summary: currentContent.summary,
      outcomes: currentContent.outcomes,
      workstreams: currentContent.workstreams,
      stickyNotes: currentContent.stickyNotes,
      shapeHints: currentContent.shapeHints,
      assignmentProposals: currentContent.assignmentProposals,
    }, null, 2),
    '',
    `User feedback: ${feedback}`,
    '',
    'Return only the revised plan JSON.',
  ].join('\n')

  let revisedContent: ReturnType<typeof sanitizePlanContent> = null

  // Attempt 1: strict JSON generation
  try {
    const result = await generateAiText({
      task: 'chat',
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1800,
      temperature: 0.25,
    })
    const parsed = JSON.parse(extractJsonObject(result.text))
    revisedContent = sanitizePlanContent(parsed, existing.goal)
  } catch {
    // continue
  }

  // Attempt 2: convert imperfect output into strict JSON via repair pass
  if (!revisedContent) {
    try {
      const firstAttempt = await generateAiText({
        task: 'chat',
        systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: 1800,
        temperature: 0.15,
      })

      const repairPrompt = [
        'Convert the following plan revision output into STRICT JSON matching the exact schema.',
        'Output only JSON. No markdown.',
        '',
        firstAttempt.text,
      ].join('\n')

      const repaired = await generateAiText({
        task: 'classify',
        systemPrompt,
        messages: [{ role: 'user', content: repairPrompt }],
        maxTokens: 1800,
        temperature: 0,
      })
      const parsed = JSON.parse(extractJsonObject(repaired.text))
      revisedContent = sanitizePlanContent(parsed, existing.goal)
    } catch {
      // continue
    }
  }

  // Attempt 3: parser-friendly DSL fallback
  if (!revisedContent) {
    try {
      const dslPrompt = [
        'Return ONLY in this format:',
        'SUMMARY: <text>',
        'OUTCOMES:',
        '- <outcome>',
        'WORKSTREAM: <name>',
        '- <task>',
        'STICKY: <lane> | <text>',
        'SHAPE: <type> | <label>',
        'ASSIGN: <roleHint> | <responsibility> | <confidence 0.50-0.95>',
        '',
        userMessage,
      ].join('\n')

      const dsl = await generateAiText({
        task: 'taskify',
        systemPrompt: 'You are an execution strategist. Follow the requested DSL format exactly.',
        messages: [{ role: 'user', content: dslPrompt }],
        maxTokens: 2200,
        temperature: 0.2,
      })
      revisedContent = parsePlanDsl(dsl.text, existing.goal)
    } catch {
      // continue
    }
  }

  // Deterministic fallback: keep the current plan but do not fail with 502.
  if (!revisedContent) {
    revisedContent = sanitizePlanContent({
      summary: currentContent.summary,
      outcomes: currentContent.outcomes,
      workstreams: currentContent.workstreams,
      stickyNotes: currentContent.stickyNotes,
      shapeHints: currentContent.shapeHints,
      assignmentProposals: currentContent.assignmentProposals,
    }, existing.goal)
  }

  if (!revisedContent) {
    return NextResponse.json({ error: 'Could not produce a valid plan revision. Please try with more specific feedback.' }, { status: 502 })
  }

  // Preserve non-plan fields (materializedBoard etc.)
  const prevContent = (existing.content ?? {}) as Record<string, unknown>
  const nextContent = {
    ...prevContent,
    ...revisedContent,
    // Reset materializedBoard if the plan was previously applied — user is changing it
    ...(existing.status === 'applied' ? { materializedBoard: undefined } : {}),
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('ai_plan_artifacts')
    .update({ content: nextContent, status: 'draft' } as never)
    .eq('id', id)
    .select('id, status, content, updated_at')
    .single()

  if (updateErr || !updated) {
    return NextResponse.json({ error: 'Failed to save revised plan' }, { status: 500 })
  }

  return NextResponse.json({ id: updated.id, status: updated.status, content: updated.content })
}
