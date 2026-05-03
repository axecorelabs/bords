import { randomUUID } from 'crypto'
import { generateAiText } from '@/lib/ai/gateway'

// ── AI Scene-graph types ──────────────────────────────────────────────────────

type SceneSection = 'overview' | 'outcomes' | 'execution' | 'status' | 'assignments' | 'reference' | 'risks' | 'metrics'

type SceneItemType = 'sticky' | 'text' | 'checklist' | 'kanban' | 'richtext' | 'table'

export type AiSceneItem = {
  id: string
  type: SceneItemType
  section: SceneSection
  label: string
  // Content varies by type:
  body?: string               // sticky, text, richtext
  items?: string[]            // checklist tasks
  columns?: string[]          // table column headers
  rows?: string[][]           // table row values (parallel to columns)
  kanbans?: string[]          // kanban column titles (tasks auto-derived from checklist streams)
  color?: string              // optional hint
}

export type AiSceneConnection = {
  fromId: string
  toId: string
  color?: string
}

export type AiScene = {
  items: AiSceneItem[]
  connections: AiSceneConnection[]
}

// ── Scene-graph generation ────────────────────────────────────────────────────

function extractJsonObject(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return '{}'
  return text.slice(start, end + 1)
}

const VALID_SECTIONS: SceneSection[] = ['overview', 'outcomes', 'execution', 'status', 'assignments', 'reference', 'risks', 'metrics']
const VALID_TYPES: SceneItemType[] = ['sticky', 'text', 'checklist', 'kanban', 'richtext', 'table']

function sanitizeSceneItem(raw: unknown, usedIds: Set<string>): AiSceneItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const type = VALID_TYPES.includes(r.type as SceneItemType) ? (r.type as SceneItemType) : null
  const section = VALID_SECTIONS.includes(r.section as SceneSection) ? (r.section as SceneSection) : 'reference'
  const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 120) : null
  if (!type || !label) return null

  const rawId = typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 32) : `item-${randomUUID().slice(0, 8)}`
  const id = usedIds.has(rawId) ? `${rawId}-${randomUUID().slice(0, 6)}` : rawId
  usedIds.add(id)

  const body = typeof r.body === 'string' ? r.body.slice(0, 1200) : undefined
  const items = Array.isArray(r.items)
    ? (r.items as unknown[]).filter((i): i is string => typeof i === 'string' && i.trim().length > 0).slice(0, 20).map(i => i.slice(0, 180))
    : undefined
  const columns = Array.isArray(r.columns)
    ? (r.columns as unknown[]).filter((c): c is string => typeof c === 'string').slice(0, 8).map(c => c.slice(0, 60))
    : undefined
  const rows = Array.isArray(r.rows)
    ? (r.rows as unknown[]).slice(0, 20).map(row =>
        (Array.isArray(row) ? row : []).slice(0, 8).map(cell => typeof cell === 'string' ? cell.slice(0, 120) : '')
      )
    : undefined
  const kanbans = Array.isArray(r.kanbans)
    ? (r.kanbans as unknown[]).filter((k): k is string => typeof k === 'string').slice(0, 6)
    : undefined
  const color = typeof r.color === 'string' ? r.color.slice(0, 40) : undefined

  return { id, type, section, label, body, items, columns, rows, kanbans, color }
}

function sanitizeScene(raw: unknown): AiScene | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.items) || r.items.length < 2) return null

  const usedIds = new Set<string>()
  const items: AiSceneItem[] = []
  for (const rawItem of r.items) {
    const item = sanitizeSceneItem(rawItem, usedIds)
    if (item) items.push(item)
  }

  if (items.length < 2) return null

  const idSet = new Set(items.map(i => i.id))
  const connections: AiSceneConnection[] = Array.isArray(r.connections)
    ? (r.connections as unknown[]).flatMap((c): AiSceneConnection[] => {
        if (!c || typeof c !== 'object') return []
        const conn = c as Record<string, unknown>
        const fromId = typeof conn.fromId === 'string' ? conn.fromId : null
        const toId = typeof conn.toId === 'string' ? conn.toId : null
        if (!fromId || !toId || !idSet.has(fromId) || !idSet.has(toId) || fromId === toId) return []
        const color = typeof conn.color === 'string' ? conn.color : undefined
        return [{ fromId, toId, color }]
      })
    : []

  return { items, connections }
}

const AI_SCENE_SYSTEM = `You are a visual whiteboard information architect.
Given a plan, design a high-quality, non-generic digital whiteboard scene.
Choose the right tools: sticky notes for quick ideas/insights, checklists for action steps, tables for structured data, rich text for narrative playbook, kanban for workflow tracking.
Use connection lines to express real logical dependencies or flow — not every item needs to be connected.
Think carefully about the domain — a training course has different anatomy than a product launch or an ops plan.
Return STRICT JSON only, no markdown.`

function buildAiScenePrompt(params: {
  title: string
  goal: string
  content: PlanArtifactContent
}): string {
  const ws = Array.isArray(params.content.workstreams) ? params.content.workstreams : []
  const outcomes = Array.isArray(params.content.outcomes) ? params.content.outcomes : []
  const proposals = Array.isArray(params.content.assignmentProposals) ? params.content.assignmentProposals : []
  const stickyHints = Array.isArray(params.content.stickyNotes) ? params.content.stickyNotes : []

  return [
    `Plan title: ${params.title}`,
    `Goal: ${params.goal}`,
    `Summary: ${params.content.summary || ''}`,
    `Outcomes (${outcomes.length}):`,
    outcomes.slice(0, 6).map(o => `  - ${o}`).join('\n'),
    '',
    `Workstreams (${ws.length}):`,
    ws.slice(0, 6).map(w => `  ${w.title || 'Untitled'}: ${(w.checklist || []).slice(0, 3).join(', ')}`).join('\n'),
    '',
    proposals.length > 0 ? `Suggested owners: ${proposals.slice(0, 4).map(p => `${p.roleHint} → ${p.responsibility}`).join('; ')}` : '',
    stickyHints.length > 0 ? `Sticky note hints: ${stickyHints.slice(0, 4).map(s => s.text).join('; ')}` : '',
    '',
    'Design a custom whiteboard board for this specific plan. Output JSON with this exact shape:',
    '{',
    '  "items": [',
    '    {',
    '      "id": string,                // unique short id',
    '      "type": "sticky"|"text"|"checklist"|"kanban"|"richtext"|"table",',
    '      "section": "overview"|"outcomes"|"execution"|"status"|"assignments"|"reference"|"risks"|"metrics",',
    '      "label": string,             // heading/title for the item',
    '      "body": string,              // for sticky/text/richtext: the full text content',
    '      "items": string[],           // for checklist: the task strings',
    '      "columns": string[],         // for table: column headers',
    '      "rows": string[][],          // for table: 2D array of cell values (same length as columns)',
    '      "kanbans": string[],         // for kanban: column titles',
    '      "color": string              // optional: color name or hex',
    '    }',
    '  ],',
    '  "connections": [',
    '    { "fromId": string, "toId": string, "color": string }',
    '  ]',
    '}',
    'Rules:',
    '- Minimum 6 items, maximum 18.',
    '- Include at least one richtext with a meaningful playbook or overview narrative.',
    '- Every workstream should become a checklist item with real tasks (use the data above).',
    '- connections must reference valid ids from the items array.',
    '- Table rows must be same length as columns array.',
    '- Make every item content-rich and specific to this plan — no placeholders.',
  ].filter(Boolean).join('\n')
}

export async function generateAiScene(params: {
  title: string
  goal: string
  content: PlanArtifactContent
}): Promise<AiScene | null> {
  try {
    const result = await generateAiText({
      task: 'taskify',
      systemPrompt: AI_SCENE_SYSTEM,
      messages: [{ role: 'user', content: buildAiScenePrompt(params) }],
      maxTokens: 3200,
      temperature: 0.35,
    })

    const parsed = JSON.parse(extractJsonObject(result.text))
    const scene = sanitizeScene(parsed)
    if (!scene || scene.items.length < 2) return null
    return scene
  } catch {
    return null
  }
}

// ── Auto-layout engine ────────────────────────────────────────────────────────

type SectionRegion = { x: number; y: number; cols: number; colWidth: number; rowHeight: number; gap: number }

const SECTION_REGIONS: Record<SceneSection, SectionRegion> = {
  overview:     { x: 60,   y: 24,   cols: 1, colWidth: 720, rowHeight: 80,  gap: 20 },
  outcomes:     { x: 60,   y: 160,  cols: 3, colWidth: 240, rowHeight: 140, gap: 18 },
  assignments:  { x: 1100, y: 160,  cols: 2, colWidth: 250, rowHeight: 160, gap: 18 },
  execution:    { x: 60,   y: 520,  cols: 3, colWidth: 340, rowHeight: 360, gap: 30 },
  status:       { x: 60,   y: 960,  cols: 1, colWidth: 960, rowHeight: 420, gap: 24 },
  reference:    { x: 1100, y: 520,  cols: 1, colWidth: 460, rowHeight: 420, gap: 24 },
  risks:        { x: 60,   y: 1460, cols: 3, colWidth: 260, rowHeight: 140, gap: 18 },
  metrics:      { x: 1100, y: 960,  cols: 1, colWidth: 460, rowHeight: 280, gap: 18 },
}

// Default item sizes by type
const ITEM_SIZE: Record<SceneItemType, { w: number; h: number }> = {
  sticky:    { w: 220, h: 140 },
  text:      { w: 620, h: 80  },
  checklist: { w: 320, h: 360 },
  kanban:    { w: 940, h: 420 },
  richtext:  { w: 440, h: 400 },
  table:     { w: 700, h: 280 },
}

function estimateItemSize(item: AiSceneItem, region: SectionRegion): { w: number; h: number } {
  const base = ITEM_SIZE[item.type]
  if (item.type === 'checklist') {
    const count = Array.isArray(item.items) ? item.items.length : 0
    return {
      w: Math.max(base.w, region.colWidth),
      h: Math.max(base.h, 170 + count * 34),
    }
  }

  if (item.type === 'table') {
    const count = Array.isArray(item.rows) ? item.rows.length : 0
    return {
      w: Math.max(base.w, region.colWidth),
      h: Math.max(base.h, 170 + count * 34),
    }
  }

  if (item.type === 'richtext') {
    const textLength = (item.body || '').length
    const extra = Math.min(220, Math.floor(textLength / 7))
    return {
      w: Math.max(base.w, region.colWidth),
      h: Math.max(base.h, base.h + extra),
    }
  }

  return { w: Math.max(base.w, region.colWidth), h: base.h }
}

function intersects(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  gap: number,
): boolean {
  return !(
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  )
}

function assignPositions(items: AiSceneItem[]): Map<string, { x: number; y: number; w: number; h: number }> {
  const sectionOrder: SceneSection[] = ['overview', 'outcomes', 'assignments', 'execution', 'status', 'metrics', 'reference', 'risks']
  const sectionPriority = new Map(sectionOrder.map((section, index) => [section, index]))
  const sortedItems = [...items].sort((a, b) => {
    const pa = sectionPriority.get(a.section) ?? 99
    const pb = sectionPriority.get(b.section) ?? 99
    if (pa !== pb) return pa - pb
    return a.id.localeCompare(b.id)
  })

  const sectionCounters = new Map<SceneSection, number>()
  const positions = new Map<string, { x: number; y: number; w: number; h: number }>()
  const placed: Array<{ x: number; y: number; w: number; h: number }> = []
  const collisionGap = 24

  for (const item of sortedItems) {
    const region = SECTION_REGIONS[item.section] ?? SECTION_REGIONS.reference
    const count = sectionCounters.get(item.section) ?? 0
    const { w, h } = estimateItemSize(item, region)

    const col = count % region.cols
    const row = Math.floor(count / region.cols)

    const x = region.x + col * (region.colWidth + region.gap)
    let y = region.y + row * (region.rowHeight + region.gap)

    // Shift down until there is no overlap with any already-placed item.
    let tries = 0
    while (tries < 240) {
      const candidate = { x, y, w, h }
      const overlap = placed.some(rect => intersects(candidate, rect, collisionGap))
      if (!overlap) {
        placed.push(candidate)
        positions.set(item.id, candidate)
        break
      }
      y += 28
      tries += 1
    }

    if (!positions.has(item.id)) {
      const fallback = { x, y, w, h }
      placed.push(fallback)
      positions.set(item.id, fallback)
    }

    sectionCounters.set(item.section, count + 1)
  }

  return positions
}

// ── Scene → BoardPayload renderer ────────────────────────────────────────────

const NOTE_COLORS = ['yellow', 'blue', 'green', 'pink', 'purple', 'orange']

function buildRichTextDoc(label: string, body: string, outcomes: string[]): Record<string, unknown> {
  const text = body && body.trim() ? body : ''
  const paragraphs = text.split(/\n+/).filter(Boolean)
  const docNodes: unknown[] = [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: label }] },
    ...paragraphs.map(p => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })),
  ]
  if (outcomes.length > 0 && !text.toLowerCase().includes('outcome')) {
    docNodes.push({
      type: 'heading', attrs: { level: 2 },
      content: [{ type: 'text', text: 'Expected Outcomes' }],
    })
    docNodes.push({
      type: 'bulletList',
      content: outcomes.map(o => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: o }] }],
      })),
    })
  }
  return { type: 'doc', content: docNodes }
}

function renderSceneToBoard(
  scene: AiScene,
  boardTitle: string,
  boardId: string,
  theme: 'dark' | 'light',
  planContent: PlanArtifactContent,
): BoardPayload {
  const positions = assignPositions(scene.items)

  const stickyNotes: Array<Record<string, unknown>> = []
  const checklists: Array<Record<string, unknown>> = []
  const textElements: Array<Record<string, unknown>> = []
  const kanbanBoards: Array<Record<string, unknown>> = []
  const richTexts: Array<Record<string, unknown>> = []
  const tables: Array<Record<string, unknown>> = []
  const drawings: Array<Record<string, unknown>> = []
  const connections: Array<Record<string, unknown>> = []

  const zEntries: Array<{ itemId: string; zIndex: number }> = []
  let zCounter = 1

  const outcomes = Array.isArray(planContent.outcomes) ? planContent.outcomes : []

  for (const item of scene.items) {
    const pos = positions.get(item.id) ?? { x: 60, y: 60, w: 300, h: 200 }

    if (item.type === 'sticky') {
      const colorIndex = scene.items.filter(i => i.type === 'sticky').indexOf(item)
      const noteColor = item.color || NOTE_COLORS[colorIndex % NOTE_COLORS.length]
      stickyNotes.push({
        id: item.id,
        text: item.body || item.label,
        position: { x: pos.x, y: pos.y },
        color: noteColor,
        width: pos.w,
        height: pos.h,
      })
      zEntries.push({ itemId: item.id, zIndex: zCounter++ })
    }

    else if (item.type === 'text') {
      textElements.push({
        id: item.id,
        text: item.body || item.label,
        position: { x: pos.x, y: pos.y },
        fontSize: item.section === 'overview' ? 22 : 16,
        color: theme === 'dark' ? '#f1f5f9' : '#0f172a',
        width: pos.w,
      })
      zEntries.push({ itemId: item.id, zIndex: zCounter++ })
    }

    else if (item.type === 'checklist') {
      checklists.push({
        id: item.id,
        title: item.label,
        items: (item.items || []).map(text => ({
          id: makeId('ci'),
          text,
          completed: false,
          timeSpent: 0,
          isTracking: false,
        })),
        position: { x: pos.x, y: pos.y },
        color: 'white',
        createdAt: new Date().toISOString(),
        width: pos.w,
        height: pos.h,
      })
      zEntries.push({ itemId: item.id, zIndex: zCounter++ })
    }

    else if (item.type === 'kanban') {
      const columnTitles = item.kanbans?.length ? item.kanbans : ['Backlog', 'In Progress', 'Review', 'Done']
      // Seed cards from workstreams
      const workstreams = Array.isArray(planContent.workstreams) ? planContent.workstreams : []
      const seeds = workstreams.slice(0, 6).map(ws => ({
        id: makeId('kt'),
        title: ws.title || 'Task',
        description: Array.isArray(ws.checklist) ? `${ws.checklist.length} tasks` : '',
        priority: 'medium',
        completed: false,
      }))
      kanbanBoards.push({
        id: item.id,
        title: item.label,
        columns: columnTitles.map((title, i) => ({
          id: makeId('kc'),
          title,
          tasks: i === 0 ? seeds : [],
        })),
        position: { x: pos.x, y: pos.y },
        color: 'bg-blue-100/90',
        width: pos.w,
        height: pos.h,
      })
      zEntries.push({ itemId: item.id, zIndex: zCounter++ })
    }

    else if (item.type === 'richtext') {
      richTexts.push({
        id: item.id,
        title: item.label,
        content: buildRichTextDoc(item.label, item.body || '', item.section === 'reference' ? outcomes : []),
        position: { x: pos.x, y: pos.y },
        width: pos.w,
        height: pos.h,
        color: '#ffffff',
      })
      zEntries.push({ itemId: item.id, zIndex: zCounter++ })
    }

    else if (item.type === 'table') {
      const cols = item.columns || ['Item', 'Details', 'Owner']
      const rows = (item.rows || []).map(row =>
        cols.map((_, ci) => ({ value: row[ci] || '' }))
      )
      // If no rows provided, add placeholder row
      const finalRows = rows.length > 0 ? rows : [cols.map(() => ({ value: 'TBD' }))]
      tables.push({
        id: item.id,
        title: item.label,
        position: { x: pos.x, y: pos.y },
        width: pos.w,
        height: pos.h,
        color: theme === 'dark' ? '#111827' : '#ffffff',
        columns: cols,
        rows: finalRows,
      })
      zEntries.push({ itemId: item.id, zIndex: zCounter++ })
    }
  }

  // Render connections (validated against real item ids)
  const allRenderedIds = new Set([
    ...stickyNotes.map(n => String(n.id)),
    ...checklists.map(c => String(c.id)),
    ...textElements.map(t => String(t.id)),
    ...kanbanBoards.map(k => String(k.id)),
    ...richTexts.map(r => String(r.id)),
    ...tables.map(t => String(t.id)),
  ])

  const typeOf = new Map<string, string>()
  stickyNotes.forEach(n => typeOf.set(String(n.id), 'note'))
  checklists.forEach(c => typeOf.set(String(c.id), 'checklist'))
  textElements.forEach(t => typeOf.set(String(t.id), 'text'))
  kanbanBoards.forEach(k => typeOf.set(String(k.id), 'kanban'))
  richTexts.forEach(r => typeOf.set(String(r.id), 'richText'))
  tables.forEach(t => typeOf.set(String(t.id), 'table'))

  for (const conn of scene.connections) {
    if (!allRenderedIds.has(conn.fromId) || !allRenderedIds.has(conn.toId)) continue
    const fromPos = positions.get(conn.fromId) ?? { x: 0, y: 0, w: 0, h: 0 }
    const toPos = positions.get(conn.toId) ?? { x: 0, y: 0, w: 0, h: 0 }
    connections.push({
      id: makeId('conn'),
      fromId: conn.fromId,
      toId: conn.toId,
      fromType: typeOf.get(conn.fromId) || 'note',
      toType: typeOf.get(conn.toId) || 'note',
      fromPosition: { x: fromPos.x + Math.round(fromPos.w / 2), y: fromPos.y + Math.round(fromPos.h / 2) },
      toPosition: { x: toPos.x + Math.round(toPos.w / 2), y: toPos.y + Math.round(toPos.h / 2) },
      color: conn.color || 'rgba(99, 102, 241, 0.55)',
      boardId,
    })
  }

  const itemIds = {
    notes: stickyNotes.map(n => String(n.id)),
    checklists: checklists.map(c => String(c.id)),
    texts: textElements.map(t => String(t.id)),
    connections: connections.map(c => String(c.id)),
    drawings: drawings.map(d => String(d.id)),
    kanbans: kanbanBoards.map(k => String(k.id)),
    medias: [],
    reminders: [],
    tables: tables.map(t => String(t.id)),
    richTexts: richTexts.map(r => String(r.id)),
  }

  return {
    stickyNotes,
    checklists,
    textElements,
    kanbanBoards,
    connections,
    drawings,
    mediaItems: [],
    reminders: [],
    tables,
    richTexts,
    itemIds,
    zIndexData: { counter: zCounter, entries: zEntries },
  }
}

export async function materializePlanWithAiScene(
  content: PlanArtifactContent,
  boardTitle: string,
  boardId: string,
  options: { theme: 'dark' | 'light'; goal: string },
): Promise<{ board: BoardPayload; source: 'ai_scene' | 'blueprint' }> {
  const scene = await generateAiScene({ title: boardTitle, goal: options.goal, content })
  if (scene && scene.items.length >= 3) {
    return {
      board: renderSceneToBoard(scene, boardTitle, boardId, options.theme, content),
      source: 'ai_scene',
    }
  }
  // Fallback
  return {
    board: materializePlanToBoardContent(content, boardTitle, boardId, { theme: options.theme }),
    source: 'blueprint',
  }
}

export type PlanArtifactContent = {
  summary?: string
  outcomes?: string[]
  workstreams?: Array<{ title?: string; checklist?: string[] }>
  stickyNotes?: Array<{ lane?: string; text?: string }>
  shapeHints?: Array<{ type?: string; label?: string }>
  assignmentProposals?: Array<{ roleHint?: string; responsibility?: string; confidence?: number }>
  materializedBoard?: {
    localBoardId: string
    title: string
    createdAt: string
  }
}

export type PlanMaterializationBlueprint = {
  layout: 'flow' | 'timeline' | 'matrix'
  primaryTool: 'checklists' | 'kanban' | 'tables'
  outcomePresentation: 'sticky' | 'table'
  includeKanban: boolean
  includeConnections: boolean
  includeAssignmentNotes: boolean
  includeTimelineDrawing: boolean
  richTextFocus: 'summary' | 'playbook'
}

type MaterializeOptions = {
  theme?: 'dark' | 'light'
  blueprint?: PlanMaterializationBlueprint
}

type BoardPayload = {
  stickyNotes: Array<Record<string, unknown>>
  checklists: Array<Record<string, unknown>>
  textElements: Array<Record<string, unknown>>
  kanbanBoards: Array<Record<string, unknown>>
  connections: Array<Record<string, unknown>>
  drawings: Array<Record<string, unknown>>
  mediaItems: Array<Record<string, unknown>>
  reminders: Array<Record<string, unknown>>
  tables: Array<Record<string, unknown>>
  richTexts: Array<Record<string, unknown>>
  itemIds: Record<string, string[]>
  zIndexData: { counter: number; entries: Array<{ itemId: string; zIndex: number }> }
}

function makeId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`
}

function normalizeTitle(input: string): string {
  const cleaned = input.trim().replace(/\s+/g, ' ')
  return cleaned.length > 90 ? `${cleaned.slice(0, 90).trim()}...` : cleaned
}

export function deriveBoardTitleFromPlanTitle(planTitle: string): string {
  const t = normalizeTitle(planTitle)
  return t.toLowerCase().includes('plan') ? t : `${t} Plan`
}

function toLowerBlob(content: PlanArtifactContent): string {
  const bits: string[] = []
  if (content.summary) bits.push(content.summary)
  if (Array.isArray(content.outcomes)) bits.push(content.outcomes.join(' '))
  if (Array.isArray(content.workstreams)) {
    for (const ws of content.workstreams) {
      if (ws?.title) bits.push(ws.title)
      if (Array.isArray(ws?.checklist)) bits.push(ws.checklist.join(' '))
    }
  }
  return bits.join(' ').toLowerCase()
}

export function inferPlanMaterializationBlueprint(content: PlanArtifactContent): PlanMaterializationBlueprint {
  const blob = toLowerBlob(content)
  const checklistCount = Array.isArray(content.workstreams)
    ? content.workstreams.reduce((acc, ws) => acc + (Array.isArray(ws?.checklist) ? ws.checklist.length : 0), 0)
    : 0
  const outcomeCount = Array.isArray(content.outcomes) ? content.outcomes.length : 0

  const hasTimelineSignals = /(timeline|milestone|phase|roadmap|week|month|quarter|q1|q2|q3|q4)/i.test(blob)
  const hasOpsSignals = /(metric|kpi|target|budget|risk|dependency|compliance|owner)/i.test(blob)

  if (hasTimelineSignals) {
    return {
      layout: 'timeline',
      primaryTool: 'checklists',
      outcomePresentation: outcomeCount >= 5 ? 'table' : 'sticky',
      includeKanban: checklistCount >= 6,
      includeConnections: true,
      includeAssignmentNotes: true,
      includeTimelineDrawing: true,
      richTextFocus: 'playbook',
    }
  }

  if (hasOpsSignals) {
    return {
      layout: 'matrix',
      primaryTool: 'tables',
      outcomePresentation: 'table',
      includeKanban: checklistCount >= 8,
      includeConnections: true,
      includeAssignmentNotes: true,
      includeTimelineDrawing: false,
      richTextFocus: 'summary',
    }
  }

  return {
    layout: 'flow',
    primaryTool: checklistCount >= 5 ? 'checklists' : 'kanban',
    outcomePresentation: outcomeCount >= 6 ? 'table' : 'sticky',
    includeKanban: true,
    includeConnections: true,
    includeAssignmentNotes: true,
    includeTimelineDrawing: false,
    richTextFocus: 'summary',
  }
}

function sanitizeBlueprint(blueprint: Partial<PlanMaterializationBlueprint> | undefined, fallback: PlanMaterializationBlueprint): PlanMaterializationBlueprint {
  if (!blueprint) return fallback

  return {
    layout: blueprint.layout === 'timeline' || blueprint.layout === 'matrix' || blueprint.layout === 'flow'
      ? blueprint.layout
      : fallback.layout,
    primaryTool: blueprint.primaryTool === 'checklists' || blueprint.primaryTool === 'kanban' || blueprint.primaryTool === 'tables'
      ? blueprint.primaryTool
      : fallback.primaryTool,
    outcomePresentation: blueprint.outcomePresentation === 'table' || blueprint.outcomePresentation === 'sticky'
      ? blueprint.outcomePresentation
      : fallback.outcomePresentation,
    includeKanban: typeof blueprint.includeKanban === 'boolean' ? blueprint.includeKanban : fallback.includeKanban,
    includeConnections: typeof blueprint.includeConnections === 'boolean' ? blueprint.includeConnections : fallback.includeConnections,
    includeAssignmentNotes: typeof blueprint.includeAssignmentNotes === 'boolean' ? blueprint.includeAssignmentNotes : fallback.includeAssignmentNotes,
    includeTimelineDrawing: typeof blueprint.includeTimelineDrawing === 'boolean' ? blueprint.includeTimelineDrawing : fallback.includeTimelineDrawing,
    richTextFocus: blueprint.richTextFocus === 'playbook' || blueprint.richTextFocus === 'summary'
      ? blueprint.richTextFocus
      : fallback.richTextFocus,
  }
}

function buildTiptapDoc(title: string, summary: string, outcomes: string[]): Record<string, unknown> {
  const docNodes: unknown[] = [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: title }],
    },
    { type: 'paragraph', content: [{ type: 'text', text: summary || '' }] },
  ]
  if (outcomes.length > 0) {
    docNodes.push({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Expected Outcomes' }],
    })
    docNodes.push({
      type: 'bulletList',
      content: outcomes.map((o) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: o }] }],
      })),
    })
  }
  return { type: 'doc', content: docNodes }
}

export function materializePlanToBoardContent(
  content: PlanArtifactContent,
  boardTitle: string,
  boardId: string,
  options?: MaterializeOptions,
): BoardPayload {
  const inferredBlueprint = inferPlanMaterializationBlueprint(content)
  const blueprint = sanitizeBlueprint(options?.blueprint, inferredBlueprint)

  const stickyNotes: Array<Record<string, unknown>> = []
  const checklists: Array<Record<string, unknown>> = []
  const textElements: Array<Record<string, unknown>> = []
  const kanbanBoards: Array<Record<string, unknown>> = []
  const connections: Array<Record<string, unknown>> = []
  const drawings: Array<Record<string, unknown>> = []
  const tables: Array<Record<string, unknown>> = []
  const richTexts: Array<Record<string, unknown>> = []

  const zEntries: Array<{ itemId: string; zIndex: number }> = []
  let zCounter = 1

  const outcomeNoteWidth = 220
  const outcomeNoteHeight = 120
  const assignmentNoteWidth = 210
  const assignmentNoteHeight = 150
  const checklistWidth = 320
  const checklistHeight = 340
  const checklistGapX = 36
  const checklistGapY = 34
  const kanbanWidth = 920
  const kanbanHeight = 400
  const richTextWidth = 420
  const richTextHeight = 400

  const summaryId = makeId('text')
  const summaryColor = options?.theme === 'dark' ? '#f8fafc' : '#111827'
  const summaryPos = { x: 500, y: 32 }
  const summaryText = content.summary || `Execution board for ${boardTitle}`
  textElements.push({
    id: summaryId,
    text: summaryText,
    position: summaryPos,
    fontSize: 20,
    color: summaryColor,
    width: 720,
  })
  zEntries.push({ itemId: summaryId, zIndex: zCounter++ })

  const outcomes = Array.isArray(content.outcomes) ? content.outcomes : []
  const assignmentProposals = Array.isArray(content.assignmentProposals) ? content.assignmentProposals : []
  const outcomeCols = 3
  const assignmentCols = 2
  const outcomesOrigin = { x: 120, y: 180 }
  const assignmentsOrigin = { x: 1060, y: 180 }

  if (blueprint.outcomePresentation === 'table' && outcomes.length > 0) {
    const tableId = makeId('table')
    tables.push({
      id: tableId,
      title: 'Outcomes and Success Criteria',
      position: { x: outcomesOrigin.x, y: outcomesOrigin.y },
      width: 660,
      height: 300,
      color: options?.theme === 'dark' ? '#111827' : '#ffffff',
      columns: ['Outcome', 'Success signal', 'Owner'],
      rows: outcomes.slice(0, 10).map((outcome) => ([
        { value: outcome },
        { value: 'Measurable progress visible' },
        { value: 'TBD' },
      ])),
    })
    zEntries.push({ itemId: tableId, zIndex: zCounter++ })
    if (blueprint.includeConnections) {
      connections.push({
        id: makeId('conn'),
        fromId: summaryId,
        toId: tableId,
        fromType: 'text',
        toType: 'table',
        fromPosition: summaryPos,
        toPosition: { x: outcomesOrigin.x + 40, y: outcomesOrigin.y + 20 },
        color: 'rgba(59, 130, 246, 0.6)',
        boardId,
      })
    }
  } else {
    outcomes.slice(0, 8).forEach((outcome, index) => {
      const id = makeId('note')
      const notePos = {
        x: outcomesOrigin.x + (index % outcomeCols) * 230,
        y: outcomesOrigin.y + Math.floor(index / outcomeCols) * 150,
      }
      stickyNotes.push({
        id,
        text: outcome,
        position: notePos,
        color: index % 2 === 0 ? 'yellow' : 'blue',
        width: outcomeNoteWidth,
        height: outcomeNoteHeight,
      })
      zEntries.push({ itemId: id, zIndex: zCounter++ })
      if (blueprint.includeConnections) {
        connections.push({
          id: makeId('conn'),
          fromId: summaryId,
          toId: id,
          fromType: 'text',
          toType: 'note',
          fromPosition: summaryPos,
          toPosition: notePos,
          color: 'rgba(59, 130, 246, 0.6)',
          boardId,
        })
      }
    })
  }

  const workstreams = Array.isArray(content.workstreams) ? content.workstreams : []
  const checklistConnectors: Array<{ id: string; position: { x: number; y: number } }> = []
  const topSectionBottom = Math.max(
    outcomesOrigin.y + Math.max(0, Math.ceil(Math.max(outcomes.slice(0, 8).length, 1) / outcomeCols) - 1) * 150 + outcomeNoteHeight,
    assignmentsOrigin.y + Math.max(0, Math.ceil(Math.max(assignmentProposals.slice(0, 6).length, 1) / assignmentCols) - 1) * 170 + assignmentNoteHeight,
  )
  const checklistOrigin = { x: 120, y: topSectionBottom + 84 }

  // Detailed execution lives in per-workstream checklists.
  workstreams.slice(0, 6).forEach((stream, index) => {
    const checklistId = makeId('checklist')
    const items = Array.isArray(stream.checklist) ? stream.checklist : []
    const checklistPos = blueprint.layout === 'timeline'
      ? {
        x: checklistOrigin.x + index * (checklistWidth + 56),
        y: checklistOrigin.y + ((index % 2) * 18),
      }
      : {
        x: checklistOrigin.x + (index % 3) * (checklistWidth + checklistGapX),
        y: checklistOrigin.y + Math.floor(index / 3) * (checklistHeight + checklistGapY),
      }
    checklists.push({
      id: checklistId,
      title: stream.title || `Workstream ${index + 1}`,
      items: items.slice(0, 12).map((item) => ({
        id: makeId('item'),
        text: item,
        completed: false,
        timeSpent: 0,
        isTracking: false,
      })),
      position: checklistPos,
      color: 'white',
      createdAt: new Date().toISOString(),
      width: checklistWidth,
      height: checklistHeight,
    })
    checklistConnectors.push({ id: checklistId, position: checklistPos })
    zEntries.push({ itemId: checklistId, zIndex: zCounter++ })
  })

  const kanbanId = makeId('kanban')
  const checklistRows = Math.max(1, Math.ceil(Math.max(workstreams.slice(0, 6).length, 1) / 3))
  const checklistBottom = checklistOrigin.y + (checklistRows - 1) * (checklistHeight + checklistGapY) + checklistHeight
  const kanbanPos = { x: 120, y: checklistBottom + 110 }
  const workstreamCards = workstreams.slice(0, 6).map((stream, idx) => {
    const checklist = Array.isArray(stream.checklist) ? stream.checklist : []
    const title = stream.title || `Workstream ${idx + 1}`
    return {
      id: makeId('task'),
      title,
      description: checklist.length > 0 ? `${checklist.length} checklist task${checklist.length === 1 ? '' : 's'}` : 'No checklist tasks yet',
      priority: 'medium',
      completed: false,
    }
  })

  const columns = [
    {
      id: makeId('col'),
      title: 'Backlog',
      tasks: workstreamCards,
    },
    {
      id: makeId('col'),
      title: 'In Progress',
      tasks: [],
    },
    {
      id: makeId('col'),
      title: 'Done',
      tasks: [],
    },
  ]

  if (workstreamCards.length > 0 && blueprint.includeKanban) {
    kanbanBoards.push({
      id: kanbanId,
      title: `${boardTitle} Workstream Status`,
      columns,
      position: kanbanPos,
      color: 'bg-blue-100/90',
      width: kanbanWidth,
      height: kanbanHeight,
    })
    zEntries.push({ itemId: kanbanId, zIndex: zCounter++ })

    checklistConnectors.forEach((checklist, index) => {
      const laneX = kanbanPos.x + 130 + (index % 3) * 250
      if (blueprint.includeConnections) {
        connections.push({
          id: makeId('conn'),
          fromId: checklist.id,
          toId: kanbanId,
          fromType: 'checklist',
          toType: 'kanban',
          fromPosition: { x: checklist.position.x + Math.round(checklistWidth / 2), y: checklist.position.y + checklistHeight },
          toPosition: { x: laneX, y: kanbanPos.y + 10 },
          color: 'rgba(16, 185, 129, 0.6)',
          boardId,
        })
      }
    })
  }

  // Rich text overview doc — placed beside kanban and connected to it.
  const richTextId = makeId('richtext')
  const tiptapContent = buildTiptapDoc(
    boardTitle,
    blueprint.richTextFocus === 'playbook'
      ? `Playbook for ${boardTitle}:\n\n${summaryText}`
      : summaryText,
    outcomes,
  )
  const richTextPos = blueprint.includeKanban
    ? { x: kanbanPos.x + kanbanWidth + 36, y: kanbanPos.y }
    : { x: checklistOrigin.x + 3 * (checklistWidth + 36), y: checklistOrigin.y }
  richTexts.push({
    id: richTextId,
    title: boardTitle,
    content: tiptapContent,
    position: richTextPos,
    width: richTextWidth,
    height: richTextHeight,
    color: '#ffffff',
  })
  zEntries.push({ itemId: richTextId, zIndex: zCounter++ })

  if (workstreamCards.length > 0 && blueprint.includeKanban && blueprint.includeConnections) {
    connections.push({
      id: makeId('conn'),
      fromId: kanbanId,
      toId: richTextId,
      fromType: 'kanban',
      toType: 'richText',
      fromPosition: { x: kanbanPos.x + kanbanWidth, y: kanbanPos.y + Math.round(kanbanHeight / 2) },
      toPosition: { x: richTextPos.x, y: richTextPos.y + Math.round(richTextHeight / 2) },
      color: 'rgba(99, 102, 241, 0.6)',
      boardId,
    })
  }

  if (blueprint.includeAssignmentNotes) {
    assignmentProposals.slice(0, 6).forEach((proposal, index) => {
      const id = makeId('note')
      const notePos = {
        x: assignmentsOrigin.x + (index % assignmentCols) * 230,
        y: assignmentsOrigin.y + Math.floor(index / assignmentCols) * 170,
      }
      stickyNotes.push({
        id,
        text: `Assignment proposal\nRole: ${proposal.roleHint || 'Unspecified'}\nResponsibility: ${proposal.responsibility || 'Unspecified'}\nConfidence: ${typeof proposal.confidence === 'number' ? `${Math.round(proposal.confidence * 100)}%` : 'n/a'}`,
        position: notePos,
        color: 'purple',
        width: assignmentNoteWidth,
        height: assignmentNoteHeight,
      })
      zEntries.push({ itemId: id, zIndex: zCounter++ })
    })
  }

  if (blueprint.layout === 'matrix' && workstreams.length > 0) {
    const matrixId = makeId('table')
    tables.push({
      id: matrixId,
      title: 'Workstream Matrix',
      position: { x: checklistOrigin.x, y: checklistOrigin.y + checklistHeight * 2 + 60 },
      width: 780,
      height: 280,
      color: options?.theme === 'dark' ? '#111827' : '#ffffff',
      columns: ['Workstream', 'Top tasks', 'Dependencies', 'Owner'],
      rows: workstreams.slice(0, 8).map((ws, i) => ([
        { value: ws.title || `Workstream ${i + 1}` },
        { value: Array.isArray(ws.checklist) ? ws.checklist.slice(0, 2).join('; ') : 'TBD' },
        { value: 'TBD' },
        { value: 'TBD' },
      ])),
    })
    zEntries.push({ itemId: matrixId, zIndex: zCounter++ })
  }

  if (blueprint.includeTimelineDrawing && checklistConnectors.length > 1) {
    const pathPoints = checklistConnectors.map((c) => ({
      x: c.position.x + Math.round(checklistWidth / 2),
      y: c.position.y - 24,
    }))
    const timelineDrawingId = makeId('drawing')
    drawings.push({
      id: timelineDrawingId,
      position: { x: 0, y: 0 },
      paths: [{
        id: makeId('path'),
        points: pathPoints,
        color: options?.theme === 'dark' ? '#60a5fa' : '#2563eb',
        strokeWidth: 4,
        timestamp: Date.now(),
      }],
    })
    zEntries.push({ itemId: timelineDrawingId, zIndex: zCounter++ })
  }

  const itemIds = {
    notes: stickyNotes.map((n) => String(n.id)),
    checklists: checklists.map((c) => String(c.id)),
    texts: textElements.map((t) => String(t.id)),
    connections: connections.map((c) => String(c.id)),
    drawings: drawings.map((d) => String(d.id)),
    kanbans: kanbanBoards.map((k) => String(k.id)),
    medias: [],
    reminders: [],
    tables: tables.map((t) => String(t.id)),
    richTexts: richTexts.map((r) => String(r.id)),
  }

  return {
    stickyNotes,
    checklists,
    textElements,
    kanbanBoards,
    connections,
    drawings,
    mediaItems: [],
    reminders: [],
    tables,
    richTexts,
    itemIds,
    zIndexData: {
      counter: zCounter,
      entries: zEntries,
    },
  }
}
