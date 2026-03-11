# Y.Doc Frontend Migration — Implementation Guide

> **Goal**: Make the Y.Doc the single source of truth for all board content. Remove REST-based content sync entirely. Use `y-indexeddb` for offline persistence and a new `BoardMetadata` API for board listing/search.

---

## Table of Contents

1. [Current Architecture (Before)](#1-current-architecture-before)
2. [Target Architecture (After)](#2-target-architecture-after)
3. [Phase 1 — y-indexeddb Integration](#3-phase-1--y-indexeddb-integration)
4. [Phase 4 — Remove REST Content Sync](#4-phase-4--remove-rest-content-sync)
5. [Phase 5 — Board Listing from Metadata API](#5-phase-5--board-listing-from-metadata-api)
6. [New Load Sequence](#6-new-load-sequence)
7. [File-by-File Change List](#7-file-by-file-change-list)
8. [Migration Safety & Rollback](#8-migration-safety--rollback)

---

## 1. Current Architecture (Before)

```
┌─────────────┐  REST push/pull   ┌──────────────┐
│  Zustand     │ ◄──────────────► │ /api/board/  │ ◄── MongoDB (BoardDocument)
│  stores      │                  │ REST API     │
└──────┬───────┘                  └──────────────┘
       │
       │ yjs-bindings (two-way)
       ▼
┌─────────────┐  WebSocket        ┌──────────────┐
│  Y.Doc       │ ◄──────────────► │ Hocuspocus   │ ◄── MongoDB (YjsDocument)
│  (in-memory) │                  │ Server       │
└─────────────┘                  └──────────────┘
```

**Problems**:
- Two sources of truth: `BoardDocument` (REST) + `YjsDocument` (Hocuspocus)
- Complex 3-way merge in `boardSyncStore.ts` (~1350 lines)
- Content hashing + optimistic locking for conflict resolution
- Double network traffic: REST + WebSocket

### Current Data Flow

1. **Load**: REST pull → `applyCloudData()` → Zustand → `pushStoreToYDoc()` → Y.Doc
2. **Edit**: Zustand mutation → `yjsWriteItem()` → Y.Doc transact → WebSocket → server
3. **Remote edit**: WebSocket → Y.Doc observer → RAF-debounced → Zustand setState
4. **Save**: Periodic timer → `gatherBoardData()` → REST push → MongoDB

---

## 2. Target Architecture (After)

```
┌─────────────┐                  
│  Zustand     │                  
│  stores      │                  
└──────┬───────┘                  
       │ yjs-bindings (two-way, unchanged)
       ▼
┌─────────────┐  WebSocket        ┌──────────────┐
│  Y.Doc       │ ◄──────────────► │ Hocuspocus   │ ◄── MongoDB (YjsDocument)
│  (in-memory) │                  │ Server       │
└──────┬───────┘                  └──────────────┘
       │                                 │
       ▼                                 ▼
┌─────────────┐                  ┌──────────────┐
│ y-indexeddb  │                  │ BoardMetadata│ ◄── Incremental extraction
│ (offline)    │                  │ (MongoDB)    │
└─────────────┘                  └──────────────┘
```

**Benefits**:
- Single source of truth: Y.Doc
- Offline-first: IndexedDB has the full Y.Doc state
- No REST content sync, no 3-way merge
- BoardMetadata for listing/search (extracted server-side from CRDT updates)

### Target Data Flow

1. **Load**: y-indexeddb → Y.Doc (instant local) → WebSocket sync merges remote changes → Y.Doc observers → Zustand
2. **Edit**: Zustand mutation → `yjsWriteItem()` → Y.Doc → WebSocket + IndexedDB (automatic)
3. **Remote edit**: WebSocket → Y.Doc → IndexedDB (automatic) + observer → Zustand
4. **No explicit save step** — Hocuspocus server auto-persists Y.Doc binary

---

## 3. Phase 1 — y-indexeddb Integration

### Install

```bash
npm install y-indexeddb
```

### Modify `src/lib/yjs-provider.ts`

Add IndexedDB persistence alongside the WebSocket provider:

```typescript
import { IndexeddbPersistence } from 'y-indexeddb'

let indexeddbProvider: IndexeddbPersistence | null = null

export async function connectToBoard(boardId: string): Promise<HocuspocusProvider> {
  // ... existing Y.Doc + HocuspocusProvider setup ...

  // Add IndexedDB persistence
  indexeddbProvider = new IndexeddbPersistence(`board-${boardId}`, ydoc)

  // Wait for IndexedDB to load before declaring ready
  await new Promise<void>((resolve) => {
    indexeddbProvider!.once('synced', () => resolve())
  })

  // Now connect WebSocket — remote state will merge into local
  ws.connect()

  return provider
}

export function disconnectFromBoard() {
  // ... existing cleanup ...

  if (indexeddbProvider) {
    indexeddbProvider.destroy()
    indexeddbProvider = null
  }
}
```

### Key Behaviors of y-indexeddb

- **Automatic writes**: Every Y.Doc update is automatically written to IndexedDB. No manual save needed.
- **Merge on load**: When `IndexeddbPersistence` loads, it applies stored updates to the Y.Doc. When WebSocket connects, Hocuspocus merges server state. CRDT guarantees convergence.
- **No conflicts**: Y.Doc merge is commutative — order of local-first vs server-first doesn't matter.
- **Storage key**: Use `board-${boardId}` to namespace per board.

### Update `src/app/page.tsx` init flow

```typescript
// Before: REST pull then YJS connect
// const boardData = await pullBoardData(currentBoardId)
// applyCloudData(boardData)

// After: just connect (IndexedDB loads local, WebSocket merges remote)
const provider = await connectToBoard(currentBoardId)
// Y.Doc observers auto-populate Zustand via yjs-bindings
```

### Handle First-Time Board

On first open (no IndexedDB data, no server Y.Doc):
- Y.Doc starts empty
- `setupYjsBindings()` observers fire with empty maps
- Zustand stores stay at defaults
- User creates content → flows into Y.Doc → persisted

On subsequent opens:
- IndexedDB loads Y.Doc state → observers fire → Zustand populated instantly
- WebSocket syncs any remote changes → merged → observers fire again

---

## 4. Phase 4 — Remove REST Content Sync

This is the largest change. We delete all the REST-based content pushing/pulling.

### Files to DELETE entirely

| File | Reason |
|------|--------|
| `src/lib/boardData.ts` | `gatherBoardData()`, `applyCloudData()`, `computeHash()` — all REST sync |
| `src/app/api/board/[id]/content/` | REST content endpoint (if exists) |

### Files to HEAVILY modify

#### `src/store/boardSyncStore.ts`

**Delete** (content sync machinery):
- `pushToCloud()` / `pullFromCloud()` — REST content push/pull
- `syncBoard()` / `fullSync()` — orchestrated sync cycles
- `contentHashes` / `computeHash()` — change detection for REST
- `dirtyBoards` / `staleBoards` tracking
- `markDirty()` / `markStale()`
- Auto-save timer / periodic sync interval
- `lastSyncedAt` / `syncInProgress` / `syncError` state
- 3-way merge logic
- `applyCloudData()` calls

**Keep** (still needed):
- Board metadata operations: create/delete/rename board (these hit the new BoardMetadata API)
- Board sharing / permissions (if using REST)
- Board listing (will be refactored in Phase 5)
- Organization/workspace context

After cleanup, this file should shrink from ~1350 lines to ~200-300 lines.

#### `src/app/page.tsx`

**Delete**:
- REST `pullBoardData()` call
- `applyCloudData()` call
- `pushStoreToYDoc()` call (no longer needed — Y.Doc is the source, not Zustand)
- Save-on-unmount / periodic push
- `computeHash()` / hash comparison logic
- `currentBoardHash` dependency

**Replace with**:
```typescript
useEffect(() => {
  if (!currentBoardId || status !== 'authenticated') return

  let cancelled = false
  let provider: HocuspocusProvider | null = null

  async function init() {
    // Single call: loads IndexedDB + connects WebSocket
    provider = await connectToBoard(currentBoardId)
    if (cancelled) {
      disconnectFromBoard()
      return
    }
    // Awareness (parallel)
    fetchRoomAwareness(currentBoardId)
  }

  init()

  return () => {
    cancelled = true
    disconnectFromBoard()
  }
}, [currentBoardId, status])
```

#### `src/lib/yjs-bindings.ts`

**Delete**:
- `pushStoreToYDoc()` — was used for REST→YJS seeding. No longer needed because Y.Doc IS the source.

**Keep** (unchanged):
- `setupYjsBindings()` — still the core two-way binding
- All observer logic
- Write path (`yjsWriteItem` etc.) — unchanged

**Subtle change**: Currently `pushStoreToYDoc()` checks if Y.Doc is empty and seeds from Zustand. After migration, if Y.Doc is empty, it IS an empty board. No seeding.

#### All content stores

No changes needed. Zustand mutations already go through `yjsWriteItem()` which writes to Y.Doc. Y.Doc observers already update Zustand. The stores are completely decoupled from REST sync.

### API routes to evaluate

| Route | Action |
|-------|--------|
| `src/app/api/board/` | Keep — board CRUD (metadata only, not content) |
| `src/app/api/board/[id]/content` | Delete — was REST content sync |
| Content-related PUT/POST endpoints | Delete |

---

## 5. Phase 5 — Board Listing from Metadata API

### Problem

Currently board listing comes from `BoardDocument` (which stores full content). After removing it, we need a lightweight source for the board list.

### Solution: BoardMetadata API

The Hocuspocus server maintains a `BoardMetadata` collection (see Server Migration doc). The frontend fetches board metadata for listing.

### Environment Variable

Add the collab server URL to your Next.js environment:

```env
NEXT_PUBLIC_COLLAB_SERVER_URL=https://collabserver.bords.app
```

### New API endpoint (Next.js)

Create `src/app/api/boards/route.ts` — a proxy to the collab server's `GET /api/boards` endpoint. The collab server handles access control by joining against `Bord.accessList` (there is **no** `collaborators` field on `BoardMetadata`):

```typescript
// GET /api/boards — proxy to collab server
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getSessionToken } from '@/lib/session'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = await getSessionToken(req)
  const res = await fetch(`${process.env.NEXT_PUBLIC_COLLAB_SERVER_URL}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch boards' }, { status: res.status })
  }

  const metadata = await res.json()
  return NextResponse.json(metadata)
}
```

> **Why proxy instead of direct MongoDB query?** The `BoardMetadata` collection has no `collaborators` field — access control lives in `Bord.accessList`, and the collab server's `GET /api/boards` endpoint handles the two-query join (Bord.accessList → BoardMetadata.$in). Querying BoardMetadata directly would bypass access control.

### Update `boardStore.ts` / board listing UI

Replace current board fetching:

```typescript
// Before: fetch from /api/board which returns full content
// After: fetch from /api/boards which returns lightweight metadata

fetchBoards: async () => {
  const res = await fetch('/api/boards')
  const metadata = await res.json()

  set({
    boards: metadata.map((m: BoardMetadataResponse) => ({
      id: m.boardId,
      name: m.title,
      userId: m.ownerId,
      permission: m.permission, // 'owner' | 'edit' | 'view' — returned by collab server
      lastModified: new Date(m.lastModifiedAt),
      lastModifiedBy: m.lastModifiedBy,
      // Item counts for preview badges
      itemCounts: m.itemCounts,
      backgroundImage: m.backgroundImage,
      backgroundColor: m.backgroundColor,
      // ID arrays no longer needed — content lives in Y.Doc
      notes: [],
      checklists: [],
      texts: [],
      connections: [],
      drawings: [],
      kanbans: [],
      medias: [],
      reminders: [],
      tables: [],
    }))
  })
}
```

### Board interface evolution

The `Board` interface will simplify:

```typescript
export interface Board {
  id: string
  userId: string
  name: string
  lastModified: Date
  // Preview metadata (from BoardMetadata)
  itemCounts?: {
    stickyNotes: number
    checklists: number
    kanbanBoards: number
    texts: number
    mediaItems: number
    connections: number
    drawings: number
    reminders: number
    tables: number
  }
  // Board-level settings (still in boardMeta Y.Map)
  contextType?: 'personal' | 'organization'
  organizationId?: string
  backgroundImage?: string
  backgroundColor?: string
  backgroundOverlay?: boolean
  backgroundOverlayColor?: string
  backgroundBlurLevel?: 'sm' | 'md' | 'lg' | 'xl'
}
```

The `notes: string[]`, `checklists: string[]`, etc. ID arrays become unnecessary — the Y.Doc holds all content, and `itemCounts` from metadata provides listing-level preview info.

### BoardMetadataResponse type

```typescript
interface BoardMetadataResponse {
  boardId: string
  title: string
  ownerId: string
  permission: 'owner' | 'edit' | 'view'  // attached by the collab server from Bord.accessList
  itemCounts: {
    stickyNotes: number
    checklists: number
    kanbanBoards: number
    texts: number
    mediaItems: number
    connections: number
    drawings: number
    reminders: number
    tables: number
  }
  lastModifiedAt: string           // ISO 8601
  lastModifiedBy: string | null
  backgroundImage: string | null
  backgroundColor: string | null
}
```

---

## 6. New Load Sequence

### Board List Screen

```
User opens app
  → GET /api/boards (Next.js proxy → collab server GET /api/boards)
  → BoardMetadataResponse[] → render board cards
  → Each card shows: title, last modified, item counts, background preview, permission badge
```

### Opening a Board

```
User clicks board
  1. setCurrentBoardId(id)
  2. connectToBoard(id)
     a. new Y.Doc()
     b. new IndexeddbPersistence('board-{id}', ydoc) → await 'synced'
        → Y.Doc now has local offline state (if any)
     c. setupYjsBindings(ydoc, id)
        → Observers fire → Zustand populated from local Y.Doc
        → UI renders immediately with offline data
     d. new HocuspocusProviderWebsocket({
          url: process.env.NEXT_PUBLIC_COLLAB_SERVER_URL + '/ws',
          // wss://collabserver.bords.app/ws
        })
     e. new HocuspocusProvider({
          name: id,              // documentName = boardId
          document: ydoc,
          websocketProvider: ws,
          token: sessionToken,   // NextAuth JWT
        })
     f. ws.connect()
        → Connects to wss://collabserver.bords.app/ws/{boardId}?token={jwt}
        → WebSocket sync merges remote changes
        → Observers fire again → Zustand updated with merged state
        → UI updates seamlessly
  3. fetchRoomAwareness(id)
     → GET {COLLAB_SERVER_URL}/api/rooms/{id}/awareness
     → Returns cursor positions, selections, editing states
```

### Closing a Board / Switching

```
  1. disconnectFromBoard()
     a. ws.disconnect()
     b. provider.destroy()
     c. indexeddbProvider.destroy()  // stops watching, does NOT delete data
  2. Clear Zustand stores for the board
  3. Navigate / open next board
```

### Offline Scenario

```
  1. connectToBoard(id)
     a. IndexedDB loads → Y.Doc populated → Zustand rendered
     b. WebSocket fails to connect → retries in background
  2. User edits
     → Zustand → yjsWriteItem() → Y.Doc → IndexedDB (automatic)
     → Edits are persisted locally
  3. Network returns
     → WebSocket reconnects → CRDT merge → all changes propagated
     → No data loss, no conflicts
```

---

## 7. File-by-File Change List

### Phase 1 (y-indexeddb)

| File | Change |
|------|--------|
| `package.json` | Add `y-indexeddb` |
| `src/lib/yjs-provider.ts` | Add `IndexeddbPersistence`, await sync before WS connect |
| `src/app/page.tsx` | Minor: remove hash dependency if ready |

### Phase 4 (Remove REST sync)

| File | Change |
|------|--------|
| `src/lib/boardData.ts` | **DELETE** |
| `src/store/boardSyncStore.ts` | Remove ~1000 lines of content sync. Keep board CRUD/sharing |
| `src/app/page.tsx` | Remove REST pull/push, simplify to connectToBoard() only |
| `src/lib/yjs-bindings.ts` | Remove `pushStoreToYDoc()` |
| `src/app/api/board/[id]/content/` | **DELETE** content endpoints |
| `src/store/boardStore.ts` | Remove ID arrays from Board interface |

### Phase 5 (Metadata-based listing)

| File | Change |
|------|--------|
| `.env.local` | Add `NEXT_PUBLIC_COLLAB_SERVER_URL=https://collabserver.bords.app` |
| `src/app/api/boards/route.ts` | **NEW** — proxy to collab server `GET /api/boards` |
| `src/store/boardStore.ts` | Refactor `fetchBoards()` to use metadata API, add `permission` field |
| `src/store/boardSyncStore.ts` | Board creation → collab server auto-creates metadata on first Y.Doc save |
| Board list UI components | Update to show itemCounts, permission badges, remove content-based previews |

---

## 8. Migration Safety & Rollback

### Graduated rollout

1. **Phase 1 is additive** — y-indexeddb runs alongside existing REST sync. Both persist. If anything breaks, REST sync is still there.
2. **Phase 4 needs a feature flag**:
   ```typescript
   const USE_REST_SYNC = process.env.NEXT_PUBLIC_USE_REST_SYNC === 'true'
   ```
   Keep REST sync code behind the flag during testing. Remove after validation.

### Data migration

Before enabling Phase 4, ensure all existing boards have Y.Doc state:
1. Run a migration script that loads each `BoardDocument` content and pushes it into a Y.Doc
2. Persist those Y.Docs via Hocuspocus server
3. Verify by loading each board — Y.Doc should match REST content

### IndexedDB cleanup

- When a board is deleted, also clear its IndexedDB:
  ```typescript
  import { clearDocument } from 'y-indexeddb'
  await clearDocument(`board-${boardId}`)
  ```
- Consider max storage: Large boards with media URLs could take significant IndexedDB space. Monitor with `navigator.storage.estimate()`.

### Versioning

Add a version marker to the Y.Doc's `boardMeta` map:
```typescript
yjsWriteBoardMeta(ydoc, 'schemaVersion', 2)
```
This allows future schema migrations of the Y.Doc structure itself.

---

## 9. Collab Server API Endpoints Reference

All endpoints below are on the Hocuspocus collab server (`NEXT_PUBLIC_COLLAB_SERVER_URL`). Auth is via NextAuth JWT — pass as `Authorization: Bearer <token>` or via session cookie.

> Full documentation: see `server/API_DOCUMENTATION.md`

### Board Listing & Search

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/boards` | List all accessible boards (metadata + permission) |
| `GET` | `/api/boards/search?q=` | Full-text search across board titles and content |

### Real-Time Collaboration

| Method | Path | Description |
|--------|------|-------------|
| `WS` | `/ws/:boardId?token=` | Hocuspocus WebSocket (Y.Doc sync + awareness) |
| `GET` | `/api/rooms/:boardId/connections` | List connected users |
| `GET` | `/api/rooms/:boardId/awareness` | Get cursor/selection awareness states |

### Calls (LiveKit)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/calls/create` | Start or join a call |
| `POST` | `/calls/join` | Join an active call |
| `POST` | `/calls/end` | Force-end a call |
| `GET` | `/calls/active/:boardId` | Check if call is active |
| `GET` | `/calls/history/:boardId` | Call history (owner only) |

### Deadlines

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/deadlines?days=7` | Upcoming incomplete deadlines across all accessible boards |

**Response shape** (array):
```json
[
  {
    "itemId": "item_001",
    "parentId": "checklist_abc",
    "parentType": "checklist",
    "text": "Review design specs",
    "dueDate": "2026-03-12T00:00:00.000Z",
    "completed": false,
    "assignedTo": "user_002",
    "boardId": "abc123",
    "boardTitle": "Project Plan"
  }
]
```

Deadlines are extracted server-side from checklist items, kanban tasks, and reminders that have a due date. The `days` parameter controls the lookahead window (default 7, max 90).

### Mentions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/mentions?unread=true` | Get @mentions for the current user |
| `PATCH` | `/api/mentions/mark-read` | Mark specific mentions as read |

**GET response shape** (array):
```json
[
  {
    "mentionedUserId": "user_002",
    "sourceType": "stickyNote",
    "sourceId": "note_abc",
    "text": "Hey @Bob can you review this?",
    "createdAt": "2026-03-10T14:30:00.000Z",
    "notified": false,
    "boardId": "abc123",
    "boardTitle": "Project Plan"
  }
]
```

**PATCH body**:
```json
{
  "boardId": "abc123",
  "mentionKeys": [
    { "sourceType": "stickyNote", "sourceId": "note_abc" }
  ]
}
```

Mentions are detected server-side via `@[Name](userId)` patterns in text. No board access check is needed — if you're mentioned, you can see it.

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Server health check |
| `GET` | `/admin/stats` | Admin | Detailed server stats |
