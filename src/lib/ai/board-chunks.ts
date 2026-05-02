import type { Database, Json } from '@/types/supabase'

type BoardDocumentRow = Database['public']['Tables']['board_documents']['Row']

type BoardChunk = {
  chunkIndex: number
  content: string
  metadata: Record<string, unknown>
}

const MAX_FIELD_LEN = 400
const MAX_TABLE_ROWS = 8

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD_LEN)
}

function pushString(parts: string[], label: string, value: unknown): void {
  if (typeof value !== 'string') return
  const normalized = cleanText(value)
  if (!normalized) return
  parts.push(`${label}: ${normalized}`)
}

function collectNamedStrings(value: unknown, keys: string[], seen = new Set<string>()): string[] {
  const parts: string[] = []

  function walk(node: unknown): void {
    if (parts.length >= 24) return
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry)
      return
    }
    if (!isRecord(node)) return

    for (const key of keys) {
      const raw = node[key]
      if (typeof raw === 'string') {
        const normalized = cleanText(raw)
        if (normalized && !seen.has(`${key}:${normalized}`)) {
          seen.add(`${key}:${normalized}`)
          parts.push(`${key}: ${normalized}`)
        }
      }
    }

    for (const val of Object.values(node)) walk(val)
  }

  walk(value)
  return parts
}

function summarizeChecklist(checklist: unknown): string | null {
  if (!isRecord(checklist)) return null
  const parts: string[] = []
  pushString(parts, 'Checklist', checklist.title)
  const items = Array.isArray(checklist.items) ? checklist.items : []
  for (const item of items.slice(0, 10)) {
    if (!isRecord(item)) continue
    const text = typeof item.text === 'string' ? cleanText(item.text) : ''
    if (!text) continue
    const done = item.completed === true ? 'done' : 'open'
    parts.push(`Item (${done}): ${text}`)
  }
  return parts.length > 0 ? parts.join('\n') : null
}

function summarizeKanban(board: unknown): string | null {
  if (!isRecord(board)) return null
  const parts: string[] = []
  pushString(parts, 'Kanban', board.title)
  const columns = Array.isArray(board.columns) ? board.columns : []
  for (const column of columns.slice(0, 8)) {
    if (!isRecord(column)) continue
    const title = typeof column.title === 'string' ? cleanText(column.title) : 'Untitled column'
    parts.push(`Column: ${title}`)
    const tasks = Array.isArray(column.tasks) ? column.tasks : []
    for (const task of tasks.slice(0, 8)) {
      if (!isRecord(task)) continue
      const taskTitle = typeof task.title === 'string' ? cleanText(task.title) : ''
      const desc = typeof task.description === 'string' ? cleanText(task.description) : ''
      const joined = [taskTitle, desc].filter(Boolean).join(' — ')
      if (joined) parts.push(`Task: ${joined}`)
    }
  }
  return parts.length > 0 ? parts.join('\n') : null
}

function summarizeTable(table: unknown): string | null {
  if (!isRecord(table)) return null
  const parts: string[] = []
  pushString(parts, 'Table', table.title)
  const headers = Array.isArray(table.headers) ? table.headers : []
  if (headers.length > 0) {
    const headerRow = headers
      .map((h) => (typeof h === 'string' ? cleanText(h) : isRecord(h) && typeof h.title === 'string' ? cleanText(h.title) : ''))
      .filter(Boolean)
    if (headerRow.length > 0) parts.push(`Headers: ${headerRow.join(' | ')}`)
  }
  const rows = Array.isArray(table.rows) ? table.rows : []
  for (const row of rows.slice(0, MAX_TABLE_ROWS)) {
    if (Array.isArray(row)) {
      const vals = row.map((cell) => (typeof cell === 'string' ? cleanText(cell) : isRecord(cell) && typeof cell.value === 'string' ? cleanText(cell.value) : '')).filter(Boolean)
      if (vals.length > 0) parts.push(`Row: ${vals.join(' | ')}`)
    } else if (isRecord(row)) {
      const vals = Object.values(row).map((cell) => (typeof cell === 'string' ? cleanText(cell) : isRecord(cell) && typeof cell.value === 'string' ? cleanText(cell.value) : '')).filter(Boolean)
      if (vals.length > 0) parts.push(`Row: ${vals.join(' | ')}`)
    }
  }
  return parts.length > 0 ? parts.join('\n') : null
}

function toArray(value: Json): unknown[] {
  return Array.isArray(value) ? value : []
}

export function extractBoardDocumentChunks(doc: BoardDocumentRow): BoardChunk[] {
  const chunks: BoardChunk[] = []
  let chunkIndex = 0

  const counts = {
    stickyNotes: toArray(doc.sticky_notes).length,
    texts: toArray(doc.text_elements).length,
    checklists: toArray(doc.checklists).length,
    kanbans: toArray(doc.kanban_boards).length,
    comments: toArray(doc.comments).length,
    reminders: toArray(doc.reminders).length,
    tables: toArray(doc.tables).length,
  }

  chunks.push({
    chunkIndex: chunkIndex++,
    content: [
      `Board title: ${doc.title}`,
      `Context: ${doc.context_type}`,
      `Counts: sticky_notes=${counts.stickyNotes}, texts=${counts.texts}, checklists=${counts.checklists}, kanbans=${counts.kanbans}, comments=${counts.comments}, reminders=${counts.reminders}, tables=${counts.tables}`,
    ].join('\n'),
    metadata: { section: 'board_summary', title: doc.title },
  })

  for (const note of toArray(doc.sticky_notes).slice(0, 40)) {
    const strings = collectNamedStrings(note, ['text', 'title', 'content', 'label'])
    if (strings.length === 0) continue
    chunks.push({
      chunkIndex: chunkIndex++,
      content: ['Section: sticky note', ...strings].join('\n'),
      metadata: { section: 'sticky_notes' },
    })
  }

  for (const text of toArray(doc.text_elements).slice(0, 40)) {
    const strings = collectNamedStrings(text, ['text', 'title', 'content'])
    if (strings.length === 0) continue
    chunks.push({
      chunkIndex: chunkIndex++,
      content: ['Section: text element', ...strings].join('\n'),
      metadata: { section: 'text_elements' },
    })
  }

  for (const checklist of toArray(doc.checklists).slice(0, 24)) {
    const content = summarizeChecklist(checklist)
    if (!content) continue
    chunks.push({
      chunkIndex: chunkIndex++,
      content,
      metadata: { section: 'checklists' },
    })
  }

  for (const kanban of toArray(doc.kanban_boards).slice(0, 16)) {
    const content = summarizeKanban(kanban)
    if (!content) continue
    chunks.push({
      chunkIndex: chunkIndex++,
      content,
      metadata: { section: 'kanban_boards' },
    })
  }

  for (const comment of toArray(doc.comments).slice(0, 40)) {
    const strings = collectNamedStrings(comment, ['text', 'content', 'body', 'authorName'])
    if (strings.length === 0) continue
    chunks.push({
      chunkIndex: chunkIndex++,
      content: ['Section: comment', ...strings].join('\n'),
      metadata: { section: 'comments' },
    })
  }

  for (const reminder of toArray(doc.reminders).slice(0, 24)) {
    const strings = collectNamedStrings(reminder, ['title', 'content', 'text', 'note'])
    if (strings.length === 0) continue
    chunks.push({
      chunkIndex: chunkIndex++,
      content: ['Section: reminder', ...strings].join('\n'),
      metadata: { section: 'reminders' },
    })
  }

  for (const table of toArray(doc.tables).slice(0, 12)) {
    const content = summarizeTable(table)
    if (!content) continue
    chunks.push({
      chunkIndex: chunkIndex++,
      content,
      metadata: { section: 'tables' },
    })
  }

  return chunks.slice(0, 160)
}
