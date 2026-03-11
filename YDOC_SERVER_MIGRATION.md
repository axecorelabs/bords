# Y.Doc Server Migration — Implementation Guide

> **Goal**: Make the Hocuspocus server the authoritative persistence layer for board content, extract lightweight metadata incrementally from CRDT updates, and serve search/listing/notification APIs.

---

## Table of Contents

1. [Current Server Architecture](#1-current-server-architecture)
2. [Target Server Architecture](#2-target-server-architecture)
3. [Phase 2 — BoardMetadata Model](#3-phase-2--boardmetadata-model)
4. [Phase 3 — Incremental Metadata Extraction](#4-phase-3--incremental-metadata-extraction)
5. [Redis Integration](#5-redis-integration)
6. [API Endpoints](#6-api-endpoints)
7. [Notification System](#7-notification-system)
8. [Deployment & Operations](#8-deployment--operations)

---

## 1. Current Server Architecture

```
┌────────────────────┐
│  Hocuspocus Server │
│  (Fastify)         │
├────────────────────┤
│  Extensions:       │
│  - MongoDB persist │  ← stores binary Y.Doc state in YjsDocument collection
│  - Redis (pub/sub) │  ← multi-server sync
│  - Auth            │  ← ticket-based authentication
└────────────────────┘
```

The server currently:
- Accepts WebSocket connections per board (`/ws/:boardId`)
- Authenticates via collab tickets
- Persists Y.Doc binary state to MongoDB on every update
- Uses Redis for cross-server awareness and document sync

**What's missing**: The server stores raw binary CRDT state but extracts NO structured metadata. The frontend's REST API (BoardDocument) is the only source for board titles, item counts, listings, etc.

---

## 2. Target Server Architecture

```
┌──────────────────────────────────────────────┐
│  Hocuspocus Server (Fastify)                 │
├──────────────────────────────────────────────┤
│  Extensions:                                 │
│  - MongoDB persist   → YjsDocument           │
│  - Redis pub/sub     → multi-server sync     │
│  - Auth              → ticket validation      │
│  - MetadataExtractor → BoardMetadata (NEW)   │
├──────────────────────────────────────────────┤
│  REST API (Fastify routes):                  │
│  - GET /api/boards        → board listing    │
│  - GET /api/boards/search → full-text search │
│  - GET /api/mentions      → @mentions        │
│  - GET /api/deadlines     → upcoming tasks   │
└──────────────────────────────────────────────┘
```

---

## 3. Phase 2 — BoardMetadata Model

### Mongoose Schema

```typescript
import { Schema, model } from 'mongoose'

const BoardMetadataSchema = new Schema({
  boardId: { type: String, required: true, unique: true, index: true },
  title: { type: String, default: 'Untitled Board' },
  ownerId: { type: String, required: true, index: true },
  
  // Collaborator access list (for listing queries)
  collaborators: [{
    userId: { type: String, index: true },
    role: { type: String, enum: ['editor', 'viewer'], default: 'editor' },
    addedAt: { type: Date, default: Date.now }
  }],

  // Lightweight counts — updated incrementally
  itemCounts: {
    stickyNotes: { type: Number, default: 0 },
    checklists: { type: Number, default: 0 },
    kanbanBoards: { type: Number, default: 0 },
    texts: { type: Number, default: 0 },
    mediaItems: { type: Number, default: 0 },
    connections: { type: Number, default: 0 },
    drawings: { type: Number, default: 0 },
    reminders: { type: Number, default: 0 },
    tables: { type: Number, default: 0 }
  },

  // Deadlines extracted from checklists, kanban tasks, and reminders
  deadlines: [{
    itemId: String,           // ID of the checklist item / kanban task / reminder item
    parentId: String,         // ID of the parent container (checklist / kanban board / reminder)
    parentType: { type: String, enum: ['checklist', 'kanban', 'reminder'] },
    text: String,             // Task/item text for display
    dueDate: Date,            // Parsed deadline
    completed: { type: Boolean, default: false },
    assignedTo: String        // userId if assigned
  }],

  // @mentions extracted from sticky notes, texts, checklist items
  mentions: [{
    mentionedUserId: String,
    sourceType: { type: String, enum: ['stickyNote', 'text', 'checklist', 'kanban', 'reminder'] },
    sourceId: String,
    text: String,             // Snippet for notification
    createdAt: { type: Date, default: Date.now },
    notified: { type: Boolean, default: false }
  }],

  // Searchable text — concatenated from all text-bearing items
  // Rebuilt per-collection, stored as a map for incremental updates
  searchableText: {
    stickyNotes: { type: String, default: '' },
    checklists: { type: String, default: '' },
    kanbanBoards: { type: String, default: '' },
    texts: { type: String, default: '' },
    reminders: { type: String, default: '' },
    tables: { type: String, default: '' }
  },

  // Board-level settings (mirrored from boardMeta Y.Map)
  backgroundImage: String,
  backgroundColor: String,

  // Timestamps
  lastModifiedAt: { type: Date, default: Date.now, index: true },
  lastModifiedBy: String,    // userId of last editor
  createdAt: { type: Date, default: Date.now },

  // Schema version for future migrations
  schemaVersion: { type: Number, default: 1 }
}, {
  timestamps: false // We manage our own timestamps
})

// Compound indexes for common queries
BoardMetadataSchema.index({ ownerId: 1, lastModifiedAt: -1 })
BoardMetadataSchema.index({ 'collaborators.userId': 1, lastModifiedAt: -1 })
BoardMetadataSchema.index({ 'deadlines.dueDate': 1, 'deadlines.completed': 1 })
BoardMetadataSchema.index({ 'mentions.mentionedUserId': 1, 'mentions.notified': 1 })

// Text index for search
BoardMetadataSchema.index({
  'searchableText.stickyNotes': 'text',
  'searchableText.checklists': 'text',
  'searchableText.kanbanBoards': 'text',
  'searchableText.texts': 'text',
  'searchableText.reminders': 'text',
  'searchableText.tables': 'text',
  title: 'text'
})

export const BoardMetadata = model('BoardMetadata', BoardMetadataSchema)
```

### Key Design Decisions

1. **`searchableText` is a map, not a single string**: When only stickyNotes change, we rebuild only `searchableText.stickyNotes` — not the entire text blob.

2. **`deadlines` is a flat array**: Denormalized from checklists, kanban tasks, and reminders. Easy to query across all boards for a user's upcoming deadlines.

3. **`mentions` tracks notification state**: `notified: false` means the mention is new and needs a notification dispatched.

4. **`itemCounts` uses atomic `$inc`**: No need to count all items — just increment/decrement as items are added/removed.

---

## 4. Phase 3 — Incremental Metadata Extraction

### The Core Problem

A large board might have hundreds of sticky notes, dozens of checklists, and complex kanban boards. Decoding the entire Y.Doc and re-extracting all metadata on every keystroke is wasteful.

### Solution: Differential Extraction

Instead of:
```
onStoreDocument → decode full Y.Doc → extract all metadata → replace BoardMetadata
```

We do:
```
onStoreDocument → inspect which Y.Map keys changed → extract only those → atomic MongoDB updates
```

### How to Detect Changed Collections

Hocuspocus `onStoreDocument` receives the full Y.Doc, but we can track which top-level Y.Maps were modified by observing the document:

```typescript
import * as Y from 'yjs'

// YJS_KEYS mapping to metadata-relevant collections
const METADATA_RELEVANT_KEYS = {
  boardMeta: 'boardMeta',
  stickyNotes: 'stickyNotes',
  checklists: 'checklists',
  kanbanBoards: 'kanbanBoards',
  texts: 'texts',
  mediaItems: 'mediaItems',
  connections: 'connections',
  drawings: 'drawings',
  reminders: 'reminders',
  tables: 'tables'
}

// Track which collections have been modified since last extraction
const pendingChanges = new Map<string, Set<string>>()  // boardId → Set<collectionKey>

function trackChanges(boardId: string, ydoc: Y.Doc) {
  for (const [key] of Object.entries(METADATA_RELEVANT_KEYS)) {
    const ymap = ydoc.getMap(key)
    ymap.observe((event) => {
      if (!pendingChanges.has(boardId)) {
        pendingChanges.set(boardId, new Set())
      }
      pendingChanges.get(boardId)!.add(key)
    })
  }
}
```

### Hocuspocus Extension

```typescript
import { Extension, onStoreDocumentPayload } from '@hocuspocus/server'

class MetadataExtractor implements Extension {
  // Debounce per board — don't extract on every keystroke
  private timers = new Map<string, NodeJS.Timeout>()
  private DEBOUNCE_MS = 2000  // 2 seconds after last change

  async onLoadDocument({ documentName, document }: onLoadDocumentPayload) {
    // Start tracking which collections change
    trackChanges(documentName, document)
  }

  async onStoreDocument({ documentName, document, context }: onStoreDocumentPayload) {
    const boardId = documentName
    const changed = pendingChanges.get(boardId)

    if (!changed || changed.size === 0) return

    // Debounce: reset timer on every store
    if (this.timers.has(boardId)) {
      clearTimeout(this.timers.get(boardId)!)
    }

    // Snapshot the changed set (clear for next batch)
    const changedKeys = new Set(changed)
    changed.clear()

    this.timers.set(boardId, setTimeout(async () => {
      this.timers.delete(boardId)
      await this.extractIncremental(boardId, document, changedKeys, context?.userId)
    }, this.DEBOUNCE_MS))
  }

  private async extractIncremental(
    boardId: string,
    ydoc: Y.Doc,
    changedKeys: Set<string>,
    userId?: string
  ) {
    const updateOps: Record<string, any> = {}
    const setOps: Record<string, any> = {}
    const pullOps: any[] = []
    const pushOps: any[] = []

    // Always update timestamp
    setOps.lastModifiedAt = new Date()
    if (userId) setOps.lastModifiedBy = userId

    // --- Board Meta ---
    if (changedKeys.has('boardMeta')) {
      const meta = ydoc.getMap('boardMeta')
      const title = meta.get('name')
      if (title) setOps.title = title
      const bg = meta.get('backgroundColor')
      if (bg !== undefined) setOps.backgroundColor = bg
      const bgImg = meta.get('backgroundImage')
      if (bgImg !== undefined) setOps.backgroundImage = bgImg
    }

    // --- Item counts (compare current Y.Map size with stored count) ---
    for (const key of changedKeys) {
      if (key === 'boardMeta') continue
      const ymap = ydoc.getMap(key)
      const countField = `itemCounts.${key}`
      setOps[countField] = ymap.size
    }

    // --- Searchable text (rebuild only changed collections) ---
    if (changedKeys.has('stickyNotes')) {
      setOps['searchableText.stickyNotes'] = extractStickyNoteText(ydoc)
    }
    if (changedKeys.has('checklists')) {
      setOps['searchableText.checklists'] = extractChecklistText(ydoc)
    }
    if (changedKeys.has('kanbanBoards')) {
      setOps['searchableText.kanbanBoards'] = extractKanbanText(ydoc)
    }
    if (changedKeys.has('texts')) {
      setOps['searchableText.texts'] = extractTextElementText(ydoc)
    }
    if (changedKeys.has('reminders')) {
      setOps['searchableText.reminders'] = extractReminderText(ydoc)
    }
    if (changedKeys.has('tables')) {
      setOps['searchableText.tables'] = extractTableText(ydoc)
    }

    // --- Deadlines (rebuild only if relevant collections changed) ---
    const deadlineCollections = ['checklists', 'kanbanBoards', 'reminders']
    const deadlinesChanged = deadlineCollections.some(k => changedKeys.has(k))
    if (deadlinesChanged) {
      // Full rebuild of deadlines array (it's small and interconnected)
      const deadlines = extractAllDeadlines(ydoc)
      setOps.deadlines = deadlines
    }

    // --- Mentions (diff-based) ---
    const mentionCollections = ['stickyNotes', 'texts', 'checklists', 'kanbanBoards', 'reminders']
    const mentionsChanged = mentionCollections.some(k => changedKeys.has(k))
    if (mentionsChanged) {
      await updateMentions(boardId, ydoc)
    }

    // Apply atomic update
    await BoardMetadata.updateOne(
      { boardId },
      { $set: setOps },
      { upsert: true }
    )
  }
}
```

### Text Extraction Functions

These are lightweight — they iterate ONE collection's Y.Map, not the entire document:

```typescript
function extractStickyNoteText(ydoc: Y.Doc): string {
  const ymap = ydoc.getMap('stickyNotes')
  const texts: string[] = []
  ymap.forEach((value: any) => {
    const obj = value instanceof Y.Map ? yMapToObject(value) : value
    if (obj.text) texts.push(obj.text)
  })
  return texts.join(' ')
}

function extractChecklistText(ydoc: Y.Doc): string {
  const ymap = ydoc.getMap('checklists')
  const texts: string[] = []
  ymap.forEach((value: any) => {
    const obj = value instanceof Y.Map ? yMapToObject(value) : value
    if (obj.title) texts.push(obj.title)
    if (obj.items && Array.isArray(obj.items)) {
      for (const item of obj.items) {
        if (item.text) texts.push(item.text)
      }
    }
  })
  return texts.join(' ')
}

function extractKanbanText(ydoc: Y.Doc): string {
  const ymap = ydoc.getMap('kanbanBoards')
  const texts: string[] = []
  ymap.forEach((value: any) => {
    const obj = value instanceof Y.Map ? yMapToObject(value) : value
    if (obj.title) texts.push(obj.title)
    if (obj.columns && Array.isArray(obj.columns)) {
      for (const col of obj.columns) {
        if (col.title) texts.push(col.title)
        if (col.tasks && Array.isArray(col.tasks)) {
          for (const task of col.tasks) {
            if (task.title) texts.push(task.title)
            if (task.description) texts.push(task.description)
          }
        }
      }
    }
  })
  return texts.join(' ')
}

function extractTextElementText(ydoc: Y.Doc): string {
  const ymap = ydoc.getMap('texts')
  const texts: string[] = []
  ymap.forEach((value: any) => {
    const obj = value instanceof Y.Map ? yMapToObject(value) : value
    if (obj.text) texts.push(obj.text)
  })
  return texts.join(' ')
}

function extractReminderText(ydoc: Y.Doc): string {
  const ymap = ydoc.getMap('reminders')
  const texts: string[] = []
  ymap.forEach((value: any) => {
    const obj = value instanceof Y.Map ? yMapToObject(value) : value
    if (obj.title) texts.push(obj.title)
    if (obj.items && Array.isArray(obj.items)) {
      for (const item of obj.items) {
        if (item.text) texts.push(item.text)
      }
    }
  })
  return texts.join(' ')
}

function extractTableText(ydoc: Y.Doc): string {
  const ymap = ydoc.getMap('tables')
  const texts: string[] = []
  ymap.forEach((value: any) => {
    const obj = value instanceof Y.Map ? yMapToObject(value) : value
    if (obj.title) texts.push(obj.title)
    if (obj.columns && Array.isArray(obj.columns)) {
      texts.push(...obj.columns)
    }
    if (obj.rows && Array.isArray(obj.rows)) {
      for (const row of obj.rows) {
        if (Array.isArray(row)) {
          for (const cell of row) {
            if (cell.value) texts.push(cell.value)
          }
        }
      }
    }
  })
  return texts.join(' ')
}
```

### Deadline Extraction

```typescript
interface ExtractedDeadline {
  itemId: string
  parentId: string
  parentType: 'checklist' | 'kanban' | 'reminder'
  text: string
  dueDate: Date
  completed: boolean
  assignedTo?: string
}

function extractAllDeadlines(ydoc: Y.Doc): ExtractedDeadline[] {
  const deadlines: ExtractedDeadline[] = []

  // From checklists
  const checklists = ydoc.getMap('checklists')
  checklists.forEach((value: any, checklistId: string) => {
    const obj = value instanceof Y.Map ? yMapToObject(value) : value
    if (obj.items && Array.isArray(obj.items)) {
      for (const item of obj.items) {
        if (item.deadline) {
          deadlines.push({
            itemId: item.id,
            parentId: checklistId,
            parentType: 'checklist',
            text: item.text || '',
            dueDate: new Date(item.deadline),
            completed: item.completed || false
          })
        }
      }
    }
  })

  // From kanban tasks
  const kanbans = ydoc.getMap('kanbanBoards')
  kanbans.forEach((value: any, boardId: string) => {
    const obj = value instanceof Y.Map ? yMapToObject(value) : value
    if (obj.columns && Array.isArray(obj.columns)) {
      for (const col of obj.columns) {
        if (col.tasks && Array.isArray(col.tasks)) {
          for (const task of col.tasks) {
            if (task.dueDate) {
              deadlines.push({
                itemId: task.id,
                parentId: boardId,
                parentType: 'kanban',
                text: task.title || '',
                dueDate: new Date(task.dueDate),
                completed: task.completed || false
              })
            }
          }
        }
      }
    }
  })

  // From reminders
  const reminders = ydoc.getMap('reminders')
  reminders.forEach((value: any, reminderId: string) => {
    const obj = value instanceof Y.Map ? yMapToObject(value) : value
    if (obj.items && Array.isArray(obj.items)) {
      for (const item of obj.items) {
        if (item.dueDate) {
          const dueDateTime = item.dueTime
            ? new Date(`${item.dueDate}T${item.dueTime}`)
            : new Date(item.dueDate)
          deadlines.push({
            itemId: item.id,
            parentId: reminderId,
            parentType: 'reminder',
            text: item.text || '',
            dueDate: dueDateTime,
            completed: item.completed || false,
            assignedTo: obj.assignedTo?.userId
          })
        }
      }
    }
  })

  return deadlines
}
```

### Mention Detection & Diffing

```typescript
const MENTION_REGEX = /@\[([^\]]+)\]\(user:([a-f0-9]+)\)/g
// Matches patterns like @[John Doe](user:64a1b2c3d4e5f6)

interface ExtractedMention {
  mentionedUserId: string
  sourceType: string
  sourceId: string
  text: string
}

function extractMentionsFromDoc(ydoc: Y.Doc): ExtractedMention[] {
  const mentions: ExtractedMention[] = []

  const collectFromMap = (key: string, sourceType: string, textExtractor: (obj: any) => string[]) => {
    const ymap = ydoc.getMap(key)
    ymap.forEach((value: any, itemId: string) => {
      const obj = value instanceof Y.Map ? yMapToObject(value) : value
      const textParts = textExtractor(obj)
      for (const text of textParts) {
        let match
        while ((match = MENTION_REGEX.exec(text)) !== null) {
          mentions.push({
            mentionedUserId: match[2],
            sourceType,
            sourceId: itemId,
            text: text.substring(0, 100) // Snippet
          })
        }
      }
    })
  }

  collectFromMap('stickyNotes', 'stickyNote', (obj) => [obj.text || ''])
  collectFromMap('texts', 'text', (obj) => [obj.text || ''])
  collectFromMap('checklists', 'checklist', (obj) => {
    const texts = [obj.title || '']
    if (obj.items) texts.push(...obj.items.map((i: any) => i.text || ''))
    return texts
  })
  // ... similar for kanban, reminders

  return mentions
}

async function updateMentions(boardId: string, ydoc: Y.Doc) {
  const currentMentions = extractMentionsFromDoc(ydoc)

  // Get existing mentions from DB
  const existing = await BoardMetadata.findOne(
    { boardId },
    { mentions: 1 }
  ).lean()
  const existingMentions = existing?.mentions || []

  // Find new mentions (not in existing)
  const existingKey = (m: any) => `${m.mentionedUserId}:${m.sourceType}:${m.sourceId}`
  const existingSet = new Set(existingMentions.map(existingKey))

  const newMentions = currentMentions
    .filter(m => !existingSet.has(`${m.mentionedUserId}:${m.sourceType}:${m.sourceId}`))
    .map(m => ({ ...m, createdAt: new Date(), notified: false }))

  // Find removed mentions
  const currentKey = (m: ExtractedMention) => `${m.mentionedUserId}:${m.sourceType}:${m.sourceId}`
  const currentSet = new Set(currentMentions.map(currentKey))
  const removedKeys = existingMentions
    .filter((m: any) => !currentSet.has(existingKey(m)))

  // Atomic update
  if (newMentions.length > 0) {
    await BoardMetadata.updateOne(
      { boardId },
      { $push: { mentions: { $each: newMentions } } }
    )
  }

  if (removedKeys.length > 0) {
    for (const removed of removedKeys) {
      await BoardMetadata.updateOne(
        { boardId },
        { $pull: { mentions: {
          mentionedUserId: removed.mentionedUserId,
          sourceType: removed.sourceType,
          sourceId: removed.sourceId
        }}}
      )
    }
  }

  // Queue notifications for new mentions
  if (newMentions.length > 0) {
    await queueMentionNotifications(boardId, newMentions)
  }
}
```

### Performance Characteristics

| Board Size | Items | Full Extract | Incremental (1 collection) |
|------------|-------|-------------|---------------------------|
| Small | <50 | ~5ms | ~1ms |
| Medium | 50-200 | ~20ms | ~2-5ms |
| Large | 200-1000 | ~100ms | ~5-15ms |
| Very Large | 1000+ | ~500ms+ | ~10-30ms |

The incremental approach means a user typing in a sticky note only triggers `extractStickyNoteText()` (iterating the stickyNotes Y.Map) and a `$set` on `searchableText.stickyNotes` + `itemCounts.stickyNotes` — NOT a full document scan.

For position-only changes (dragging items), the `changedKeys` set will include the collection, but the text extraction will produce the same result. This is still cheap since we only process one collection. To optimize further, we could track whether text content actually changed vs. just position, but the gains are marginal.

---

## 5. Redis Integration

### Architecture

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Hocuspocus   │    │ Hocuspocus   │    │ Hocuspocus   │
│ Server 1     │    │ Server 2     │    │ Server 3     │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       └───────────┬───────┘───────────────────┘
                   │
              ┌────▼────┐
              │  Redis   │
              │          │
              │ Channels:│
              │ - sync:* │  ← document sync (existing @hocuspocus/extension-redis)
              │ - meta:* │  ← metadata extraction coordination (NEW)
              │ - notif:*│  ← notification dispatch (NEW)
              └──────────┘
```

### Metadata Extraction Coordination

When multiple servers handle the same board, only ONE should extract metadata. Use Redis distributed locking:

```typescript
import Redis from 'ioredis'

const redis = new Redis(process.env.REDIS_URL)

async function acquireExtractionLock(boardId: string): Promise<boolean> {
  // SET NX with 10s TTL — only one server wins
  const result = await redis.set(
    `meta:lock:${boardId}`,
    process.env.SERVER_ID,
    'NX',
    'EX',
    10
  )
  return result === 'OK'
}

async function releaseExtractionLock(boardId: string) {
  // Only release if we own it
  const owner = await redis.get(`meta:lock:${boardId}`)
  if (owner === process.env.SERVER_ID) {
    await redis.del(`meta:lock:${boardId}`)
  }
}
```

### Debouncing via Redis

Instead of in-memory debounce timers (which don't coordinate across servers), use Redis for debouncing:

```typescript
async function shouldExtract(boardId: string): Promise<boolean> {
  const key = `meta:debounce:${boardId}`
  // Set key with 2s TTL. If it already exists, skip extraction.
  const result = await redis.set(key, '1', 'NX', 'PX', 2000)
  return result === 'OK'
}
```

This means: after extraction starts for a board, no other server (or the same server) will extract again for 2 seconds.

### Notification Dispatch Queue

```typescript
async function queueMentionNotifications(boardId: string, mentions: any[]) {
  for (const mention of mentions) {
    await redis.lpush('notif:mentions', JSON.stringify({
      boardId,
      mentionedUserId: mention.mentionedUserId,
      sourceType: mention.sourceType,
      sourceId: mention.sourceId,
      text: mention.text,
      timestamp: Date.now()
    }))
  }
}

// Notification worker (separate process or interval)
async function processMentionNotifications() {
  while (true) {
    // Block-pop with 5s timeout
    const result = await redis.brpop('notif:mentions', 5)
    if (!result) continue

    const notification = JSON.parse(result[1])
    // Send email/push notification
    await sendMentionNotification(notification)
    // Mark as notified in BoardMetadata
    await BoardMetadata.updateOne(
      {
        boardId: notification.boardId,
        'mentions.mentionedUserId': notification.mentionedUserId,
        'mentions.sourceId': notification.sourceId
      },
      { $set: { 'mentions.$.notified': true } }
    )
  }
}
```

---

## 6. API Endpoints

### Board Listing

```typescript
// GET /api/boards?userId=xxx
fastify.get('/api/boards', async (request, reply) => {
  const { userId } = request.query as { userId: string }
  // Auth check: ensure request user matches userId or is admin

  const boards = await BoardMetadata.find({
    $or: [
      { ownerId: userId },
      { 'collaborators.userId': userId }
    ]
  })
  .select('boardId title ownerId itemCounts lastModifiedAt lastModifiedBy backgroundImage backgroundColor')
  .sort({ lastModifiedAt: -1 })
  .lean()

  return boards
})
```

### Search

```typescript
// GET /api/boards/search?userId=xxx&q=project+plan
fastify.get('/api/boards/search', async (request, reply) => {
  const { userId, q } = request.query as { userId: string; q: string }

  const boards = await BoardMetadata.find({
    $and: [
      { $or: [
        { ownerId: userId },
        { 'collaborators.userId': userId }
      ]},
      { $text: { $search: q } }
    ]
  })
  .select('boardId title ownerId itemCounts lastModifiedAt')
  .sort({ score: { $meta: 'textScore' } })
  .lean()

  return boards
})
```

### Upcoming Deadlines

```typescript
// GET /api/deadlines?userId=xxx&days=7
fastify.get('/api/deadlines', async (request, reply) => {
  const { userId, days = 7 } = request.query as { userId: string; days?: number }
  const cutoff = new Date(Date.now() + days * 86400000)

  const boards = await BoardMetadata.find({
    $or: [
      { ownerId: userId },
      { 'collaborators.userId': userId }
    ],
    'deadlines.dueDate': { $lte: cutoff },
    'deadlines.completed': false
  })
  .select('boardId title deadlines')
  .lean()

  // Flatten and filter
  const upcoming = boards.flatMap(board =>
    board.deadlines
      .filter((d: any) => !d.completed && new Date(d.dueDate) <= cutoff)
      .map((d: any) => ({
        ...d,
        boardId: board.boardId,
        boardTitle: board.title
      }))
  )
  .sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())

  return upcoming
})
```

### Mentions

```typescript
// GET /api/mentions?userId=xxx&unread=true
fastify.get('/api/mentions', async (request, reply) => {
  const { userId, unread } = request.query as { userId: string; unread?: string }

  const filter: any = {
    'mentions.mentionedUserId': userId
  }
  if (unread === 'true') {
    filter['mentions.notified'] = false
  }

  const boards = await BoardMetadata.find(filter)
    .select('boardId title mentions')
    .lean()

  const mentions = boards.flatMap(board =>
    board.mentions
      .filter((m: any) => m.mentionedUserId === userId && (unread !== 'true' || !m.notified))
      .map((m: any) => ({
        ...m,
        boardId: board.boardId,
        boardTitle: board.title
      }))
  )
  .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return mentions
})
```

---

## 7. Notification System

### Architecture

```
Y.Doc change → MetadataExtractor → new mention detected
  → Redis queue (notif:mentions)
  → Notification Worker:
      → Check user preferences (email? push? in-app?)
      → Resend email (via Resend/SES)
      → Store in-app notification
      → Send push notification (if PWA)
```

### Reminder/Deadline Notifications

Run a cron job (or Redis-based scheduler) that checks for upcoming deadlines:

```typescript
// Run every 15 minutes
async function checkUpcomingDeadlines() {
  const soon = new Date(Date.now() + 30 * 60000) // 30 minutes from now
  const now = new Date()

  const boards = await BoardMetadata.find({
    'deadlines.dueDate': { $gte: now, $lte: soon },
    'deadlines.completed': false
  })
  .select('boardId title deadlines')
  .lean()

  for (const board of boards) {
    for (const deadline of board.deadlines) {
      if (deadline.completed) continue
      if (new Date(deadline.dueDate) < now || new Date(deadline.dueDate) > soon) continue

      // Check if we already notified for this deadline
      const notifKey = `notif:deadline:${board.boardId}:${deadline.itemId}`
      const already = await redis.get(notifKey)
      if (already) continue

      // Mark as notified (24h TTL to prevent re-notification)
      await redis.set(notifKey, '1', 'EX', 86400)

      // Send notification
      if (deadline.assignedTo) {
        await sendDeadlineNotification({
          userId: deadline.assignedTo,
          boardId: board.boardId,
          boardTitle: board.title,
          taskText: deadline.text,
          dueDate: deadline.dueDate
        })
      }
    }
  }
}
```

---

## 8. Deployment & Operations

### Initial Data Migration

Before enabling the new system, backfill `BoardMetadata` from existing Y.Docs:

```typescript
async function backfillMetadata() {
  const cursor = YjsDocument.find({}).cursor()

  for await (const doc of cursor) {
    const ydoc = new Y.Doc()
    Y.applyUpdate(ydoc, doc.state) // Apply binary state

    const boardId = doc.name

    // Full extraction (one-time, not incremental)
    const meta = ydoc.getMap('boardMeta')
    const title = meta.get('name') || 'Untitled Board'
    const ownerId = meta.get('userId') || ''

    await BoardMetadata.updateOne(
      { boardId },
      {
        $set: {
          boardId,
          title,
          ownerId,
          itemCounts: {
            stickyNotes: ydoc.getMap('stickyNotes').size,
            checklists: ydoc.getMap('checklists').size,
            kanbanBoards: ydoc.getMap('kanbanBoards').size,
            texts: ydoc.getMap('texts').size,
            mediaItems: ydoc.getMap('mediaItems').size,
            connections: ydoc.getMap('connections').size,
            drawings: ydoc.getMap('drawings').size,
            reminders: ydoc.getMap('reminders').size,
            tables: ydoc.getMap('tables').size
          },
          searchableText: {
            stickyNotes: extractStickyNoteText(ydoc),
            checklists: extractChecklistText(ydoc),
            kanbanBoards: extractKanbanText(ydoc),
            texts: extractTextElementText(ydoc),
            reminders: extractReminderText(ydoc),
            tables: extractTableText(ydoc)
          },
          deadlines: extractAllDeadlines(ydoc),
          lastModifiedAt: new Date(),
          schemaVersion: 1
        }
      },
      { upsert: true }
    )

    ydoc.destroy()
  }
}
```

### Monitoring

Key metrics to track:

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| Extraction latency per board | MetadataExtractor timer | >500ms |
| Extraction queue depth | Redis `meta:debounce:*` key count | >100 |
| Notification queue depth | Redis `notif:mentions` length | >1000 |
| BoardMetadata staleness | `lastModifiedAt` vs YjsDocument `updatedAt` | >30s |
| MongoDB write ops/sec | MongoDB metrics | Capacity dependent |

### Scaling Considerations

1. **Large boards (1000+ items)**: Incremental extraction handles this. Even if the stickyNotes collection has 500 items, iterating 500 Y.Map entries and joining text is <30ms.

2. **High-frequency edits (typing)**: The 2-second debounce means at most 1 extraction every 2s per board, regardless of edit frequency.

3. **Many concurrent boards**: Each board's extraction is independent. With Redis locking, only one server handles extraction per board.

4. **Memory**: Y.Doc instances are managed by Hocuspocus. Loading a large board for extraction doesn't create a new Y.Doc — it uses the already-loaded server instance.

### Schema Evolution

When adding new metadata fields:
1. Bump `schemaVersion` in the extraction code
2. Add a migration script that backfills the new field from existing Y.Docs
3. Handle missing fields gracefully in API endpoints (default values)

### Cleanup

- When a board is deleted:
  1. Delete `YjsDocument` (Hocuspocus handles this)
  2. Delete `BoardMetadata`: `await BoardMetadata.deleteOne({ boardId })`
  3. Clean up Redis keys: `await redis.del(\`meta:lock:${boardId}\`, \`meta:debounce:${boardId}\`)`

- Periodic cleanup of orphaned metadata:
  ```typescript
  // Find BoardMetadata entries with no matching YjsDocument
  const metadataIds = await BoardMetadata.distinct('boardId')
  const yjsIds = await YjsDocument.distinct('name')
  const orphaned = metadataIds.filter(id => !yjsIds.includes(id))
  await BoardMetadata.deleteMany({ boardId: { $in: orphaned } })
  ```
