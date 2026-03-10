/**
 * Item-level diff engine for BORDS board data.
 *
 * Compares two board states at the individual item level (by item `id`).
 * This is the foundation for Git-style three-way merging — instead of
 * replacing the whole board, we diff per-item so non-conflicting changes
 * from different editors can be merged automatically.
 */

/* ── Types ── */

export interface ItemChange {
  type: 'add' | 'delete' | 'update'
  collection: string
  itemId: string
  before?: any
  after?: any
}

export interface CollectionDiff {
  added: any[]
  deleted: any[]
  modified: { before: any; after: any }[]
  unchanged: any[]
}

export interface BoardDiff {
  collections: Record<string, CollectionDiff>
  settingsChanged: boolean
  backgroundChanged: boolean
  changes: ItemChange[]
  hasChanges: boolean
}

/* ── The content collections stored per-board ── */

export const CONTENT_COLLECTIONS = [
  'stickyNotes', 'checklists', 'kanbanBoards', 'mediaItems',
  'textElements', 'drawings', 'connections', 'reminders', 'tables',
  // comments excluded — managed server-side via comments API
] as const

export type ContentCollection = (typeof CONTENT_COLLECTIONS)[number]

/* ── Human-friendly labels for each collection ── */

export const COLLECTION_LABELS: Record<string, string> = {
  stickyNotes:  'Sticky Note',
  checklists:   'Checklist',
  kanbanBoards: 'Kanban Board',
  mediaItems:   'Media',
  textElements: 'Text',
  drawings:     'Drawing',
  connections:  'Connection',
  reminders:    'Reminder',
  tables:       'Table',
}

/* ── Fast deterministic hash of a single item (strips Mongoose noise) ── */

function itemHash(item: any): string {
  if (!item) return ''
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, __v, ...clean } = item
  return JSON.stringify(clean)
}

/* ── Get a human-readable label for an item ── */

export function getItemLabel(collection: string, item: any): string {
  const type = COLLECTION_LABELS[collection] || collection
  const raw = item?.title || item?.name || item?.text || item?.content || item?.id || 'Unknown'
  const name = typeof raw === 'string' && raw.length > 40 ? raw.slice(0, 40) + '…' : raw
  return `${type}: "${name}"`
}

/* ── Diff a single collection by item ID ── */

export function diffCollection(base: any[], current: any[]): CollectionDiff {
  const baseMap = new Map<string, any>()
  const baseHashes = new Map<string, string>()
  for (const item of base || []) {
    if (item?.id) {
      baseMap.set(item.id, item)
      baseHashes.set(item.id, itemHash(item))
    }
  }

  const currentMap = new Map<string, any>()
  const currentHashes = new Map<string, string>()
  for (const item of current || []) {
    if (item?.id) {
      currentMap.set(item.id, item)
      currentHashes.set(item.id, itemHash(item))
    }
  }

  const added: any[] = []
  const deleted: any[] = []
  const modified: { before: any; after: any }[] = []
  const unchanged: any[] = []

  // In current but not in base → added
  for (const [id, item] of currentMap) {
    if (!baseMap.has(id)) added.push(item)
  }

  // In base but not in current → deleted
  for (const [id, item] of baseMap) {
    if (!currentMap.has(id)) deleted.push(item)
  }

  // In both → check if modified
  for (const [id, cur] of currentMap) {
    if (baseMap.has(id)) {
      if (baseHashes.get(id) !== currentHashes.get(id)) {
        modified.push({ before: baseMap.get(id), after: cur })
      } else {
        unchanged.push(cur)
      }
    }
  }

  return { added, deleted, modified, unchanged }
}

/* ── Diff the full board across all collections ── */

export function diffBoard(base: any, current: any): BoardDiff {
  const collections: Record<string, CollectionDiff> = {}
  const changes: ItemChange[] = []
  let hasChanges = false

  for (const col of CONTENT_COLLECTIONS) {
    const diff = diffCollection(base?.[col] || [], current?.[col] || [])
    collections[col] = diff

    for (const item of diff.added) {
      changes.push({ type: 'add', collection: col, itemId: item.id, after: item })
      hasChanges = true
    }
    for (const item of diff.deleted) {
      changes.push({ type: 'delete', collection: col, itemId: item.id, before: item })
      hasChanges = true
    }
    for (const { before, after } of diff.modified) {
      changes.push({ type: 'update', collection: col, itemId: before.id, before, after })
      hasChanges = true
    }
  }

  const settingsChanged = JSON.stringify({
    connectionLineSettings: base?.connectionLineSettings,
    gridSettings: base?.gridSettings,
    themeSettings: base?.themeSettings,
  }) !== JSON.stringify({
    connectionLineSettings: current?.connectionLineSettings,
    gridSettings: current?.gridSettings,
    themeSettings: current?.themeSettings,
  })

  const backgroundChanged = JSON.stringify({
    backgroundImage: base?.backgroundImage,
    backgroundColor: base?.backgroundColor,
    backgroundOverlay: base?.backgroundOverlay,
    backgroundOverlayColor: base?.backgroundOverlayColor,
    backgroundBlurLevel: base?.backgroundBlurLevel,
  }) !== JSON.stringify({
    backgroundImage: current?.backgroundImage,
    backgroundColor: current?.backgroundColor,
    backgroundOverlay: current?.backgroundOverlay,
    backgroundOverlayColor: current?.backgroundOverlayColor,
    backgroundBlurLevel: current?.backgroundBlurLevel,
  })

  if (settingsChanged || backgroundChanged) hasChanges = true

  return { collections, settingsChanged, backgroundChanged, changes, hasChanges }
}

/* ── Summarize a diff for human consumption ── */

export function summarizeDiff(diff: BoardDiff): string {
  const parts: string[] = []
  let adds = 0, deletes = 0, updates = 0
  for (const c of diff.changes) {
    if (c.type === 'add') adds++
    else if (c.type === 'delete') deletes++
    else if (c.type === 'update') updates++
  }
  if (adds)    parts.push(`${adds} added`)
  if (updates) parts.push(`${updates} modified`)
  if (deletes) parts.push(`${deletes} removed`)
  if (diff.settingsChanged)   parts.push('settings changed')
  if (diff.backgroundChanged) parts.push('background changed')
  return parts.join(', ') || 'no changes'
}
