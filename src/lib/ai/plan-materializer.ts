import { randomUUID } from 'crypto'

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

type MaterializeOptions = {
  theme?: 'dark' | 'light'
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
  const stickyNotes: Array<Record<string, unknown>> = []
  const checklists: Array<Record<string, unknown>> = []
  const textElements: Array<Record<string, unknown>> = []
  const kanbanBoards: Array<Record<string, unknown>> = []
  const connections: Array<Record<string, unknown>> = []
  const richTexts: Array<Record<string, unknown>> = []

  const zEntries: Array<{ itemId: string; zIndex: number }> = []
  let zCounter = 1

  const outcomeNoteWidth = 210
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
  textElements.push({
    id: summaryId,
    text: content.summary || `Execution board for ${boardTitle}`,
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
  })

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
    const checklistPos = {
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

  if (workstreamCards.length > 0) {
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
    })
  }

  // Rich text overview doc — placed beside kanban and connected to it.
  const richTextId = makeId('richtext')
  const tiptapContent = buildTiptapDoc(
    boardTitle,
    content.summary || `Execution board for ${boardTitle}`,
    outcomes,
  )
  const richTextPos = { x: kanbanPos.x + kanbanWidth + 36, y: kanbanPos.y }
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

  if (workstreamCards.length > 0) {
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

  const itemIds = {
    notes: stickyNotes.map((n) => String(n.id)),
    checklists: checklists.map((c) => String(c.id)),
    texts: textElements.map((t) => String(t.id)),
    connections: connections.map((c) => String(c.id)),
    drawings: [],
    kanbans: kanbanBoards.map((k) => String(k.id)),
    medias: [],
    reminders: [],
    tables: [],
    richTexts: richTexts.map((r) => String(r.id)),
  }

  return {
    stickyNotes,
    checklists,
    textElements,
    kanbanBoards,
    connections,
    drawings: [],
    mediaItems: [],
    reminders: [],
    tables: [],
    richTexts,
    itemIds,
    zIndexData: {
      counter: zCounter,
      entries: zEntries,
    },
  }
}
