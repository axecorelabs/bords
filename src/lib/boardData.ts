/**
 * boardData.ts — Pure helpers for gathering, applying, hashing, and purging
 * board data across Zustand stores. Extracted from boardSyncStore to keep
 * the store focused on sync orchestration.
 */

import { useBoardStore } from '@/store/boardStore'
import { useChecklistStore } from '@/store/checklistStore'
import { useKanbanStore } from '@/store/kanbanStore'
import { useNoteStore } from '@/store/stickyNoteStore'
import { useMediaStore } from '@/store/mediaStore'
import { useTextStore } from '@/store/textStore'
import { useDrawingStore } from '@/store/drawingStore'
import { useCommentStore } from '@/store/commentStore'
import { useConnectionStore } from '@/store/connectionStore'
import { useConnectionLineStore } from '@/store/connectionLineStore'
import { useGridStore } from '@/store/gridStore'
import { useThemeStore } from '@/store/themeStore'
import { useZIndexStore } from '@/store/zIndexStore'
import { useReminderStore } from '@/store/reminderStore'
import { useTableStore } from '@/store/tableStore'
import { useTldrawNativeStore } from '@/store/tldrawNativeStore'
import { useCollabStore } from '@/store/collabStore'
import { YJS_KEYS, objectToYMap, setSuppressObserver } from '@/lib/yjs-helpers'

/* ═══════════════════  Fast hash (djb2) ═══════════════════ */

function djb2Hash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0
  }
  return hash.toString(36)
}

/* ═══════════════════  computeHash ═══════════════════ */

export function computeHash(localBoardId: string): string {
  const boardStore = useBoardStore.getState()
  const board = boardStore.boards.find(b => b.id === localBoardId)
  if (!board) return ''

  const checklistStore = useChecklistStore.getState()
  const kanbanStore = useKanbanStore.getState()
  const stickyStore = useNoteStore.getState()
  const mediaStore = useMediaStore.getState()
  const textStore = useTextStore.getState()
  const drawingStore = useDrawingStore.getState()
  const connectionStore = useConnectionStore.getState()
  const reminderStore = useReminderStore.getState()
  const tableStore = useTableStore.getState()
  const connectionLineStore = useConnectionLineStore.getState()
  const gridStore = useGridStore.getState()
  const themeStore = useThemeStore.getState()
  const zIndexStore = useZIndexStore.getState()

  const checklists = checklistStore.checklists.filter((c: any) => board.checklists.includes(c.id))
  const kanbans = kanbanStore.boards.filter((k: any) => board.kanbans.includes(k.id))
  const notes = stickyStore.notes.filter((n: any) => board.notes.includes(n.id))
  const medias = mediaStore.medias.filter((m: any) => board.medias.includes(m.id))
  const texts = textStore.texts.filter((t: any) => board.texts.includes(t.id))
  const drawings = drawingStore.drawings.filter((d: any) => board.drawings.includes(d.id))
  // Comments are managed server-side via the comments API — excluded from sync hash
  const connections = connectionStore.connections.filter((c: any) => c.boardId === localBoardId)
  const reminders = reminderStore.reminders.filter((r: any) => (board.reminders || []).includes(r.id))
  const tables = tableStore.tables.filter((t: any) => (board.tables || []).includes(t.id))

  // Native tldraw shapes for hash computation
  const nativeTldrawState = useTldrawNativeStore.getState().getBoardState(localBoardId)

  const allItemIds = new Set([
    ...board.notes, ...board.checklists, ...board.texts,
    ...board.kanbans, ...board.medias, ...board.drawings,
    ...(board.reminders || []), ...(board.tables || []),
  ])
  const zEntries = Object.entries(zIndexStore.zIndexMap)
    .filter(([id]) => allItemIds.has(id))
    .map(([itemId, zIndex]) => ({ itemId, zIndex }))

  const payload = JSON.stringify({
    checklists, kanbans, notes, medias, texts, drawings, connections, reminders, tables,
    nativeTldraw: nativeTldrawState,
    itemIds: {
      notes: board.notes, checklists: board.checklists, texts: board.texts,
      connections: board.connections, drawings: board.drawings,
      kanbans: board.kanbans, medias: board.medias,
      reminders: board.reminders || [], tables: board.tables || [],
    },
    bg: [board.backgroundImage, board.backgroundColor, board.backgroundOverlay,
         board.backgroundOverlayColor, board.backgroundBlurLevel],
    settings: [
      { colorMode: connectionLineStore.colorMode, monochromaticColor: connectionLineStore.monochromaticColor },
      { isGridVisible: gridStore.isGridVisible, gridColor: gridStore.gridColor, zoom: gridStore.zoom,
        gridSize: gridStore.gridSize, snapEnabled: gridStore.snapEnabled },
      { isDark: themeStore.isDark, colorTheme: themeStore.colorTheme },
    ],
    zIndex: { counter: zIndexStore.counter, entries: zEntries },
  })

  return djb2Hash(payload)
}

/* ═══════════════════  gatherBoardData ═══════════════════ */

export function gatherBoardData(localBoardId: string) {
  const boardStore = useBoardStore.getState()
  const board = boardStore.boards.find(b => b.id === localBoardId)
  if (!board) return null

  const checklistStore = useChecklistStore.getState()
  const kanbanStore = useKanbanStore.getState()
  const stickyStore = useNoteStore.getState()
  const mediaStore = useMediaStore.getState()
  const textStore = useTextStore.getState()
  const drawingStore = useDrawingStore.getState()
  const connectionStore = useConnectionStore.getState()
  const reminderStore = useReminderStore.getState()
  const tableStore = useTableStore.getState()
  const connectionLineStore = useConnectionLineStore.getState()
  const gridStore = useGridStore.getState()
  const themeStore = useThemeStore.getState()
  const zIndexStore = useZIndexStore.getState()

  const checklists = checklistStore.checklists.filter((c: any) => board.checklists.includes(c.id))
    .map((c: any) => ({
      ...c,
      createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString()
        : (typeof c.createdAt === 'string' && c.createdAt) ? c.createdAt
        : new Date().toISOString(),
    }))
  const kanbanBoards = kanbanStore.boards.filter((k: any) => board.kanbans.includes(k.id))
  const stickyNotes = stickyStore.notes.filter((n: any) => board.notes.includes(n.id))
  const mediaItems = mediaStore.medias.filter((m: any) => board.medias.includes(m.id))
  const textElements = textStore.texts.filter((t: any) => board.texts.includes(t.id))
  const drawings = drawingStore.drawings.filter((d: any) => board.drawings.includes(d.id))
  // Comments are managed server-side via the comments API — not included in sync payload
  const connections = connectionStore.connections.filter((c: any) => c.boardId === localBoardId)
  const reminders = reminderStore.reminders.filter((r: any) => (board.reminders || []).includes(r.id))
  const tables = tableStore.tables.filter((t: any) => (board.tables || []).includes(t.id))

  // Native tldraw shapes (arrows, geo, draw, text, line, etc.)
  const nativeState = useTldrawNativeStore.getState().getBoardState(localBoardId)

  const allItemIds = new Set([
    ...board.notes, ...board.checklists, ...board.texts,
    ...board.kanbans, ...board.medias, ...board.drawings,
    ...(board.reminders || []), ...(board.tables || []),
  ])
  const zEntries = Object.entries(zIndexStore.zIndexMap)
    .filter(([id]) => allItemIds.has(id))
    .map(([itemId, zIndex]) => ({ itemId, zIndex }))

  return {
    backgroundImage:        board.backgroundImage || null,
    backgroundColor:        board.backgroundColor || null,
    backgroundOverlay:      board.backgroundOverlay || false,
    backgroundOverlayColor: board.backgroundOverlayColor || null,
    backgroundBlurLevel:    board.backgroundBlurLevel || null,
    checklists,
    kanbanBoards,
    stickyNotes,
    mediaItems,
    textElements,
    drawings,
    // comments excluded — managed server-side via comments API
    connections,
    reminders,
    tables,
    // Native tldraw shapes (arrows, geo, draw, text, line, etc.)
    nativeTldraw: nativeState,
    connectionLineSettings: {
      colorMode: connectionLineStore.colorMode,
      monochromaticColor: connectionLineStore.monochromaticColor,
    },
    gridSettings: {
      isGridVisible: gridStore.isGridVisible,
      gridColor: gridStore.gridColor,
      zoom: gridStore.zoom,
      gridSize: gridStore.gridSize,
      snapEnabled: gridStore.snapEnabled,
    },
    themeSettings: {
      isDark: themeStore.isDark,
      colorTheme: themeStore.colorTheme,
    },
    zIndexData: {
      counter: zIndexStore.counter,
      entries: zEntries,
    },
    itemIds: {
      notes: board.notes,
      checklists: board.checklists,
      texts: board.texts,
      connections: board.connections,
      drawings: board.drawings,
      kanbans: board.kanbans,
      medias: board.medias,
      reminders: board.reminders || [],
      tables: board.tables || [],
    },
  }
}

/* ═══════════════════  Base snapshot storage ═══════════════════ */
/* In-memory only — rebuilt on reload. Stores the last-known cloud state
 * for each board, used as the "common ancestor" (base) for 3-way merging. */

const _baseSnapshots = new Map<string, any>()

export function getBaseSnapshot(localBoardId: string): any | null {
  return _baseSnapshots.get(localBoardId) || null
}

export function setBaseSnapshot(localBoardId: string, data: any) {
  try {
    _baseSnapshots.set(localBoardId, JSON.parse(JSON.stringify(data)))
  } catch {
    _baseSnapshots.set(localBoardId, data)
  }
}

/* ═══════════════════  applyCloudData ═══════════════════ */

export function applyCloudData(localBoardId: string, cloud: any, opts?: { skipTheme?: boolean }) {
  setBaseSnapshot(localBoardId, cloud)

  const boardStore = useBoardStore.getState()
  const checklistStore = useChecklistStore.getState()
  const kanbanStore = useKanbanStore.getState()
  const stickyStore = useNoteStore.getState()
  const mediaStore = useMediaStore.getState()
  const textStore = useTextStore.getState()
  const drawingStore = useDrawingStore.getState()
  const connectionStore = useConnectionStore.getState()
  const reminderStore = useReminderStore.getState()
  const tableStore = useTableStore.getState()
  const connectionLineStore = useConnectionLineStore.getState()
  const gridStore = useGridStore.getState()
  const themeStore = useThemeStore.getState()
  const zIndexStore = useZIndexStore.getState()

  const board = boardStore.boards.find((b: any) => b.id === localBoardId)

  if (!board) {
    const newBoard = {
      id: localBoardId,
      userId: boardStore.currentUserId || '',
      name: cloud.name || 'Synced Board',
      createdAt: new Date(),
      lastModified: new Date(),
      notes: cloud.itemIds?.notes || [],
      checklists: cloud.itemIds?.checklists || [],
      texts: cloud.itemIds?.texts || [],
      connections: cloud.itemIds?.connections || [],
      drawings: cloud.itemIds?.drawings || [],
      kanbans: cloud.itemIds?.kanbans || [],
      medias: cloud.itemIds?.medias || [],
      reminders: cloud.itemIds?.reminders || [],
      tables: cloud.itemIds?.tables || [],
      backgroundImage: cloud.backgroundImage || undefined,
      backgroundColor: cloud.backgroundColor || undefined,
      backgroundOverlay: cloud.backgroundOverlay || undefined,
      backgroundOverlayColor: cloud.backgroundOverlayColor || undefined,
      backgroundBlurLevel: cloud.backgroundBlurLevel || undefined,
      // Context: personal vs organization
      contextType: cloud.contextType || undefined,
      organizationId: cloud.organizationId || undefined,
    }
    boardStore.boards.push(newBoard)
    useBoardStore.setState({ boards: [...boardStore.boards] })
  } else {
    boardStore.updateBoard(localBoardId, {
      name: cloud.name || board.name,
      notes: cloud.itemIds?.notes || board.notes,
      checklists: cloud.itemIds?.checklists || board.checklists,
      texts: cloud.itemIds?.texts || board.texts,
      connections: cloud.itemIds?.connections || board.connections,
      drawings: cloud.itemIds?.drawings || board.drawings,
      kanbans: cloud.itemIds?.kanbans || board.kanbans,
      medias: cloud.itemIds?.medias || board.medias,
      reminders: cloud.itemIds?.reminders || board.reminders || [],
      tables: cloud.itemIds?.tables || board.tables || [],
      backgroundImage: cloud.backgroundImage || undefined,
      backgroundColor: cloud.backgroundColor || undefined,
      backgroundOverlay: cloud.backgroundOverlay ?? undefined,
      backgroundOverlayColor: cloud.backgroundOverlayColor || undefined,
      backgroundBlurLevel: cloud.backgroundBlurLevel || undefined,
      // Context: preserve cloud context if available
      ...(cloud.contextType ? { contextType: cloud.contextType } : {}),
      ...(cloud.organizationId ? { organizationId: cloud.organizationId } : {}),
    })
  }

  // Checklists
  if (cloud.checklists) {
    const boardChecklistIds = new Set(cloud.itemIds?.checklists || [])
    const otherChecklists = checklistStore.checklists.filter((c: any) => !boardChecklistIds.has(c.id))
    useChecklistStore.setState({ checklists: [...otherChecklists, ...cloud.checklists] })
  }

  // Kanban boards
  if (cloud.kanbanBoards) {
    const boardKanbanIds = new Set(cloud.itemIds?.kanbans || [])
    const otherKanbans = kanbanStore.boards.filter((k: any) => !boardKanbanIds.has(k.id))
    useKanbanStore.setState({ boards: [...otherKanbans, ...cloud.kanbanBoards] })
  }

  // Sticky notes
  if (cloud.stickyNotes) {
    const boardNoteIds = new Set(cloud.itemIds?.notes || [])
    const otherNotes = stickyStore.notes.filter((n: any) => !boardNoteIds.has(n.id))
    useNoteStore.setState({ notes: [...otherNotes, ...cloud.stickyNotes] })
  }

  // Media
  if (cloud.mediaItems) {
    const boardMediaIds = new Set(cloud.itemIds?.medias || [])
    const otherMedia = mediaStore.medias.filter((m: any) => !boardMediaIds.has(m.id))
    useMediaStore.setState({ medias: [...otherMedia, ...cloud.mediaItems] })
  }

  // Texts
  if (cloud.textElements) {
    const boardTextIds = new Set(cloud.itemIds?.texts || [])
    const otherTexts = textStore.texts.filter((t: any) => !boardTextIds.has(t.id))
    useTextStore.setState({ texts: [...otherTexts, ...cloud.textElements] })
  }

  // Drawings
  if (cloud.drawings) {
    const boardDrawingIds = new Set(cloud.itemIds?.drawings || [])
    const otherDrawings = drawingStore.drawings.filter((d: any) => !boardDrawingIds.has(d.id))
    useDrawingStore.setState({ drawings: [...otherDrawings, ...cloud.drawings] })
  }

  // Comments are managed server-side via the comments API — skip during cloud apply

  // Connections
  if (cloud.connections) {
    const otherConnections = connectionStore.connections.filter((c: any) => c.boardId !== localBoardId)
    useConnectionStore.setState({ connections: [...otherConnections, ...cloud.connections] })
  }

  // Reminders
  if (cloud.reminders) {
    const boardReminderIds = new Set(cloud.itemIds?.reminders || [])
    const otherReminders = reminderStore.reminders.filter((r: any) => !boardReminderIds.has(r.id))
    useReminderStore.setState({ reminders: [...otherReminders, ...cloud.reminders] })
  }

  // Tables
  if (cloud.tables) {
    const boardTableIds = new Set(cloud.itemIds?.tables || [])
    const otherTables = tableStore.tables.filter((t: any) => !boardTableIds.has(t.id))
    useTableStore.setState({ tables: [...otherTables, ...cloud.tables] })
  }

  // Native tldraw shapes (arrows, geo, draw, text, line, etc.)
  if (cloud.nativeTldraw) {
    useTldrawNativeStore.getState().setBoardState(localBoardId, {
      shapes:   cloud.nativeTldraw.shapes   || {},
      bindings: cloud.nativeTldraw.bindings || {},
      assets:   cloud.nativeTldraw.assets   || {},
    })
  }

  // Connection line settings
  if (cloud.connectionLineSettings) {
    connectionLineStore.setColorMode(cloud.connectionLineSettings.colorMode)
    connectionLineStore.setMonochromaticColor(cloud.connectionLineSettings.monochromaticColor)
  }

  // Grid settings
  if (cloud.gridSettings) {
    if (cloud.gridSettings.isGridVisible !== gridStore.isGridVisible) gridStore.toggleGrid()
    gridStore.setGridColor(cloud.gridSettings.gridColor)
    gridStore.setGridSize(cloud.gridSettings.gridSize)
    if (cloud.gridSettings.snapEnabled !== gridStore.snapEnabled) gridStore.toggleSnap()
    gridStore.setZoom(cloud.gridSettings.zoom)
  }

  // Theme settings — skip for shared boards so viewers keep their own theme
  if (cloud.themeSettings && !opts?.skipTheme) {
    if (cloud.themeSettings.isDark !== themeStore.isDark) themeStore.toggleDark()
    themeStore.setColorTheme(cloud.themeSettings.colorTheme)
  }

  // Z-index data
  if (cloud.zIndexData) {
    const newMap = { ...zIndexStore.zIndexMap }
    for (const entry of cloud.zIndexData.entries || []) {
      newMap[entry.itemId] = entry.zIndex
    }
    useZIndexStore.setState({
      counter: Math.max(zIndexStore.counter, cloud.zIndexData.counter || 0),
      zIndexMap: newMap,
    })
  }

  // Schedule connection line rewire after DOM renders the loaded items
  if (typeof window !== 'undefined' && cloud.connections?.length) {
    setTimeout(() => {
      try {
        const { scheduleConnectionUpdate } = require('../components/Connections')
        scheduleConnectionUpdate()
        setTimeout(() => scheduleConnectionUpdate(), 300)
      } catch { /* Connections component not mounted yet */ }
    }, 100)
  }

  // ── Bridge: write cloud data into Y.Doc for WebSocket broadcast ──
  // When this client pulls data from cloud (REST), other Yjs-connected
  // clients won't see the change unless we push it into the Y.Doc.
  const { ydoc, boardId: collabBoardId } = useCollabStore.getState()
  if (ydoc && collabBoardId === localBoardId) {
    setSuppressObserver(true)
    try {
      ydoc.transact(() => {
        // Board metadata
        const meta = ydoc.getMap(YJS_KEYS.BOARD_META)
        if (cloud.name) meta.set('name', cloud.name)
        if (cloud.backgroundColor !== undefined) meta.set('backgroundColor', cloud.backgroundColor ?? null)
        if (cloud.backgroundImage !== undefined) meta.set('backgroundImage', cloud.backgroundImage ?? null)
        if (cloud.backgroundOverlay !== undefined) meta.set('backgroundOverlay', cloud.backgroundOverlay ?? false)
        if (cloud.backgroundOverlayColor !== undefined) meta.set('backgroundOverlayColor', cloud.backgroundOverlayColor ?? null)
        if (cloud.backgroundBlurLevel !== undefined) meta.set('backgroundBlurLevel', cloud.backgroundBlurLevel ?? null)

        // Collection items — replace entire map contents with cloud data
        const syncCollection = (key: string, items: any[] | undefined, idField = 'id') => {
          if (!items) return
          const ymap = ydoc.getMap(key)
          // Remove items no longer in cloud
          const cloudIds = new Set(items.map((it: any) => it[idField]))
          ymap.forEach((_: any, k: string) => { if (!cloudIds.has(k)) ymap.delete(k) })
          // Upsert all cloud items
          for (const item of items) {
            ymap.set(item[idField], objectToYMap(item))
          }
        }

        syncCollection(YJS_KEYS.STICKY_NOTES, cloud.stickyNotes)
        syncCollection(YJS_KEYS.CHECKLISTS, cloud.checklists)
        syncCollection(YJS_KEYS.KANBANS, cloud.kanbanBoards)
        syncCollection(YJS_KEYS.TEXTS, cloud.textElements)
        syncCollection(YJS_KEYS.MEDIA, cloud.mediaItems)
        syncCollection(YJS_KEYS.CONNECTIONS, cloud.connections)
        syncCollection(YJS_KEYS.DRAWINGS, cloud.drawings)
        syncCollection(YJS_KEYS.REMINDERS, cloud.reminders)
        syncCollection(YJS_KEYS.TABLES, cloud.tables)

        // Native tldraw shapes (arrows, drawings, geo, etc.)
        if (cloud.nativeTldraw) {
          const syncNativeMap = (key: string, data: Record<string, any> | undefined) => {
            if (!data) return
            const ymap = ydoc.getMap(key)
            const cloudIds = new Set(Object.keys(data))
            ymap.forEach((_: any, k: string) => { if (!cloudIds.has(k)) ymap.delete(k) })
            for (const [id, val] of Object.entries(data)) {
              ymap.set(id, objectToYMap(val))
            }
          }
          syncNativeMap(YJS_KEYS.TLDRAW_SHAPES, cloud.nativeTldraw.shapes)
          syncNativeMap(YJS_KEYS.TLDRAW_BINDINGS, cloud.nativeTldraw.bindings)
          syncNativeMap(YJS_KEYS.TLDRAW_ASSETS, cloud.nativeTldraw.assets)
        }
      })
    } finally {
      setSuppressObserver(false)
    }
  }

  // Signal TldrawCanvas to reload shapes from the updated stores
  // so the editor reflects the new cloud data (deletes, updates, and additions)
  if (localBoardId === useBoardStore.getState().currentBoardId) {
    useBoardStore.getState().bumpBoardDataVersion()
  }
}

/* ═══════════════════  purgeLocalBoard ═══════════════════ */

export function purgeLocalBoard(localBoardId: string) {
  const boardStore = useBoardStore.getState()
  const board = boardStore.boards.find((b: any) => b.id === localBoardId)
  if (!board) return

  const checklistStore = useChecklistStore.getState()
  const kanbanStore = useKanbanStore.getState()
  const stickyStore = useNoteStore.getState()
  const mediaStore = useMediaStore.getState()
  const textStore = useTextStore.getState()
  const drawingStore = useDrawingStore.getState()
  const commentStore = useCommentStore.getState()
  const connectionStore = useConnectionStore.getState()
  const reminderStore = useReminderStore.getState()
  const tableStore = useTableStore.getState()
  const zIndexStore = useZIndexStore.getState()

  const noteIds = new Set(board.notes || [])
  const checklistIds = new Set(board.checklists || [])
  const textIds = new Set(board.texts || [])
  const kanbanIds = new Set(board.kanbans || [])
  const mediaIds = new Set(board.medias || [])
  const drawingIds = new Set(board.drawings || [])
  const reminderIds = new Set(board.reminders || [])
  const tableIds = new Set(board.tables || [])

  useNoteStore.setState({ notes: stickyStore.notes.filter((n: any) => !noteIds.has(n.id)) })
  useChecklistStore.setState({ checklists: checklistStore.checklists.filter((c: any) => !checklistIds.has(c.id)) })
  useTextStore.setState({ texts: textStore.texts.filter((t: any) => !textIds.has(t.id)) })
  useKanbanStore.setState({ boards: kanbanStore.boards.filter((k: any) => !kanbanIds.has(k.id)) })
  useMediaStore.setState({ medias: mediaStore.medias.filter((m: any) => !mediaIds.has(m.id)) })
  useDrawingStore.setState({ drawings: drawingStore.drawings.filter((d: any) => !drawingIds.has(d.id)) })
  useReminderStore.setState({ reminders: reminderStore.reminders.filter((r: any) => !reminderIds.has(r.id)) })
  useTableStore.setState({ tables: tableStore.tables.filter((t: any) => !tableIds.has(t.id)) })
  useCommentStore.setState({ comments: commentStore.comments.filter((c: any) => c.boardId !== localBoardId) })
  useConnectionStore.setState({ connections: connectionStore.connections.filter((c: any) => c.boardId !== localBoardId) })

  const allItemIds = [...noteIds, ...checklistIds, ...textIds, ...kanbanIds, ...mediaIds, ...drawingIds, ...reminderIds, ...tableIds]
  const newZMap = { ...zIndexStore.zIndexMap }
  for (const id of allItemIds) newZMap[id] && delete newZMap[id]
  useZIndexStore.setState({ zIndexMap: newZMap })

  const currentId = boardStore.currentBoardId
  const remaining = boardStore.boards.filter((b: any) => b.id !== localBoardId)

  let nextBoardId: string | null = currentId === localBoardId ? null : currentId
  if (currentId === localBoardId && remaining.length > 0 && board) {
    const sameContext = remaining.filter((b: any) => {
      if (board.contextType === 'organization') {
        return b.contextType === 'organization' && b.organizationId === board.organizationId
      }
      return !b.contextType || b.contextType === 'personal'
    })
    nextBoardId = sameContext.length > 0 ? sameContext[0].id : null
  }

  useBoardStore.setState({
    boards: remaining,
    currentBoardId: nextBoardId,
  })
}
