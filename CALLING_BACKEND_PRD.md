# Calling System — Backend PRD (Fastify Server)

## Feature: Real-Time Voice & Video Call Infrastructure

**Scope:** Phase 1 — Room management, token generation, call metadata  
**Framework:** Fastify (extends existing collab server at `ws://localhost:4444`)  
**Media:** LiveKit Cloud (Bords never touches media streams)

---

## 1. Overview

The Fastify server is responsible for:
- LiveKit room lifecycle management (create, track, cleanup)
- Access token generation with board-level permission checks
- Call metadata storage (who called, when, how long)
- Real-time call presence via the existing Yjs awareness channel
- Webhook receiver for LiveKit server events (participant joined/left, room closed)

The server does **NOT**:
- Handle media streams (LiveKit does this)
- Manage WebRTC signaling (LiveKit does this)
- Store recordings (out of scope for Phase 1)

---

## 2. Dependencies

### New packages

```
livekit-server-sdk           — Token generation + room management API
```

### Existing systems used

| System | How it's used |
|--------|---------------|
| MongoDB (via Mongoose) | Store call metadata (Call model) |
| Fastify server (`server/src/index.ts`) | Host new `/calls/*` REST routes |
| JWT auth (NEXTAUTH_SECRET) | Verify caller identity from collab ticket |
| Board permissions (MongoDB `bords` collection) | Authorize call access |
| Yjs awareness (y-protocols) | Already broadcasts presence — frontend extends with `inCall` field |

---

## 3. New Files

```
server/src/
├── routes/
│   └── calls.ts                — REST routes: create, join, end, active
├── services/
│   └── livekit.ts              — LiveKit SDK wrapper (token gen, room API)
├── models/
│   └── Call.ts                 — Mongoose schema for call metadata
└── webhooks/
    └── livekit.ts              — LiveKit webhook receiver
```

---

## 4. Environment Variables

```env
# LiveKit (server-side only)
LIVEKIT_API_KEY=<api-key>
LIVEKIT_API_SECRET=<api-secret>
LIVEKIT_HOST=https://<your-instance>.livekit.cloud

# Webhook verification
LIVEKIT_WEBHOOK_SECRET=<webhook-signing-secret>
```

These are added to the Fastify server's environment config, NOT to `.env.local` (except `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` which are also used by the Next.js API route for token generation).

---

## 5. Data Model — `Call`

### Mongoose Schema

```typescript
// server/src/models/Call.ts

const CallSchema = new Schema({
  boardId: {
    type: String,
    required: true,
    index: true,
  },
  roomName: {
    type: String,
    required: true,
    unique: true,
  },
  startedBy: {
    userId: String,
    name: String,
    email: String,
  },
  startedAt: {
    type: Date,
    default: Date.now,
  },
  endedAt: {
    type: Date,
    default: null,
  },
  status: {
    type: String,
    enum: ['active', 'ended'],
    default: 'active',
    index: true,
  },
  participants: [{
    userId: String,
    name: String,
    joinedAt: Date,
    leftAt: Date,
  }],
  peakParticipantCount: {
    type: Number,
    default: 1,
  },
  metadata: {
    // Future: AI summary, action items, etc.
    type: Schema.Types.Mixed,
    default: {},
  },
})

// Compound index for fast lookup
CallSchema.index({ boardId: 1, status: 1 })

// TTL index: auto-delete ended calls after 90 days
CallSchema.index({ endedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60, partialFilterExpression: { status: 'ended' } })
```

### Room name convention

```
board_<boardId>
```

Example: `board_abc-123-def-456`

One active call per board at a time. If a room already exists for the board, joining returns a token for the existing room.

---

## 6. REST Routes — `routes/calls.ts`

All routes require authentication via the same JWT ticket mechanism used for WebSocket auth.

### 6.1 `POST /calls/create`

**Purpose:** Start a new call on a board (or return existing if one is active).

**Auth:** JWT ticket in `Authorization: Bearer <token>` header.

**Request:**
```json
{
  "boardId": "abc-123"
}
```

**Logic:**
1. Verify JWT → extract `userId`, `email`, `name`
2. Check board permission:
   - Query MongoDB `bords` collection for board access
   - Must be `owner` or `editor` (viewers cannot start calls)
3. Check for existing active call on this board:
   - `Call.findOne({ boardId, status: 'active' })`
   - If exists → generate token for existing room (same as join)
4. If no active call:
   - Create LiveKit room via API: `roomService.createRoom({ name: roomName })`
   - Create `Call` document in MongoDB
5. Generate LiveKit access token (see Section 8)
6. Return token + room info

**Response (200):**
```json
{
  "token": "<livekit-jwt>",
  "url": "wss://your-instance.livekit.cloud",
  "room": "board_abc-123",
  "callId": "66a1b2c3d4e5f6...",
  "isNew": true
}
```

**Response (200, existing call):**
```json
{
  "token": "<livekit-jwt>",
  "url": "wss://your-instance.livekit.cloud",
  "room": "board_abc-123",
  "callId": "66a1b2c3d4e5f6...",
  "isNew": false,
  "participantCount": 3
}
```

**Errors:**
| Code | Reason |
|------|--------|
| 401 | Invalid/expired JWT |
| 403 | No access to board, or viewer role |
| 404 | Board not found |
| 500 | LiveKit API error |

---

### 6.2 `POST /calls/join`

**Purpose:** Join an existing call on a board.

**Auth:** JWT ticket in `Authorization: Bearer <token>` header.

**Request:**
```json
{
  "boardId": "abc-123"
}
```

**Logic:**
1. Verify JWT
2. Check board permission (owner, editor, OR viewer — viewers can join but not start)
3. Find active call: `Call.findOne({ boardId, status: 'active' })`
4. If no active call → return 404
5. Add participant to call document (if not already listed)
6. Generate LiveKit access token
7. Return token + room info

**Response (200):**
```json
{
  "token": "<livekit-jwt>",
  "url": "wss://your-instance.livekit.cloud",
  "room": "board_abc-123",
  "callId": "66a1b2c3d4e5f6...",
  "participantCount": 3
}
```

**Errors:**
| Code | Reason |
|------|--------|
| 401 | Invalid/expired JWT |
| 403 | No access to board |
| 404 | No active call on this board |

---

### 6.3 `POST /calls/end`

**Purpose:** Forcefully end a call (admin/owner action — normally calls end when last participant leaves via webhook).

**Auth:** JWT ticket — must be board `owner` or the user who `startedBy`.

**Request:**
```json
{
  "boardId": "abc-123"
}
```

**Logic:**
1. Verify JWT
2. Find active call
3. Verify permission (owner or call starter)
4. Delete LiveKit room: `roomService.deleteRoom(roomName)`
5. Update Call document: `status: 'ended'`, `endedAt: new Date()`
6. Set `leftAt` for all participants still in the call

**Response (200):**
```json
{
  "ended": true,
  "callId": "66a1b2c3d4e5f6...",
  "duration": 1823
}
```

---

### 6.4 `GET /calls/active/:boardId`

**Purpose:** Check if a call is active on a board (lightweight, no token generation).

**Auth:** JWT ticket.

**Request:** Board ID in URL path.

**Logic:**
1. Verify JWT
2. Check board access
3. Query: `Call.findOne({ boardId, status: 'active' }, 'roomName startedBy startedAt participants peakParticipantCount')`

**Response (200, call active):**
```json
{
  "active": true,
  "callId": "66a1b2c3d4e5f6...",
  "startedBy": { "name": "Alice", "userId": "u1" },
  "startedAt": "2026-03-10T14:30:00Z",
  "participantCount": 3
}
```

**Response (200, no call):**
```json
{
  "active": false
}
```

---

### 6.5 `GET /calls/history/:boardId`

**Purpose:** Return recent call history for a board (for future analytics UI).

**Auth:** JWT ticket — must be board owner.

**Request:**
- Path: `boardId`
- Query: `?limit=20&offset=0`

**Response (200):**
```json
{
  "calls": [
    {
      "callId": "66a1b2c3d4e5f6...",
      "startedBy": { "name": "Alice" },
      "startedAt": "2026-03-10T14:30:00Z",
      "endedAt": "2026-03-10T15:00:00Z",
      "duration": 1800,
      "peakParticipantCount": 4,
      "participants": [
        { "name": "Alice", "joinedAt": "...", "leftAt": "..." },
        { "name": "Bob", "joinedAt": "...", "leftAt": "..." }
      ]
    }
  ],
  "total": 42
}
```

---

## 7. LiveKit Service — `services/livekit.ts`

### Interface

```typescript
import { RoomServiceClient, AccessToken } from 'livekit-server-sdk'

// Initialize once at server startup
const roomService = new RoomServiceClient(
  process.env.LIVEKIT_HOST!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
)

export function createRoom(roomName: string): Promise<Room>
export function deleteRoom(roomName: string): Promise<void>
export function listParticipants(roomName: string): Promise<ParticipantInfo[]>

export function generateToken(params: {
  userId: string
  name: string
  avatar: string | null
  roomName: string
}): string
```

### Token generation

```typescript
export function generateToken({ userId, name, avatar, roomName }: {
  userId: string
  name: string
  avatar: string | null
  roomName: string
}): string {
  const token = new AccessToken(
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
    {
      identity: userId,
      name: name,
      metadata: JSON.stringify({ avatar }),
    }
  )
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  })
  // 4-hour expiry — calls can be long collaboration sessions
  token.ttl = 4 * 60 * 60
  return token.toJwt()
}
```

### Room creation

```typescript
export async function createRoom(roomName: string) {
  return roomService.createRoom({
    name: roomName,
    // Room auto-closes 5 minutes after last participant leaves
    emptyTimeout: 300,
    // Max 100 participants per room
    maxParticipants: 100,
  })
}
```

---

## 8. Webhook Receiver — `webhooks/livekit.ts`

### Purpose

LiveKit sends server-side events when participants join, leave, or rooms close. This keeps the `Call` document in sync with reality (even if a client disconnects ungracefully).

### Route

```
POST /webhooks/livekit
```

**Auth:** LiveKit signs webhooks with `LIVEKIT_WEBHOOK_SECRET`. Verify signature before processing.

### Events handled

#### `participant_joined`

```typescript
// Update Call document — add participant if not already listed
await Call.updateOne(
  { roomName: event.room.name, status: 'active' },
  {
    $push: {
      participants: {
        userId: event.participant.identity,
        name: event.participant.name,
        joinedAt: new Date(),
      }
    },
    $max: { peakParticipantCount: currentCount }
  }
)
```

#### `participant_left`

```typescript
// Update participant's leftAt timestamp
await Call.updateOne(
  {
    roomName: event.room.name,
    status: 'active',
    'participants.userId': event.participant.identity,
    'participants.leftAt': null,
  },
  {
    $set: { 'participants.$.leftAt': new Date() }
  }
)
```

#### `room_finished`

```typescript
// Mark call as ended
await Call.updateOne(
  { roomName: event.room.name, status: 'active' },
  {
    $set: {
      status: 'ended',
      endedAt: new Date(),
    }
  }
)
```

This is the authoritative signal that a call has ended — it fires when LiveKit's `emptyTimeout` expires after the last participant leaves.

---

## 9. Authentication Flow

Reuses the existing collab ticket mechanism:

```
1. Frontend: GET /api/collab/ticket
   → Returns JWT signed with NEXTAUTH_SECRET
   → Contains: { sub: userId, email, name }
   → Valid for 5 minutes

2. Frontend: POST /calls/create
   Headers: Authorization: Bearer <ticket-jwt>

3. Fastify: Verify JWT with NEXTAUTH_SECRET
   → Extract userId, email, name
   → Check board permissions in MongoDB
```

### Authorization helper

```typescript
// server/src/services/permissions.ts (already exists for collab)
// Extend with:

export async function checkBoardCallPermission(
  userId: string,
  boardId: string,
  action: 'start' | 'join'
): Promise<{ allowed: boolean; role: string }> {
  // 1. Check if user owns the board (bords collection)
  // 2. Check sharedWith / accessList for permission level
  // 3. 'start' requires 'owner' or 'editor'
  // 4. 'join' requires any access level
}
```

---

## 10. Room Naming & Isolation

### Convention

```
board_<boardId>
```

### Rules

- **One active room per board** — if a room exists, new users join it
- **No cross-board rooms** — rooms are strictly scoped to a single board
- **Room names are deterministic** — derived from boardId, not random
- **Room cleanup** — LiveKit auto-closes rooms after `emptyTimeout` (300s)

---

## 11. Fastify Route Registration

### Plugin registration

```typescript
// server/src/index.ts

import callRoutes from './routes/calls'
import livekitWebhook from './webhooks/livekit'

// Register after existing WebSocket routes
fastify.register(callRoutes, { prefix: '/calls' })
fastify.register(livekitWebhook, { prefix: '/webhooks' })
```

### Route definitions

```typescript
// server/src/routes/calls.ts

import { FastifyPluginAsync } from 'fastify'

const callRoutes: FastifyPluginAsync = async (fastify) => {
  // Auth preHandler (reuse existing JWT verification)
  fastify.addHook('preHandler', verifyCollabTicket)

  fastify.post('/create', createCallHandler)
  fastify.post('/join', joinCallHandler)
  fastify.post('/end', endCallHandler)
  fastify.get('/active/:boardId', activeCallHandler)
  fastify.get('/history/:boardId', callHistoryHandler)
}
```

---

## 12. Error Handling

| Scenario | HTTP | Response |
|----------|------|----------|
| Invalid JWT | 401 | `{ error: 'Unauthorized' }` |
| Expired JWT | 401 | `{ error: 'Token expired' }` |
| No board access | 403 | `{ error: 'Access denied' }` |
| Viewer tries to start call | 403 | `{ error: 'Insufficient permissions to start a call' }` |
| Board not found | 404 | `{ error: 'Board not found' }` |
| No active call (for join) | 404 | `{ error: 'No active call on this board' }` |
| LiveKit API error | 502 | `{ error: 'Call service unavailable' }` |
| Rate limit (>10 creates/min) | 429 | `{ error: 'Too many requests' }` |

---

## 13. Rate Limiting

| Endpoint | Limit |
|----------|-------|
| `POST /calls/create` | 10 per minute per user |
| `POST /calls/join` | 20 per minute per user |
| `GET /calls/active/:boardId` | 60 per minute per user |
| `POST /webhooks/livekit` | No limit (server-to-server) |

Use `@fastify/rate-limit` with the existing plugin setup.

---

## 14. Monitoring & Logging

### Structured logs

```
[Call] Room created: board_abc-123 by user:alice@example.com
[Call] User joined: user:bob@example.com → board_abc-123 (2 participants)
[Call] User left: user:bob@example.com ← board_abc-123 (1 participant)
[Call] Room ended: board_abc-123 (duration: 30m, peak: 4)
```

### Metrics to track

- Calls created per hour
- Average call duration
- Peak participant count distribution
- Token generation latency
- LiveKit API error rate

---

## 15. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Token theft | Short-lived JWT (5-min ticket), LiveKit token bound to identity |
| Unauthorized room join | Board permission check before token issuance |
| Webhook spoofing | Verify LiveKit webhook signature with `LIVEKIT_WEBHOOK_SECRET` |
| Room enumeration | Room names derived from boardId (UUID) — not guessable |
| DOS via room creation | Rate limiting on `/calls/create` |

---

## 16. Alternative: Next.js API Route Token Generation

If the Fastify collab server is not yet deployed, the token generation can temporarily live in the Next.js app as an API route:

```
src/app/api/calls/token/route.ts
```

This route uses `getServerSession()` for auth (instead of JWT ticket verification) and generates LiveKit tokens directly. The call metadata storage and webhook handling would then also live in Next.js API routes.

This is the **recommended approach for Phase 1** since it avoids blocking on the Fastify server deployment. The routes can be migrated to Fastify later when the collab server is mature.

### Next.js fallback routes

```
src/app/api/calls/
├── token/route.ts          — POST: Generate LiveKit token
├── active/[boardId]/route.ts  — GET: Check if call active
├── end/route.ts            — POST: Force-end a call
└── webhook/route.ts        — POST: LiveKit webhook receiver
```

---

## 17. Testing Checklist

- [ ] Create call → verify LiveKit room created
- [ ] Create call on board with existing call → verify joins existing room
- [ ] Join call → verify token grants are correct
- [ ] Leave call (last user) → verify `room_finished` webhook fires
- [ ] Force end call → verify LiveKit room deleted + DB updated
- [ ] Viewer tries to start call → verify 403
- [ ] Viewer joins existing call → verify 200
- [ ] Invalid JWT → verify 401
- [ ] No board access → verify 403
- [ ] Webhook with invalid signature → verify rejected
- [ ] `participant_joined` webhook → verify DB updated
- [ ] `participant_left` webhook → verify DB updated
- [ ] `room_finished` webhook → verify call marked ended
- [ ] Call history returns recent calls with correct duration
- [ ] Concurrent calls on different boards → verify isolation
- [ ] Rate limiting → verify 429 after threshold
