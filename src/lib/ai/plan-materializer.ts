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

export function materializePlanToBoardContent(content: PlanArtifactContent, boardTitle: string, boardId: string): BoardPayload {
  const stickyNotes: Array<Record<string, unknown>> = []
  const checklists: Array<Record<string, unknown>> = []
  const textElements: Array<Record<string, unknown>> = []
  const kanbanBoards: Array<Record<string, unknown>> = []
  const connections: Array<Record<string, unknown>> = []
  const richTexts: Array<Record<string, unknown>> = []

  const zEntries: Array<{ itemId: string; zIndex: number }> = []
  let zCounter = 1

  const summaryId = makeId('text')
  textElements.push({
    id: summaryId,
    text: content.summary || `Execution board for ${boardTitle}`,
    position: { x: 120, y: 80 },
    fontSize: 20,
    color: '#1f2937',
    width: 760,
  })
  zEntries.push({ itemId: summaryId, zIndex: zCounter++ })

  const outcomes = Array.isArray(content.outcomes) ? content.outcomes : []
  outcomes.slice(0, 8).forEach((outcome, index) => {
    const id = makeId('note')
    const notePos = { x: 120 + (index % 4) * 230, y: 170 + Math.floor(index / 4) * 150 }
    stickyNotes.push({
      id,
      text: outcome,
      position: notePos,
      color: index % 2 === 0 ? 'yellow' : 'blue',
      width: 210,
      height: 120,
    })
    zEntries.push({ itemId: id, zIndex: zCounter++ })
    connections.push({
      id: makeId('conn'),
      fromId: summaryId,
      toId: id,
      fromType: 'text',
      toType: 'note',
      fromPosition: { x: 120, y: 80 },
      toPosition: notePos,
      color: 'rgba(59, 130, 246, 0.6)',
      boardId,
    })
  })

  const workstreams = Array.isArray(content.workstreams) ? content.workstreams : []

  // Detailed execution lives in per-workstream checklists.
  workstreams.slice(0, 6).forEach((stream, index) => {
    const checklistId = makeId('checklist')
    const items = Array.isArray(stream.checklist) ? stream.checklist : []
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
      position: { x: 120 + (index % 3) * 340, y: 470 + Math.floor(index / 3) * 370 },
      color: 'white',
      createdAt: new Date().toISOString(),
      width: 320,
      height: 340,
    })
    zEntries.push({ itemId: checklistId, zIndex: zCounter++ })
  })

  const kanbanId = makeId('kanban')
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
      position: { x: 120, y: 1260 },
      color: 'bg-blue-100/90',
      width: 1320,
      height: 420,
    })
    zEntries.push({ itemId: kanbanId, zIndex: zCounter++ })
  }

  // Rich text overview doc — placed to the right of the text summary
  const richTextId = makeId('richtext')
  const tiptapContent = buildTiptapDoc(
    boardTitle,
    content.summary || `Execution board for ${boardTitle}`,
    outcomes,
  )
  richTexts.push({
    id: richTextId,
    title: boardTitle,
    content: tiptapContent,
    position: { x: 920, y: 80 },
    width: 520,
    height: 320,
    color: '#ffffff',
  })
  zEntries.push({ itemId: richTextId, zIndex: zCounter++ })

  const assignmentProposals = Array.isArray(content.assignmentProposals) ? content.assignmentProposals : []
  assignmentProposals.slice(0, 6).forEach((proposal, index) => {
    const id = makeId('note')
    stickyNotes.push({
      id,
      text: `Assignment proposal\nRole: ${proposal.roleHint || 'Unspecified'}\nResponsibility: ${proposal.responsibility || 'Unspecified'}\nConfidence: ${typeof proposal.confidence === 'number' ? `${Math.round(proposal.confidence * 100)}%` : 'n/a'}`,
      position: { x: 1120 + (index % 2) * 230, y: 170 + Math.floor(index / 2) * 170 },
      color: 'purple',
      width: 210,
      height: 150,
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
