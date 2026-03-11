# Hocuspocus Migration Guide

## Overview

The collaboration server has been migrated from a **custom Y.js sync implementation** (manual sync protocol, awareness management, room lifecycle, persistence scheduling) to **[@hocuspocus/server](https://tiptap.dev/docs/hocuspocus/introduction)** — a production-grade Y.js backend that handles all of this internally.

This is a **breaking change** for the frontend WebSocket provider.

---

## What Changed on the Server

### Removed Files

| File | Purpose | Replaced By |
|------|---------|-------------|
| `services/yjs-room.ts` | Room lifecycle, connection tracking | Hocuspocus document management |
| `services/yjs-sync.ts` | Y.js sync protocol (SyncStep1/2, updates) | Hocuspocus sync layer |
| `services/awareness.ts` | Awareness state broadcasting | Hocuspocus built-in awareness |
| `types/room.ts` | Room/ConnectionInfo interfaces | `HocuspocusConnectionContext` |
| `types/awareness.ts` | Awareness type definitions | No longer needed |

### New / Modified Files

| File | Change |
|------|--------|
| `services/hocuspocus.ts` | **New** — Hocuspocus instance with Database extension, auth hook, persistence, helpers |
| `routes/collaboration.ts` | **Rewritten** — Delegates entirely to `hocuspocus.handleConnection()` |
| `routes/health.ts` | **Updated** — Uses Hocuspocus helpers for stats |
| `routes/rooms.ts` | **Updated** — Uses Hocuspocus document/connection APIs |
| `index.ts` | **Updated** — Imports `flushAllDocuments` for graceful shutdown |

### Kept (Still Used)

| File | Why |
|------|-----|
| `services/yjs-persistence.ts` | `saveYDoc()` used by Hocuspocus for legacy migration and shutdown flush |
| `services/migration.ts` | `migrateFromBoardDocument()` used by Hocuspocus Database fetch hook |
| `models/YjsDocument.ts` | MongoDB persistence model — unchanged |

### Server Behavior Changes

- **Authentication**: Token is now received via the Hocuspocus protocol handshake (not just URL query param). The `onAuthenticate` hook verifies JWT and checks board permissions.
- **Persistence**: Debounced writes — saves after 5 seconds of inactivity, or at most every 30 seconds. No more manual `PersistenceScheduler`.
- **Connection detection**: Built-in ping/pong with 30-second timeout replaces our custom heartbeat.
- **Read-only enforcement**: Viewers are marked `readOnly` at the protocol level via `connectionConfig.readOnly = true` in `onAuthenticate`. Hocuspocus blocks write operations from read-only connections automatically.
- **Document unloading**: Documents stay in memory briefly after the last disconnect (to respect the debounce timer for persistence), then auto-unload.
- **Legacy migration**: On first load of a board, if no `YjsDocument` exists but a legacy `BoardDocument` does, the server auto-migrates it to Y.js format.

---

## Frontend Changes Required

### 1. Install the Hocuspocus Provider

```bash
npm install @hocuspocus/provider
```

You can **remove** `y-websocket` if it was only used for the collaboration connection:

```bash
npm uninstall y-websocket
```

### 2. Replace the WebSocket Provider

**Before** (y-websocket):

```ts
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const ydoc = new Y.Doc()

const provider = new WebsocketProvider(
  'wss://collabserver.bords.app/ws',
  boardId,
  ydoc,
  {
    params: { token: sessionToken },
  }
)
```

**After** (Hocuspocus):

```ts
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'

const ydoc = new Y.Doc()

const provider = new HocuspocusProvider({
  url: 'wss://collabserver.bords.app/ws',
  name: boardId,         // maps to documentName on the server
  document: ydoc,
  token: sessionToken,   // sent via protocol, verified by onAuthenticate
})
```

### 3. Key Differences

| Feature | y-websocket (`WebsocketProvider`) | Hocuspocus (`HocuspocusProvider`) |
|---------|-----------------------------------|-----------------------------------|
| **Auth** | Token in URL query (`?token=xxx`) | Token sent via protocol message to `onAuthenticate` |
| **Awareness** | Needs separate configuration | Built-in, automatic (`provider.awareness`) |
| **Reconnection** | Basic retry | Exponential backoff with jitter (configurable) |
| **Sync** | Manual SyncStep1/SyncStep2 handling on server | Fully managed by Hocuspocus |
| **Read-only** | Server-side enforcement in message handler | Protocol-level enforcement (blocked before processing) |

### 4. Connection Events

```ts
// Connection status
provider.on('status', ({ status }) => {
  // status: 'connecting' | 'connected' | 'disconnected'
  console.log('Connection status:', status)
})

// Initial sync complete (document is up-to-date)
provider.on('synced', ({ state }) => {
  // state: true when sync is done
  console.log('Document synced:', state)
})

// Authentication failed (invalid/expired token, no board access)
provider.on('authenticationFailed', ({ reason }) => {
  console.error('Auth failed:', reason)
  // Handle: redirect to login, show error, etc.
})

// Connection closed
provider.on('close', ({ event }) => {
  console.log('Connection closed:', event)
})
```

### 5. Awareness (Cursors, Presence)

Awareness works the same way via the provider — no changes to how you read/write awareness state:

```ts
// Access awareness from the provider
const awareness = provider.awareness

// Set local state (cursor position, user info, etc.)
awareness.setLocalStateField('user', {
  name: userName,
  color: userColor,
  avatar: userAvatar,
})

// Listen for remote awareness changes
awareness.on('change', () => {
  const states = awareness.getStates()
  // Update cursor positions, user list, etc.
})
```

### 6. Provider Configuration Options

```ts
const provider = new HocuspocusProvider({
  url: 'wss://collabserver.bords.app/ws',
  name: boardId,
  document: ydoc,
  token: sessionToken,

  // Reconnection settings (defaults are good for most cases)
  delay: 1000,                    // Initial reconnect delay (ms)
  maxDelay: 30000,                // Max reconnect delay (ms)
  factor: 2,                      // Backoff multiplier
  maxAttempts: 0,                 // 0 = unlimited reconnect attempts

  // Set to false if you want to connect manually via provider.connect()
  connect: true,

  // Awareness instance (auto-created if not provided)
  // awareness: myAwareness,

  // Preserve shared types (Y.Map, Y.Array, etc.) between reconnects
  preserveConnection: true,

  // Broadcast changes to other connections on the same tab/page
  broadcast: true,

  // Called when the provider needs a fresh token (e.g., after expiry)
  onAuthenticationFailed: ({ reason }) => {
    // Refresh the session token and reconnect
    refreshToken().then(newToken => {
      provider.setToken(newToken)
      provider.connect()
    })
  },
})
```

### 7. Cleanup on Unmount

```ts
// When leaving a board or unmounting the component:
provider.destroy()
ydoc.destroy()
```

### 8. Remove Custom Code

The following frontend code is **no longer needed** and can be deleted:

- Manual sync protocol handling (encoding/decoding SyncStep1, SyncStep2, Update messages)
- Custom awareness broadcasting/encoding
- Manual WebSocket reconnection logic
- Heartbeat/ping-pong handling
- Token injection via URL query parameters (though it won't break if still present)

---

## Endpoint Reference (Unchanged)

The REST API endpoints remain the same:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ws/:boardId` | WebSocket | Collaboration connection (now Hocuspocus protocol) |
| `/health` | GET | Public health check |
| `/admin/stats` | GET | Admin-only server statistics |
| `/api/rooms/:boardId/connections` | GET | Connected users for a board |
| `/api/rooms/:boardId/awareness` | GET | Awareness states for a board |
| `/calls/*` | Various | Calling system (unchanged) |

---

## Deployment Notes

- No new environment variables required
- The `@hocuspocus/server` and `@hocuspocus/extension-database` packages have been added to `package.json`
- Memory usage should be lower — Hocuspocus auto-unloads documents when all clients disconnect (after persistence debounce completes)
- The server gracefully flushes all documents to MongoDB on shutdown signals (SIGTERM/SIGINT)
