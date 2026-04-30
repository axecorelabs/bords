'use client'

/**
 * Yjs ↔ Zustand Bindings
 *
 * Observer/binding layer only.  Write helpers and constants live in
 * yjs-helpers.ts to avoid circular dependencies (stores import helpers,
 * this file imports stores).
 */

import * as Y from 'yjs'
import { useNoteStore, type StickyNote } from '@/store/stickyNoteStore'
import { useChecklistStore, type Checklist } from '@/store/checklistStore'
import { useKanbanStore } from '@/store/kanbanStore'
import { useTextStore, type TextElement } from '@/store/textStore'
import { useMediaStore, type Media } from '@/store/mediaStore'
import { useConnectionStore, type Connection } from '@/store/connectionStore'
import { useDrawingStore } from '@/store/drawingStore'
import { useReminderStore, type Reminder } from '@/store/reminderStore'
import { useTableStore, type TableData } from '@/store/tableStore'
import { useRichTextStore, type RichTextDoc } from '@/store/richTextStore'
import { useBoardStore } from '@/store/boardStore'
import { useTldrawNativeStore } from '@/store/tldrawNativeStore'
import type { KanbanBoard } from '@/types/kanban'
import type { Drawing } from '@/types/drawing'

// Re-export everything from helpers so existing page.tsx / TldrawCanvas
// imports that reference yjs-bindings still work.
export {
  YJS_KEYS,
  objectToYMap,
  yMapToObject,
  yjsWriteItem,
  yjsDeleteItem,
  yjsWriteBoardMeta,
  yjsWriteTldrawShape,
  yjsDeleteTldrawShape,
} from '@/lib/yjs-helpers'

import {
  YJS_KEYS,
  objectToYMap,
  yMapToObject,
  isSuppressed,
  yjsWriteBoardMeta,
} from '@/lib/yjs-helpers'

// ─── Read path: Y.Doc → Zustand ─────────────────────────────────────

function collectionToArray<T extends { id: string }>(ymap: Y.Map<any>): T[] {
  const items: T[] = []
  ymap.forEach((value, key) => {
    if (value instanceof Y.Map) {
      const obj = yMapToObject(value) as T
      // The Y.Map key IS the canonical item ID — always use it
      obj.id = key
      items.push(obj)
    }
  })
  return items
}

// ─── Board item type mapping ────────────────────────────────────────
type BoardItemType = 'notes' | 'checklists' | 'texts' | 'connections' | 'drawings' | 'kanbans' | 'medias' | 'reminders' | 'tables' | 'richTexts'

// ─── Setup: attach observers (Y.Doc → Zustand) ──────────────────────

/**
 * Attach deep observers to all Y.Doc maps so that remote changes
 * automatically update the corresponding Zustand stores.
 *
 * Returns a teardown function that removes all observers.
 */
export function setupYjsBindings(ydoc: Y.Doc, boardId: string): () => void {
  const destroyers: (() => void)[] = []

  // ── RAF-debounced observer helper ──
  // Y.Doc observers fire synchronously for EVERY nested property change.
  // Without debouncing, a single sync burst triggers O(n×depth) rebuild
  // + setState + persist write per collection — all blocking the main thread.
  // requestAnimationFrame collapses rapid fires into one update per frame.
  //
  // The observer also:
  // 1. MERGES Y.Doc items with existing items from other boards
  //    (prevents data loss when the Y.Doc overwrites the entire store)
  // 2. Updates the board's item ID array so the rendering filter works
  //    (e.g. currentBoard.notes includes the remote note's ID)
  function observeCollection<T extends { id: string }>(
    key: string,
    boardItemType: BoardItemType,
    getAll: () => T[],
    setAll: (items: T[]) => void
  ) {
    const ymap = ydoc.getMap(key)
    let prevYjsIds = new Set<string>()
    let rafId: number | null = null
    const handler = () => {
      if (isSuppressed()) return
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        const yjsItems = collectionToArray<T>(ymap)
        // Filter out any items that somehow still lack a valid id
        const validItems = yjsItems.filter(item => item.id)
        const yjsIds = new Set(validItems.map(item => item.id))

        // IDs previously in Y.Doc but now gone = deletions from this board
        const deletedIds = new Set([...prevYjsIds].filter(id => !yjsIds.has(id)))

        // Only update board ID array if the set of IDs actually changed
        // (position-only drags don't change IDs — skip the heavy boardStore update)
        const idsChanged = yjsIds.size !== prevYjsIds.size ||
          [...yjsIds].some(id => !prevYjsIds.has(id)) ||
          deletedIds.size > 0
        prevYjsIds = yjsIds

        if (idsChanged) {
          useBoardStore.setState(state => ({
            boards: state.boards.map(b =>
              b.id === boardId
                ? { ...b, [boardItemType]: Array.from(yjsIds) }
                : b
            ),
          }))
        }

        // Merge: keep items from OTHER boards but replace this board's items.
        // For this board's items, merge Yjs data with existing Zustand data
        // to avoid losing fields that haven't been written to Y.Doc yet.
        const existing = getAll()
        const existingById = new Map(existing.map(item => [item.id, item]))
        const mergedItems = validItems.map(item => {
          const prev = existingById.get(item.id)
          return prev ? { ...prev, ...item } : item
        })
        const merged = [
          ...existing.filter(item => !yjsIds.has(item.id) && !deletedIds.has(item.id)),
          ...mergedItems,
        ]
        setAll(merged)
      })
    }
    ymap.observeDeep(handler)
    // Trigger initial read — IndexedDB may have already loaded data into Y.Doc
    // before these observers were attached, so we need one manual pass.
    console.log(`[Yjs:bindings] Initial read for ${key}: Y.Doc has ${ymap.size} items`)
    handler()
    destroyers.push(() => {
      ymap.unobserveDeep(handler)
      if (rafId !== null) cancelAnimationFrame(rafId)
    })
  }

  // ── Sticky Notes ──
  observeCollection<StickyNote>(
    YJS_KEYS.STICKY_NOTES, 'notes',
    () => useNoteStore.getState().notes,
    (notes) => useNoteStore.setState({ notes }),
  )

  // ── Checklists ──
  observeCollection<Checklist>(
    YJS_KEYS.CHECKLISTS, 'checklists',
    () => useChecklistStore.getState().checklists,
    (checklists) => useChecklistStore.setState({ checklists }),
  )

  // ── Kanban Boards ──
  observeCollection<KanbanBoard>(
    YJS_KEYS.KANBANS, 'kanbans',
    () => useKanbanStore.getState().boards,
    (boards) => useKanbanStore.setState({ boards }),
  )

  // ── Texts ──
  observeCollection<TextElement>(
    YJS_KEYS.TEXTS, 'texts',
    () => useTextStore.getState().texts,
    (texts) => useTextStore.setState({ texts }),
  )

  // ── Media ──
  observeCollection<Media>(
    YJS_KEYS.MEDIA, 'medias',
    () => useMediaStore.getState().medias,
    (medias) => useMediaStore.setState({ medias }),
  )

  // ── Connections ──
  observeCollection<Connection>(
    YJS_KEYS.CONNECTIONS, 'connections',
    () => useConnectionStore.getState().connections,
    (connections) => useConnectionStore.setState({ connections }),
  )

  // ── Drawings ──
  observeCollection<Drawing>(
    YJS_KEYS.DRAWINGS, 'drawings',
    () => useDrawingStore.getState().drawings,
    (drawings) => useDrawingStore.setState({ drawings }),
  )

  // ── Reminders ──
  observeCollection<Reminder>(
    YJS_KEYS.REMINDERS, 'reminders',
    () => useReminderStore.getState().reminders,
    (reminders) => useReminderStore.setState({ reminders }),
  )

  // ── Tables ──
  observeCollection<TableData>(
    YJS_KEYS.TABLES, 'tables',
    () => useTableStore.getState().tables,
    (tables) => useTableStore.setState({ tables }),
  )

  // ── Rich Text Docs ──
  observeCollection<RichTextDoc>(
    YJS_KEYS.RICH_TEXTS, 'richTexts',
    () => useRichTextStore.getState().docs,
    (docs) => useRichTextStore.setState({ docs }),
  )

  // ── Board Metadata ──
  // IMPORTANT: We use direct setState here instead of updateBoard()
  // because updateBoard() writes BACK to Y.Doc via yjsWriteBoardMeta(),
  // creating a wasteful echo transaction on every remote change.
  const boardMeta = ydoc.getMap(YJS_KEYS.BOARD_META)
  let metaRafId: number | null = null
  const metaHandler = () => {
    if (isSuppressed()) return
    if (metaRafId !== null) return
    metaRafId = requestAnimationFrame(() => {
      metaRafId = null
      const updates: Record<string, any> = {}
      const name = boardMeta.get('name')
      const backgroundColor = boardMeta.get('backgroundColor')
      const backgroundImage = boardMeta.get('backgroundImage')
      const backgroundOverlay = boardMeta.get('backgroundOverlay')
      const backgroundOverlayColor = boardMeta.get('backgroundOverlayColor')
      const backgroundBlurLevel = boardMeta.get('backgroundBlurLevel')
      if (name !== undefined) updates.name = name
      if (backgroundColor !== undefined) updates.backgroundColor = backgroundColor
      if (backgroundImage !== undefined) updates.backgroundImage = backgroundImage
      if (backgroundOverlay !== undefined) updates.backgroundOverlay = backgroundOverlay
      if (backgroundOverlayColor !== undefined) updates.backgroundOverlayColor = backgroundOverlayColor
      if (backgroundBlurLevel !== undefined) updates.backgroundBlurLevel = backgroundBlurLevel

      if (Object.keys(updates).length > 0) {
        useBoardStore.setState(state => ({
          boards: state.boards.map(b =>
            b.id === boardId ? { ...b, ...updates } : b
          )
        }))
      }
    })
  }
  boardMeta.observeDeep(metaHandler)
  metaHandler()
  destroyers.push(() => {
    boardMeta.unobserveDeep(metaHandler)
    if (metaRafId !== null) cancelAnimationFrame(metaRafId)
  })

  // Seed boardMeta with the board name if it's not already in Y.Doc
  // This ensures the MetadataExtractor can extract the title
  if (!boardMeta.get('name')) {
    const currentBoard = useBoardStore.getState().boards.find(b => b.id === boardId)
    if (currentBoard?.name) {
      yjsWriteBoardMeta(ydoc, 'name', currentBoard.name)
    }
  }

  // ── tldraw Native Shapes ──
  // These are handled separately in TldrawCanvas.tsx via the
  // tldraw editor store listener + Y.Map sync. The observer here
  // updates tldrawNativeStore so persistence still works for offline.
  const tldrawShapes = ydoc.getMap(YJS_KEYS.TLDRAW_SHAPES)
  const tldrawBindings = ydoc.getMap(YJS_KEYS.TLDRAW_BINDINGS)
  const tldrawAssets = ydoc.getMap(YJS_KEYS.TLDRAW_ASSETS)

  let tldrawRafId: number | null = null
  const tldrawHandler = () => {
    if (isSuppressed()) return
    if (tldrawRafId !== null) return
    tldrawRafId = requestAnimationFrame(() => {
      tldrawRafId = null
      const shapes: Record<string, any> = {}
      tldrawShapes.forEach((v, k) => {
        shapes[k] = v instanceof Y.Map ? yMapToObject(v) : v
      })
      const bindings: Record<string, any> = {}
      tldrawBindings.forEach((v, k) => {
        bindings[k] = v instanceof Y.Map ? yMapToObject(v) : v
      })
      const assets: Record<string, any> = {}
      tldrawAssets.forEach((v, k) => {
        assets[k] = v instanceof Y.Map ? yMapToObject(v) : v
      })
      useTldrawNativeStore.getState().setBoardState(boardId, {
        shapes,
        bindings,
        assets,
      })
    })
  }
  tldrawShapes.observeDeep(tldrawHandler)
  tldrawBindings.observeDeep(tldrawHandler)
  tldrawAssets.observeDeep(tldrawHandler)
  tldrawHandler()
  destroyers.push(() => {
    tldrawShapes.unobserveDeep(tldrawHandler)
    tldrawBindings.unobserveDeep(tldrawHandler)
    tldrawAssets.unobserveDeep(tldrawHandler)
    if (tldrawRafId !== null) cancelAnimationFrame(tldrawRafId)
  })

  return () => {
    for (const fn of destroyers) fn()
  }
}

// ─── Write path: Zustand → Y.Doc (initial seed for new boards) ──────

/**
 * Seed a Y.Doc from Zustand state for a given board.
 * Used when a board is created from a template — template items exist
 * in Zustand but the Y.Doc is brand new and empty, so they need to be
 * pushed into Y.Doc so the collab server can persist them.
 *
 * Only writes items that belong to this board and are missing from Y.Doc.
 */
export function seedYDocFromZustand(ydoc: Y.Doc, boardId: string): void {
  const board = useBoardStore.getState().boards.find(b => b.id === boardId)
  if (!board) return

  const collections: {
    boardKey: keyof typeof board
    yjsKey: string
    getAll: () => { id: string }[]
  }[] = [
    { boardKey: 'notes', yjsKey: YJS_KEYS.STICKY_NOTES, getAll: () => useNoteStore.getState().notes },
    { boardKey: 'checklists', yjsKey: YJS_KEYS.CHECKLISTS, getAll: () => useChecklistStore.getState().checklists },
    { boardKey: 'kanbans', yjsKey: YJS_KEYS.KANBANS, getAll: () => useKanbanStore.getState().boards },
    { boardKey: 'texts', yjsKey: YJS_KEYS.TEXTS, getAll: () => useTextStore.getState().texts },
    { boardKey: 'medias', yjsKey: YJS_KEYS.MEDIA, getAll: () => useMediaStore.getState().medias },
    { boardKey: 'connections', yjsKey: YJS_KEYS.CONNECTIONS, getAll: () => useConnectionStore.getState().connections },
    { boardKey: 'drawings', yjsKey: YJS_KEYS.DRAWINGS, getAll: () => useDrawingStore.getState().drawings },
    { boardKey: 'reminders', yjsKey: YJS_KEYS.REMINDERS, getAll: () => useReminderStore.getState().reminders },
    { boardKey: 'tables', yjsKey: YJS_KEYS.TABLES, getAll: () => useTableStore.getState().tables },
    { boardKey: 'richTexts', yjsKey: YJS_KEYS.RICH_TEXTS, getAll: () => useRichTextStore.getState().docs },
  ]

  let seeded = 0
  ydoc.transact(() => {
    for (const { boardKey, yjsKey, getAll } of collections) {
      const boardItemIds = new Set((board[boardKey] as string[]) || [])
      if (boardItemIds.size === 0) continue

      const ymap = ydoc.getMap(yjsKey)
      const allItems = getAll()
      for (const item of allItems) {
        if (!boardItemIds.has(item.id)) continue
        if (ymap.has(item.id)) continue // Already in Y.Doc
        ymap.set(item.id, objectToYMap(item as any))
        seeded++
      }
    }
  })

  if (seeded > 0) {
    console.log(`[Yjs:seed] Seeded ${seeded} item(s) from Zustand → Y.Doc for board ${boardId}`)
  }
}
