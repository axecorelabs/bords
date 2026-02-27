/**
 * Zustand store for native tldraw shapes (geo, arrow, draw, text, etc.)
 *
 * Zustand → IndexedDB persistence flow:
 * - persist middleware with IndexedDB adapter handles persistence (no size limits)
 * - On reload: IndexedDB → Zustand hydrates → tldraw restores shapes
 * - Falls back to localStorage during SSR or when IndexedDB is blocked
 */
import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'

/** Dynamic import of idb-keyval — only available in browser */
const idbReady = typeof window !== 'undefined'
  ? import('idb-keyval')
  : null

export interface BoardNativeState {
  shapes: Record<string, any>    // shapeId → serialized TLShape
  bindings: Record<string, any>  // bindingId → serialized TLBinding
  assets: Record<string, any>    // assetId → serialized TLAsset
}

interface TldrawNativeStore {
  /** Map of boardId → persisted native tldraw state */
  boards: Record<string, BoardNativeState>

  /** Set entire board state (called during debounced flush) */
  setBoardState: (boardId: string, state: BoardNativeState) => void

  /** Get board state (returns empty defaults if not found) */
  getBoardState: (boardId: string) => BoardNativeState

  /** Remove a board's native state */
  clearBoard: (boardId: string) => void
}

/**
 * IndexedDB-backed storage adapter for Zustand's persist middleware.
 * Serializes to JSON strings before storing (avoids structured clone errors).
 * Falls back to localStorage if IndexedDB is blocked (incognito, permissions).
 */
const indexedDBStorage: PersistStorage<TldrawNativeStore> = {
  getItem: async (name) => {
    try {
      if (!idbReady) throw new Error('SSR')
      const { get: idbGet } = await idbReady
      const raw = await idbGet<string>(name)
      return raw ? JSON.parse(raw) : null
    } catch (e) {
      if (typeof window !== 'undefined') {
        console.warn('[tldraw-persist] IndexedDB read failed, falling back to localStorage', e)
      }
      try {
        const ls = localStorage.getItem(name)
        return ls ? JSON.parse(ls) : null
      } catch {
        return null
      }
    }
  },
  setItem: async (name, value) => {
    const json = JSON.stringify(value)
    try {
      if (!idbReady) throw new Error('SSR')
      const { set: idbSet } = await idbReady
      await idbSet(name, json)
    } catch (e) {
      if (typeof window !== 'undefined') {
        console.warn('[tldraw-persist] IndexedDB write failed, falling back to localStorage', e)
      }
      try { localStorage.setItem(name, json) } catch { /* quota exceeded — silent */ }
    }
  },
  removeItem: async (name) => {
    try {
      if (!idbReady) throw new Error('SSR')
      const { del: idbDel } = await idbReady
      await idbDel(name)
    } catch (e) {
      if (typeof window !== 'undefined') {
        console.warn('[tldraw-persist] IndexedDB delete failed', e)
      }
    }
    try { localStorage.removeItem(name) } catch { /* ignore */ }
  },
}

const EMPTY_STATE: BoardNativeState = { shapes: {}, bindings: {}, assets: {} }

export const useTldrawNativeStore = create<TldrawNativeStore>()(
  persist(
    (set, get) => ({
      boards: {},

      setBoardState: (boardId, state) =>
        set((s) => ({
          boards: { ...s.boards, [boardId]: state },
        })),

      getBoardState: (boardId) =>
        get().boards[boardId] ?? { ...EMPTY_STATE },

      clearBoard: (boardId) =>
        set((s) => {
          const { [boardId]: _, ...rest } = s.boards
          return { boards: rest }
        }),
    }),
    { name: 'tldraw-native-shapes', storage: indexedDBStorage }
  )
)
