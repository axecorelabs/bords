/**
 * boardSyncStore.ts — Zustand store for cloud sync orchestration.
 *
 * Heavy helpers (hashing, data gathering, cloud-data application, purging)
 * live in  @/lib/boardData.ts
 * Share API helpers live in  @/lib/boardShareApi.ts
 *
 * This store now focuses on:
 *  • sync state (dirty / stale / hashes / permissions)
 *  • push / pull / merge orchestration
 *  • selective loading (only fetches the board the user is on)
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { toast } from 'react-hot-toast'
import { useBoardStore } from './boardStore'
import {
  computeHash,
  gatherBoardData,
  applyCloudData,
  purgeLocalBoard,
  getBaseSnapshot,
  setBaseSnapshot,
} from '@/lib/boardData'
import {
  mergeBoards,
  applyConflictResolutions,
  type MergeConflict,
  type AutoResolved,
} from '@/lib/boardMerge'
import {
  getShareSettings as _getShareSettings,
  updateVisibility as _updateVisibility,
  addShareUser as _addShareUser,
  removeShareUser as _removeShareUser,
  updateSharePermission as _updateSharePermission,
} from '@/lib/boardShareApi'

// Re-export for backward compat (BoardSyncControls, PersonalBordAccessModal, etc.)
export type { ShareEntry } from '@/lib/boardShareApi'

/* ─────────────────────── Types ─────────────────────── */

export interface CloudBoardMeta {
  _id: string
  localBoardId: string
  name: string
  visibility: 'private' | 'public' | 'shared'
  contentHash?: string
  lastSyncedAt: string
  createdAt: string
  updatedAt: string
  sharedBy?: { name: string; email: string } | null
}

export interface MergeState {
  localBoardId: string
  conflicts: MergeConflict[]
  merged: any
  autoResolved: AutoResolved[]
  local: any
  cloud: any
  cloudHash: string
  boardName: string
}

interface BoardSyncStore {
  // State
  isSyncing: boolean
  isInitialLoading: boolean
  hasLoadedFromCloud: boolean
  lastSyncedAt: Record<string, Date>
  contentHashes: Record<string, string>     // localBoardId → last-known cloud hash
  dirtyBoards: Set<string>                  // boards with unsaved local changes
  staleBoards: Set<string>                  // boards with newer cloud versions
  deletedBoardIds: Set<string>              // boards deleted locally — skip on re-import
  cloudBoards: CloudBoardMeta[]
  boardPermissions: Record<string, 'owner' | 'view' | 'edit'>
  boardSharedBy: Record<string, { name: string; email: string }>  // localBoardId → who shared it
  error: string | null
  mergeState: MergeState | null             // active merge conflict awaiting resolution
  loadedBoards: Set<string>                 // boards whose full data was fetched this session

  // Core sync actions
  syncBoardToCloud: (localBoardId: string) => Promise<void>
  loadBoardFromCloud: (localBoardId: string) => Promise<void>
  deleteBoardFromCloud: (localBoardId: string) => Promise<void>
  listCloudBoards: () => Promise<void>
  loadAllCloudBoards: () => Promise<void>

  // Selective loading — only fetch the board the user is currently on
  ensureBoardLoaded: (localBoardId: string) => Promise<void>

  // Smart sync
  markDirty: (localBoardId: string) => void
  computeLocalHash: (localBoardId: string) => string
  syncDirtyBoards: () => Promise<void>
  checkForStaleBoards: () => Promise<void>
  refreshStaleBoards: () => Promise<void>
  dismissStale: (localBoardId: string) => void

  // Permission
  setBoardPermission: (localBoardId: string, permission: 'owner' | 'view' | 'edit') => void
  getCurrentBoardPermission: () => 'owner' | 'view' | 'edit'

  // Share (thin wrappers — logic lives in boardShareApi.ts)
  getShareSettings: (localBoardId: string) => Promise<{ visibility: string; shareToken: string | null; sharedWith: any[] } | null>
  updateVisibility: (localBoardId: string, visibility: 'private' | 'public' | 'shared') => Promise<void>
  addShareUser: (localBoardId: string, email: string, permission: 'view' | 'edit') => Promise<void>
  removeShareUser: (localBoardId: string, userId: string) => Promise<void>
  updateSharePermission: (localBoardId: string, userId: string, permission: 'view' | 'edit') => Promise<void>

  // Merge conflict resolution
  resolveConflicts: (resolutions: Record<string, 'local' | 'cloud' | 'both'>) => Promise<void>
  dismissMerge: () => void
}

/* ── Workspace-context helper (reused by push actions) ── */

async function resolveWorkspacePayload(): Promise<Record<string, any>> {
  try {
    const { useWorkspaceStore } = await import('./workspaceStore')
    const ws = useWorkspaceStore.getState()
    const ctx = ws.activeContext
    if (ctx && ctx.type === 'organization') {
      return {
        organizationId: ctx.organizationId,
        contextType: 'organization',
        workspaceId: ws.orgContainerWorkspace?._id || undefined,
      }
    }
    return {
      contextType: 'personal',
      workspaceId: ws.personalWorkspace?._id || undefined,
    }
  } catch {
    return {}
  }
}

/* ─────────────────────── Store ─────────────────────── */

export const useBoardSyncStore = create<BoardSyncStore>()(persist((set, get) => ({
  isSyncing: false,
  isInitialLoading: false,
  hasLoadedFromCloud: false,
  lastSyncedAt: {},
  contentHashes: {},
  dirtyBoards: new Set<string>(),
  staleBoards: new Set<string>(),
  deletedBoardIds: new Set<string>(),
  cloudBoards: [],
  boardPermissions: {},
  boardSharedBy: {},
  error: null,
  mergeState: null,
  loadedBoards: new Set<string>(),

  /* ══════════════ Permission helpers ══════════════ */

  setBoardPermission: (localBoardId, permission) => {
    set(s => ({
      boardPermissions: { ...s.boardPermissions, [localBoardId]: permission },
    }))
  },

  getCurrentBoardPermission: () => {
    const currentBoardId = useBoardStore.getState().currentBoardId
    if (!currentBoardId) return 'owner'
    return get().boardPermissions[currentBoardId] || 'owner'
  },

  /* ══════════════ Push to cloud (optimistic locking + auto-merge) ══════════════ */

  syncBoardToCloud: async (localBoardId: string) => {
    const boardStore = useBoardStore.getState()
    const board = boardStore.boards.find(b => b.id === localBoardId)
    if (!board) { toast.error('Board not found'); return }

    set({ isSyncing: true, error: null })

    try {
      const boardData = gatherBoardData(localBoardId)
      if (!boardData) throw new Error('Could not gather board data')

      const workspacePayload = await resolveWorkspacePayload()
      const baseHash = get().contentHashes[localBoardId] || ''

      const pushBoard = async (data: any, bHash: string): Promise<Response> => {
        return fetch('/api/boards/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            localBoardId,
            name: board.name,
            board: data,
            baseHash: bHash,
            ...workspacePayload,
          }),
        })
      }

      let res = await pushBoard(boardData, baseHash)

      /* ── 409 MERGE_REQUIRED ── */
      if (res.status === 409) {
        const conflictData = await res.json()
        if (conflictData.code !== 'MERGE_REQUIRED') throw new Error(conflictData.error || 'Conflict')

        const cloudBoard = conflictData.cloudBoard
        const cloudHash  = conflictData.cloudHash
        const base       = getBaseSnapshot(localBoardId)

        if (!base) {
          // No base — let user pick whole board
          set({
            isSyncing: false,
            mergeState: {
              localBoardId,
              conflicts: [{
                collection: '_board', itemId: '_board', type: 'both_modified',
                localVersion: boardData, cloudVersion: cloudBoard,
                description: 'This board was modified by another editor. No merge base is available — please choose which version to keep.',
              }],
              merged: cloudBoard,
              autoResolved: [],
              local: boardData,
              cloud: cloudBoard,
              cloudHash,
              boardName: board.name,
            },
          })
          return
        }

        // Three-way merge
        const { merged, conflicts, autoResolved, hasConflicts } = mergeBoards(base, boardData, cloudBoard)

        if (!hasConflicts) {
          toast.success(`Auto-merged ${autoResolved.length} change${autoResolved.length !== 1 ? 's' : ''}`)
          res = await pushBoard(merged, cloudHash)
          if (res.status === 409) throw new Error('Board changed again during merge — please sync again')
          if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed to sync merged board') }

          applyCloudData(localBoardId, { ...merged, name: board.name }, { skipTheme: get().boardPermissions[localBoardId] !== 'owner' })
          const data = await res.json()
          const newDirty = new Set(get().dirtyBoards); newDirty.delete(localBoardId)
          set(s => ({
            isSyncing: false,
            lastSyncedAt: { ...s.lastSyncedAt, [localBoardId]: new Date(data.lastSyncedAt) },
            contentHashes: { ...s.contentHashes, [localBoardId]: data.contentHash || '' },
            dirtyBoards: newDirty,
          }))
          setBaseSnapshot(localBoardId, merged)
          toast.success('Board synced to cloud')
          return
        }

        // Has conflicts — surface modal
        set({
          isSyncing: false,
          mergeState: { localBoardId, conflicts, merged, autoResolved, local: boardData, cloud: cloudBoard, cloudHash, boardName: board.name },
        })
        toast('Merge conflicts detected — please resolve them', { icon: '⚠️', duration: 5000 })
        return
      }

      /* ── Normal success ── */
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed to sync') }

      const data = await res.json()
      const newDirty = new Set(get().dirtyBoards); newDirty.delete(localBoardId)
      set(s => ({
        isSyncing: false,
        lastSyncedAt: { ...s.lastSyncedAt, [localBoardId]: new Date(data.lastSyncedAt) },
        contentHashes: { ...s.contentHashes, [localBoardId]: data.contentHash || '' },
        dirtyBoards: newDirty,
      }))
      setBaseSnapshot(localBoardId, boardData)

      // Auto-create Bord record for org boards
      if (workspacePayload.contextType === 'organization' && workspacePayload.organizationId) {
        try {
          const { useDelegationStore } = await import('./delegationStore')
          const delegation = useDelegationStore.getState()
          if (!delegation.bords.find(b => b.localBoardId === localBoardId)) {
            await delegation.linkBoardToOrg(workspacePayload.organizationId, localBoardId, board.name)
          }
        } catch { /* delegation store not ready */ }
      }

      toast.success('Board synced to cloud')
    } catch (error: any) {
      set({ isSyncing: false, error: error.message })
      toast.error(`Sync failed: ${error.message}`)
    }
  },

  /* ══════════════ Pull single board from cloud ══════════════ */

  loadBoardFromCloud: async (localBoardId: string) => {
    set({ isSyncing: true, error: null })

    try {
      const res = await fetch(`/api/boards/sync/${localBoardId}`)
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed to load') }

      const { board: cloudBoard, permission } = await res.json()
      const perm = permission || 'owner'
      const cloudHash = cloudBoard.contentHash || ''

      set(s => ({
        boardPermissions: { ...s.boardPermissions, [localBoardId]: perm },
      }))

      // Reload always overwrites local state with the cloud version
      applyCloudData(localBoardId, cloudBoard, { skipTheme: perm !== 'owner' })
      setBaseSnapshot(localBoardId, cloudBoard)

      const newDirty = new Set(get().dirtyBoards); newDirty.delete(localBoardId)
      const newStale = new Set(get().staleBoards); newStale.delete(localBoardId)
      const newLoaded = new Set(get().loadedBoards); newLoaded.add(localBoardId)
      set(s => ({
        isSyncing: false,
        lastSyncedAt: { ...s.lastSyncedAt, [localBoardId]: new Date(cloudBoard.lastSyncedAt) },
        contentHashes: { ...s.contentHashes, [localBoardId]: cloudHash },
        dirtyBoards: newDirty,
        staleBoards: newStale,
        loadedBoards: newLoaded,
      }))
      toast.success('Board reloaded from cloud')
    } catch (error: any) {
      set({ isSyncing: false, error: error.message })
      toast.error(`Reload failed: ${error.message}`)
    }
  },

  /* ══════════════ Delete from cloud ══════════════ */

  deleteBoardFromCloud: async (localBoardId: string) => {
    set(s => ({ deletedBoardIds: new Set(s.deletedBoardIds).add(localBoardId) }))

    const permission = get().boardPermissions[localBoardId]
    const isOwner = !permission || permission === 'owner'

    // Only attempt cloud deletion if the user owns the board.
    // For shared/viewer boards, just clean up the local sync metadata.
    if (isOwner) {
      try {
        const res = await fetch(`/api/boards/sync/${localBoardId}`, { method: 'DELETE' })
        if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed to delete from cloud') }
        toast.success('Board removed from cloud')
      } catch (error: any) {
        toast.error(`Cloud delete failed: ${error.message}`)
      }
    }

    // Always clean up local sync metadata
    set(s => {
      const updated = { ...s.lastSyncedAt }; delete updated[localBoardId]
      const hashes = { ...s.contentHashes }; delete hashes[localBoardId]
      const perms = { ...s.boardPermissions }; delete perms[localBoardId]
      const sharedBy = { ...s.boardSharedBy }; delete sharedBy[localBoardId]
      const dirty = new Set(s.dirtyBoards); dirty.delete(localBoardId)
      const stale = new Set(s.staleBoards); stale.delete(localBoardId)
      const loaded = new Set(s.loadedBoards); loaded.delete(localBoardId)
      return {
        lastSyncedAt: updated, contentHashes: hashes, boardPermissions: perms,
        boardSharedBy: sharedBy, dirtyBoards: dirty, staleBoards: stale, loadedBoards: loaded,
      }
    })
  },

  /* ══════════════ List cloud boards (metadata only) ══════════════ */

  listCloudBoards: async () => {
    try {
      const res = await fetch('/api/boards/sync')
      if (!res.ok) return

      const data = await res.json()
      const all: CloudBoardMeta[] = [
        ...(data.owned || []),
        ...(data.shared || []).map((b: any) => ({ ...b, _shared: true })),
      ]
      set({ cloudBoards: all })
    } catch {
      // silent
    }
  },

  /* ══════════════ Selective load — fetch only what the user needs ══════════════ */

  /**
   * Called when the user switches boards. Only fetches full board data if:
   *  1. Board not yet loaded this session, OR
   *  2. Board is marked stale (cloud version is newer)
   * For boards already loaded + not stale, this is a no-op.
   */
  ensureBoardLoaded: async (localBoardId: string) => {
    const { loadedBoards, staleBoards, deletedBoardIds, contentHashes, boardPermissions } = get()

    // Skip boards that were deliberately deleted
    if (deletedBoardIds.has(localBoardId)) return

    const isLoaded = loadedBoards.has(localBoardId)
    const isStale  = staleBoards.has(localBoardId)
    const boardStore = useBoardStore.getState()
    const existsLocally = boardStore.boards.some(b => b.id === localBoardId)

    // Already loaded this session, not stale, exists locally → nothing to do
    if (isLoaded && !isStale && existsLocally) return

    // If it exists locally, has a matching hash, and isn't stale → mark loaded, skip fetch
    if (existsLocally && !isStale) {
      const localHash = computeHash(localBoardId)
      const cloudHash = contentHashes[localBoardId] || ''
      if (localHash && cloudHash && localHash === cloudHash) {
        const newLoaded = new Set(get().loadedBoards); newLoaded.add(localBoardId)
        set({ loadedBoards: newLoaded })
        return
      }
    }

    // Need to fetch from cloud
    try {
      const res = await fetch(`/api/boards/sync/${localBoardId}`)
      if (!res.ok) return // board may not exist in cloud yet (new local board)

      const { board, permission } = await res.json()
      const perm = permission || boardPermissions[localBoardId] || 'owner'

      applyCloudData(localBoardId, board, { skipTheme: perm !== 'owner' })

      // Ensure context info is set on the local board (for sidebar filtering)
      const ctxType = board.contextType
      const orgId = board.organizationId
      if (ctxType || orgId) {
        const bs = useBoardStore.getState()
        bs.updateBoard(localBoardId, {
          ...(ctxType ? { contextType: ctxType } : {}),
          ...(orgId ? { organizationId: orgId } : {}),
        })
      }

      const cloudEntry = board.contentHash
      const newLoaded = new Set(get().loadedBoards); newLoaded.add(localBoardId)
      const newStale = new Set(get().staleBoards); newStale.delete(localBoardId)
      set(s => ({
        boardPermissions: { ...s.boardPermissions, [localBoardId]: perm },
        contentHashes: { ...s.contentHashes, [localBoardId]: cloudEntry || '' },
        loadedBoards: newLoaded,
        staleBoards: newStale,
      }))
    } catch {
      // Silent — board may not be synced to cloud yet
    }
  },

  /* ══════════════ Initial load — metadata + CURRENT board only ══════════════ */

  loadAllCloudBoards: async () => {
    if (get().hasLoadedFromCloud || get().isInitialLoading) return

    set({ isInitialLoading: true, error: null })

    try {
      const checkRes = await fetch('/api/boards/sync/check')
      if (!checkRes.ok) { set({ isInitialLoading: false, hasLoadedFromCloud: true }); return }

      const { boards: cloudHashes } = await checkRes.json()
      if (!cloudHashes || cloudHashes.length === 0) {
        set({ isInitialLoading: false, hasLoadedFromCloud: true })
        return
      }

      // ── Track permissions + sharedBy for ALL boards from metadata ──
      const newPermissions = { ...get().boardPermissions }
      const newSharedBy = { ...get().boardSharedBy }
      for (const entry of cloudHashes) {
        if (entry.localBoardId) {
          newPermissions[entry.localBoardId] = entry.permission || 'owner'
          if (entry.sharedBy) newSharedBy[entry.localBoardId] = entry.sharedBy
        }
      }
      set({ boardPermissions: newPermissions, boardSharedBy: newSharedBy })

      // ── Purge revoked boards ──
      const cloudBoardIds = new Set(cloudHashes.map((h: any) => h.localBoardId).filter(Boolean))
      const prevPermissions = get().boardPermissions
      for (const [boardId, perm] of Object.entries(prevPermissions)) {
        if (perm === 'owner') continue
        if (!cloudBoardIds.has(boardId)) {
          purgeLocalBoard(boardId)
          const perms = { ...get().boardPermissions }; delete perms[boardId]
          const hashes = { ...get().contentHashes }; delete hashes[boardId]
          set({ boardPermissions: perms, contentHashes: hashes })
        }
      }

      // ── Figure out which boards changed (for metadata + stale tracking) ──
      const knownHashes = get().contentHashes
      const currentBoardId = useBoardStore.getState().currentBoardId
      const newStale = new Set<string>()
      const newHashes = { ...knownHashes }
      const boardsToAutoCreate: string[] = []  // boards that don't exist locally at all

      for (const entry of cloudHashes) {
        const localBoardId = entry.localBoardId
        if (!localBoardId) continue
        if (get().deletedBoardIds.has(localBoardId)) continue

        const localBoard = useBoardStore.getState().boards.find((b: any) => b.id === localBoardId)

        if (!localBoard) {
          boardsToAutoCreate.push(localBoardId)
        } else {
          const localHash = computeHash(localBoardId)
          const cloudHash = entry.contentHash || ''
          const lastKnown = knownHashes[localBoardId] || ''

          if (cloudHash && cloudHash !== localHash && cloudHash !== lastKnown) {
            newStale.add(localBoardId)
          } else if (cloudHash) {
            newHashes[localBoardId] = cloudHash
          }
        }
      }

      // ── Auto-load boards that don't exist locally (new device) ──
      let loadedCount = 0

      for (const localBoardId of boardsToAutoCreate) {
        try {
          const res = await fetch(`/api/boards/sync/${localBoardId}`)
          if (!res.ok) continue

          const { board, permission } = await res.json()
          const perm = permission || newPermissions[localBoardId] || 'owner'
          newPermissions[localBoardId] = perm
          applyCloudData(localBoardId, board, { skipTheme: perm !== 'owner' })

          // Ensure context info is set on the local board (for sidebar filtering)
          const cloudEntry = cloudHashes.find((h: any) => h.localBoardId === localBoardId)
          const ctxType = board.contextType || cloudEntry?.contextType
          const orgId = board.organizationId || cloudEntry?.organizationId
          if (ctxType || orgId) {
            const boardStore = useBoardStore.getState()
            boardStore.updateBoard(localBoardId, {
              ...(ctxType ? { contextType: ctxType } : {}),
              ...(orgId ? { organizationId: orgId } : {}),
            })
          }

          loadedCount++

          if (cloudEntry?.contentHash) newHashes[localBoardId] = cloudEntry.contentHash

          // Mark as loaded
          const newLoaded = new Set(get().loadedBoards); newLoaded.add(localBoardId)
          set({ loadedBoards: newLoaded })
        } catch (err) {
          console.error(`Failed to load board ${localBoardId} from cloud:`, err)
        }
      }

      // ── For existing stale boards: only fetch the CURRENT board right now ──
      // Other stale boards stay marked — they get fetched via ensureBoardLoaded
      // when the user actually switches to them.
      if (currentBoardId && newStale.has(currentBoardId)) {
        try {
          const res = await fetch(`/api/boards/sync/${currentBoardId}`)
          if (res.ok) {
            const { board, permission } = await res.json()
            const perm = permission || newPermissions[currentBoardId] || 'owner'
            newPermissions[currentBoardId] = perm
            applyCloudData(currentBoardId, board, { skipTheme: perm !== 'owner' })

            // Ensure context info is set on the local board (for sidebar filtering)
            const cloudEntry = cloudHashes.find((h: any) => h.localBoardId === currentBoardId)
            const ctxType = board.contextType || cloudEntry?.contextType
            const orgId = board.organizationId || cloudEntry?.organizationId
            if (ctxType || orgId) {
              const boardStore = useBoardStore.getState()
              boardStore.updateBoard(currentBoardId, {
                ...(ctxType ? { contextType: ctxType } : {}),
                ...(orgId ? { organizationId: orgId } : {}),
              })
            }

            newStale.delete(currentBoardId)
            if (cloudEntry?.contentHash) newHashes[currentBoardId] = cloudEntry.contentHash
            loadedCount++
          }
        } catch { /* will show as stale */ }

        const newLoaded = new Set(get().loadedBoards); newLoaded.add(currentBoardId)
        set({ loadedBoards: newLoaded })
      }

      // ── Patch context on ALL existing local boards from cloud metadata ──
      // This ensures boards that weren't freshly fetched still get their
      // contextType/organizationId updated from the check endpoint metadata.
      const boardStore = useBoardStore.getState()
      for (const entry of cloudHashes) {
        const bid = entry.localBoardId
        if (!bid) continue
        const ctxType = entry.contextType
        const orgId = entry.organizationId
        if (ctxType || orgId) {
          const existingBoard = boardStore.boards.find((b: any) => b.id === bid)
          if (existingBoard && (existingBoard.contextType !== ctxType || existingBoard.organizationId !== orgId)) {
            boardStore.updateBoard(bid, {
              ...(ctxType ? { contextType: ctxType } : {}),
              ...(orgId ? { organizationId: orgId } : {}),
            })
          }
        }
      }

      set({
        contentHashes: newHashes,
        boardPermissions: newPermissions,
        staleBoards: newStale,
      })

      // Store metadata
      const all: CloudBoardMeta[] = cloudHashes.map((h: any) => ({
        _id: '',
        localBoardId: h.localBoardId,
        name: h.name,
        visibility: 'private',
        contentHash: h.contentHash,
        lastSyncedAt: '',
        createdAt: '',
        updatedAt: '',
        sharedBy: h.sharedBy || null,
      }))
      set({ cloudBoards: all })

      // Select a board if none selected
      if (loadedCount > 0) {
        const currentId = useBoardStore.getState().currentBoardId
        const currentUserId = useBoardStore.getState().currentUserId
        if (!currentId && currentUserId) {
          const { useWorkspaceStore } = await import('./workspaceStore')
          const ctx = useWorkspaceStore.getState().activeContext
          const owned = useBoardStore.getState().boards.filter((b: any) => b.userId === currentUserId)
          const contextBoards = ctx?.type === 'organization'
            ? owned.filter((b: any) => b.contextType === 'organization' && b.organizationId === ctx.organizationId)
            : owned.filter((b: any) => !b.contextType || b.contextType === 'personal')
          if (contextBoards.length > 0) useBoardStore.getState().setCurrentBoard(contextBoards[0].id)
        }

        toast.success(loadedCount === 1 ? '1 board synced from cloud' : `${loadedCount} boards synced from cloud`)
      }

      set({ isInitialLoading: false, hasLoadedFromCloud: true })
    } catch (error: any) {
      console.error('Cloud board auto-load error:', error)
      set({ isInitialLoading: false, hasLoadedFromCloud: true, error: error.message })
    }
  },

  /* ══════════════ Mark dirty ══════════════ */

  markDirty: (localBoardId: string) => {
    const newDirty = new Set(get().dirtyBoards); newDirty.add(localBoardId)
    set({ dirtyBoards: newDirty })
  },

  computeLocalHash: (localBoardId: string) => computeHash(localBoardId),

  /* ══════════════ Push all dirty boards ══════════════ */

  syncDirtyBoards: async () => {
    const { dirtyBoards, contentHashes } = get()
    if (dirtyBoards.size === 0) return

    for (const localBoardId of Array.from(dirtyBoards)) {
      const localHash = computeHash(localBoardId)
      const cloudHash = contentHashes[localBoardId] || ''

      if (localHash === cloudHash) {
        const newDirty = new Set(get().dirtyBoards); newDirty.delete(localBoardId)
        set({ dirtyBoards: newDirty })
        continue
      }

      await get().syncBoardToCloud(localBoardId)
    }
  },

  /* ══════════════ Stale check (tab-focus, lightweight) ══════════════ */

  checkForStaleBoards: async () => {
    if (get().isSyncing || get().isInitialLoading) return

    try {
      const res = await fetch('/api/boards/sync/check')
      if (!res.ok) return

      const { boards: cloudEntries } = await res.json()
      if (!cloudEntries || cloudEntries.length === 0) return

      const currentHashes = get().contentHashes
      const newStale = new Set(get().staleBoards)
      const boardsToAutoLoad: string[] = []
      const currentBoardId = useBoardStore.getState().currentBoardId

      for (const entry of cloudEntries) {
        const { localBoardId, contentHash: cloudHash } = entry
        if (!localBoardId || !cloudHash) continue
        if (get().deletedBoardIds.has(localBoardId)) continue
        if (get().dirtyBoards.has(localBoardId)) continue

        const localBoard = useBoardStore.getState().boards.find((b: any) => b.id === localBoardId)

        if (!localBoard) {
          boardsToAutoLoad.push(localBoardId)
          continue
        }

        const lastKnown = currentHashes[localBoardId] || ''
        if (cloudHash !== lastKnown) {
          const localHash = computeHash(localBoardId)
          if (localHash !== cloudHash) {
            newStale.add(localBoardId)
          } else {
            set(s => ({ contentHashes: { ...s.contentHashes, [localBoardId]: cloudHash } }))
          }
        }
      }

      if (newStale.size !== get().staleBoards.size) {
        set({ staleBoards: newStale })
      }

      // ── Keep boardSharedBy in sync ──
      const updatedSharedBy: Record<string, { name: string; email: string }> = { ...get().boardSharedBy }
      for (const entry of cloudEntries) {
        if (entry.sharedBy) updatedSharedBy[entry.localBoardId] = entry.sharedBy
      }
      set({ boardSharedBy: updatedSharedBy })

      // ── Purge boards with revoked access ──
      const cloudBoardIds = new Set(cloudEntries.map((h: any) => h.localBoardId).filter(Boolean))
      for (const [boardId, perm] of Object.entries(get().boardPermissions)) {
        if (perm === 'owner') continue
        if (!cloudBoardIds.has(boardId)) {
          purgeLocalBoard(boardId)
          const perms = { ...get().boardPermissions }; delete perms[boardId]
          const hashes = { ...get().contentHashes }; delete hashes[boardId]
          set({ boardPermissions: perms, contentHashes: hashes })
        }
      }

      // ── Auto-load boards that don't exist locally ──
      if (boardsToAutoLoad.length > 0) {
        const newHashes = { ...get().contentHashes }
        let loadedCount = 0

        for (const localBoardId of boardsToAutoLoad) {
          try {
            const boardRes = await fetch(`/api/boards/sync/${localBoardId}`)
            if (!boardRes.ok) continue

            const { board, permission } = await boardRes.json()
            const perm = permission || get().boardPermissions[localBoardId] || 'owner'
            set(s => ({ boardPermissions: { ...s.boardPermissions, [localBoardId]: perm } }))
            applyCloudData(localBoardId, board, { skipTheme: perm !== 'owner' })

            // Ensure context info is set on the local board (for sidebar filtering)
            const cloudEntry = cloudEntries.find((h: any) => h.localBoardId === localBoardId)
            const ctxType = board.contextType || cloudEntry?.contextType
            const orgId = board.organizationId || cloudEntry?.organizationId
            if (ctxType || orgId) {
              useBoardStore.getState().updateBoard(localBoardId, {
                ...(ctxType ? { contextType: ctxType } : {}),
                ...(orgId ? { organizationId: orgId } : {}),
              })
            }

            loadedCount++
            if (cloudEntry?.contentHash) newHashes[localBoardId] = cloudEntry.contentHash

            // Mark loaded if it's the current board
            if (localBoardId === currentBoardId) {
              const newLoaded = new Set(get().loadedBoards); newLoaded.add(localBoardId)
              set({ loadedBoards: newLoaded })
            }
          } catch (err) {
            console.error(`Auto-load: failed to load board ${localBoardId}:`, err)
          }
        }

        set({ contentHashes: newHashes })

        if (loadedCount > 0) {
          const currentId = useBoardStore.getState().currentBoardId
          const currentUserId = useBoardStore.getState().currentUserId
          if (!currentId && currentUserId) {
            const { useWorkspaceStore } = await import('./workspaceStore')
            const ctx = useWorkspaceStore.getState().activeContext
            const owned = useBoardStore.getState().boards.filter((b: any) => b.userId === currentUserId)
            const contextBoards = ctx?.type === 'organization'
              ? owned.filter((b: any) => b.contextType === 'organization' && b.organizationId === ctx.organizationId)
              : owned.filter((b: any) => !b.contextType || b.contextType === 'personal')
            if (contextBoards.length > 0) useBoardStore.getState().setCurrentBoard(contextBoards[0].id)
          }
          toast.success(loadedCount === 1 ? '1 board loaded from cloud' : `${loadedCount} boards loaded from cloud`)
        }
      }

      // ── Auto-refresh the CURRENT board if it's stale ──
      // The user sees whichever board they're on immediately, while other
      // stale boards get refreshed lazily when the user switches to them.
      if (currentBoardId && newStale.has(currentBoardId)) {
        try {
          const boardRes = await fetch(`/api/boards/sync/${currentBoardId}`)
          if (boardRes.ok) {
            const { board, permission } = await boardRes.json()
            const perm = permission || get().boardPermissions[currentBoardId] || 'owner'
            set(s => ({ boardPermissions: { ...s.boardPermissions, [currentBoardId]: perm } }))
            applyCloudData(currentBoardId, board, { skipTheme: perm !== 'owner' })

            // Ensure context info is set on the local board (for sidebar filtering)
            const cloudEntry = cloudEntries.find((h: any) => h.localBoardId === currentBoardId)
            const ctxType = board.contextType || cloudEntry?.contextType
            const orgId = board.organizationId || cloudEntry?.organizationId
            if (ctxType || orgId) {
              useBoardStore.getState().updateBoard(currentBoardId, {
                ...(ctxType ? { contextType: ctxType } : {}),
                ...(orgId ? { organizationId: orgId } : {}),
              })
            }

            const updated = new Set(get().staleBoards); updated.delete(currentBoardId)
            const newHashes = { ...get().contentHashes }
            if (cloudEntry?.contentHash) newHashes[currentBoardId] = cloudEntry.contentHash
            const newLoaded = new Set(get().loadedBoards); newLoaded.add(currentBoardId)
            set({ staleBoards: updated, contentHashes: newHashes, loadedBoards: newLoaded })
          }
        } catch { /* will stay stale — user can manual refresh */ }
      }
    } catch {
      // Silent — check failures shouldn't interrupt the user
    }
  },

  /* ══════════════ Refresh stale boards — ONLY current board ══════════════ */

  refreshStaleBoards: async () => {
    const { staleBoards } = get()
    if (staleBoards.size === 0) return

    // Only fetch the board the user is currently viewing
    const currentBoardId = useBoardStore.getState().currentBoardId
    if (!currentBoardId || !staleBoards.has(currentBoardId)) {
      // Nothing stale for current board — other stale boards refresh
      // lazily via ensureBoardLoaded when the user switches to them
      return
    }

    set({ isSyncing: true })

    try {
      const res = await fetch(`/api/boards/sync/${currentBoardId}`)
      if (!res.ok) throw new Error('Failed to refresh')

      const { board, permission } = await res.json()
      const perm = permission || get().boardPermissions[currentBoardId] || 'owner'
      set(s => ({ boardPermissions: { ...s.boardPermissions, [currentBoardId]: perm } }))
      applyCloudData(currentBoardId, board, { skipTheme: perm !== 'owner' })

      const newStale = new Set(get().staleBoards); newStale.delete(currentBoardId)
      const newLoaded = new Set(get().loadedBoards); newLoaded.add(currentBoardId)
      set(s => ({
        isSyncing: false,
        staleBoards: newStale,
        loadedBoards: newLoaded,
        contentHashes: { ...s.contentHashes, [currentBoardId]: board.contentHash || '' },
      }))
      toast.success('Board updated from cloud')
    } catch (err: any) {
      set({ isSyncing: false })
      console.error(`Refresh failed for ${currentBoardId}:`, err)
      toast.error('Failed to update board')
    }
  },

  dismissStale: (localBoardId: string) => {
    const newStale = new Set(get().staleBoards); newStale.delete(localBoardId)
    set({ staleBoards: newStale })
  },

  /* ══════════════ Merge conflict resolution ══════════════ */

  resolveConflicts: async (resolutions: Record<string, 'local' | 'cloud' | 'both'>) => {
    const ms = get().mergeState
    if (!ms) return

    set({ isSyncing: true })

    try {
      const isFullBoardChoice = ms.conflicts.length === 1 && ms.conflicts[0].itemId === '_board'
      let resolved: any

      if (isFullBoardChoice) {
        const choice = resolutions['_board:_board']
        resolved = choice === 'local' ? ms.local : ms.cloud
      } else {
        resolved = applyConflictResolutions(ms.merged, resolutions, ms.conflicts)
      }

      const workspacePayload = await resolveWorkspacePayload()

      const res = await fetch('/api/boards/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          localBoardId: ms.localBoardId,
          name: ms.boardName,
          board: resolved,
          baseHash: ms.cloudHash,
          ...workspacePayload,
        }),
      })

      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed to sync resolved board') }

      applyCloudData(ms.localBoardId, { ...resolved, name: ms.boardName }, {
        skipTheme: get().boardPermissions[ms.localBoardId] !== 'owner',
      })
      setBaseSnapshot(ms.localBoardId, resolved)

      const data = await res.json()
      const newDirty = new Set(get().dirtyBoards); newDirty.delete(ms.localBoardId)
      set(s => ({
        isSyncing: false,
        mergeState: null,
        lastSyncedAt: { ...s.lastSyncedAt, [ms.localBoardId]: new Date(data.lastSyncedAt) },
        contentHashes: { ...s.contentHashes, [ms.localBoardId]: data.contentHash || '' },
        dirtyBoards: newDirty,
      }))
      toast.success('Conflicts resolved — board synced!')
    } catch (error: any) {
      set({ isSyncing: false })
      toast.error(`Resolve failed: ${error.message}`)
    }
  },

  dismissMerge: () => { set({ mergeState: null }) },

  /* ══════════════ Share (delegates to boardShareApi.ts) ══════════════ */

  getShareSettings: (localBoardId) => _getShareSettings(localBoardId),
  updateVisibility: (localBoardId, visibility) => _updateVisibility(localBoardId, visibility),
  addShareUser: (localBoardId, email, permission) => _addShareUser(localBoardId, email, permission),
  removeShareUser: (localBoardId, userId) => _removeShareUser(localBoardId, userId),
  updateSharePermission: (localBoardId, userId, permission) => _updateSharePermission(localBoardId, userId, permission),
}),
{
  name: 'board-sync-storage',
  partialize: (state) => ({
    lastSyncedAt: Object.fromEntries(
      Object.entries(state.lastSyncedAt).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])
    ),
    boardPermissions: state.boardPermissions,
    boardSharedBy: state.boardSharedBy,
    contentHashes: state.contentHashes,
    deletedBoardIds: Array.from(state.deletedBoardIds),
  }),
  merge: (persisted: any, current) => ({
    ...current,
    ...(persisted ? {
      lastSyncedAt: persisted.lastSyncedAt
        ? Object.fromEntries(
            Object.entries(persisted.lastSyncedAt).map(([k, v]) => [k, new Date(v as string)])
          )
        : {},
      boardPermissions: persisted.boardPermissions || {},
      boardSharedBy: persisted.boardSharedBy || {},
      contentHashes: persisted.contentHashes || {},
      deletedBoardIds: new Set<string>(persisted.deletedBoardIds || []),
    } : {}),
  }),
}))

/* ── Export helper for sendBeacon on page close ── */
export function gatherBoardDataForBeacon(localBoardId: string) {
  const boardStore = useBoardStore.getState()
  const board = boardStore.boards.find(b => b.id === localBoardId)
  if (!board) return null

  const data = gatherBoardData(localBoardId)
  if (!data) return null

  return { localBoardId, name: board.name, board: data }
}
