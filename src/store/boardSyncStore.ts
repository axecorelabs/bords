/**
 * boardSyncStore.ts — Zustand store for board permissions, sharing, and
 * board deletion.
 *
 * All REST-based sync orchestration (push/pull/merge/dirty/stale) has been
 * removed — Y.Doc + Hocuspocus is now the single source of truth for
 * board content.
 *
 * Share API helpers live in  @/lib/boardShareApi.ts
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { toast } from 'react-hot-toast'
import { useBoardStore } from './boardStore'
import { purgeLocalBoard } from '@/lib/boardData'
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

interface BoardSyncStore {
  // State
  deletedBoardIds: Set<string>              // boards deleted locally — skip on re-import
  boardPermissions: Record<string, 'owner' | 'view' | 'edit'>
  boardSharedBy: Record<string, { name: string; email: string }>  // localBoardId → who shared it
  error: string | null
  /** Boards the owner has shared — triggers WS upgrade when set */
  sharedByOwner: Record<string, boolean>

  // Actions
  deleteBoardFromCloud: (localBoardId: string) => Promise<void>
  markBoardShared: (localBoardId: string) => void

  // Permission
  setBoardPermission: (localBoardId: string, permission: 'owner' | 'view' | 'edit') => void
  getCurrentBoardPermission: () => 'owner' | 'view' | 'edit'

  // Share (thin wrappers — logic lives in boardShareApi.ts)
  getShareSettings: (localBoardId: string) => Promise<{ visibility: string; shareToken: string | null; sharedWith: any[] } | null>
  updateVisibility: (localBoardId: string, visibility: 'private' | 'public' | 'shared') => Promise<void>
  addShareUser: (localBoardId: string, email: string, permission: 'view' | 'edit') => Promise<void>
  removeShareUser: (localBoardId: string, userId: string) => Promise<void>
  updateSharePermission: (localBoardId: string, userId: string, permission: 'view' | 'edit') => Promise<void>
}

/* ─────────────────────── Store ─────────────────────── */

export const useBoardSyncStore = create<BoardSyncStore>()(persist((set, get) => ({
  deletedBoardIds: new Set<string>(),
  boardPermissions: {},
  boardSharedBy: {},
  sharedByOwner: {},
  error: null,

  /* ══════════════ Permission helpers ══════════════ */

  setBoardPermission: (localBoardId, permission) => {
    set(s => ({
      boardPermissions: { ...s.boardPermissions, [localBoardId]: permission },
    }))
  },

  markBoardShared: (localBoardId) => {
    set(s => ({
      sharedByOwner: { ...s.sharedByOwner, [localBoardId]: true },
    }))
  },

  getCurrentBoardPermission: () => {
    const currentBoardId = useBoardStore.getState().currentBoardId
    if (!currentBoardId) return 'owner'
    return get().boardPermissions[currentBoardId] || 'owner'
  },

  /* ══════════════ Delete from cloud ══════════════ */

  deleteBoardFromCloud: async (localBoardId: string) => {
    set(s => ({ deletedBoardIds: new Set(s.deletedBoardIds).add(localBoardId) }))

    const permission = get().boardPermissions[localBoardId]
    const isOwner = !permission || permission === 'owner'

    // Check if this is an org board (org owners/admins can delete even
    // if they're not the board creator)
    const board = useBoardStore.getState().boards.find(b => b.id === localBoardId)
    const isOrgBoard = board?.contextType === 'organization'

    // Attempt cloud deletion for boards the user owns OR org boards
    // (the server handles permission checks for org owner/admin access)
    if (isOwner || isOrgBoard) {
      try {
        const res = await fetch(`/api/boards/sync/${localBoardId}`, { method: 'DELETE' })
        if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed to delete from cloud') }
        toast.success('Board removed from cloud')
      } catch (error: any) {
        toast.error(`Cloud delete failed: ${error.message}`)
      }
    }

    // Always clean up local metadata
    set(s => {
      const perms = { ...s.boardPermissions }; delete perms[localBoardId]
      const sharedBy = { ...s.boardSharedBy }; delete sharedBy[localBoardId]
      return { boardPermissions: perms, boardSharedBy: sharedBy }
    })

    // Clean up Zustand stores for the deleted board
    purgeLocalBoard(localBoardId)
  },

  /* ══════════════ Share (delegates to boardShareApi.ts) ══════════════ */

  getShareSettings: (localBoardId) => _getShareSettings(localBoardId),
  updateVisibility: async (localBoardId, visibility) => {
    await _updateVisibility(localBoardId, visibility)
    if (visibility !== 'private') get().markBoardShared(localBoardId)
  },
  addShareUser: async (localBoardId, email, permission) => {
    await _addShareUser(localBoardId, email, permission)
    get().markBoardShared(localBoardId)
  },
  removeShareUser: (localBoardId, userId) => _removeShareUser(localBoardId, userId),
  updateSharePermission: (localBoardId, userId, permission) => _updateSharePermission(localBoardId, userId, permission),
}),
{
  name: 'board-sync-storage',
  partialize: (state) => ({
    boardPermissions: state.boardPermissions,
    boardSharedBy: state.boardSharedBy,
    sharedByOwner: state.sharedByOwner,
    deletedBoardIds: Array.from(state.deletedBoardIds),
  }),
  merge: (persisted: any, current) => ({
    ...current,
    ...(persisted ? {
      boardPermissions: persisted.boardPermissions || {},
      boardSharedBy: persisted.boardSharedBy || {},
      sharedByOwner: persisted.sharedByOwner || {},
      deletedBoardIds: new Set<string>(persisted.deletedBoardIds || []),
    } : {}),
  }),
}))

