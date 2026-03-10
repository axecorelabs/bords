# Calling System — Frontend PRD (Next.js)

## Feature: Real-Time Voice & Video Calls in Bords

**Scope:** Phase 1 — Board-based voice/video calls with join/leave  
**Framework:** Next.js (App Router) + LiveKit Client SDK  
**Target:** `src/` directory of the Bords monorepo

---

## 1. Overview

The frontend is responsible for:
- Call UI (controls, participant grid, indicators)
- LiveKit WebRTC connection management
- Audio/video track handling
- Syncing call presence state across board collaborators
- Integrating call controls into existing Bords chrome (TopBar, Dock)

---

## 2. Dependencies

### New packages

```
@livekit/components-react    — Pre-built React components (ParticipantTile, TrackToggle, etc.)
livekit-client               — Core LiveKit JS SDK (Room, Track, etc.)
```

### Existing integrations

| System | How it's used |
|--------|---------------|
| `next-auth` / `useSession()` | Authenticate user before requesting call token |
| `collabStore` (Zustand) | Extend to track call state (who's in a call) |
| `yjs-awareness` | Broadcast `inCall: true` to other board users via awareness |
| `TopBar.tsx` | Host the "Start Call" / "Join Call" button |
| `Dock.tsx` | Host in-call controls (mute, camera, leave) |

---

## 3. New Files

### Stores

```
src/store/callStore.ts
```

### Components

```
src/components/call/
├── CallButton.tsx              — Start / Join call button (used in TopBar)
├── CallRoom.tsx                — Main call container (LiveKit room provider)
├── CallControls.tsx            — Mute, camera, screen share, leave
├── ParticipantGrid.tsx         — Grid layout for participant tiles
├── ParticipantTile.tsx         — Single participant (video + name + speaking indicator)
├── CallBanner.tsx              — Floating banner: "Call in progress — 3 participants"
└── ActiveCallIndicator.tsx     — Small pulsing dot on TopBar when call is active
```

### API Route

```
src/app/api/calls/token/route.ts    — Issues LiveKit access token
```

### Lib

```
src/lib/livekit.ts              — LiveKit server SDK helpers (token generation)
```

---

## 4. State Management — `callStore.ts`

### Interface

```typescript
interface CallParticipant {
  userId: string
  name: string
  avatar: string | null
  joinedAt: Date
}

interface CallStore {
  // State
  isInCall: boolean
  callBoardId: string | null           // Which board the active call belongs to
  participants: CallParticipant[]       // Other users in the call
  livekitToken: string | null          // JWT for LiveKit room
  livekitUrl: string                   // LiveKit server URL (from env)

  // Media state
  isMicEnabled: boolean
  isCameraEnabled: boolean
  isScreenSharing: boolean

  // UI state
  isCallPanelOpen: boolean             // Whether the call panel is expanded
  activeSpeakerId: string | null       // Currently speaking participant

  // Actions
  startCall: (boardId: string) => Promise<void>
  joinCall: (boardId: string) => Promise<void>
  leaveCall: () => void
  toggleMic: () => void
  toggleCamera: () => void
  toggleScreenShare: () => void
  setActiveSpeaker: (userId: string | null) => void
  setParticipants: (participants: CallParticipant[]) => void
  setCallPanelOpen: (open: boolean) => void
}
```

### Behavior

- `startCall(boardId)`:
  1. `POST /api/calls/token` with `{ boardId }` → receives `{ token, url, room }`
  2. Sets `livekitToken`, `callBoardId`, `isInCall = true`
  3. Broadcasts `inCall: true` via Yjs awareness

- `joinCall(boardId)`:
  1. Same as `startCall` — backend decides whether to create or join existing room
  2. Sets same state

- `leaveCall()`:
  1. Disconnects from LiveKit room
  2. Resets all call state
  3. Broadcasts `inCall: false` via Yjs awareness

- **No persistence** — call state is memory-only (no localStorage)

---

## 5. API Route — `/api/calls/token`

### `POST /api/calls/token/route.ts`

**Purpose:** Generate a short-lived LiveKit access token for the authenticated user.

**Auth:** `getServerSession()` — requires authenticated session.

**Request:**
```json
{
  "boardId": "abc-123"
}
```

**Validation:**
1. User must be authenticated
2. User must have access to the board (owner, editor, or viewer with call permission)
3. Board must exist

**Response:**
```json
{
  "token": "<livekit-jwt>",
  "url": "wss://your-livekit-instance.livekit.cloud",
  "room": "board_abc-123"
}
```

**Token generation:**
```typescript
import { AccessToken } from 'livekit-server-sdk'

const token = new AccessToken(
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET,
  {
    identity: session.user.id,
    name: session.user.name,
    metadata: JSON.stringify({ avatar: session.user.image }),
  }
)
token.addGrant({
  room: `board_${boardId}`,
  roomJoin: true,
  canPublish: true,
  canSubscribe: true,
})
```

**Token expiry:** 4 hours (calls can be long collaboration sessions).

---

## 6. Environment Variables

```env
# LiveKit
LIVEKIT_API_KEY=<api-key>
LIVEKIT_API_SECRET=<api-secret>
NEXT_PUBLIC_LIVEKIT_URL=wss://<your-instance>.livekit.cloud
```

- `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are server-only (token generation)
- `NEXT_PUBLIC_LIVEKIT_URL` is exposed to the client (WebRTC connection)

---

## 7. Component Specifications

### 7.1 `CallButton.tsx`

**Location:** Rendered inside `TopBar.tsx`, next to the board name badge.

**States:**

| Board State | Button Renders |
|-------------|---------------|
| No active call | `Start Call` (phone icon) |
| Call active, user NOT in | `Join (3)` (green pulsing dot + participant count) |
| Call active, user IN call | `In Call` (green solid, clicking opens call panel) |

**Data sources:**
- Call active? → Read from `callStore.participants.length > 0` OR from other users' Yjs awareness `inCall` field
- User in call? → `callStore.isInCall`

**Click handlers:**
- No call → `callStore.startCall(currentBoardId)`
- Call exists → `callStore.joinCall(currentBoardId)`
- Already in call → `callStore.setCallPanelOpen(true)`

---

### 7.2 `CallRoom.tsx`

**Purpose:** Wraps the LiveKit `<LiveKitRoom>` provider and renders the call UI.

**Rendering condition:** Only rendered when `callStore.isInCall === true`.

**Position:** Fixed overlay at bottom-right of the viewport (like a PiP window), draggable/resizable later.

**Structure:**
```tsx
<LiveKitRoom
  token={callStore.livekitToken}
  serverUrl={callStore.livekitUrl}
  connect={callStore.isInCall}
  onDisconnected={() => callStore.leaveCall()}
>
  <ParticipantGrid />
  <CallControls />
</LiveKitRoom>
```

**Sizing:**
- **Collapsed:** 320×200px (shows only active speaker + controls)
- **Expanded:** 640×480px (shows grid of participants)
- Toggle via `callStore.isCallPanelOpen`

---

### 7.3 `CallControls.tsx`

**Buttons:**

| Control | Icon | Action | Visual State |
|---------|------|--------|-------------|
| Microphone | `Mic` / `MicOff` | `callStore.toggleMic()` | Red background when muted |
| Camera | `Video` / `VideoOff` | `callStore.toggleCamera()` | Red background when off |
| Screen Share | `Monitor` | `callStore.toggleScreenShare()` | Blue when sharing |
| Leave | `PhoneOff` | `callStore.leaveCall()` | Always red |

**LiveKit integration:**
- Use `useLocalParticipant()` hook from `@livekit/components-react`
- Toggle tracks via `localParticipant.setMicrophoneEnabled()` / `.setCameraEnabled()`

---

### 7.4 `ParticipantGrid.tsx`

**Layout:**
- 1 participant: Full container
- 2 participants: Side-by-side
- 3-4 participants: 2×2 grid
- 5+ participants: Scrollable grid with active speaker pinned

**Active speaker:**
- Use `useSpeakingParticipants()` from LiveKit
- Highlight border (green glow)

---

### 7.5 `ParticipantTile.tsx`

**Content:**
- Video track (if camera on) OR avatar placeholder (initials + background color)
- Name label (bottom-left)
- Mic muted indicator (bottom-right, red mic-off icon)
- Speaking indicator (green border pulse)

---

### 7.6 `CallBanner.tsx`

**Purpose:** Shown to board users who are NOT in the call but a call is active.

**Position:** Fixed bottom-center of the viewport, above the Dock.

**Content:**
```
🟢 Call in progress · 3 participants   [Join]
```

**Data source:** Read participant count from awareness — other users broadcast `inCall: true` in their awareness state.

---

### 7.7 `ActiveCallIndicator.tsx`

**Purpose:** Small pulsing green dot shown in TopBar when a call is active on the current board.

**Visual:** 8px green circle with CSS `animate-pulse`.

---

## 8. Awareness Integration

### Broadcasting call state

When a user joins/leaves a call, broadcast via Yjs awareness:

```typescript
// In yjs-awareness.ts — extend the awareness state
awareness.setLocalStateField('call', {
  inCall: true,
  joinedAt: Date.now(),
})

// On leave:
awareness.setLocalStateField('call', null)
```

### Reading call state from remote users

```typescript
// In collabStore — extend RemoteUser interface
interface RemoteUser {
  // ... existing fields
  call?: {
    inCall: boolean
    joinedAt: number
  }
}
```

This allows the `CallBanner` and `CallButton` to know how many board users are in a call WITHOUT an extra API call — the data comes through the existing Yjs awareness channel.

---

## 9. Integration Points

### TopBar.tsx

Add `<CallButton />` after the board name badge:

```tsx
{currentBoard && (
  <div className="flex items-center gap-1.5 ...">
    <h1>{currentBoard.name}</h1>
    {/* existing badges */}
    <CallButton />
  </div>
)}
```

### page.tsx

Add `<CallRoom />` and `<CallBanner />` as fixed overlays:

```tsx
{/* After main canvas content */}
<CallRoom />
<CallBanner />
```

### Dock.tsx

When in a call, show minimal call controls in the Dock (optional — controls are also in `CallRoom`):

```tsx
{callStore.isInCall && (
  <div className="flex items-center gap-2">
    <MicToggleButton />
    <LeaveCallButton />
  </div>
)}
```

---

## 10. User Experience Flow

### Starting a call

1. User clicks `Start Call` in TopBar
2. Loading spinner on button (200ms typical)
3. `POST /api/calls/token` → receives token
4. `CallRoom` component mounts, connects to LiveKit
5. Connection established (~1-2s)
6. User's video/audio starts
7. Awareness broadcasts `inCall: true`
8. Other board users see `CallBanner` appear

### Joining a call

1. User sees `CallBanner` → clicks `Join`
2. Same flow as starting (token request → connect)
3. Joins existing LiveKit room
4. Sees other participants in grid

### Leaving a call

1. User clicks `Leave` (red phone icon)
2. LiveKit room disconnects
3. Call state resets
4. Awareness broadcasts `inCall: false`
5. `CallRoom` unmounts
6. If last participant: room auto-closes on LiveKit

---

## 11. Error Handling

| Scenario | Behavior |
|----------|----------|
| Token request fails | Toast: "Could not start call. Try again." |
| LiveKit connection fails | Toast: "Connection failed. Check your network." + auto-retry 2x |
| Media permission denied | Toast: "Microphone access required" + join audio-only |
| Network interruption mid-call | LiveKit auto-reconnects (built-in) + "Reconnecting..." indicator |
| Board permission revoked during call | Disconnect + toast: "You no longer have access to this board" |

---

## 12. Styling

- All call UI follows existing Bords patterns: Tailwind CSS, `isDark` theme support, `backdrop-blur`, rounded corners
- Call panel uses `bg-zinc-900/95 backdrop-blur-xl` (always dark, like video call UIs)
- Controls use the same button sizing as Dock items
- Animations via framer-motion (mount/unmount transitions)

---

## 13. Performance

- LiveKit client SDK handles WebRTC optimization (simulcast, adaptive bitrate)
- Video tracks lazy-render: only decode visible participants
- Audio tracks always active (no lazy loading)
- Call state updates (participants, speaking) throttled to 100ms
- No localStorage persistence for call state (memory-only)

---

## 14. Testing Checklist

- [ ] Start call from board with no active call
- [ ] Join existing call from another browser tab
- [ ] Mute/unmute microphone
- [ ] Toggle camera on/off
- [ ] Leave call — verify other participants stay connected
- [ ] Last participant leaves — verify room closes
- [ ] Reload page during call — verify clean disconnect
- [ ] Call banner appears for non-call users
- [ ] Call banner disappears when call ends
- [ ] Participant count updates in real-time
- [ ] Active speaker highlight works
- [ ] Dark mode / light mode rendering
- [ ] Network interruption — verify reconnection
