# Bords Realtime Collaboration Server — Product Requirements Document

> **Target AI Agent:** Claude Opus 4.6  
> **Project:** Bords — Collaborative Whiteboard Application  
> **Server Framework:** Fastify (Node.js/TypeScript)  
> **Realtime Protocol:** Yjs + WebSocket (y-websocket compatible)  
> **Date:** March 2026

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture (As-Is)](#2-current-architecture-as-is)
3. [Target Architecture (To-Be)](#3-target-architecture-to-be)
4. [Functional Requirements](#4-functional-requirements)
5. [Project Structure](#5-project-structure)
6. [Technical Specifications](#6-technical-specifications)
7. [Database Schema Extensions](#7-database-schema-extensions)
8. [API Endpoints](#8-api-endpoints)
9. [WebSocket Protocol](#9-websocket-protocol)
10. [Yjs Document Structure](#10-yjs-document-structure)
11. [Authentication & Authorization](#11-authentication--authorization)
12. [Presence & Awareness](#12-presence--awareness)
13. [Persistence Strategy](#13-persistence-strategy)
14. [Frontend Integration Contract](#14-frontend-integration-contract)
15. [Scaling & Performance](#15-scaling--performance)
16. [Error Handling & Resilience](#16-error-handling--resilience)
17. [Deployment](#17-deployment)
18. [Security Requirements](#18-security-requirements)
19. [Implementation Phases](#19-implementation-phases)
20. [Testing Strategy](#20-testing-strategy)

---

## 1. Executive Summary

Bords is a Next.js whiteboard application that uses **tldraw** as the canvas engine and **9 Zustand stores** for state management. It currently syncs to MongoDB via REST with optimistic locking and 3-way merge conflict resolution. **Yjs is installed (`yjs@^13.6.29`) but unused.**

This PRD defines a **standalone Fastify server** that provides:

- **WebSocket-based Yjs document synchronization** for real-time multi-user collaboration
- **Presence/awareness** — cursor positions, user identities, active selections
- **Authenticated room management** — one Yjs document per board, permission-gated
- **MongoDB persistence** — Yjs document state persisted to the same MongoDB cluster
- **Horizontal scalability** — Redis pub/sub for multi-instance coordination

The Fastify server runs as a **separate process** from the Next.js app (different port, same deployment or separate service). The Next.js frontend connects to it via WebSocket for real-time sync, while the existing REST API continues to handle auth, user management, subscriptions, and non-realtime operations.

---

## 2. Current Architecture (As-Is)

### 2.1 Frontend State Flow

```
User Interaction
    → tldraw Editor (canvas)
    → sideEffects handlers (shape change/create/delete)
    → Zustand Store (stickyNoteStore, kanbanStore, etc.)
    → localStorage / IndexedDB persistence
    → Debounced REST sync (30s idle) → POST /api/boards/sync
```

### 2.2 Data Stores (9 Zustand Stores)

| Store | Content | Persistence |
|-------|---------|-------------|
| `boardStore` | Board metadata, item ID arrays | localStorage |
| `tldrawNativeStore` | Native geo/arrow/draw shapes | IndexedDB |
| `stickyNoteStore` | Sticky note data | localStorage |
| `checklistStore` | Checklist items | localStorage |
| `kanbanStore` | Kanban boards & tasks | localStorage |
| `textStore` | Text elements | localStorage |
| `mediaStore` | Media items (images/videos) | localStorage |
| `reminderStore` | Reminders | localStorage |
| `gridStore` | Grid settings | localStorage |

### 2.3 Cloud Sync Mechanism

- **Push:** `gatherBoardData()` → `POST /api/boards/sync` with `baseHash`
- **Conflict:** Server returns `409 MERGE_REQUIRED` + cloud state → client runs `mergeBoards()` (3-way diff)
- **Pull:** `GET /api/boards/sync/[boardId]` → `applyCloudData()` overwrites local
- **Stale Check:** `GET /api/boards/sync/check` — lightweight hash comparison (~50 bytes/board)
- **Hash:** djb2 locally, SHA-256 server-side

### 2.4 Auth System

- **NextAuth v4** with credentials + Google OAuth providers
- **Session model** in MongoDB (sessionToken-based)
- **JWT** for API auth (NextAuth session token in cookies)
- **Middleware:** `next-auth/middleware` protects routes

### 2.5 Sharing & Permissions (Already Implemented)

- Board `visibility`: `'private' | 'public' | 'shared'`
- `sharedWith`: `[{ userId, email, permission: 'view' | 'edit', addedAt }]`
- Organization-level: `Bord` model with `accessList` entries
- Public sharing via `shareToken` (UUID)

### 2.6 MongoDB Models

- `User` — email, passwordHash, provider, MFA settings
- `Session` — sessionToken, userId, expires
- `BoardDocument` — full board content, contentHash, version, owner, sharedWith
- `Bord` — org-level board reference with accessList
- `Workspace` — personal vs org context scoping

### 2.7 Connection Details

```env
MONGODB_URI=mongodb+srv://...@bords.98cropt.mongodb.net/bords
NEXTAUTH_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3001
```

---

## 3. Target Architecture (To-Be)

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js)                        │
│                                                             │
│  ┌─────────┐    ┌──────────────┐    ┌───────────────────┐  │
│  │ tldraw  │◄──►│  Yjs Y.Doc   │◄──►│  y-websocket      │  │
│  │ Editor  │    │  (per board) │    │  WebSocketProvider │  │
│  └────┬────┘    └──────┬───────┘    └─────────┬─────────┘  │
│       │                │                      │             │
│  ┌────▼────────────────▼───┐                  │             │
│  │  Zustand Stores         │                  │             │
│  │  (read from Y.Doc maps) │                  │             │
│  └─────────────────────────┘                  │             │
│                                               │             │
└───────────────────────────────────────────────┼─────────────┘
                                                │ ws://
                                                │
┌───────────────────────────────────────────────┼─────────────┐
│              FASTIFY SERVER (port 4444)        │             │
│                                               │             │
│  ┌────────────────────────────────────────────▼──────────┐  │
│  │  @fastify/websocket                                   │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Yjs WebSocket Handler                          │  │  │
│  │  │  ─ y-protocols (sync + awareness)               │  │  │
│  │  │  ─ Auth verification on upgrade                  │  │  │
│  │  │  ─ Permission check (owner/editor/viewer)       │  │  │
│  │  │  ─ Room management (1 room per board)           │  │  │
│  │  └──────────────┬──────────────────────────────────┘  │  │
│  └─────────────────┼─────────────────────────────────────┘  │
│                    │                                        │
│  ┌─────────────────▼─────────────────┐  ┌───────────────┐  │
│  │  Y.Doc In-Memory Cache            │  │  Redis Pub/Sub│  │
│  │  (per active room)                │  │  (multi-node) │  │
│  └─────────────────┬─────────────────┘  └───────┬───────┘  │
│                    │                            │           │
│  ┌─────────────────▼────────────────────────────▼────────┐  │
│  │  MongoDB Persistence Layer                             │  │
│  │  ─ Debounced flush (5s idle or 30s max)               │  │
│  │  ─ YjsDocument collection (binary Y.Doc state)        │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  REST Endpoints (Fastify)                              │  │
│  │  ─ GET /health                                         │  │
│  │  ─ GET /api/rooms/:boardId/connections                 │  │
│  │  ─ GET /api/rooms/:boardId/awareness                   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  MongoDB (shared)   │
              │  bords database     │
              │  ─ users            │
              │  ─ sessions         │
              │  ─ boarddocuments   │
              │  ─ yjsdocuments ★   │
              └─────────────────────┘
```

### 3.2 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Server framework | **Fastify** | Fastest Node.js HTTP framework, plugin architecture, TypeScript-first, schema validation |
| WebSocket library | **@fastify/websocket** (wraps `ws`) | Native Fastify integration, shares auth hooks |
| Yjs transport | **y-protocols** (sync + awareness) | Standard Yjs binary protocol, compatible with all Yjs providers |
| NOT using `y-websocket` server | Custom handler | `y-websocket` server is barebones — we need auth, permissions, MongoDB persistence, Redis pub/sub |
| Persistence | **MongoDB** (binary Yjs state vector) | Same cluster as existing data, no new infra dependency |
| Cross-instance sync | **Redis pub/sub** | Standard pattern for horizontal WS scaling, minimal latency |
| Auth verification | **Validate NextAuth session token against MongoDB** | Reuses existing auth — no new auth system needed |
| Document model | **One Y.Doc per board** | Maps directly to existing board model |
| Awareness protocol | **y-protocols/awareness** | Standard Yjs awareness for cursor/presence data |

---

## 4. Functional Requirements

### 4.1 Core Realtime Sync

| ID | Requirement | Priority |
|----|-------------|----------|
| F-1 | Multiple users can edit the same board simultaneously with sub-second sync | P0 |
| F-2 | All board item types sync in real-time: sticky notes, checklists, kanban boards, text, media references, reminders, tables, drawings, connections | P0 |
| F-3 | tldraw native shapes (geo, arrows, freehand, highlights) sync via tldraw's own Yjs binding | P0 |
| F-4 | Offline edits merge automatically when reconnecting (Yjs CRDT guarantee) | P0 |
| F-5 | Board background, overlay, and grid settings sync in real-time | P1 |
| F-6 | Item z-index ordering syncs consistently across clients | P1 |

### 4.2 Presence & Awareness

| ID | Requirement | Priority |
|----|-------------|----------|
| F-7 | See avatars/names of other users currently on the same board | P0 |
| F-8 | See other users' cursor positions on the canvas | P1 |
| F-9 | See which item another user is currently selecting/editing | P1 |
| F-10 | Presence updates within 100ms latency | P1 |

### 4.3 Permissions

| ID | Requirement | Priority |
|----|-------------|----------|
| F-11 | Only authenticated users can connect to WebSocket | P0 |
| F-12 | Only board owner or users in `sharedWith` with `'edit'` can write | P0 |
| F-13 | Users with `'view'` permission can connect read-only (receive sync, no write) | P0 |
| F-14 | Permission changes take effect within 10 seconds (no reconnect needed) | P1 |
| F-15 | Revoking access disconnects the user's WebSocket | P1 |

### 4.4 Persistence

| ID | Requirement | Priority |
|----|-------------|----------|
| F-16 | Y.Doc state persisted to MongoDB so rooms survive server restarts | P0 |
| F-17 | Persistence is debounced — flush after 5s of inactivity or 30s max | P0 |
| F-18 | When last user leaves a room, flush and unload Y.Doc from memory after 60s | P1 |
| F-19 | Y.Doc can be loaded from MongoDB when first user joins a room | P0 |
| F-20 | If no Y.Doc exists in MongoDB, initialize from existing `BoardDocument` data (migration) | P0 |

### 4.5 Compatibility

| ID | Requirement | Priority |
|----|-------------|----------|
| F-21 | Existing REST sync continues to work for non-collaborative (solo) boards | P0 |
| F-22 | The server co-exists with the Next.js app — separate process, same MongoDB | P0 |
| F-23 | Frontend can gracefully fall back to REST sync if WebSocket unavailable | P1 |

---

## 5. Project Structure

Create the Fastify server as a **separate directory** within the monorepo:

```
boards/
├── server/                          ★ NEW — Fastify collaboration server
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env                         (symlink or copy relevant vars from ../.env.local)
│   ├── src/
│   │   ├── index.ts                 — Server entry point (Fastify bootstrap)
│   │   ├── config.ts                — Environment config (typed, validated with zod)
│   │   ├── plugins/
│   │   │   ├── cors.ts              — CORS plugin config
│   │   │   ├── websocket.ts         — @fastify/websocket registration
│   │   │   ├── mongodb.ts           — MongoDB connection (reuse URI from env)
│   │   │   ├── redis.ts             — Redis pub/sub connection
│   │   │   └── auth.ts              — Auth verification plugin (decorates request)
│   │   ├── routes/
│   │   │   ├── health.ts            — GET /health
│   │   │   ├── collaboration.ts     — WebSocket upgrade route: /ws/:boardId
│   │   │   └── rooms.ts             — REST: room info, connected users
│   │   ├── services/
│   │   │   ├── yjs-room.ts          — Room lifecycle (create, join, leave, destroy)
│   │   │   ├── yjs-persistence.ts   — MongoDB load/save Y.Doc state
│   │   │   ├── yjs-sync.ts          — y-protocols sync message handling
│   │   │   ├── awareness.ts         — Awareness state management
│   │   │   ├── permissions.ts       — Board permission verification
│   │   │   └── migration.ts         — BoardDocument → Y.Doc initial migration
│   │   ├── models/
│   │   │   └── YjsDocument.ts       — Mongoose model for persisted Y.Doc state
│   │   ├── utils/
│   │   │   ├── logger.ts            — Pino logger config (Fastify default)
│   │   │   └── errors.ts            — Typed error classes
│   │   └── types/
│   │       ├── room.ts              — Room, Connection types
│   │       └── awareness.ts         — Awareness state types
│   ├── scripts/
│   │   └── migrate-boards.ts        — One-time migration: BoardDocument → YjsDocument
│   └── tests/
│       ├── unit/
│       │   ├── yjs-room.test.ts
│       │   ├── permissions.test.ts
│       │   └── yjs-persistence.test.ts
│       └── integration/
│           ├── websocket.test.ts
│           └── sync.test.ts
├── src/                             (existing Next.js app — frontend changes)
├── package.json                     (existing)
└── ...
```

---

## 6. Technical Specifications

### 6.1 Server Dependencies

```json
{
  "name": "@bords/collaboration-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "migrate": "tsx scripts/migrate-boards.ts"
  },
  "dependencies": {
    "fastify": "^5.3.3",
    "@fastify/websocket": "^11.0.2",
    "@fastify/cors": "^10.0.2",
    "@fastify/rate-limit": "^10.2.2",
    "yjs": "^13.6.29",
    "y-protocols": "^1.0.6",
    "lib0": "^0.2.99",
    "mongoose": "^9.1.1",
    "ioredis": "^5.6.1",
    "zod": "^4.3.4",
    "pino": "^9.6.0"
  },
  "devDependencies": {
    "typescript": "^5.8.3",
    "tsx": "^4.19.4",
    "@types/node": "^22.0.0",
    "@types/ws": "^8.18.1",
    "vitest": "^3.2.2",
    "@fastify/type-provider-zod": "^4.0.0"
  }
}
```

### 6.2 Environment Variables

The Fastify server needs these environment variables (sourced from same `.env.local` or a separate `.env`):

```env
# Server
PORT=4444
HOST=0.0.0.0
NODE_ENV=development

# MongoDB (same as Next.js app)
MONGODB_URI=mongodb+srv://...@bords.98cropt.mongodb.net/bords

# Redis (for multi-instance pub/sub)
REDIS_URL=redis://localhost:6379

# Auth (shared secret with Next.js for session validation)
NEXTAUTH_SECRET=your-super-secret-key-change-this-in-production

# CORS
CORS_ORIGIN=http://localhost:3001

# Logging
LOG_LEVEL=info
```

### 6.3 Server Entry Point (`src/index.ts`)

```typescript
import Fastify from 'fastify'
import { config } from './config.js'
import { mongodbPlugin } from './plugins/mongodb.js'
import { corsPlugin } from './plugins/cors.js'
import { websocketPlugin } from './plugins/websocket.js'
import { redisPlugin } from './plugins/redis.js'
import { authPlugin } from './plugins/auth.js'
import { healthRoutes } from './routes/health.js'
import { collaborationRoutes } from './routes/collaboration.js'
import { roomRoutes } from './routes/rooms.js'

const server = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    transport: config.NODE_ENV === 'development'
      ? { target: 'pino-pretty' }
      : undefined,
  },
})

// Plugins (order matters)
await server.register(corsPlugin)
await server.register(mongodbPlugin)
await server.register(redisPlugin)
await server.register(authPlugin)
await server.register(websocketPlugin)

// Routes
await server.register(healthRoutes)
await server.register(collaborationRoutes, { prefix: '/ws' })
await server.register(roomRoutes, { prefix: '/api/rooms' })

// Graceful shutdown
const shutdown = async (signal: string) => {
  server.log.info(`Received ${signal}, flushing all Y.Doc rooms...`)
  // Flush all active rooms to MongoDB
  await flushAllRooms()
  await server.close()
  process.exit(0)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

await server.listen({ port: config.PORT, host: config.HOST })
```

### 6.4 TypeScript Configuration (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

---

## 7. Database Schema Extensions

### 7.1 New Collection: `yjsdocuments`

```typescript
// server/src/models/YjsDocument.ts
import { Schema, model } from 'mongoose'

const yjsDocumentSchema = new Schema({
  // The board this Y.Doc belongs to
  boardId: {
    type: String,        // matches BoardDocument.localBoardId
    required: true,
    unique: true,
    index: true,
  },

  // Binary Yjs state — the entire Y.Doc encoded via Y.encodeStateAsUpdate()
  state: {
    type: Buffer,
    required: true,
  },

  // State vector for efficient incremental sync
  stateVector: {
    type: Buffer,
    default: null,
  },

  // Metadata
  version: {
    type: Number,
    default: 1,
  },

  lastModifiedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },

  connectedClients: {
    type: Number,
    default: 0,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },

  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
})

// Index for cleanup queries
yjsDocumentSchema.index({ updatedAt: 1 })

export const YjsDocument = model('YjsDocument', yjsDocumentSchema)
```

### 7.2 No Changes to Existing Models

The existing `BoardDocument`, `User`, `Session` models remain unchanged. The Fastify server reads them directly via Mongoose with the shared `MONGODB_URI`.

---

## 8. API Endpoints

### 8.1 Health Check

```
GET /health

Response 200:
{
  "status": "ok",
  "uptime": 12345,
  "activeRooms": 3,
  "totalConnections": 7,
  "mongoStatus": "connected",
  "redisStatus": "connected"
}
```

### 8.2 WebSocket Upgrade (Primary Endpoint)

```
GET /ws/:boardId
Upgrade: websocket
Connection: Upgrade

Query Parameters:
  - token: string (NextAuth session token — extracted from cookie or passed explicitly)

Headers:
  - Cookie: next-auth.session-token=... (alternative to query param)

On Upgrade Success:
  → WebSocket connection established
  → Server sends y-protocols sync step 1
  → Awareness state exchanged

On Failure:
  - 401 Unauthorized — invalid or expired session
  - 403 Forbidden — no access to this board
  - 404 Not Found — board does not exist
  - 429 Too Many Requests — rate limited
```

### 8.3 Room Info

```
GET /api/rooms/:boardId/connections

Headers:
  Authorization: Bearer <sessionToken>

Response 200:
{
  "boardId": "abc123",
  "connectedUsers": [
    {
      "userId": "user1",
      "name": "Alice",
      "email": "alice@example.com",
      "avatar": "https://...",
      "permission": "edit",
      "connectedAt": "2026-03-09T10:00:00Z",
      "cursor": { "x": 150, "y": 300 }
    }
  ],
  "totalConnections": 2
}
```

### 8.4 Active Awareness State

```
GET /api/rooms/:boardId/awareness

Headers:
  Authorization: Bearer <sessionToken>

Response 200:
{
  "states": [
    {
      "clientId": 12345,
      "user": { "id": "user1", "name": "Alice", "color": "#e57373" },
      "cursor": { "x": 150, "y": 300 },
      "selection": ["shape:abc123"],
      "editingItem": "note:xyz789"
    }
  ]
}
```

---

## 9. WebSocket Protocol

### 9.1 Message Types (Binary)

The WebSocket uses **binary frames** with the standard Yjs protocol encoding from `y-protocols`:

```
Byte 0: Message Type
  0 = sync message    (y-protocols/sync)
  1 = awareness update (y-protocols/awareness)
  2 = auth message     (custom)

For sync messages (type 0), byte 1:
  0 = syncStep1 (client sends state vector, server responds with missing updates)
  1 = syncStep2 (server sends missing updates)
  2 = update    (incremental change broadcast)

For awareness messages (type 1):
  Standard y-protocols awareness encoding
  Contains: cursor position, user info, selection state

For auth messages (type 2), byte 1:
  0 = permission denied (server → client, readonly user tried to write)
  1 = permission changed (server → client, permission was updated)
  2 = kicked (server → client, access revoked, close connection)
```

### 9.2 Connection Lifecycle

```
Client                          Server
  │                               │
  │──── WS upgrade request ──────►│
  │     (with session token)      │
  │                               │── Verify session token against MongoDB sessions
  │                               │── Check board permissions (owner/sharedWith)
  │                               │── Load or create Y.Doc for this boardId
  │                               │── Add connection to room
  │                               │
  │◄─── syncStep1 ───────────────│  (server sends its state vector)
  │──── syncStep1 ──────────────►│  (client sends its state vector)
  │◄─── syncStep2 ───────────────│  (server sends missing updates)
  │──── syncStep2 ──────────────►│  (client sends missing updates)
  │                               │
  │◄─── awareness ───────────────│  (server sends existing awareness states)
  │──── awareness ──────────────►│  (client sends its awareness state)
  │                               │
  │      ═══ SYNCED ═══          │
  │                               │
  │──── update ─────────────────►│  (client makes edit)
  │                               │── Apply update to Y.Doc
  │                               │── Broadcast to other clients in room
  │                               │── Schedule debounced persist to MongoDB
  │◄───── update (from others) ──│
  │                               │
  │──── awareness ──────────────►│  (cursor moved)
  │                               │── Broadcast to other clients
  │◄─── awareness ──────────────│
  │                               │
  │──── close ──────────────────►│
  │                               │── Remove from room
  │                               │── Broadcast awareness removal
  │                               │── If last client, schedule room cleanup
```

### 9.3 Read-Only Client Handling

When a `viewer` connects:
- They receive all sync and awareness messages (full real-time view)
- If they send a sync `update` message, the server:
  - Does **not** apply it to the Y.Doc
  - Sends back an auth message `type=2, byte1=0` (permission denied)
  - Does **not** disconnect them (graceful degradation)
- Their awareness state is still broadcast (so editors see the viewer's cursor)

---

## 10. Yjs Document Structure

### 10.1 Y.Doc Map Layout

Each board gets **one Y.Doc** with the following shared types:

```typescript
// The Y.Doc structure mirrors the Zustand stores
const ydoc = new Y.Doc()

// Board metadata
const boardMeta = ydoc.getMap('board')
// Keys: 'name', 'backgroundColor', 'backgroundImage', 'backgroundOverlay',
//       'backgroundOverlayColor', 'backgroundBlurLevel'

// Item collections — each is a Y.Map<Y.Map<any>>
// Outer map key = item ID, inner map = item properties
const stickyNotes    = ydoc.getMap('stickyNotes')
const checklists     = ydoc.getMap('checklists')
const kanbanBoards   = ydoc.getMap('kanbanBoards')
const texts          = ydoc.getMap('texts')
const mediaItems     = ydoc.getMap('mediaItems')
const reminders      = ydoc.getMap('reminders')
const tables         = ydoc.getMap('tables')
const connections    = ydoc.getMap('connections')
const drawings       = ydoc.getMap('drawings')

// tldraw native shapes — stored as a Y.Map mirroring tldraw's store
const tldrawShapes   = ydoc.getMap('tldrawShapes')
const tldrawBindings = ydoc.getMap('tldrawBindings')
const tldrawAssets   = ydoc.getMap('tldrawAssets')

// Board item membership (which items belong to this board)
const boardItems = ydoc.getMap('boardItems')
// Keys: 'notes', 'checklists', 'texts', 'connections', ...
// Values: Y.Array<string> (item IDs)

// Z-index ordering
const zIndex = ydoc.getArray('zIndex')

// Grid settings
const gridSettings = ydoc.getMap('gridSettings')
```

### 10.2 Example: Sticky Note in Y.Doc

```typescript
// Adding a sticky note
const stickyNotes = ydoc.getMap('stickyNotes')
const noteMap = new Y.Map()
noteMap.set('id', 'note-abc123')
noteMap.set('content', 'Hello world')
noteMap.set('x', 200)
noteMap.set('y', 150)
noteMap.set('width', 200)
noteMap.set('height', 200)
noteMap.set('color', '#FFEB3B')
noteMap.set('fontSize', 14)
noteMap.set('fontFamily', 'default')
noteMap.set('textAlign', 'left')
noteMap.set('rotation', 0)
noteMap.set('locked', false)
noteMap.set('createdAt', Date.now())
noteMap.set('lastModifiedBy', 'user-xyz')

stickyNotes.set('note-abc123', noteMap)
```

### 10.3 Kanban Board Nested Structure

```typescript
const kanbanBoards = ydoc.getMap('kanbanBoards')
const board = new Y.Map()
board.set('id', 'kanban-1')
board.set('title', 'Sprint Board')
board.set('x', 500)
board.set('y', 100)

// Columns as nested Y.Array of Y.Maps
const columns = new Y.Array()
const col1 = new Y.Map()
col1.set('id', 'col-1')
col1.set('title', 'To Do')
const tasks1 = new Y.Array()
// Each task is a Y.Map
const task = new Y.Map()
task.set('id', 'task-1')
task.set('title', 'Implement feature')
task.set('assignee', 'user-xyz')
tasks1.push([task])
col1.set('tasks', tasks1)
columns.push([col1])

board.set('columns', columns)
kanbanBoards.set('kanban-1', board)
```

### 10.4 tldraw Native Shapes

tldraw v4 has its own store format. Each shape is stored with its tldraw ID:

```typescript
const tldrawShapes = ydoc.getMap('tldrawShapes')

// Each tldraw shape gets serialized as JSON and stored
tldrawShapes.set('shape:abc123', {
  id: 'shape:abc123',
  type: 'geo',
  x: 100,
  y: 200,
  props: {
    geo: 'rectangle',
    w: 300,
    h: 200,
    color: 'black',
    fill: 'none',
    // ... standard tldraw props
  },
  rotation: 0,
  // ...
})
```

> **Note:** tldraw v4 has experimental Yjs bindings (`@tldraw/sync`). Evaluate whether to use tldraw's built-in sync adapter or manage tldraw shapes manually in Y.Maps. The recommended approach is to use tldraw's `useSync` + `TLSocketClientOptions` if available, or fall back to serializing tldraw store snapshots into Y.Maps. Check tldraw v4 docs at build time.

---

## 11. Authentication & Authorization

### 11.1 WebSocket Auth Flow

```typescript
// server/src/plugins/auth.ts

// Strategy: Validate NextAuth session token against MongoDB sessions collection

async function verifySession(token: string): Promise<User | null> {
  // 1. Look up session in MongoDB sessions collection
  const session = await SessionModel.findOne({
    sessionToken: token,
    expires: { $gt: new Date() },
  })

  if (!session) return null

  // 2. Look up the user
  const user = await UserModel.findById(session.userId)
  return user
}

// On WebSocket upgrade:
async function authenticateWsUpgrade(request: FastifyRequest): Promise<{
  user: User
  permission: 'owner' | 'edit' | 'view'
}> {
  // Extract token from:
  // 1. Query param: ?token=...
  // 2. Cookie: next-auth.session-token=...
  const token = request.query.token
    || parseCookies(request.headers.cookie)['next-auth.session-token']

  if (!token) throw new Unauthorized('No session token')

  const user = await verifySession(token)
  if (!user) throw new Unauthorized('Invalid or expired session')

  // Check board permission
  const boardId = request.params.boardId
  const permission = await checkBoardPermission(user._id, boardId)
  if (!permission) throw new Forbidden('No access to this board')

  return { user, permission }
}
```

### 11.2 Board Permission Check

```typescript
// server/src/services/permissions.ts

async function checkBoardPermission(
  userId: string,
  boardId: string
): Promise<'owner' | 'edit' | 'view' | null> {
  const board = await BoardDocument.findOne({ localBoardId: boardId })
  if (!board) return null

  // Owner
  if (board.owner.toString() === userId) return 'owner'

  // Shared with user
  const shareEntry = board.sharedWith?.find(
    s => s.userId?.toString() === userId
  )
  if (shareEntry) return shareEntry.permission // 'edit' or 'view'

  // Org-level access (via Bord model)
  const bord = await Bord.findOne({ localBoardId: boardId })
  if (bord) {
    const access = bord.accessList?.find(
      a => a.userId?.toString() === userId
    )
    if (access) return access.permission
  }

  // Public board
  if (board.visibility === 'public') return 'view'

  return null
}
```

### 11.3 Token Passing from Frontend

The frontend passes the NextAuth session token to the WebSocket:

```typescript
// Frontend: How to connect
const sessionToken = document.cookie
  .split('; ')
  .find(c => c.startsWith('next-auth.session-token='))
  ?.split('=')[1]

const wsProvider = new WebsocketProvider(
  'ws://localhost:4444/ws',
  boardId,            // room name = boardId
  ydoc,
  {
    params: { token: sessionToken },
    connect: true,
    // y-websocket provider handles reconnection
    resyncInterval: 5000,  // resync every 5s for consistency
  }
)
```

---

## 12. Presence & Awareness

### 12.1 Awareness State Shape

```typescript
// server/src/types/awareness.ts

interface AwarenessUserState {
  user: {
    id: string
    name: string
    email: string
    avatar: string | null
    color: string          // Unique color assigned per session
  }
  cursor: {
    x: number
    y: number
  } | null
  selection: string[]       // IDs of selected tldraw shapes
  editingItem: string | null // ID of item being edited (e.g., "note:abc123")
  viewportCenter: {
    x: number
    y: number
    zoom: number
  }
  lastActive: number        // timestamp
}
```

### 12.2 Color Assignment

Each user gets a consistent color derived from their user ID:

```typescript
const PRESENCE_COLORS = [
  '#e57373', '#f06292', '#ba68c8', '#9575cd',
  '#7986cb', '#64b5f6', '#4fc3f7', '#4dd0e1',
  '#4db6ac', '#81c784', '#aed581', '#dce775',
  '#fff176', '#ffd54f', '#ffb74d', '#ff8a65',
]

function getUserColor(userId: string): string {
  let hash = 0
  for (const char of userId) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0)
    hash |= 0
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length]
}
```

### 12.3 Server-Side Awareness Handling

```typescript
// The server acts as awareness relay:
// 1. Receives awareness update from client A
// 2. Broadcasts to all other clients in the same room
// 3. Does NOT persist awareness to MongoDB (ephemeral)
// 4. When client disconnects, broadcasts awareness removal

// Cleanup:
// - On WS close: remove client's awareness state, broadcast to room
// - Stale detection: if a client hasn't sent awareness in 30s, remove
```

---

## 13. Persistence Strategy

### 13.1 Y.Doc Lifecycle

```
Room does not exist in memory
    │
    ▼
First client connects to boardId
    │
    ▼
Load Y.Doc from MongoDB (yjsdocuments collection)
    │ If not found:
    │   ├── Check BoardDocument exists
    │   │   └── Yes → Run migration: BoardDocument → Y.Doc
    │   └── No → Create empty Y.Doc
    │
    ╿ Store Y.Doc in memory (Map<boardId, Room>)
    │
    ▼
Clients sync via y-protocols
    │
    │ On every Y.Doc update:
    │   └── Schedule debounced persist (5s idle / 30s max)
    │
    ▼
Last client disconnects
    │
    ╿ Immediate flush to MongoDB
    │ Start 60s unload timer
    │
    ▼ (after 60s with no connections)
Room destroyed, Y.Doc garbage collected
```

### 13.2 Persistence Implementation

```typescript
// server/src/services/yjs-persistence.ts

import * as Y from 'yjs'
import { YjsDocument } from '../models/YjsDocument.js'

export async function loadYDoc(boardId: string): Promise<Y.Doc> {
  const ydoc = new Y.Doc()

  const stored = await YjsDocument.findOne({ boardId })
  if (stored?.state) {
    Y.applyUpdate(ydoc, new Uint8Array(stored.state))
  }

  return ydoc
}

export async function saveYDoc(boardId: string, ydoc: Y.Doc): Promise<void> {
  const state = Buffer.from(Y.encodeStateAsUpdate(ydoc))
  const stateVector = Buffer.from(Y.encodeStateVector(ydoc))

  await YjsDocument.findOneAndUpdate(
    { boardId },
    {
      state,
      stateVector,
      updatedAt: new Date(),
      $inc: { version: 1 },
    },
    { upsert: true }
  )
}

// Debounced persistence per room
class PersistenceScheduler {
  private timers = new Map<string, NodeJS.Timeout>()
  private lastFlush = new Map<string, number>()
  private MAX_INTERVAL = 30_000  // 30s max between flushes
  private IDLE_DELAY = 5_000     // 5s idle before flush

  schedule(boardId: string, ydoc: Y.Doc) {
    // Clear existing idle timer
    const existing = this.timers.get(boardId)
    if (existing) clearTimeout(existing)

    // Check max interval
    const last = this.lastFlush.get(boardId) ?? 0
    const elapsed = Date.now() - last
    const delay = elapsed >= this.MAX_INTERVAL ? 0 : this.IDLE_DELAY

    this.timers.set(boardId, setTimeout(async () => {
      await saveYDoc(boardId, ydoc)
      this.lastFlush.set(boardId, Date.now())
      this.timers.delete(boardId)
    }, delay))
  }

  async flushAll(rooms: Map<string, Room>) {
    const promises = Array.from(rooms.entries()).map(
      ([boardId, room]) => saveYDoc(boardId, room.ydoc)
    )
    await Promise.allSettled(promises)
  }
}
```

### 13.3 Migration: BoardDocument → Y.Doc

For existing boards that have data in `BoardDocument` but no `YjsDocument`:

```typescript
// server/src/services/migration.ts

import * as Y from 'yjs'

export async function migrateFromBoardDocument(
  boardId: string
): Promise<Y.Doc> {
  const boardDoc = await BoardDocument.findOne({ localBoardId: boardId })
  if (!boardDoc) throw new Error(`Board ${boardId} not found`)

  const ydoc = new Y.Doc()

  // Migrate board metadata
  const boardMeta = ydoc.getMap('board')
  boardMeta.set('name', boardDoc.name || '')
  boardMeta.set('backgroundColor', boardDoc.backgroundColor || '')
  boardMeta.set('backgroundImage', boardDoc.backgroundImage || '')
  // ... other board settings

  // Migrate each collection
  const collections = [
    { key: 'stickyNotes', data: boardDoc.stickyNotes },
    { key: 'checklists', data: boardDoc.checklists },
    { key: 'kanbanBoards', data: boardDoc.kanbanBoards },
    { key: 'texts', data: boardDoc.texts },
    { key: 'mediaItems', data: boardDoc.mediaItems },
    { key: 'reminders', data: boardDoc.reminders },
    { key: 'tables', data: boardDoc.tables },
    { key: 'connections', data: boardDoc.connections },
    { key: 'drawings', data: boardDoc.drawings },
  ]

  for (const { key, data } of collections) {
    if (!data?.length) continue
    const ymap = ydoc.getMap(key)
    for (const item of data) {
      const itemMap = new Y.Map()
      for (const [prop, value] of Object.entries(item)) {
        if (prop === '_id') continue
        itemMap.set(prop, value)
      }
      ymap.set(item.id || item._id?.toString(), itemMap)
    }
  }

  // Migrate tldraw native shapes
  if (boardDoc.tldrawShapes?.length) {
    const shapesMap = ydoc.getMap('tldrawShapes')
    for (const shape of boardDoc.tldrawShapes) {
      shapesMap.set(shape.id, shape)
    }
  }

  // Migrate z-index
  if (boardDoc.zIndex?.length) {
    const zIndex = ydoc.getArray('zIndex')
    zIndex.push(boardDoc.zIndex)
  }

  // Persist the migrated Y.Doc
  await saveYDoc(boardId, ydoc)

  return ydoc
}
```

---

## 14. Frontend Integration Contract

### 14.1 New Frontend Dependencies

```bash
# Add to the main (Next.js) package.json
npm install y-websocket y-protocols
```

> **Note:** `yjs` is already installed.

### 14.2 Yjs Provider Setup (Frontend)

```typescript
// src/lib/yjs-provider.ts (NEW FILE — frontend)

import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

// Single Y.Doc per board — created when entering collaboration mode
let currentDoc: Y.Doc | null = null
let currentProvider: WebsocketProvider | null = null

export function connectToBoard(boardId: string): {
  ydoc: Y.Doc
  provider: WebsocketProvider
} {
  // Cleanup previous connection
  disconnect()

  const ydoc = new Y.Doc()

  // Get session token from cookie
  const token = getSessionToken()

  const provider = new WebsocketProvider(
    process.env.NEXT_PUBLIC_COLLAB_WS_URL || 'ws://localhost:4444/ws',
    boardId,
    ydoc,
    {
      params: { token },
      connect: true,
      resyncInterval: 5000,
    }
  )

  // Connection status events
  provider.on('status', ({ status }: { status: string }) => {
    // 'connecting' | 'connected' | 'disconnected'
    useCollabStore.getState().setConnectionStatus(status)
  })

  provider.on('connection-error', (event: Event) => {
    console.error('WebSocket connection error:', event)
    useCollabStore.getState().setConnectionStatus('error')
  })

  currentDoc = ydoc
  currentProvider = provider

  return { ydoc, provider }
}

export function disconnect() {
  currentProvider?.disconnect()
  currentProvider?.destroy()
  currentDoc?.destroy()
  currentProvider = null
  currentDoc = null
}

function getSessionToken(): string {
  return document.cookie
    .split('; ')
    .find(c => c.startsWith('next-auth.session-token='))
    ?.split('=')[1] ?? ''
}
```

### 14.3 Zustand Store ↔ Y.Doc Binding Pattern

The key integration challenge: Zustand stores must **read from AND write to** Y.Doc maps instead of local state when in collaboration mode.

```typescript
// Pattern for each store — example: stickyNoteStore

// BEFORE (current — local only):
addNote: (note) => set(state => ({
  notes: [...state.notes, note]
}))

// AFTER (collaboration-aware):
addNote: (note) => {
  const ydoc = useCollabStore.getState().ydoc
  if (ydoc) {
    // Write to Y.Doc — Yjs observer will update Zustand
    const stickyNotes = ydoc.getMap('stickyNotes')
    const noteMap = new Y.Map()
    Object.entries(note).forEach(([k, v]) => noteMap.set(k, v))
    stickyNotes.set(note.id, noteMap)
  } else {
    // Fallback: local-only mode (no collaboration)
    set(state => ({ notes: [...state.notes, note] }))
  }
}

// Y.Doc observer → Zustand sync (set up once per board):
ydoc.getMap('stickyNotes').observeDeep((events) => {
  // Convert Y.Map state to plain objects
  const notes = Array.from(ydoc.getMap('stickyNotes').entries())
    .map(([id, ymap]) => ymapToObject(ymap))
  useStickyNoteStore.setState({ notes })
})
```

### 14.4 tldraw ↔ Y.Doc Integration

For tldraw native shapes, evaluate these options at build time:

**Option A: tldraw's built-in sync (preferred if available in v4)**
```typescript
// If tldraw v4 exposes Yjs bindings:
import { useSync } from '@tldraw/sync'

// Use tldraw's own Y.Doc integration for its native shapes
// Custom Bords shapes still go through the Y.Map approach above
```

**Option B: Manual store snapshot sync**
```typescript
// Serialize tldraw store → Y.Map on every change
editor.store.listen((entry) => {
  const tldrawShapes = ydoc.getMap('tldrawShapes')
  for (const [id, record] of Object.entries(entry.changes.added)) {
    tldrawShapes.set(id, record)
  }
  for (const [id, record] of Object.entries(entry.changes.updated)) {
    tldrawShapes.set(id, record[1]) // [before, after]
  }
  for (const id of Object.keys(entry.changes.removed)) {
    tldrawShapes.delete(id)
  }
})

// Y.Map observer → tldraw store
ydoc.getMap('tldrawShapes').observe((event) => {
  // Apply changes to editor.store
})
```

### 14.5 New Environment Variable (Frontend)

Add to `.env.local`:

```env
NEXT_PUBLIC_COLLAB_WS_URL=ws://localhost:4444/ws
```

### 14.6 Awareness Integration (Frontend)

```typescript
// src/lib/yjs-awareness.ts (NEW FILE — frontend)

import { Awareness } from 'y-protocols/awareness'

export function setupAwareness(
  provider: WebsocketProvider,
  user: { id: string; name: string; avatar?: string; color: string }
) {
  const awareness = provider.awareness

  // Set local user state
  awareness.setLocalStateField('user', user)

  // Track cursor position
  // (Integrate with tldraw's pointer events)
  // awareness.setLocalStateField('cursor', { x, y })

  // Listen for remote awareness changes
  awareness.on('change', ({ added, updated, removed }: AwarenessChange) => {
    const states = Array.from(awareness.getStates().entries())
    useCollabStore.getState().setRemoteUsers(
      states
        .filter(([clientId]) => clientId !== awareness.clientID)
        .map(([clientId, state]) => ({
          clientId,
          ...state,
        }))
    )
  })

  return awareness
}
```

### 14.7 New Zustand Store: `collabStore`

```typescript
// src/store/collabStore.ts (NEW FILE — frontend)

interface CollabStore {
  // Connection state
  isCollaborating: boolean
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
  ydoc: Y.Doc | null
  provider: WebsocketProvider | null

  // Remote users
  remoteUsers: RemoteUser[]

  // Actions
  startCollaboration: (boardId: string) => void
  stopCollaboration: () => void
  setConnectionStatus: (status: string) => void
  setRemoteUsers: (users: RemoteUser[]) => void
}
```

---

## 15. Scaling & Performance

### 15.1 Single Instance Capacity

- Target: **500 concurrent WebSocket connections** per instance
- Target: **100 active rooms** per instance
- Memory budget: ~2MB per active Y.Doc (average board) = ~200MB for 100 rooms
- CPU: Yjs update application is O(n) where n = update size — typically <1ms

### 15.2 Multi-Instance with Redis

For horizontal scaling, use Redis pub/sub to relay updates between instances:

```
Instance A (user Alice)          Redis           Instance B (user Bob)
    │                              │                    │
    │── Alice edits ──►            │                    │
    │   Apply to Y.Doc             │                    │
    │   Broadcast to local clients │                    │
    │── PUBLISH board:xyz ────────►│                    │
    │   (binary Yjs update)        │                    │
    │                              │──►SUBSCRIBE────────│
    │                              │   board:xyz        │
    │                              │                    │── Apply to Y.Doc
    │                              │                    │   Broadcast to local
    │                              │                    │   clients (Bob sees it)
```

```typescript
// server/src/plugins/redis.ts

import Redis from 'ioredis'

// Two connections: one for pub, one for sub
const pub = new Redis(config.REDIS_URL)
const sub = new Redis(config.REDIS_URL)

// Subscribe to board channels for active rooms
function subscribeToRoom(boardId: string) {
  sub.subscribe(`board:${boardId}:sync`)
  sub.subscribe(`board:${boardId}:awareness`)
}

// Publish update from local edit
function publishUpdate(boardId: string, update: Uint8Array, origin: string) {
  pub.publishBuffer(
    `board:${boardId}:sync`,
    Buffer.from(update)
  )
}

// When receiving from Redis, apply to local Y.Doc and broadcast to local WS clients
sub.on('messageBuffer', (channel, message) => {
  const boardId = extractBoardId(channel)
  const room = rooms.get(boardId)
  if (!room) return

  Y.applyUpdate(room.ydoc, new Uint8Array(message), 'redis')
  broadcastToLocalClients(room, message, null) // null origin = from Redis
})
```

### 15.3 Room Cleanup

```typescript
// Unload rooms after inactivity to free memory
const ROOM_IDLE_TIMEOUT = 60_000  // 60 seconds after last client leaves

function scheduleRoomCleanup(boardId: string, room: Room) {
  room.cleanupTimer = setTimeout(async () => {
    if (room.connections.size === 0) {
      await saveYDoc(boardId, room.ydoc)
      room.ydoc.destroy()
      rooms.delete(boardId)
      unsubscribeFromRedis(boardId)
    }
  }, ROOM_IDLE_TIMEOUT)
}
```

### 15.4 Large Document Handling

For boards with many items (>500 shapes):

- **Incremental sync:** y-protocols always sends only the diff, not the full state
- **State vector optimization:** Store and use state vectors for efficient sync on reconnect
- **Subdocuments (future):** If Y.Doc size exceeds 10MB, consider splitting into Y.Doc subdocs per collection

---

## 16. Error Handling & Resilience

### 16.1 Connection Failures

| Scenario | Behavior |
|----------|----------|
| WebSocket drops mid-session | y-websocket auto-reconnects (default: exponential backoff). On reconnect, y-protocols sync step 1+2 resync the full state |
| Server crashes | All rooms lost from memory. On restart, Y.Doc reloaded from MongoDB. Clients will auto-reconnect and resync |
| MongoDB write fails | Log error + retry with exponential backoff. Do not crash the server. Y.Doc in memory is still authoritative |
| Redis unavailable | Fall back to single-instance mode (no cross-instance sync). Log warning. Reconnect to Redis when available |
| Client sends malformed message | Log + ignore. Do not crash the connection |
| Y.Doc state corruption | Detect via try/catch on `Y.applyUpdate()`. Log + reject the update. Notify client |

### 16.2 Reconnection Protocol

```
Client reconnects after drop:
  1. WebSocket upgrade + auth (same as initial connect)
  2. Server sends syncStep1 with current state vector
  3. Client sends syncStep1 with its local state vector
  4. Both exchange missing updates via syncStep2
  5. Any edits made offline are automatically merged (CRDT)
  6. Awareness state re-exchanged
  → Client is fully synced within ~100ms
```

### 16.3 Health Monitoring

```typescript
// Periodic health checks
setInterval(() => {
  const health = {
    activeRooms: rooms.size,
    totalConnections: Array.from(rooms.values())
      .reduce((sum, r) => sum + r.connections.size, 0),
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime(),
    mongoConnected: mongoose.connection.readyState === 1,
    redisConnected: pub.status === 'ready',
  }
  server.log.info(health, 'server-health')
}, 60_000)
```

---

## 17. Deployment

### 17.1 Development

```bash
# Terminal 1: Next.js frontend
cd /Users/aon/Desktop/MyWork/boards
npm run dev -- -p 3001

# Terminal 2: Fastify collaboration server
cd /Users/aon/Desktop/MyWork/boards/server
npm run dev
# → Runs on port 4444
```

### 17.2 Docker (Production)

```dockerfile
# server/Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
ENV NODE_ENV=production
EXPOSE 4444
CMD ["node", "dist/index.js"]
```

### 17.3 Docker Compose (Full Stack)

```yaml
version: '3.8'
services:
  frontend:
    build: .
    ports:
      - "3001:3001"
    environment:
      - NEXT_PUBLIC_COLLAB_WS_URL=ws://collab:4444/ws
    depends_on:
      - collab
      - redis

  collab:
    build: ./server
    ports:
      - "4444:4444"
    environment:
      - MONGODB_URI=${MONGODB_URI}
      - REDIS_URL=redis://redis:6379
      - NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
      - CORS_ORIGIN=http://localhost:3001
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

volumes:
  redis-data:
```

### 17.4 Production Deployment Options

| Platform | Notes |
|----------|-------|
| **Railway / Render** | Deploy as separate service. Set env vars. WebSocket support built-in |
| **AWS ECS / Fargate** | Container-based. Use ALB with WebSocket sticky sessions |
| **Fly.io** | Excellent WebSocket support. Auto-TLS. Use `fly-replay` header for room affinity |
| **VPS (DigitalOcean, Hetzner)** | PM2 for process management. Nginx reverse proxy with WebSocket upgrade |

### 17.5 Nginx WebSocket Proxy (VPS)

```nginx
upstream collab_server {
    server 127.0.0.1:4444;
}

server {
    listen 443 ssl;
    server_name collab.bords.app;

    location /ws/ {
        proxy_pass http://collab_server;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;  # 24h — keep WS alive
    }

    location / {
        proxy_pass http://collab_server;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 18. Security Requirements

### 18.1 Authentication

- [ ] Every WebSocket connection MUST be authenticated via NextAuth session token
- [ ] Session tokens are validated against MongoDB on every new connection
- [ ] Expired sessions are rejected immediately (HTTP 401 before upgrade)
- [ ] No anonymous WebSocket connections allowed (except public board viewers via shareToken — P2)

### 18.2 Authorization

- [ ] Board permission checked on every connection: owner, edit, view, or denied
- [ ] Read-only users (viewers) cannot send Yjs updates — server silently drops them
- [ ] Permission changes are checked periodically (every 60s) for long-lived connections
- [ ] Access revocation triggers immediate WebSocket disconnect

### 18.3 Transport Security

- [ ] WebSocket MUST use `wss://` in production (TLS)
- [ ] CORS origin restricted to the app domain (`CORS_ORIGIN` env var)
- [ ] Rate limiting: max 10 connection attempts per IP per minute (`@fastify/rate-limit`)
- [ ] Max message size: 5MB (reject larger Yjs updates)
- [ ] Max connections per user: 10 (across all boards — prevent resource exhaustion)

### 18.4 Data Validation

- [ ] All binary WebSocket messages validated as proper y-protocols encoding before processing
- [ ] Board IDs validated as proper format before room lookup
- [ ] Query parameters sanitized (token, boardId)
- [ ] No user-supplied data used in MongoDB queries without sanitization

### 18.5 Infrastructure

- [ ] MongoDB connection uses TLS (already enforced by Atlas)
- [ ] Redis connection uses TLS in production (`rediss://`)
- [ ] Environment variables never logged
- [ ] Health endpoint does not expose sensitive information
- [ ] Graceful shutdown flushes all Y.Doc state before exit

---

## 19. Implementation Phases

### Phase 1: Foundation (Week 1)

**Goal:** Fastify server boots, connects to MongoDB, serves health endpoint

- [ ] Initialize `server/` directory with `package.json`, `tsconfig.json`
- [ ] Install all dependencies
- [ ] Create `src/index.ts` — Fastify bootstrap with plugins
- [ ] Create `src/config.ts` — Zod-validated env config
- [ ] Create `src/plugins/mongodb.ts` — MongoDB connection (reuse existing URI)
- [ ] Create `src/plugins/cors.ts` — CORS configured for frontend origin
- [ ] Create `src/routes/health.ts` — Health check endpoint
- [ ] Verify server starts and connects to MongoDB
- [ ] Create `src/models/YjsDocument.ts` — Mongoose model

**Deliverable:** `npm run dev` starts Fastify on port 4444, `GET /health` returns OK with MongoDB status.

### Phase 2: WebSocket + Auth (Week 1-2)

**Goal:** Authenticated WebSocket connections with room management

- [ ] Create `src/plugins/websocket.ts` — @fastify/websocket registration
- [ ] Create `src/plugins/auth.ts` — Session token verification against MongoDB
- [ ] Create `src/services/permissions.ts` — Board permission checks
- [ ] Create `src/routes/collaboration.ts` — WebSocket upgrade route `/ws/:boardId`
- [ ] Implement auth verification on upgrade (reject 401/403 before WS handshake)
- [ ] Create `src/services/yjs-room.ts` — Room creation, join, leave, destroy
- [ ] In-memory room registry (`Map<boardId, Room>`)
- [ ] Connection tracking per room

**Deliverable:** Frontend can open WebSocket to `/ws/:boardId` with session token. Connection accepted for valid sessions, rejected for invalid.

### Phase 3: Yjs Sync Protocol (Week 2)

**Goal:** Full Yjs document synchronization over WebSocket

- [ ] Create `src/services/yjs-sync.ts` — y-protocols handler
- [ ] Implement sync step 1/2 exchange on connection
- [ ] Implement incremental update broadcast
- [ ] Handle read-only clients (drop writes, send permission error)
- [ ] Create `src/services/yjs-persistence.ts` — MongoDB load/save
- [ ] Implement debounced persistence (5s idle / 30s max)
- [ ] Implement room cleanup after last client leaves (60s timer)
- [ ] Graceful shutdown: flush all rooms on SIGTERM/SIGINT

**Deliverable:** Two browser tabs can connect to the same board and see each other's Yjs updates in real-time. Y.Doc persisted to MongoDB.

### Phase 4: Awareness & Presence (Week 2-3)

**Goal:** Cursor tracking and user presence

- [ ] Create `src/services/awareness.ts` — Awareness relay
- [ ] Implement awareness message broadcast
- [ ] Cleanup awareness on disconnect
- [ ] Create `src/routes/rooms.ts` — REST endpoints for room info
- [ ] Create `src/types/awareness.ts` — Type definitions

**Deliverable:** Connected users see each other's presence information.

### Phase 5: Migration & Compatibility (Week 3)

**Goal:** Existing boards work seamlessly with the new system

- [ ] Create `src/services/migration.ts` — BoardDocument → Y.Doc converter
- [ ] Auto-migrate on first connection to a board without a YjsDocument
- [ ] Create `scripts/migrate-boards.ts` — Bulk migration script
- [ ] Ensure REST sync continues to work for non-collaborative mode
- [ ] Handle edge case: REST sync pushes while WebSocket room is active (apply REST data to Y.Doc)

**Deliverable:** All existing boards load correctly through the WebSocket path.

### Phase 6: Redis Pub/Sub (Week 3-4)

**Goal:** Multi-instance horizontal scaling

- [ ] Create `src/plugins/redis.ts` — Redis connection
- [ ] Implement pub/sub for Yjs updates across instances
- [ ] Implement pub/sub for awareness across instances
- [ ] Handle Redis disconnection gracefully (fall back to single-instance)
- [ ] Room cleanup coordination across instances

**Deliverable:** Two server instances can serve the same board with clients on different instances seeing real-time updates.

### Phase 7: Frontend Integration (Week 4-5)

**Goal:** Bords frontend connects to collaboration server

> **Note:** This phase modifies the Next.js frontend, not the Fastify server.

- [ ] Create `src/lib/yjs-provider.ts` — WebSocket provider setup
- [ ] Create `src/lib/yjs-awareness.ts` — Awareness integration
- [ ] Create `src/store/collabStore.ts` — Collaboration state
- [ ] Bind Zustand stores to Y.Doc maps (observe + write pattern)
- [ ] Integrate tldraw with Yjs (evaluate `@tldraw/sync` vs manual binding)
- [ ] Add `NEXT_PUBLIC_COLLAB_WS_URL` to env
- [ ] Connection status UI indicator
- [ ] Presence avatars on the board
- [ ] Remote cursor rendering
- [ ] Graceful fallback to REST sync when WebSocket unavailable

**Deliverable:** Full end-to-end real-time collaboration between multiple users on the same board.

### Phase 8: Testing & Hardening (Week 5-6)

- [ ] Unit tests: permissions, persistence, room lifecycle
- [ ] Integration tests: WebSocket connect/sync/disconnect
- [ ] Load testing: 50+ concurrent connections to one room
- [ ] Chaos testing: kill server during active sessions, verify data integrity
- [ ] Security audit: auth bypass attempts, malformed messages, rate limiting
- [ ] Monitoring: structured logging, health endpoint, memory tracking

---

## 20. Testing Strategy

### 20.1 Unit Tests

```typescript
// tests/unit/permissions.test.ts
describe('checkBoardPermission', () => {
  it('returns "owner" for board owner')
  it('returns "edit" for shared user with edit permission')
  it('returns "view" for shared user with view permission')
  it('returns "view" for public board')
  it('returns null for unauthorized user')
  it('checks org-level access via Bord model')
})

// tests/unit/yjs-persistence.test.ts
describe('YjsDocument persistence', () => {
  it('saves Y.Doc state to MongoDB')
  it('loads Y.Doc state from MongoDB')
  it('creates new Y.Doc when none exists')
  it('increments version on save')
  it('handles concurrent saves correctly')
})

// tests/unit/yjs-room.test.ts
describe('Room lifecycle', () => {
  it('creates room on first connection')
  it('adds connections to existing room')
  it('removes connections on disconnect')
  it('schedules cleanup when last client leaves')
  it('cancels cleanup when new client joins')
  it('destroys room after timeout')
  it('flushes Y.Doc before destroy')
})
```

### 20.2 Integration Tests

```typescript
// tests/integration/websocket.test.ts
describe('WebSocket collaboration', () => {
  it('rejects connection without session token')
  it('rejects connection with expired session')
  it('rejects connection to nonexistent board')
  it('accepts connection for board owner')
  it('accepts connection for shared editor')
  it('accepts connection for viewer (read-only)')
  it('syncs Y.Doc between two clients')
  it('broadcasts updates to all clients in room')
  it('drops updates from read-only clients')
  it('handles client disconnect + reconnect')
  it('persists Y.Doc to MongoDB on flush')
  it('loads Y.Doc from MongoDB on room create')
  it('migrates BoardDocument to Y.Doc on first access')
})
```

### 20.3 Load Testing

Use `autocannon` or a custom WebSocket load test:

```bash
# Target: 50 concurrent connections to one board
# Measure: message latency, memory usage, CPU usage
# Duration: 5 minutes sustained
# Actions: each client sends 1 update/second
```

---

## Appendix A: Room Data Structure (Server)

```typescript
// server/src/types/room.ts

interface Room {
  boardId: string
  ydoc: Y.Doc
  awareness: Awareness
  connections: Map<WebSocket, ConnectionInfo>
  cleanupTimer: NodeJS.Timeout | null
  persistTimer: NodeJS.Timeout | null
  lastPersisted: number
  createdAt: number
}

interface ConnectionInfo {
  userId: string
  userName: string
  userAvatar: string | null
  permission: 'owner' | 'edit' | 'view'
  connectedAt: number
  clientId: number  // Yjs awareness client ID
}
```

## Appendix B: Message Flow Diagram

```
Alice (Editor)              Fastify Server              Bob (Editor)
     │                           │                           │
     │── Yjs update ────────────►│                           │
     │   (moved sticky note)     │                           │
     │                           │── Apply to Y.Doc          │
     │                           │── Schedule persist         │
     │                           │                           │
     │                           │── Broadcast update ──────►│
     │                           │   (to all except Alice)   │
     │                           │                           │
     │                           │       Carol (Viewer)      │
     │                           │── Broadcast update ──────►│
     │                           │   (Carol sees the change) │
     │                           │                           │
     │                           │                           │
     │── Awareness ─────────────►│                           │
     │   (cursor at 300,400)     │                           │
     │                           │── Relay awareness ───────►│
     │                           │── Relay awareness ───────►│ (Carol)
     │                           │                           │
     │                           │   5 seconds of idle...    │
     │                           │── Persist Y.Doc ─────────►│ MongoDB
     │                           │                           │
```

## Appendix C: Frontend File Checklist (New Files)

These files need to be created in the Next.js frontend:

| File | Purpose |
|------|---------|
| `src/lib/yjs-provider.ts` | WebSocket provider lifecycle |
| `src/lib/yjs-awareness.ts` | Presence/cursor broadcasting |
| `src/lib/yjs-bindings.ts` | Zustand store ↔ Y.Doc observers |
| `src/store/collabStore.ts` | Collaboration state (isCollaborating, remoteUsers, status) |
| `src/components/PresenceBar.tsx` | User avatars showing who's online |
| `src/components/RemoteCursor.tsx` | Render other users' cursors on canvas |
| `src/components/ConnectionStatus.tsx` | WebSocket status indicator |

## Appendix D: Critical Implementation Notes for AI Agent

1. **DO NOT use the `y-websocket` server package.** It's a minimal reference implementation. Build the WebSocket handler directly using `@fastify/websocket` + `y-protocols` for full control over auth, persistence, and scaling.

2. **DO NOT store Y.Doc as JSON.** Always use `Y.encodeStateAsUpdate()` → `Buffer` for MongoDB storage. JSON serialization loses CRDT metadata required for conflict-free merging.

3. **The Yjs version MUST match between frontend and backend.** Both use `yjs@^13.6.29` (already installed on frontend). Pin the same version in `server/package.json`.

4. **y-protocols message encoding is binary.** All WebSocket messages are `Uint8Array`, not JSON. Use `lib0/encoding` and `lib0/decoding` for message construction.

5. **The frontend already has 9 Zustand stores that persist to localStorage.** The Y.Doc observers must update these stores (not replace them) so the existing UI components continue working without changes.

6. **tldraw v4 shapes are in `tldrawNativeStore` (IndexedDB).** These need special handling — evaluate `@tldraw/sync` for Yjs binding or serialize via `editor.store.listen()`.

7. **The existing REST sync (`POST /api/boards/sync`) should NOT be disabled.** It serves as fallback when WebSocket is unavailable and for non-collaborative boards.

8. **MongoDB is shared between Next.js and Fastify.** Both connect to `bords` database on the same Atlas cluster. Models can be defined independently (Mongoose on both sides) but schemas must be compatible.

9. **The `BoardDocument.sharedWith` array is the source of truth for permissions.** The Fastify server reads this to gate WebSocket access. Changes made via the Next.js share API take effect on the next permission check.

10. **Session tokens are NOT JWTs in this app.** They are opaque strings stored in `sessions` collection. The Fastify server must query MongoDB to validate them — there is no secret-based verification shortcut.
