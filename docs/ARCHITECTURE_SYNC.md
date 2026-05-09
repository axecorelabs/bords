# BORDS Board Sync Contract

This document defines the ownership boundaries for board content. Keep it short, explicit, and current whenever a new write path is added.

## Sources Of Truth

### Live Board Content

Yjs is the canonical live document for board content while a board is open.

It owns:
- sticky notes
- checklists
- kanban boards
- text and rich text blocks
- media items
- drawings
- tables
- reminders
- connections
- tldraw native shapes and bindings
- board presentation metadata that must sync live, such as background settings

Zustand mirrors the current board content for rendering, local component actions, and persisted client UI state. It should not become an independent source of truth for an open board.

### Local Persistence

IndexedDB persists the Yjs document locally through `y-indexeddb`.

Its role is:
- instant local restore
- offline editing
- reconnect merge support

IndexedDB is not an app-level data model and should not be read directly outside the Yjs provider layer.

### Remote Collaboration

Hocuspocus is the remote sync transport for shared and organization boards.

It owns:
- WebSocket connection lifecycle
- Yjs document exchange
- presence/awareness transport
- conflict-free merging between collaborators

### Personal Board Persistence

REST save persists personal, non-shared board Yjs state when no WebSocket is active.

It owns:
- debounced saves for personal boards
- best-effort flush on unload/visibility changes

REST save should persist encoded Yjs state, not become a second board mutation API.

### Supabase Projection

`board_documents`, `board_metadata`, embeddings, and AI chunks are projections of board state.

They own:
- listing and access-control metadata
- dashboard/search/AI-ready board content
- share/public metadata
- background jobs and indexing

They are not the live editing source for an open board. Hydration from Supabase is allowed only as an initial/bootstrap path or when materializing AI-created boards.

## Write Path Labels

Use these labels when naming helpers, comments, PRs, and debugging logs:

- `user-edit`: a direct UI action mutates Zustand and writes through to Yjs
- `yjs-remote`: a remote Yjs update flows into Zustand through bindings
- `local-restore`: IndexedDB loads a Yjs document before network sync
- `rest-persist`: a personal board Yjs update is saved through REST
- `cloud-hydrate`: Supabase projection data bootstraps local board state
- `ai-materialize`: an AI artifact creates a board projection and local board payload
- `projection-index`: background jobs derive searchable/AI metadata from board content

## Guardrails

- New board item stores should write to Yjs through `src/lib/yjs-helpers.ts`.
- Yjs observer handlers should update Zustand without writing back to Yjs.
- Supabase board document writes should be treated as persistence/projection writes, not live conflict resolution.
- Cloud hydration must not overwrite newer open-board Yjs state without an explicit merge policy.
- tldraw-native records and BORDS custom shape backing stores must stay consistent: visual shape changes should update the matching domain store or Yjs native map, not both independently.
- Any new API that mutates board content must state which write path label it belongs to.
