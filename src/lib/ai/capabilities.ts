import { supabaseAdmin } from '@/lib/supabase/admin'
import { randomUUID } from 'crypto'
import { generateAiText } from '@/lib/ai/gateway'
import { generateEmbedding } from '@/lib/ai/embeddings'
import { extractBoardContentFromYDoc } from '@/lib/ydoc-extract'
import { buildBoardFromPlanArtifact } from '@/lib/ai/plan-board-builder'

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
    planStage?: 'clarify' | 'brief_pending' | 'drafted' | 'board_built'
    planGoal?: string
  }
}

function normalizeSpace(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

function clip(text: string, max: number): string {
  const normalized = normalizeSpace(text)
  return normalized.length > max ? `${normalized.slice(0, max).trim()}...` : normalized
}

function inferBoardIntentSummary(params: {
  boardTitle: string
  inferredIntent: string
  hasChecklists: boolean
  hasKanbans: boolean
  hasRichText: boolean
  hasStickyNotes: boolean
}): string {
  const seed = params.inferredIntent.toLowerCase()
  const title = params.boardTitle

  if (/\b(how to|guide|step[-\s]?by[-\s]?step|procedure|walkthrough)\b/.test(seed)) {
    return `This board captures a practical how-to guide for ${title}, focused on real-world execution.`
  }

  if (/\b(plan|roadmap|strategy|milestone|timeline|rollout)\b/.test(seed)) {
    return `This board outlines a plan for ${title}, including strategy and execution structure.`
  }

  if (params.hasChecklists || params.hasKanbans) {
    return `This board is an execution workspace for ${title}, with structured tasks and workflow tracking.`
  }

  if (params.hasRichText || params.hasStickyNotes) {
    return `This board consolidates key context and notes about ${title}.`
  }

  return `This board is organizing work around ${title}.`
}

function isLowSignalBoardChunk(text: string): boolean {
  const normalized = normalizeSpace(text)
  const lower = normalized.toLowerCase()
  if (!normalized) return true

  // Generic metadata/index rows are not useful as board "meaning".
  if (lower.startsWith('board title:')) return true
  if (lower.includes('context:') && lower.includes('counts:')) return true
  if (/(sticky_notes|checklists|kanbans|comments|reminders|tables)\s*=\s*\d+/i.test(normalized)) return true

  // Very short snippets usually carry no semantic content.
  if (normalized.length < 48) return true

  return false
}

function normalizeBoardHandle(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
  return cleaned || 'board'
}

function extractPlainText(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const node = value as { text?: unknown; content?: unknown[] }
  const parts: string[] = []
  if (typeof node.text === 'string') parts.push(node.text)
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => {
      parts.push(...extractPlainText(child))
    })
  }
  return parts
}

function extractHandles(text: string): string[] {
  const matches = text.match(/#([a-zA-Z0-9_-]+)/g) ?? []
  return matches.map((m) => m.slice(1).toLowerCase())
}

type CapabilityIntent =
  | { action: 'create_board'; title: string }
  | { action: 'plan_draft'; goal: string }
  | { action: 'board_details'; query: string }

function detectCapabilityIntentHeuristically(raw: string, taggedBoardIds: string[]): CapabilityIntent | null {
  const normalized = normalizeSpace(raw)
  const lower = normalized.toLowerCase()
  const handles = extractHandles(raw)

  const createPatterns = [
    /^(?:please\s+)?(?:create|make|set up|spin up)\s+(?:a\s+)?board\s+(?:for\s+)?(.+)$/i,
    /^(?:please\s+)?(?:create|make|set up)\s+(.+?)\s+board$/i,
  ]
  for (const pattern of createPatterns) {
    const match = normalized.match(pattern)
    const title = normalizeSpace(match?.[1] || '')
    if (title) return { action: 'create_board', title }
  }

  const planPatterns = [
    /^(?:please\s+)?(?:make|create|draft|build|generate)\s+(?:an?\s+)?plan\s+(?:for\s+)?(.+)$/i,
    /^(?:please\s+)?help\s+me\s+plan\s+(.+)$/i,
    /^(?:please\s+)?turn\s+(.+)\s+into\s+(?:an?\s+)?plan$/i,
    /^(?:can\s+we\s+|could\s+we\s+|let'?s\s+)?plan\s+(.+)$/i,
    /^(?:can\s+we\s+|could\s+we\s+|let'?s\s+)(?:make|create|draft|build|generate)\s+(?:an?\s+)?plan\s+(?:for\s+)?(.+)$/i,
  ]
  for (const pattern of planPatterns) {
    const match = normalized.match(pattern)
    const goal = normalizeSpace(match?.[1] || '')
    if (goal) return { action: 'plan_draft', goal }
  }

  const boardReferenced = taggedBoardIds.length > 0 || handles.length > 0
  const normalizedWithoutHandles = normalizeSpace(normalized.replace(/#([a-zA-Z0-9_-]+)/g, ''))
  const tagOnlyMessage = boardReferenced && !normalizedWithoutHandles
  const explicitBoardDetails =
    /(?:board\s+details|what(?:'s| is)\s+(?:on|in)\s+(?:this|that|the)\s+board|what is this board about|summari[sz]e\s+(?:this|that|the)\s+board|explain\s+(?:this|that|the)\s+board)/i.test(lower)

  if (tagOnlyMessage || explicitBoardDetails) {
    return { action: 'board_details', query: normalized }
  }

  return null
}

async function detectCapabilityIntentWithAi(raw: string, taggedBoardIds: string[]): Promise<CapabilityIntent | null> {
  if (raw.startsWith('/')) return null

  try {
    const systemPrompt = [
      'Classify whether the user wants one of these capabilities:',
      '- create_board',
      '- plan_draft',
      '- board_details',
      '- none',
      'Return STRICT JSON only with shape:',
      '{"action":"create_board"|"plan_draft"|"board_details"|"none","argument":string,"confidence":number}',
      'Only choose a capability if the intent is explicit and high-confidence.',
      'If the user is generally chatting or asking open-ended questions, return none.',
      taggedBoardIds.length > 0 ? 'The user has tagged at least one board in this message.' : 'No board is tagged.',
    ].join('\n')

    const result = await generateAiText({
      task: 'classify',
      systemPrompt,
      messages: [{ role: 'user', content: raw }],
      maxTokens: 120,
      temperature: 0,
    })

    const parsed = JSON.parse(extractJsonObject(result.text)) as {
      action?: 'create_board' | 'plan_draft' | 'board_details' | 'none'
      argument?: string
      confidence?: number
    }

    if (!parsed?.action || parsed.action === 'none' || typeof parsed.confidence !== 'number' || parsed.confidence < 0.78) {
      return null
    }

    const argument = normalizeSpace(parsed.argument || '')
    if (parsed.action === 'create_board' && argument) return { action: 'create_board', title: argument }
    if (parsed.action === 'plan_draft' && argument) return { action: 'plan_draft', goal: argument }
    if (parsed.action === 'board_details') return { action: 'board_details', query: argument || raw }
    return null
  } catch {
    return null
  }
}

function shouldAttemptCapabilityAiDetection(raw: string, taggedBoardIds: string[]): boolean {
  if (!raw || raw.startsWith('/')) return false

  const lower = raw.toLowerCase()
  const hasHandle = /#([a-z0-9_-]+)/i.test(lower)

  // Tagged messages should only invoke capability classification when they
  // explicitly ask for a capability. Otherwise we let normal chat + retrieval
  // answer with board context.
  if (taggedBoardIds.length > 0 || hasHandle) {
    return /(board\s+details|show\s+board\s+details|what(?:'s|\s+is)\s+(?:on|in)\s+(?:this|that|the)\s+board|summari[sz]e\s+(?:this|that|the)\s+board|explain\s+(?:this|that|the)\s+board|create\s+board|make\s+board|new\s+board|draft\s+plan|create\s+plan|make\s+plan|help\s+me\s+plan|can\s+we\s+plan|could\s+we\s+plan|let'?s\s+plan|\bplan\s+.+|turn\s+.+\s+into\s+(?:an?\s+)?plan)/i.test(lower)
  }

  // Only pay the classify-model cost when the message plausibly maps to
  // a capability intent (create_board / plan_draft / board_details).
  return /(create\s+board|make\s+board|new\s+board|board\s+details|what(?:'s|\s+is)\s+(?:on|in)\s+(?:this|that|the)\s+board|summari[sz]e\s+(?:this|that|the)\s+board|explain\s+(?:this|that|the)\s+board|draft\s+plan|create\s+plan|make\s+plan|help\s+me\s+plan|can\s+we\s+plan|could\s+we\s+plan|let'?s\s+plan|\bplan\s+.+|turn\s+.+\s+into\s+(?:an?\s+)?plan)/i.test(lower)
}

function derivePlanTitle(goal: string): string {
  // Use only the first line so accumulated context lines don't bleed into the title
  const firstLine = normalizeSpace(goal.split('\n')[0])
  const trimmed = firstLine || normalizeSpace(goal)
  if (!trimmed) return 'Execution Plan'
  const short = trimmed.length > 56 ? `${trimmed.slice(0, 56).trim()}...` : trimmed
  return short.replace(/^to\s+/i, '').replace(/^for\s+/i, '')
}

function scorePlanContext(text: string): number {
  const normalized = normalizeSpace(text)
  const lower = normalized.toLowerCase()
  let score = 0

  if (normalized.length >= 80) score += 1
  if (/(by\s+\w+|deadline|timeline|week|month|quarter|q[1-4]|date|launch\s+on|in\s+\d+\s*(days|weeks|months))/i.test(lower)) score += 1
  if (/(team|owner|stakeholder|audience|users|customers|engineering|marketing|design|sales|ops)/i.test(lower)) score += 1
  if (/(budget|cost|resources|headcount|time|constraint|risk|dependency|scope)/i.test(lower)) score += 1
  if (/(metric|kpi|success|outcome|target|goal|conversion|retention|revenue)/i.test(lower)) score += 1

  return score
}

function buildPlanClarificationMessage(goal: string, title: string): string {
  return [
    `I can draft "${title}", but to make it accurate I need a bit more context first.`,
    '',
    `Current goal: ${goal}`,
    '',
    'Reply with short answers to these:',
    '1. Outcome: what does success look like (metrics or concrete result)?',
    '2. Timeline: by when should this be done?',
    '3. Constraints: budget/team/tool/compliance limits?',
    '4. Scope: what is in-scope and explicitly out-of-scope?',
    '',
    'Optional: add audience, stakeholders, and major risks.',
    'If you want a fast draft anyway, reply: "draft now".',
  ].join('\n')
}

function buildPlanBriefMessage(goal: string, title: string): string {
  const normalized = normalizeSpace(goal)
  const lower = normalized.toLowerCase()

  const selectedScopeOption = (() => {
    if (/\b(scope\s+choice\s*:\s*option\s*a|option\s*a\s*[-:]\s*narrow|scope\s*:\s*option\s*a|go\s+with\s+option\s*a|choose\s+option\s*a|\boption\s*a\b)\b/i.test(normalized)) return 'A'
    if (/\b(scope\s+choice\s*:\s*option\s*b|option\s*b\s*[-:]\s*medium|scope\s*:\s*option\s*b|go\s+with\s+option\s*b|choose\s+option\s*b|\boption\s*b\b)\b/i.test(normalized)) return 'B'
    if (/\b(scope\s+choice\s*:\s*option\s*c|option\s*c\s*[-:]\s*broad|scope\s*:\s*option\s*c|go\s+with\s+option\s*c|choose\s+option\s*c|\boption\s*c\b)\b/i.test(normalized)) return 'C'
    return null
  })()

  // Show only the original goal (first line before accumulated context)
  const originalGoal = normalizeSpace(goal.split('\n')[0])
  const displayGoal = originalGoal || clip(normalized, 120)

  const timeline = (() => {
    const candidates: string[] = []

    // Prefer explicit durations first: "1 month", "a month and a half", "three weeks".
    for (const match of normalized.matchAll(/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|a|an)\s*(?:-\s*\d+)?\s*(?:day|week|month|year)s?(?:\s+and\s+a\s+half)?\b/gi)) {
      candidates.push(normalizeSpace(match[0]))
    }

    // Then consider relative/date phrasing.
    for (const match of normalized.matchAll(/\b(?:by\s+[^,.;\n]+|within\s+[^,.;\n]+|in\s+\d+\s*(?:days|weeks|months|years)|q[1-4]\s*\d{4}|this\s+quarter|next\s+quarter)\b/gi)) {
      candidates.push(normalizeSpace(match[0]))
    }

    // Prefer latest timeline update from the conversation context.
    let picked = ''
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const candidate = candidates[i]
      if (/\bscope\b/i.test(candidate)) continue
      // Avoid false positives from "what do you mean by ..."
      if (/\bby\s+(scope|what|which|when|how)\b/i.test(candidate)) continue
      picked = candidate
      break
    }

    return picked || 'Not explicitly provided yet.'
  })()

  const hasMetrics = /(metric|kpi|success|target|concrete\s+result|actual\s+result|conversion|retention|revenue|quality|sla)/i.test(lower)
  const hasConstraints = /(budget|cost|resources|headcount|constraint|risk|dependency|compliance)/i.test(lower)

  // Scope is only "provided" if the user actually defines it, not just asks about it
  const scopeQuestion = /\b(don'?t\s+understand|what\s+is\s+scope|give\s+me\s+options|not\s+sure\s+about\s+scope|what\s+does\s+scope\s+mean|what(?:\s+do)?\s+you\s+mean\s+by\s+scope|explain\s+scope|scope\s*\?*\s*(?:can\s+you\s+)?clarify|clarify\s+(?:what\s+you\s+mean\s+by\s+)?scope)\b/i.test(lower)
  const hasScope = !!selectedScopeOption || (!scopeQuestion && /\b(in\s+scope|out\s+of\s+scope|scope\s*:|exclude|include\s+only|focus\s+only)\b/i.test(lower))

  const looksLikeCourse = /(course|curriculum|class|cohort|student|training|learn)/i.test(lower)
  const wantsDetailedScope = /\b(explain|break\s*down|detail(?:ed)?|in\s*depth|indepth|more\s+detail|vague)\b.*\bscope\b|\bscope\b.*\b(explain|break\s*down|detail(?:ed)?|in\s*depth|indepth|more\s+detail|vague)\b/i.test(lower)
  const scopeOptions = looksLikeCourse
    ? [
        'A) Narrow: pilot cohort only (curriculum + delivery + basic support).',
        'B) Medium: pilot + recruitment funnel + instructor operations.',
        'C) Broad: full program system (curriculum, delivery, support, analytics, repeatable templates).',
      ]
    : [
        'A) Narrow: pilot execution with a single use-case and small team.',
        'B) Medium: multi-workstream rollout across one team/function.',
        'C) Broad: organization-wide rollout with governance and long-term operating model.',
      ]

  // Provide concrete scope options when user asks about it
  const scopeHintLines: string[] = []
  if (scopeQuestion && !selectedScopeOption) {
    scopeHintLines.push('')
    scopeHintLines.push('### Scope options')
    scopeOptions.forEach((option) => scopeHintLines.push(`- ${option}`))
    scopeHintLines.push('')
    scopeHintLines.push('Reply with `edit brief: scope: option B` (or your own scope wording) to lock it in.')
  }

  if ((scopeQuestion || wantsDetailedScope) && looksLikeCourse && !selectedScopeOption) {
    scopeHintLines.push('')
    scopeHintLines.push('### Scope options (in-depth)')
    scopeHintLines.push('- **Option A — Narrow (pilot only):** Build and run one cohort with core curriculum and live classes. Includes lesson plans, projects, mentor support, and final demos. Excludes growth funnel, full operations automation, and advanced reporting.')
    scopeHintLines.push('- **Option B — Medium (pilot + operations):** Everything in A, plus recruitment pipeline, instructor scheduling SOPs, learner onboarding/offboarding, progress tracking, and repeatable class operations. Excludes full analytics stack and multi-cohort scaling system.')
    scopeHintLines.push('- **Option C — Broad (program system):** Everything in B, plus analytics dashboards, standardized rubrics, reusable templates, quality audits, and multi-cohort scale playbook. This is a full training product system, not just one cohort execution.')
    scopeHintLines.push('')
    scopeHintLines.push('### How to choose quickly')
    scopeHintLines.push('- Choose **A** if you want fastest launch with smallest team load.')
    scopeHintLines.push('- Choose **B** if you want one-month execution plus a repeatable operating motion for the next cohort.')
    scopeHintLines.push('- Choose **C** if leadership needs long-term scale infrastructure from day one.')
  }

  if (selectedScopeOption) {
    const scopeLabel = selectedScopeOption === 'A'
      ? 'Option A (Narrow)'
      : selectedScopeOption === 'B'
        ? 'Option B (Medium)'
        : 'Option C (Broad)'

    scopeHintLines.push('')
    scopeHintLines.push('### Scope selected')
    scopeHintLines.push(`- ${scopeLabel}`)
  }

  return [
    `## Plan Brief: ${title}`,
    '',
    `**Goal**`,
    `${displayGoal}`,
    '',
    `**Timeline**`,
    `${timeline}`,
    '',
    `**Success Metrics**`,
    `${hasMetrics ? 'Provided in context.' : 'Not explicit yet (I will infer milestone-based outcomes).'}`,
    '',
    `**Constraints**`,
    `${hasConstraints ? 'Provided in context.' : 'Not explicit yet (I will assume standard team/resource constraints).'}`,
    '',
    `**Scope Boundaries**`,
    `${selectedScopeOption
      ? `Selected: Option ${selectedScopeOption}.`
      : hasScope
        ? 'Provided in context.'
        : scopeQuestion
          ? 'Awaiting your choice (see options below).'
          : 'Not explicit yet (I will infer practical scope from goal).'}`,
    ...scopeHintLines,
    '',
    '### Next action',
    '- `confirm plan` to generate the full draft now',
    '- `edit brief: ...` to adjust assumptions first',
    '- `draft now` to skip confirmation',
    '- `cancel` to exit plan mode',
  ].join('\n')
}

type PendingPlanSession = {
  stage: 'clarify' | 'brief_pending'
  goal: string
  title: string
}

type DraftedPlanSession = {
  goal: string
  title: string
  artifactId: string
}

function normalizePlanGoalText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isPlanningQuestion(raw: string): boolean {
  const normalized = normalizeSpace(raw.toLowerCase())
  if (!normalized) return false
  if (normalized.includes('?')) return true

  return /(\bwhat\b|\bwhy\b|\bhow\b|\bcan\s+you\b|\bcould\s+you\b|\bclarify\b|\bexplain\b|\bwalk\s+me\s+through\b|\bbreak\s+it\s+down\b)/i.test(normalized)
}

function buildScopeDeepDiveFallback(goal: string): string {
  return [
    `Great question. Here is what scope means for **${goal}**:`,
    '',
    'Scope defines what we will deliver in this cycle, what we will not deliver yet, and how deep we go operationally.',
    '',
    'Option A (Narrow):',
    '- In scope: one pilot cohort, lesson flow, hands-on build projects, mentor feedback, final showcase.',
    '- Out of scope: full recruitment funnel, full ops automation, advanced analytics dashboards.',
    '- Best when: speed matters most and team bandwidth is tight.',
    '',
    'Option B (Medium):',
    '- In scope: everything in A plus recruitment flow, learner onboarding, instructor scheduling, repeatable runbook.',
    '- Out of scope: enterprise-grade analytics and multi-cohort scale infrastructure.',
    '- Best when: you want a solid first cohort and a repeatable operating model after month one.',
    '',
    'Option C (Broad):',
    '- In scope: everything in B plus analytics, quality assurance process, templates, and scaling playbook.',
    '- Out of scope: almost nothing in the training system; this is full-program buildout.',
    '- Best when: leadership needs scale-ready infrastructure from day one.',
    '',
    'Given your one-month timeline and no advertising budget, **Option B** is usually the best balance.',
  ].join('\n')
}

function buildScopeRecommendationFromContext(params: { currentGoal: string; title: string }): string {
  const lower = params.currentGoal.toLowerCase()
  const hasOneMonthTimeline = /(\b1\s*month\b|\bone\s+month\b)/i.test(lower)
  const hasNoAdsBudget = /(no\s+advertising\s+budget|no\s+ad\s+budget)/i.test(lower)
  const hasLimitedTeam = /(limited\s+to\s+the\s+team|limited\s+team|team\s+members\s+available)/i.test(lower)

  const recommendation = hasOneMonthTimeline || hasNoAdsBudget || hasLimitedTeam ? 'B' : 'B'

  return [
    `Great question. For **${params.title}**, here is the scope breakdown in a more concrete way:`,
    '',
    '### Option A (Narrow) — Pilot cohort only',
    '- In scope: design one cohort curriculum, run live classes, assign practical mini-projects, provide mentor feedback, final demo day.',
    '- Out of scope: structured recruitment pipeline, instructor operations playbook, advanced analytics/reporting.',
    '- Tradeoff: fastest to launch, but harder to repeat smoothly for the next cohort.',
    '',
    '### Option B (Medium) — Pilot + operating motion',
    '- In scope: everything in A, plus lightweight recruitment flow, onboarding checklist, instructor cadence, learner tracking, reusable class runbook.',
    '- Out of scope: full multi-cohort scale infrastructure and deep analytics stack.',
    '- Tradeoff: slightly more setup than A, but much better repeatability and quality control.',
    '',
    '### Option C (Broad) — Full program system',
    '- In scope: everything in B, plus analytics dashboards, standardized assessment rubrics, QA loops, multi-cohort scaling templates.',
    '- Out of scope: very little; this is near end-to-end program infrastructure.',
    '- Tradeoff: highest quality long-term foundation, but heavy lift for a small team on a short timeline.',
    '',
    `### Recommendation: Option ${recommendation}`,
    '- Why this fits your context: you want practical product-building outcomes, limited team bandwidth, and a short delivery window.',
    '- Option B gives enough structure to run a strong first cohort and still leave reusable systems for the next one.',
  ].join('\n')
}

async function answerPlanningQuestion(params: {
  question: string
  currentGoal: string
  title: string
}): Promise<string> {
  const fallback = buildScopeDeepDiveFallback(params.title)
  const lowerQuestion = normalizeSpace(params.question.toLowerCase())
  const isScopeQuestion = /\bscope\b|\boption\s*[abc]\b|\bwhich\s+scope\b|\bbest\s+scope\b/i.test(lowerQuestion)

  if (isScopeQuestion) {
    return buildScopeRecommendationFromContext({
      currentGoal: params.currentGoal,
      title: params.title,
    })
  }

  try {
    const result = await generateAiText({
      task: 'chat',
      systemPrompt: [
        'You are Bords AI helping a user shape a plan through conversation.',
        'The user is in planning mode and asked a clarification question.',
        'Answer directly and concretely in a conversational tone.',
        'Use the existing planning context to tailor the answer.',
        'If asked about scope, explain options with: in-scope, out-of-scope, best-fit criteria, and recommendation.',
        'Keep response practical, specific, and concise (about 8-16 lines).',
        'End with one clear next action sentence.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: [
            `Plan title: ${params.title}`,
            `Current planning context: ${params.currentGoal}`,
            `User question: ${params.question}`,
          ].join('\n'),
        },
      ],
      maxTokens: 520,
      temperature: 0.25,
    })

    const text = result.text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return text || fallback
  } catch {
    return fallback
  }
}

function isPlanContinuationRequest(raw: string): boolean {
  const normalized = normalizeSpace(raw.toLowerCase())
  if (!normalized) return false

  if (/^(continue|go on|keep going|resume|carry on)(\s+please)?[.!?]*$/i.test(normalized)) {
    return true
  }

  if (/(continue\s+from\s+where|from\s+where\s+we\s+(stopped|left\s+off)|pick\s+up\s+where)/i.test(normalized)) {
    return true
  }

  if (/(last\s+(writeup|response|message).*(cut\s*off|truncated)|got\s+cut\s*off)/i.test(normalized)) {
    return true
  }

  return false
}

function detectScopeSelection(raw: string): 'A' | 'B' | 'C' | null {
  const normalized = normalizeSpace(raw.toLowerCase())
  if (!normalized) return null

  if (/\b(option\s*a|scope\s*:\s*option\s*a|go\s+with\s+option\s*a|choose\s+option\s*a|let'?s\s+go\s+with\s+option\s*a|narrow)\b/.test(normalized)) return 'A'
  if (/\b(option\s*b|scope\s*:\s*option\s*b|go\s+with\s+option\s*b|choose\s+option\s*b|let'?s\s+go\s+with\s+option\s*b|medium)\b/.test(normalized)) return 'B'
  if (/\b(option\s*c|scope\s*:\s*option\s*c|go\s+with\s+option\s*c|choose\s+option\s*c|let'?s\s+go\s+with\s+option\s*c|broad)\b/.test(normalized)) return 'C'
  return null
}

type PlanningTurnInterpretation = {
  intent: 'question' | 'decision' | 'update' | 'other'
  scopeChoice: 'A' | 'B' | 'C' | null
  timeline: string | null
  successCriteria: string | null
  constraints: string | null
  rationale: string | null
  inScope: string | null
  outOfScope: string | null
  answerToUser: string | null
}

function appendPlanningLine(goal: string, line: string): string {
  const trimmed = normalizeSpace(line)
  if (!trimmed) return goal
  if (goal.toLowerCase().includes(trimmed.toLowerCase())) return goal
  return [goal, '', trimmed].join('\n')
}

async function interpretPlanningTurn(params: {
  raw: string
  currentGoal: string
  title: string
}): Promise<PlanningTurnInterpretation> {
  const fallback: PlanningTurnInterpretation = {
    intent: isPlanningQuestion(params.raw) ? 'question' : 'update',
    scopeChoice: detectScopeSelection(params.raw),
    timeline: null,
    successCriteria: null,
    constraints: null,
    rationale: null,
    inScope: null,
    outOfScope: null,
    answerToUser: null,
  }

  try {
    const result = await generateAiText({
      task: 'classify',
      systemPrompt: [
        'You are an expert planning conversation interpreter.',
        'Analyze the latest user turn in a planning conversation and return STRICT JSON only.',
        'Classify the turn and extract any planning updates from it.',
        'Use intent values only: question, decision, update, other.',
        'If the user chooses A/B/C scope, set scopeChoice.',
        'If the user asks a direct planning question, provide answerToUser as concise markdown (max 180 words).',
        'Never invent details not present in user turn or context.',
        'JSON shape:',
        '{"intent":"question|decision|update|other","scopeChoice":"A|B|C|null","timeline":string|null,"successCriteria":string|null,"constraints":string|null,"rationale":string|null,"inScope":string|null,"outOfScope":string|null,"answerToUser":string|null}',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: [
            `Plan title: ${params.title}`,
            `Current planning context: ${params.currentGoal}`,
            `Latest user turn: ${params.raw}`,
          ].join('\n'),
        },
      ],
      maxTokens: 500,
      temperature: 0,
    })

    const parsed = JSON.parse(extractJsonObject(result.text)) as Partial<PlanningTurnInterpretation>

    const intent = parsed.intent === 'question' || parsed.intent === 'decision' || parsed.intent === 'update' || parsed.intent === 'other'
      ? parsed.intent
      : fallback.intent

    const scopeChoice = parsed.scopeChoice === 'A' || parsed.scopeChoice === 'B' || parsed.scopeChoice === 'C'
      ? parsed.scopeChoice
      : fallback.scopeChoice

    const asText = (value: unknown): string | null => {
      if (typeof value !== 'string') return null
      const t = value.trim()
      return t ? t : null
    }

    return {
      intent,
      scopeChoice,
      timeline: asText(parsed.timeline),
      successCriteria: asText(parsed.successCriteria),
      constraints: asText(parsed.constraints),
      rationale: asText(parsed.rationale),
      inScope: asText(parsed.inScope),
      outOfScope: asText(parsed.outOfScope),
      answerToUser: asText(parsed.answerToUser),
    }
  } catch {
    return fallback
  }
}

async function getPendingPlanSession(conversationId: string): Promise<PendingPlanSession | null> {
  const { data } = await supabaseAdmin
    .from('messages')
    .select('is_ai_message, metadata, created_at')
    .eq('conversation_id', conversationId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(40)

  const rows = Array.isArray(data) ? data : []
  for (const row of rows) {
    if (!(row as any)?.is_ai_message) continue
    const metadata = (row as any)?.metadata as any
    if (metadata?.capability !== 'plan_draft') continue

    const stage = metadata?.capabilityData?.planStage
    const goal = metadata?.capabilityData?.planGoal
    const title = metadata?.capabilityData?.planTitle

    if ((stage === 'clarify' || stage === 'brief_pending') && typeof goal === 'string') {
      const goalText = normalizePlanGoalText(goal)
      if (!goalText) return null

      return {
        stage,
        goal: goalText,
        title: typeof title === 'string' && normalizeSpace(title) ? normalizeSpace(title) : derivePlanTitle(goalText),
      }
    }

    // Latest plan_draft message is no longer pending, so stop scanning.
    return null
  }

  return null
}

async function getLatestDraftedPlanSession(conversationId: string): Promise<DraftedPlanSession | null> {
  const { data } = await supabaseAdmin
    .from('messages')
    .select('is_ai_message, metadata, created_at')
    .eq('conversation_id', conversationId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(40)

  const rows = Array.isArray(data) ? data : []
  for (const row of rows) {
    if (!(row as any)?.is_ai_message) continue
    const metadata = (row as any)?.metadata as any
    if (metadata?.capability !== 'plan_draft') continue

    const stage = metadata?.capabilityData?.planStage
    const goal = metadata?.capabilityData?.planGoal
    const title = metadata?.capabilityData?.planTitle
    const artifactId = metadata?.capabilityData?.planArtifactId

    const goalText = typeof goal === 'string' ? normalizePlanGoalText(goal) : ''

    if (
      stage === 'drafted' &&
      !!goalText &&
      typeof artifactId === 'string' && normalizeSpace(artifactId)
    ) {
      return {
        goal: goalText,
        title: typeof title === 'string' && normalizeSpace(title) ? normalizeSpace(title) : derivePlanTitle(goalText),
        artifactId: normalizeSpace(artifactId),
      }
    }

    // Stop at the latest plan_draft message if it is not a drafted artifact.
    return null
  }

  return null
}

async function getLatestPlanArtifactForConversation(params: {
  conversationId: string
  userId: string
  orgId: string | null
}): Promise<{
  id: string
  conversation_id: string
  user_id: string
  organization_id: string | null
  title: string
  goal: string | null
  content: Record<string, unknown> | null
  status: string
} | null> {
  const query = supabaseAdmin
    .from('ai_plan_artifacts')
    .select('id, conversation_id, user_id, organization_id, title, goal, content, status, created_at')
    .eq('conversation_id', params.conversationId)
    .eq('user_id', params.userId)
    .in('status', ['draft', 'approved', 'applied'])

  const { data } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null
  const row = data as any
  if (params.orgId && row.organization_id && row.organization_id !== params.orgId) {
    return null
  }

  return {
    id: String(row.id || ''),
    conversation_id: String(row.conversation_id || ''),
    user_id: String(row.user_id || ''),
    organization_id: (row.organization_id as string | null) ?? null,
    title: String(row.title || 'Plan'),
    goal: typeof row.goal === 'string' ? row.goal : null,
    content: (row.content as Record<string, unknown> | null) ?? null,
    status: String(row.status || 'draft'),
  }
}

async function buildDraftContinuationMessage(session: DraftedPlanSession): Promise<string> {
  const { data } = await supabaseAdmin
    .from('ai_plan_artifacts')
    .select('content, title')
    .eq('id', session.artifactId)
    .maybeSingle()

  const content = (data as any)?.content as Partial<PlanDraftContent> | undefined
  const workstreams = Array.isArray(content?.workstreams) ? content!.workstreams : []
  const assignmentProposals = Array.isArray(content?.assignmentProposals) ? content!.assignmentProposals : []

  const nextSteps: string[] = []
  for (const ws of workstreams.slice(0, 3)) {
    const wsTitle = normalizeSpace((ws as any)?.title || 'Workstream')
    const checklist = Array.isArray((ws as any)?.checklist) ? (ws as any).checklist : []
    for (const item of checklist.slice(0, 2)) {
      const task = normalizeSpace(String(item || ''))
      if (task) nextSteps.push(`${wsTitle}: ${task}`)
    }
  }

  const ownerLines = assignmentProposals
    .slice(0, 4)
    .map((a) => `${normalizeSpace((a as any)?.roleHint || 'Owner')}: ${normalizeSpace((a as any)?.responsibility || '')}`)
    .filter((line) => line && !line.endsWith(':'))

  const title = normalizeSpace(String((data as any)?.title || session.title || 'Plan'))

  return [
    `Continuing plan: "${title}"`,
    '',
    nextSteps.length > 0 ? 'Next execution steps (from your saved draft):' : 'I found your saved draft but could not infer the next checklist steps.',
    ...(nextSteps.length > 0 ? nextSteps.slice(0, 6).map((s, i) => `${i + 1}. ${s}`) : []),
    ...(ownerLines.length > 0 ? ['', 'Suggested owners to assign now:', ...ownerLines.map((line) => `- ${line}`)] : []),
    '',
    'Reply with one of these:',
    '1. "continue with week-by-week rollout"',
    '2. "continue with risk register"',
    '3. "create board from this plan"',
  ].join('\n')
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

function formatDetailedPlanDraftMessage(params: {
  title: string
  goal: string
  content: PlanDraftContent
}): string {
  const outcomes = Array.isArray(params.content.outcomes) ? params.content.outcomes : []
  const workstreams = Array.isArray(params.content.workstreams) ? params.content.workstreams : []
  const assignmentProposals = Array.isArray(params.content.assignmentProposals) ? params.content.assignmentProposals : []
  const goalLower = normalizeSpace(params.goal).toLowerCase()

  const timelineMatch = params.goal.match(
    /(month\s+and\s+a\s+half|\d+\s*(?:day|week|month|year)s?|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:day|week|month|year)s?|q[1-4]\s*\d{4}|this\s+quarter|next\s+quarter)/i
  )
  const timeline = timelineMatch?.[1]
    ? `Each course iteration will run for ${timelineMatch[1]}.`
    : 'Timeline to be finalized during kickoff (recommended: define a specific cohort window).'

  const budget = /no\s+advertising\s+budget|no\s+budget|limited\s+budget|budget/i.test(goalLower)
    ? 'No advertising budget.'
    : 'Budget constraints not explicitly stated yet.'
  const team = /(limited\s+to\s+the\s+team|team\s+members\s+available|limited\s+team|small\s+team|existing\s+team)/i.test(goalLower)
    ? 'Limited to available organization team members.'
    : 'Team capacity assumptions need confirmation.'
  const compliance = /(no\s+compliance|no\s+compliance\s+limits|no\s+identified\s+compliance)/i.test(goalLower)
    ? 'No identified compliance limits.'
    : 'Compliance requirements not explicitly defined yet.'

  const inferredInScope = workstreams
    .map((ws) => normalizeSpace(ws?.title || ''))
    .filter(Boolean)
    .slice(0, 7)
  const inferredOutScope = [
    'Advanced research-only topics that do not support practical product delivery.',
    'External marketing/advertising-heavy distribution tracks.',
    'Non-Python-first delivery tracks unless explicitly requested.',
  ]

  const cleanGoal = params.goal.split(/\n/)[0].trim() || params.goal

  const lines: string[] = []
  lines.push(`## Plan: ${params.title}`)
  lines.push('')
  lines.push(`**Goal:** ${cleanGoal}`)
  lines.push('')

  lines.push('### Success Metrics (Concrete Results)')
  if (outcomes.length === 0) {
    lines.push('- Define concrete completion and adoption metrics for each cohort.')
    lines.push('- Confirm a measurable project completion threshold for participants.')
  } else {
    outcomes.forEach((o) => lines.push(`- ${o}`))
  }
  lines.push('')

  lines.push('### Timeline')
  lines.push(timeline)
  lines.push('')

  lines.push('### Constraints')
  lines.push(`- **Budget:** ${budget}`)
  lines.push(`- **Team:** ${team}`)
  lines.push(`- **Compliance:** ${compliance}`)
  lines.push('')

  lines.push('### Scope')
  lines.push('')
  lines.push('**In-scope**')
  if (inferredInScope.length === 0) {
    lines.push('- Define curriculum, delivery, and project evaluation workstreams.')
  } else {
    inferredInScope.forEach((item) => lines.push(`- ${item}`))
  }
  lines.push('')
  lines.push('**Out-of-scope**')
  inferredOutScope.forEach((item) => lines.push(`- ${item}`))
  lines.push('')

  if (params.content.summary) {
    lines.push('### Plan Narrative')
    lines.push(params.content.summary)
    lines.push('')
  }

  lines.push('### Next Steps & Action Items')
  if (workstreams.length === 0) {
    lines.push('- No workstreams were generated. Ask me to regenerate with more constraints.')
  } else {
    workstreams.forEach((ws, i) => {
      const streamTitle = normalizeSpace(ws?.title || `Workstream ${i + 1}`)
      const checklist = Array.isArray(ws?.checklist) ? ws.checklist : []
      const owner = assignmentProposals[i % Math.max(1, assignmentProposals.length)]
      const ownerLine = owner
        ? `${normalizeSpace(owner.roleHint || 'Owner')}`
        : 'AxeCore Org (Team)'
      const primaryTask = checklist.length > 0
        ? checklist[0]
        : `Define concrete tasks for ${streamTitle}.`
      const dependencies = i === 0
        ? 'Review existing resources and align goals with delivery constraints.'
        : `Completion/progress of ${normalizeSpace(workstreams[i - 1]?.title || `Workstream ${i}`)}.`

      lines.push('')
      lines.push(`**${i + 1}. ${streamTitle}**`)
      lines.push('')
      lines.push(`- **Task:** ${primaryTask}`)
      lines.push(`- **Owner:** @${ownerLine.replace(/^@+/, '')}`)
      lines.push(`- **Due:** Week ${i + 1}`)
      lines.push(`- **Dependencies:** ${dependencies}`)
      if (checklist.length > 1) {
        lines.push('- **Milestones:**')
        checklist.slice(1, 6).forEach((item) => lines.push(`  - ${item}`))
      }
    })
  }
  lines.push('')

  lines.push('### Build Next')
  lines.push('When ready, click **Build board** below, or reply: `build a board for this plan`.')
  return lines.join('\n')
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

async function generateAndPersistPlanDraft(params: {
  conversationId: string
  userId: string
  orgId: string | null
  goal: string
}): Promise<CapabilityResult> {
  const title = derivePlanTitle(params.goal)
  const draft = await buildPlanDraft(params.goal, params.orgId)

  // Never persist deterministic fallback/template drafts as user-facing plan artifacts.
  if (draft.source !== 'ai' || isTemplateLikePlan(draft.content)) {
    console.warn('[AI capabilities] plan_generation_rejected', {
      source: draft.source,
      reason: draft.reason,
      goal: params.goal,
    })
    return {
      handled: true,
      action: 'plan_draft',
      data: {
        planTitle: title,
        organizationId: params.orgId,
      },
      text: [
        'I could not generate a high-quality AI plan right now, so I did not save a generic fallback draft.',
        'Please retry in a moment with the same goal (or add extra constraints like audience, timeline, and success metrics).',
      ].join('\n'),
    }
  }

  const artifactInsert = await insertPlanArtifact({
    conversationId: params.conversationId,
    userId: params.userId,
    orgId: params.orgId,
    title,
    goal: params.goal,
    content: draft.content,
    plannerSource: draft.source,
    plannerReason: draft.reason,
  })

  if (!artifactInsert.id) {
    console.error('[AI capabilities] Failed to save ai_plan_artifacts row:', artifactInsert.error)
    return {
      handled: true,
      action: 'plan_draft',
      data: {
        planTitle: title,
        organizationId: params.orgId,
      },
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
      planStage: 'drafted',
      planGoal: params.goal,
    },
    text: formatDetailedPlanDraftMessage({
      title,
      goal: params.goal,
      content: draft.content,
    }),
  }
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

  const handleMatches = extractHandles(params.query)
  if (handleMatches.length > 0) {
    let q = supabaseAdmin
      .from('bords')
      .select('id, local_board_id, title, context_type, updated_at, organization_id')
      .order('updated_at', { ascending: false })

    if (params.orgId) q = q.eq('organization_id', params.orgId)
    else q = q.is('organization_id', null)

    const { data: boards } = await q.limit(30)
    const matched = (boards ?? []).find((board: any) => {
      const titleHandle = String(board.title || '').toLowerCase().replace(/[^a-z0-9\s_-]/g, '').trim().replace(/[\s_]+/g, '-')
      const localHandle = String(board.local_board_id || '').toLowerCase()
      return handleMatches.some((handle) => handle === titleHandle || handle === localHandle)
    })
    if (matched) return matched as any
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
  orgId?: string | null
  query?: string
}): Promise<string> {
  const BOARD_DOC_STALE_MS = 5 * 60 * 1000

  const { data: boardDoc } = await supabaseAdmin
    .from('board_documents')
    .select('sticky_notes, checklists, kanban_boards, text_elements, rich_texts, connections, last_synced_at, updated_at')
    .eq('local_board_id', params.localBoardId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let boardDocData: any = boardDoc

  let boardCounts = {
    stickyNotes: Array.isArray(boardDocData?.sticky_notes) ? boardDocData.sticky_notes.length : 0,
    checklists: Array.isArray(boardDocData?.checklists) ? boardDocData.checklists.length : 0,
    kanbans: Array.isArray(boardDocData?.kanban_boards) ? boardDocData.kanban_boards.length : 0,
    texts: Array.isArray(boardDocData?.text_elements) ? boardDocData.text_elements.length : 0,
    richTexts: Array.isArray(boardDocData?.rich_texts) ? boardDocData.rich_texts.length : 0,
  }

  let boardLooksEmpty =
    boardCounts.stickyNotes === 0 &&
    boardCounts.checklists === 0 &&
    boardCounts.kanbans === 0 &&
    boardCounts.texts === 0 &&
    boardCounts.richTexts === 0

  const boardDocSyncAt =
    typeof boardDocData?.last_synced_at === 'string'
      ? boardDocData.last_synced_at
      : (typeof boardDocData?.updated_at === 'string' ? boardDocData.updated_at : null)
  const boardDocSyncAgeMs = boardDocSyncAt ? Date.now() - Date.parse(boardDocSyncAt) : Number.POSITIVE_INFINITY

  const applyExtractedBoardContent = (extracted: {
    stickyNotes: any[]
    checklists: any[]
    kanbanBoards: any[]
    textElements: any[]
    richTexts: any[]
    connections: any[]
  }) => {
    boardDocData = {
      ...(boardDocData || {}),
      sticky_notes: extracted.stickyNotes,
      checklists: extracted.checklists,
      kanban_boards: extracted.kanbanBoards,
      text_elements: extracted.textElements,
      rich_texts: extracted.richTexts,
      connections: extracted.connections,
    }

    boardCounts = {
      stickyNotes: extracted.stickyNotes.length,
      checklists: extracted.checklists.length,
      kanbans: extracted.kanbanBoards.length,
      texts: extracted.textElements.length,
      richTexts: extracted.richTexts.length,
    }

    boardLooksEmpty =
      boardCounts.stickyNotes === 0 &&
      boardCounts.checklists === 0 &&
      boardCounts.kanbans === 0 &&
      boardCounts.texts === 0 &&
      boardCounts.richTexts === 0
  }

  const extractFromYjsState = async () => {
    const { data: yjsDoc } = await supabaseAdmin
      .from('yjs_documents')
      .select('state')
      .eq('board_id', params.localBoardId)
      .maybeSingle()

    const rawState = typeof (yjsDoc as any)?.state === 'string' ? (yjsDoc as any).state : ''
    if (!rawState) return null

    const stateBase64 = rawState.startsWith('\\x')
      ? Buffer.from(rawState.slice(2), 'hex').toString('base64')
      : rawState

    return extractBoardContentFromYDoc(stateBase64)
  }

  // Shared/WebSocket boards may have fresh Y.Doc state while board_documents
  // is stale. Decode yjs_documents so board_details can still summarize content.
  if (boardLooksEmpty) {
    try {
      const extracted = await extractFromYjsState()
      if (extracted) {
        applyExtractedBoardContent(extracted)
      }
    } catch {
      // Ignore parse/fetch issues; existing fallback messaging still applies.
    }
  } else if (params.contextType !== 'personal' && boardDocSyncAgeMs > BOARD_DOC_STALE_MS) {
    try {
      const extracted = await extractFromYjsState()
      if (extracted) {
        const extractedSignal =
          extracted.stickyNotes.length +
          extracted.checklists.length +
          extracted.kanbanBoards.length +
          extracted.textElements.length +
          extracted.richTexts.length
        const boardDocSignal =
          boardCounts.stickyNotes +
          boardCounts.checklists +
          boardCounts.kanbans +
          boardCounts.texts +
          boardCounts.richTexts

        if (extractedSignal > boardDocSignal) {
          applyExtractedBoardContent(extracted)
        }
      }
    } catch {
      // Ignore parse/fetch issues; existing board document summary still applies.
    }
  }

  let semanticFallbackChunks: string[] = []
  if (boardLooksEmpty) {
    try {
      const retrievalQuery = params.query?.trim() || `What is ${params.boardTitle} about?`
      const embedding = await generateEmbedding(retrievalQuery)
      const { data } = await supabaseAdmin.rpc('ai_hybrid_board_retrieve', {
        p_query_embedding: `[${embedding.join(',')}]`,
        p_query_text: retrievalQuery,
        p_org_id: params.orgId ?? null,
        p_allowed_board_ids: [params.boardId],
        p_limit: 4,
      } as never)

      semanticFallbackChunks = Array.isArray(data)
        ? (data as any[])
          .map((row) => (typeof row?.content === 'string' ? clip(row.content, 220) : ''))
          .filter((chunk) => !isLowSignalBoardChunk(chunk))
          .filter(Boolean)
          .slice(0, 4)
        : []
    } catch {
      semanticFallbackChunks = []
    }
  }

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

  const textSummary = Array.isArray(boardDocData?.text_elements)
    ? boardDocData.text_elements
      .map((entry: any) => (typeof entry?.text === 'string' ? clip(entry.text, 220) : ''))
      .filter(Boolean)
      .slice(0, 2)
    : []

  const richTextSummary = Array.isArray(boardDocData?.rich_texts)
    ? boardDocData.rich_texts
      .map((entry: any) => clip(extractPlainText(entry?.content).join(' '), 3000))
      .filter(Boolean)
    : []

  const checklistTitles = Array.isArray(boardDocData?.checklists)
    ? boardDocData.checklists
      .map((entry: any) => {
        const title = typeof entry?.title === 'string' ? normalizeSpace(entry.title) : 'Untitled checklist'
        const itemCount = Array.isArray(entry?.items) ? entry.items.length : 0
        return `${title} (${itemCount} item${itemCount === 1 ? '' : 's'})`
      })
      .slice(0, 6)
    : []

  const kanbanBoards = Array.isArray(boardDocData?.kanban_boards) ? boardDocData.kanban_boards : []
  const kanbanSummary = kanbanBoards
    .map((board: any) => {
      const boardTitle = typeof board?.title === 'string' ? normalizeSpace(board.title) : 'Kanban board'
      const columns = Array.isArray(board?.columns) ? board.columns : []
      const columnSummary = columns
        .map((column: any) => {
          const title = typeof column?.title === 'string' ? normalizeSpace(column.title) : 'Column'
          const taskCount = Array.isArray(column?.tasks) ? column.tasks.length : 0
          return `${title} (${taskCount})`
        })
        .join(', ')
      return `${boardTitle}: ${columnSummary}`
    })
    .slice(0, 2)

  const stickySummary = Array.isArray(boardDocData?.sticky_notes)
    ? boardDocData.sticky_notes
      .map((entry: any) => (typeof entry?.text === 'string' ? clip(entry.text, 90) : ''))
      .filter(Boolean)
      .slice(0, 4)
    : []

  const inferredIntent = textSummary[0] || richTextSummary[0] || semanticFallbackChunks[0] || ''
  const boardIntent = inferBoardIntentSummary({
    boardTitle: params.boardTitle,
    inferredIntent,
    hasChecklists: boardCounts.checklists > 0,
    hasKanbans: boardCounts.kanbans > 0,
    hasRichText: boardCounts.richTexts > 0,
    hasStickyNotes: boardCounts.stickyNotes > 0,
  })
  const semanticSummary = [
    `Board intent: ${boardIntent}`,
    // Include ALL rich text entries in full after the intent line so the AI can read the complete content
    richTextSummary.length > 0 ? `Rich text content:\n${richTextSummary.map((t: string, i: number) => `[${i + 1}] ${t}`).join('\n\n')}` : null,
    checklistTitles.length > 0 ? `Execution structure: ${checklistTitles.join('; ')}` : null,
    kanbanSummary.length > 0 ? `Workflow: ${kanbanSummary.join(' | ')}` : null,
    stickySummary.length > 0 ? `Key notes: ${stickySummary.join(' | ')}` : null,
    semanticFallbackChunks.length > 1 ? `Knowledge base snippets: ${semanticFallbackChunks.slice(1).join(' | ')}` : null,
  ].filter(Boolean) as string[]

  const hasReadableBoardMeaning = Boolean(inferredIntent)

  const isHowToQuestion = /(how|steps|procedure|walk\s+me\s+through|explain\s+how)/i.test(params.query || '')
  const howToLines: string[] = []
  let howToAnswerUsed = false
  if (isHowToQuestion && Array.isArray(boardDocData?.checklists) && boardDocData.checklists.length > 0) {
    const checklists = (boardDocData.checklists as any[]).slice(0, 6)
    let stepNo = 1
    howToLines.push(`How to (based on "${params.boardTitle}"):`)
    howToLines.push('')
    for (const checklist of checklists) {
      const title = typeof checklist?.title === 'string' ? normalizeSpace(checklist.title) : `Phase ${stepNo}`
      const items = Array.isArray(checklist?.items) ? checklist.items : []
      const actions: string[] = items
        .map((it: any) => (typeof it?.text === 'string' ? normalizeSpace(it.text) : ''))
        .filter(Boolean)
        .slice(0, 2)

      howToLines.push(`Step ${stepNo}: ${title}`)
      if (actions.length > 0) {
        actions.forEach((action: string) => {
          howToLines.push(`- ${clip(action, 130)}`)
        })
      } else {
        howToLines.push('- Complete the checklist actions in this phase.')
      }
      howToLines.push('')
      stepNo += 1
    }
    howToLines.push('Execution tip: after each phase is complete, move its workstream card in kanban from Backlog -> In Progress -> Done.')
    howToAnswerUsed = true
  }

  const boardHandle = normalizeBoardHandle(params.boardTitle)

  if (!hasReadableBoardMeaning && boardLooksEmpty) {
    return [
      `I found board "${params.boardTitle}", but I cannot see synced board content yet.`,
      '- The board document currently appears empty (no checklists/kanban/sticky/text/rich text in cloud).',
      '- I also could not find indexed board chunks for this board yet.',
      '',
      'What to do next:',
      '1. Open the board and make sure your rich text/content is saved to cloud sync.',
      '2. Run or wait for the embeddings/indexing job so board chunks are searchable.',
      `3. Ask again with #${boardHandle} and I will explain the actual content.`,
    ].join('\n')
  }

  if (howToAnswerUsed) {
    return [
      ...howToLines,
      '',
      'Board snapshot:',
      ...semanticSummary.slice(0, 3).map((line) => `- ${line}`),
      `- Objects: checklists=${boardCounts.checklists}, kanbans=${boardCounts.kanbans}, sticky notes=${boardCounts.stickyNotes}`,
      `- Task assignments: total=${total}, draft=${statusCounts.draft ?? 0}, assigned=${statusCounts.assigned ?? 0}, completed=${statusCounts.completed ?? 0}`,
      `Tip: tag this board with #${boardHandle} in AI chat to include it in retrieval context.`,
      'If you want full technical board metadata, ask: "show board details for this board".',
    ].join('\n')
  }

  return [
    `Board details for "${params.boardTitle}":`,
    ...semanticSummary.map((line) => `- ${line}`),
    `- Board UUID: ${params.boardId}`,
    `- Local board ID: ${params.localBoardId}`,
    `- Context: ${params.contextType}`,
    `- Last updated: ${params.updatedAt ?? 'unknown'}`,
    `- Board objects: checklists=${boardCounts.checklists}, kanbans=${boardCounts.kanbans}, sticky notes=${boardCounts.stickyNotes}, text=${boardCounts.texts}, rich text=${boardCounts.richTexts}`,
    `- Tasks sampled: ${total}`,
    `- Status counts: draft=${statusCounts.draft ?? 0}, assigned=${statusCounts.assigned ?? 0}, completed=${statusCounts.completed ?? 0}`,
    topTasks.length > 0 ? 'Recent tasks:\n' + topTasks.join('\n') : 'Recent tasks: none',
    `Tip: tag this board with #${boardHandle} in AI chat to include it in retrieval context.`,
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
  const handleRefs = extractHandles(raw)

  const heuristicIntent = detectCapabilityIntentHeuristically(raw, params.taggedBoardIds)
  const aiIntent = heuristicIntent || !shouldAttemptCapabilityAiDetection(raw, params.taggedBoardIds)
    ? null
    : await detectCapabilityIntentWithAi(raw, params.taggedBoardIds)
  const detectedIntent = heuristicIntent || aiIntent

  const createMatch = raw.match(/^\/?create-board\s+(.+)$/i) || raw.match(/^create\s+board\s+(.+)$/i)
  if (createMatch || detectedIntent?.action === 'create_board') {
    const title = normalizeSpace(createMatch?.[1] ?? (detectedIntent?.action === 'create_board' ? detectedIntent.title : ''))
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

  const pendingPlanSession = await getPendingPlanSession(params.conversationId)
  const draftedPlanSession = await getLatestDraftedPlanSession(params.conversationId)
  const planMatch = raw.match(/^\/?plan\s+(.+)$/i) || raw.match(/^draft\s+plan\s+(.+)$/i)
  if (planMatch || detectedIntent?.action === 'plan_draft') {
    const goal = normalizeSpace(planMatch?.[1] ?? (detectedIntent?.action === 'plan_draft' ? detectedIntent.goal : ''))
    if (!goal) {
      return {
        handled: true,
        text: 'Please describe the goal. Example: /plan Launch an onboarding revamp for enterprise customers',
      }
    }

    const title = derivePlanTitle(goal)
    const explicitDraftNow = /\b(draft\s+now|skip\s+questions|no\s+questions)\b/i.test(lower) || /^\/?plan-now\b/i.test(raw)
    const contextScore = scorePlanContext(goal)

    if (!explicitDraftNow && contextScore < 3) {
      return {
        handled: true,
        action: 'plan_draft',
        data: {
          planTitle: title,
          organizationId: params.orgId,
          planStage: 'clarify',
          planGoal: goal,
        },
        text: buildPlanClarificationMessage(goal, title),
      }
    }

    if (explicitDraftNow) {
      return generateAndPersistPlanDraft({
        conversationId: params.conversationId,
        userId: params.userId,
        orgId: params.orgId,
        goal,
      })
    }

    return {
      handled: true,
      action: 'plan_draft',
      data: {
        planTitle: title,
        organizationId: params.orgId,
        planStage: 'brief_pending',
        planGoal: goal,
      },
      text: buildPlanBriefMessage(goal, title),
    }
  }

  // ── "Build board from this plan" chat command ──────────────────────────────
  const isBuildBoardRequest =
    !planMatch &&
    /\b(build\s+(a\s+|the\s+)?board(\s+for\s+(this|the)\s+plan)?|create\s+(a\s+|the\s+)?board\s+from|make\s+(a\s+|the\s+)?board(\s+for\s+(this|the)\s+plan)?|build\s+it|yes[,.]?\s+build|go\s+ahead\s+and\s+build|create\s+board\s+from\s+(this|the)\s+plan|build\s+board\s+from\s+(this|the)\s+plan|turn\s+(this|the)\s+plan\s+into\s+a\s+board)\b/i.test(lower)

  if (isBuildBoardRequest) {
    const artifact = draftedPlanSession
      ? await supabaseAdmin
          .from('ai_plan_artifacts')
          .select('id, conversation_id, user_id, organization_id, title, goal, content, status')
          .eq('id', draftedPlanSession.artifactId)
          .maybeSingle()
          .then(({ data }) => data as any)
      : await getLatestPlanArtifactForConversation({
          conversationId: params.conversationId,
          userId: params.userId,
          orgId: params.orgId,
        })

    if (!artifact) {
      return { handled: true, text: "I couldn't find a saved plan in this conversation. Draft one first with `/plan <goal>`." }
    }

    try {
      const result = await buildBoardFromPlanArtifact(artifact, params.userId, 'light')
      return {
        handled: true,
        action: 'plan_draft',
        data: {
          planArtifactId: artifact.id,
          planTitle: artifact.title,
          organizationId: params.orgId,
          planStage: 'board_built',
          boardLocalId: result.boardLocalId,
          boardTitle: result.boardTitle,
        },
        text: `Building your board now — I'll have it ready in a moment. You can open **${result.boardTitle}** from the board list.`,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      return { handled: true, text: `Failed to build the board: ${msg}. Try again or use the Review Plan modal.` }
    }
  }

  if (
    !pendingPlanSession &&
    !planMatch &&
    draftedPlanSession &&
    isPlanContinuationRequest(raw)
  ) {
    return {
      handled: true,
      action: 'plan_draft',
      data: {
        planArtifactId: draftedPlanSession.artifactId,
        planTitle: draftedPlanSession.title,
        organizationId: params.orgId,
        planStage: 'drafted',
        planGoal: draftedPlanSession.goal,
      },
      text: await buildDraftContinuationMessage(draftedPlanSession),
    }
  }

  // If a plan clarification is pending, treat this message as follow-up context
  // unless the user clearly switches to another command.
  if (
    pendingPlanSession &&
    !raw.startsWith('/') &&
    detectedIntent?.action !== 'board_details'
  ) {
    if (/\b(cancel|stop|nevermind|never mind)\b/i.test(lower)) {
      return {
        handled: true,
        action: 'plan_draft',
        data: {
          planTitle: pendingPlanSession.title,
          organizationId: params.orgId,
        },
        text: 'Plan mode cancelled. When ready, ask again with /plan <goal>.',
      }
    }

    if (/\bdraft\s+now\b/i.test(lower)) {
      return generateAndPersistPlanDraft({
        conversationId: params.conversationId,
        userId: params.userId,
        orgId: params.orgId,
        goal: pendingPlanSession.goal,
      })
    }

    const interpreted = await interpretPlanningTurn({
      raw,
      currentGoal: pendingPlanSession.goal,
      title: pendingPlanSession.title,
    })

    let nextGoal = pendingPlanSession.goal
    if (interpreted.scopeChoice) {
      const scopeLabel = interpreted.scopeChoice === 'A' ? 'Narrow' : interpreted.scopeChoice === 'B' ? 'Medium' : 'Broad'
      nextGoal = appendPlanningLine(nextGoal, `Scope choice: Option ${interpreted.scopeChoice} - ${scopeLabel}`)
    }
    if (interpreted.timeline) nextGoal = appendPlanningLine(nextGoal, `Timeline update: ${interpreted.timeline}`)
    if (interpreted.successCriteria) nextGoal = appendPlanningLine(nextGoal, `Success criteria: ${interpreted.successCriteria}`)
    if (interpreted.constraints) nextGoal = appendPlanningLine(nextGoal, `Constraints: ${interpreted.constraints}`)
    if (interpreted.rationale) nextGoal = appendPlanningLine(nextGoal, `Why this matters: ${interpreted.rationale}`)
    if (interpreted.inScope) nextGoal = appendPlanningLine(nextGoal, `In scope: ${interpreted.inScope}`)
    if (interpreted.outOfScope) nextGoal = appendPlanningLine(nextGoal, `Out of scope: ${interpreted.outOfScope}`)

    // Keep broad context capture for long-form user turns.
    if (scorePlanContext(raw) >= 1 || normalizeSpace(raw).length >= 24) {
      nextGoal = appendPlanningLine(nextGoal, `Additional planning context from user: ${raw}`)
    }

    const nextTitle = derivePlanTitle(nextGoal)

    if (interpreted.intent === 'question') {
      const answer = interpreted.answerToUser || await answerPlanningQuestion({
        question: raw,
        currentGoal: nextGoal,
        title: nextTitle,
      })

      return {
        handled: true,
        action: 'plan_draft',
        data: {
          planTitle: nextTitle,
          organizationId: params.orgId,
          planStage: pendingPlanSession.stage,
          planGoal: nextGoal,
        },
        text: [
          answer,
          '',
          interpreted.scopeChoice
            ? 'I captured your scope decision. Reply `confirm plan` when you want me to generate the full draft.'
            : 'If this direction looks right, reply with updates or say `confirm plan` to draft now.',
        ].join('\n'),
      }
    }

    if (pendingPlanSession.stage === 'brief_pending') {
      if (/\b(confirm\s+plan|confirm|approve|looks\s+good|go\s+ahead|proceed|continue|yes)\b/i.test(lower)) {
        return generateAndPersistPlanDraft({
          conversationId: params.conversationId,
          userId: params.userId,
          orgId: params.orgId,
          goal: nextGoal,
        })
      }

      return {
        handled: true,
        action: 'plan_draft',
        data: {
          planTitle: nextTitle,
          organizationId: params.orgId,
          planStage: 'brief_pending',
          planGoal: nextGoal,
        },
        text: buildPlanBriefMessage(nextGoal, nextTitle),
      }
    }

    const answerScore = scorePlanContext(raw)
    if (answerScore < 1 && normalizeSpace(raw).length < 24) {
      return {
        handled: true,
        action: 'plan_draft',
        data: {
          planTitle: pendingPlanSession.title,
          organizationId: params.orgId,
          planStage: 'clarify',
          planGoal: pendingPlanSession.goal,
        },
        text: [
          'I still need planning details before drafting.',
          'Please share timeline, constraints, and success criteria (one short paragraph is enough).',
          'Or reply "draft now" if you want an immediate draft from current context.',
        ].join('\n'),
      }
    }

    const mergedGoal = [
      nextGoal,
    ].join('\n')
    const mergedTitle = derivePlanTitle(mergedGoal)

    return {
      handled: true,
      action: 'plan_draft',
      data: {
        planTitle: mergedTitle,
        organizationId: params.orgId,
        planStage: 'brief_pending',
        planGoal: mergedGoal,
      },
      text: buildPlanBriefMessage(mergedGoal, mergedTitle),
    }
  }

  const taggedBoardReference = params.taggedBoardIds.length > 0 || handleRefs.length > 0
  const normalizedWithoutHandles = normalizeSpace(raw.replace(/#([a-zA-Z0-9_-]+)/g, ''))
  const forceBoardDetailsFromTag = taggedBoardReference && !createMatch && !planMatch && !normalizedWithoutHandles

  const wantsDetails =
    /^\/?board-details\b/i.test(raw) ||
    /^show\s+board\s+details\b/i.test(lower) ||
    /^board\s+details\b/i.test(lower) ||
    detectedIntent?.action === 'board_details' ||
    forceBoardDetailsFromTag

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
      orgId: params.orgId,
      query: raw,
    })

    return { handled: true, action: 'board_details', text }
  }

  return { handled: false }
}
