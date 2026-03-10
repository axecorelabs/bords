# Bords Collaboration Server — API Documentation

> **Base URL:** `http://localhost:4444` (development)  
> **Swagger UI:** `http://localhost:4444/docs`  
> **OpenAPI JSON:** `http://localhost:4444/docs/json`

---

## Authentication

All endpoints (except `/health`) require a valid **JWT ticket** signed with `NEXTAUTH_SECRET`. The token can be provided via:

| Method | Format |
|--------|--------|
| **Authorization header** | `Authorization: Bearer <jwt>` |
| **Cookie** | `next-auth.session-token=<jwt>` |
| **Cookie (HTTPS)** | `__Secure-next-auth.session-token=<jwt>` |
| **Query parameter** (WebSocket only) | `?token=<jwt>` |

Tokens are verified cryptographically using `jose.jwtVerify()` with the shared `NEXTAUTH_SECRET`. The JWT payload must contain `sub` (userId), `email`, and `name`. Tickets are short-lived (30s) and intended for the initial WebSocket handshake. Expired or invalid tokens return `401 Unauthorized`.

---

## Endpoints

### 1. Health Check

```
GET /health
```

Returns server status, connectivity, and active room/connection counts. No authentication required.

#### Response `200 OK`

```json
{
  "status": "ok",
  "uptime": 12345.67,
  "activeRooms": 3,
  "totalConnections": 7,
  "mongoStatus": "connected",
  "redisStatus": "connected"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `"ok"` if the server is responding |
| `uptime` | `number` | Server uptime in seconds |
| `activeRooms` | `integer` | Number of boards with active collaboration rooms in memory |
| `totalConnections` | `integer` | Total WebSocket connections across all rooms |
| `mongoStatus` | `string` | `"connected"` or `"disconnected"` |
| `redisStatus` | `string` | `"connected"` or `"disconnected"` |

---

### 2. WebSocket — Board Collaboration

```
GET /ws/:boardId
Upgrade: websocket
Connection: Upgrade
```

Establishes a WebSocket connection for real-time Yjs document synchronization on a specific board.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | `string` | Yes | The board's `localBoardId` |
| `token` | query | `string` | Yes* | NextAuth session token (*or provide via cookie) |

#### Connection Lifecycle

1. **Upgrade** — Server validates session token and board permissions
2. **Sync Step 1** — Server sends its state vector; client sends its state vector
3. **Sync Step 2** — Both sides exchange missing updates
4. **Awareness** — Server sends existing awareness states; client sends its state
5. **Synced** — Bidirectional real-time sync begins

#### Binary Message Protocol

All messages are binary (`Uint8Array`) using `y-protocols` encoding:

| Byte 0 | Type | Description |
|--------|------|-------------|
| `0` | Sync | Yjs sync protocol (step1, step2, update) |
| `1` | Awareness | Cursor position, selection, user presence |
| `2` | Auth | Permission denied / changed / kicked |

#### Auth Sub-Messages (type `2`)

| Byte 1 | Meaning | Direction |
|---------|---------|-----------|
| `0` | Permission denied (read-only user tried to write) | Server → Client |
| `1` | Permission changed | Server → Client |
| `2` | Kicked (access revoked) | Server → Client |

#### Close Codes

| Code | Meaning |
|------|---------|
| `4001` | Unauthorized — invalid or expired session token |
| `4003` | Forbidden — no access to this board |
| `4004` | Not Found — board does not exist |
| `4500` | Internal server error |

#### Read-Only Clients

Users with `view` permission:
- Receive all sync and awareness messages (full real-time view)
- Cannot send Yjs updates — server drops them and sends auth message `type=2, byte1=0`
- Can still broadcast awareness state (cursor position visible to editors)

#### Example (JavaScript)

```javascript
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'

const ydoc = new Y.Doc()
const token = getSessionToken() // from cookie

const provider = new WebsocketProvider(
  'ws://localhost:4444/ws',
  'your-board-id',
  ydoc,
  {
    params: { token },
    connect: true,
    resyncInterval: 5000,
  }
)

provider.on('status', ({ status }) => {
  console.log('Connection status:', status) // 'connecting' | 'connected' | 'disconnected'
})
```

---

### 3. Room Connections

```
GET /api/rooms/:boardId/connections
```

Returns all users currently connected to a board's collaboration room.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | `string` | Yes | The board's `localBoardId` |

#### Headers

| Name | Required | Description |
|------|----------|-------------|
| `Authorization` | Yes* | `Bearer <sessionToken>` (*or use cookie) |

#### Response `200 OK`

```json
{
  "boardId": "abc123",
  "connectedUsers": [
    {
      "userId": "user1",
      "name": "Alice",
      "avatar": "https://example.com/avatar.jpg",
      "permission": "edit",
      "connectedAt": "2026-03-09T10:00:00.000Z"
    }
  ],
  "totalConnections": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `boardId` | `string` | The board ID |
| `connectedUsers` | `array` | List of connected users |
| `connectedUsers[].userId` | `string` | User's MongoDB `_id` |
| `connectedUsers[].name` | `string` | Display name |
| `connectedUsers[].avatar` | `string\|null` | Avatar URL |
| `connectedUsers[].permission` | `string` | `"owner"`, `"edit"`, or `"view"` |
| `connectedUsers[].connectedAt` | `string` | ISO 8601 timestamp |
| `totalConnections` | `integer` | Total connections to this room |

#### Response `401 Unauthorized`

```json
{ "error": "No session token provided" }
```

#### Response `403 Forbidden`

```json
{ "error": "No access to this board" }
```

---

### 4. Room Awareness

```
GET /api/rooms/:boardId/awareness
```

Returns the current awareness state for all clients connected to a board.

#### Parameters

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `boardId` | path | `string` | Yes | The board's `localBoardId` |

#### Headers

| Name | Required | Description |
|------|----------|-------------|
| `Authorization` | Yes* | `Bearer <sessionToken>` (*or use cookie) |

#### Response `200 OK`

```json
{
  "states": [
    {
      "clientId": 12345,
      "user": {
        "id": "user1",
        "name": "Alice",
        "color": "#e57373"
      },
      "cursor": {
        "x": 150,
        "y": 300
      },
      "selection": ["shape:abc123"],
      "editingItem": "note:xyz789"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `states` | `array` | List of awareness states |
| `states[].clientId` | `integer` | Yjs awareness client ID |
| `states[].user` | `object` | User identity |
| `states[].user.id` | `string` | User ID |
| `states[].user.name` | `string` | Display name |
| `states[].user.color` | `string` | Assigned presence color (hex) |
| `states[].cursor` | `object\|null` | Current cursor position on canvas |
| `states[].selection` | `array` | IDs of selected tldraw shapes |
| `states[].editingItem` | `string\|null` | ID of item being edited (e.g., `"note:abc123"`) |

#### Response `401 Unauthorized`

```json
{ "error": "No session token provided" }
```

#### Response `403 Forbidden`

```json
{ "error": "No access to this board" }
```

---

## Permissions Model

Board access is determined by the existing `BoardDocument` and `Bord` models:

| Level | Check | Permission |
|-------|-------|------------|
| **Owner** | `board.owner === userId` | Full read/write |
| **Shared (edit)** | `board.sharedWith` contains `{ userId, permission: 'edit' }` | Read/write |
| **Shared (view)** | `board.sharedWith` contains `{ userId, permission: 'view' }` | Read-only |
| **Org access** | `bord.accessList` contains `{ userId }` | Per access entry |
| **Public** | `board.visibility === 'public'` | Read-only |
| **None** | No match | `403 Forbidden` |

---

## Error Codes

| HTTP Code | Meaning |
|-----------|---------|
| `200` | Success |
| `401` | Missing or invalid session token |
| `403` | Valid session but no access to the requested board |
| `404` | Board not found |
| `429` | Rate limited (max 10 connection attempts per IP per minute) |

---

## Rate Limiting

- **WebSocket connections:** 10 per IP per minute
- **REST endpoints:** Standard Fastify defaults

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `4444` | Server port |
| `HOST` | No | `0.0.0.0` | Bind address |
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `MONGODB_URI` | **Yes** | — | MongoDB connection string |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis URL for pub/sub |
| `NEXTAUTH_SECRET` | **Yes** | — | Shared secret with Next.js |
| `CORS_ORIGIN` | No | `http://localhost:3001` | Allowed CORS origin(s) |
| `LOG_LEVEL` | No | `info` | Pino log level |
