'use client'
import { useState, useCallback, createContext, useContext, useRef, useEffect } from 'react'
import {
  Tldraw,
  Editor,
  createShapeId,
  TLComponents,
  TLUiOverrides,
  DefaultColorStyle,
} from 'tldraw'
import 'tldraw/tldraw.css'

/* ── Import ALL shape utils ── */
import { BordsStickyNoteUtil } from './BordsStickyNoteShape'
import { BordsTextUtil } from './BordsTextShape'
import { BordsChecklistUtil } from './BordsChecklistShape'
import { BordsKanbanUtil } from './BordsKanbanShape'
import { BordsMediaUtil } from './BordsMediaShape'
import { BordsReminderUtil } from './BordsReminderShape'
import { BordsTableUtil } from './BordsTableShape'

/* ── Zustand stores ── */
import { useThemeStore } from '@/store/themeStore'
import { useNoteStore } from '@/store/stickyNoteStore'
import { useTextStore } from '@/store/textStore'
import { useChecklistStore } from '@/store/checklistStore'
import { useKanbanStore } from '@/store/kanbanStore'
import { useMediaStore } from '@/store/mediaStore'
import { useReminderStore } from '@/store/reminderStore'
import { useTableStore } from '@/store/tableStore'
import { useGridStore } from '@/store/gridStore'
import { useBoardStore } from '@/store/boardStore'
import { useTldrawNativeStore } from '@/store/tldrawNativeStore'
import { TldrawConnectionLines } from './TldrawConnectionLines'
import { useCollabStore } from '@/store/collabStore'
import { YJS_KEYS, yjsWriteTldrawShape, yjsDeleteTldrawShape, objectToYMap, yMapToObject } from '@/lib/yjs-helpers'
import { updateLocalCursor } from '@/lib/yjs-awareness'

/* ── Editor context — lets Dock/TopBar/SideBar access the tldraw editor ── */
export const TldrawEditorContext = createContext<Editor | null>(null)
export const useTldrawEditor = () => useContext(TldrawEditorContext)

/* ── Custom shape utils array ── */
const customShapeUtils = [
  BordsStickyNoteUtil,
  BordsTextUtil,
  BordsChecklistUtil,
  BordsKanbanUtil,
  BordsMediaUtil,
  BordsReminderUtil,
  BordsTableUtil,
]

/* ── Hide all of tldraw's default UI — we use our own Dock/TopBar ── */
const components: TLComponents = {
  Toolbar: null,
  StylePanel: null,
  PageMenu: null,
  MainMenu: null,
  NavigationPanel: null,
  HelpMenu: null,
  ActionsMenu: null,
  QuickActions: null,
  ContextMenu: null,
  DebugMenu: null,
  DebugPanel: null,
  MenuPanel: null,
  Minimap: null,
  Background: BordsBackground,
  OnTheCanvas: TldrawConnectionLines,
}

/* ── Custom background component ── */
function BordsBackground() {
  const isDark = useThemeStore((s) => s.isDark)
  const { isGridVisible, gridColor } = useGridStore()
  const currentBoard = useBoardStore((s) => {
    const id = s.currentBoardId
    return id ? s.boards.find((b) => b.id === id) : undefined
  })

  const hasCustomBackground = !!(currentBoard?.backgroundImage || currentBoard?.backgroundColor)

  const blurMap: Record<string, string> = { sm: '4px', md: '12px', lg: '24px', xl: '40px' }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: currentBoard?.backgroundColor || (isDark ? '#18181b' : '#f4f4f5'),
        backgroundImage: currentBoard?.backgroundImage ? `url(${currentBoard.backgroundImage})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        transition: 'background-color 200ms',
      }}
    >
      {/* Semi-transparent blur overlay */}
      {hasCustomBackground && currentBoard?.backgroundOverlay && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backdropFilter: `blur(${blurMap[currentBoard.backgroundBlurLevel || 'md']})`,
            WebkitBackdropFilter: `blur(${blurMap[currentBoard.backgroundBlurLevel || 'md']})`,
            backgroundColor: currentBoard.backgroundOverlayColor || (isDark ? 'rgba(24, 24, 27, 0.6)' : 'rgba(255, 255, 255, 0.6)'),
          }}
        />
      )}
      {isGridVisible && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundSize: '40px 40px',
            backgroundImage: `
              linear-gradient(to right, ${gridColor} 1px, transparent 1px),
              linear-gradient(to bottom, ${gridColor} 1px, transparent 1px)
            `,
          }}
        />
      )}
    </div>
  )
}

/* ── Override UI actions — pass through all tools so draw/geo/arrow/eraser work ── */
const overrides: TLUiOverrides = {
  tools(_editor, tools) {
    return tools
  },
}

/* ── Main canvas component ── */
interface TldrawCanvasProps {
  className?: string
  children?: React.ReactNode  // Dock, TopBar, SideBar rendered as children
}

/* ── Helper: load shapes for a board into the editor ── */
function loadBoardShapes(editor: Editor, boardId: string | null) {
  // Delete ALL existing shapes first
  const allShapes = editor.getCurrentPageShapes()
  if (allShapes.length > 0) {
    // Use batch to suppress side-effect handlers during clear
    editor.deleteShapes(allShapes.map((s) => s.id))
  }

  if (!boardId) return

  const currentBoard = useBoardStore.getState().boards.find((b) => b.id === boardId)
  if (!currentBoard) return

  const shapes: Parameters<Editor['createShapes']>[0] = []

  // ── Sticky Notes ──
  const notes = useNoteStore.getState().notes.filter((n) =>
    currentBoard.notes.includes(n.id)
  )
  for (const note of notes) {
    shapes.push({
      id: createShapeId(note.id),
      type: 'bords-sticky-note' as const,
      x: note.position.x,
      y: note.position.y,
      props: {
        w: note.width || 192,
        h: note.height || 160,
        text: note.text || '',
        color: note.color || 'bg-yellow-200',
        noteId: note.id,
      },
    })
  }

  // ── Texts ──
  const texts = useTextStore.getState().texts.filter((t) =>
    currentBoard.texts?.includes(t.id)
  )
  for (const text of texts) {
    shapes.push({
      id: createShapeId(text.id),
      type: 'bords-text' as const,
      x: text.position.x,
      y: text.position.y,
      props: {
        w: text.width || 200,
        h: 80,
        text: text.text || '',
        fontSize: text.fontSize || 16,
        color: text.color || '#000000',
        rotation: text.rotation || 0,
        textId: text.id,
      },
    })
  }

  // ── Checklists ──
  const checklists = useChecklistStore.getState().checklists.filter((c) =>
    currentBoard.checklists?.includes(c.id)
  )
  for (const cl of checklists) {
    shapes.push({
      id: createShapeId(cl.id),
      type: 'bords-checklist' as const,
      x: cl.position.x,
      y: cl.position.y,
      props: {
        w: cl.width || 280,
        h: cl.height || 320,
        title: cl.title || '',
        color: cl.color || 'bg-white/90',
        checklistId: cl.id,
      },
    })
  }

  // ── Kanban Boards ──
  const kanbans = useKanbanStore.getState().boards.filter((k) =>
    currentBoard.kanbans?.includes(k.id)
  )
  for (const kb of kanbans) {
    shapes.push({
      id: createShapeId(kb.id),
      type: 'bords-kanban' as const,
      x: kb.position.x,
      y: kb.position.y,
      props: {
        w: kb.width || 600,
        h: kb.height || 400,
        title: kb.title,
        color: kb.color,
        kanbanId: kb.id,
      },
    })
  }

  // ── Media ──
  const medias = useMediaStore.getState().medias.filter((m) =>
    currentBoard.medias?.includes(m.id)
  )
  for (const media of medias) {
    shapes.push({
      id: createShapeId(media.id),
      type: 'bords-media' as const,
      x: media.position.x,
      y: media.position.y,
      props: {
        w: media.width || 320,
        h: media.height || 240,
        url: media.url || '',
        title: media.title || '',
        mediaType: media.type as 'image' | 'video' || 'image',
        color: media.color || 'bg-white/90',
        mediaId: media.id,
      },
    })
  }

  // ── Reminders ──
  const reminders = useReminderStore.getState().reminders.filter((r) =>
    currentBoard.reminders?.includes(r.id)
  )
  for (const rem of reminders) {
    shapes.push({
      id: createShapeId(rem.id),
      type: 'bords-reminder' as const,
      x: rem.position.x,
      y: rem.position.y,
      props: {
        w: rem.width || 280,
        h: rem.height || 320,
        title: rem.title || '',
        color: rem.color || 'bg-white/90',
        reminderId: rem.id,
      },
    })
  }

  // ── Tables ──
  const tables = useTableStore.getState().tables.filter((t) =>
    currentBoard.tables?.includes(t.id)
  )
  for (const tbl of tables) {
    shapes.push({
      id: createShapeId(tbl.id),
      type: 'bords-table' as const,
      x: tbl.position.x,
      y: tbl.position.y,
      props: {
        w: tbl.width || 500,
        h: tbl.height || 300,
        title: tbl.title || '',
        color: tbl.color || 'bg-white/90',
        tableId: tbl.id,
      },
    })
  }

  // Create all bords shapes at once
  if (shapes.length > 0) {
    editor.createShapes(shapes)
  }

  // ── Load persisted native tldraw shapes (geo, arrows, drawings, text, etc.) ──
  const nativeState = useTldrawNativeStore.getState().getBoardState(boardId)

  const currentPageId = editor.getCurrentPageId()
  const recordsToLoad: any[] = []

  // Assets first — shapes may reference them
  for (const asset of Object.values(nativeState.assets)) {
    recordsToLoad.push(asset)
  }

  // Native shapes — reparent top-level ones to the current page
  for (const shape of Object.values(nativeState.shapes)) {
    const record = { ...shape }
    if (typeof record.parentId === 'string' && record.parentId.startsWith('page:')) {
      record.parentId = currentPageId
    }
    recordsToLoad.push(record)
  }

  // Bindings — must come after shapes (they reference shapes by ID)
  for (const binding of Object.values(nativeState.bindings)) {
    recordsToLoad.push(binding)
  }

  if (recordsToLoad.length > 0) {
    try { editor.store.put(recordsToLoad) } catch { /* graceful fallback if records are stale */ }
  }

  // Center the camera on ALL content (bords + native) at exactly 100% zoom
  const totalShapes = editor.getCurrentPageShapes().length
  if (totalShapes > 0) {
    // First reset to 100% zoom
    editor.resetZoom()
    // Then center on content without changing zoom level
    editor.zoomToFit({ animation: { duration: 300 } })
    // Always enforce 100% zoom — never zoom in beyond that
    const currentZoom = editor.getZoomLevel()
    if (currentZoom > 1) {
      // Get the center of all bounds to keep camera centered
      const bounds = editor.getCurrentPageBounds()
      if (bounds) {
        editor.centerOnPoint(bounds.center, { animation: { duration: 200 } })
      }
      editor.resetZoom(undefined, { animation: { duration: 200 } })
    }
  } else {
    // No shapes — just reset to 1x zoom at origin
    editor.resetZoom()
  }
}

// Global editor reference for RemoteCursors to use pageToScreen()
export let globalEditorRef: Editor | null = null

export function TldrawCanvas({ className, children }: TldrawCanvasProps) {
  const isDark = useThemeStore((s) => s.isDark)
  const editorRef = useRef<Editor | null>(null)
  const currentBoardId = useBoardStore((s) => s.currentBoardId)
  const prevBoardIdRef = useRef<string | null>(null)
  // Track whether side-effects are a result of board clearing (suppress store writes during clear)
  const isSwitchingBoardRef = useRef(false)
  // Native shape flush refs — accessible from both handleMount and board-switch effect
  const nativeFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushNativeStateRef = useRef<(() => void) | null>(null)
  const nativeDirtyRef = useRef(false)
  /** Suppress Y.Doc writes when applying remote tldraw changes to avoid loops */
  const suppressRemoteTldrawRef = useRef(false)

  /* ── Sync tldraw's built-in dark mode with our theme store ── */
  /* This makes native shape text/strokes respect theme automatically */
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    try {
      // Tell tldraw itself about the color scheme — this applies tl-theme__dark / tl-theme__light
      // which controls CSS vars for all native shape text, strokes, fills, etc.
      editor.user.updateUserPreferences({ colorScheme: isDark ? 'dark' : 'light' })

      const newColor = isDark ? 'white' : 'black'
      const oldColor = isDark ? 'black' : 'white'
      editor.setStyleForNextShapes(DefaultColorStyle, newColor)

      // Update all existing native shapes whose color matches the old theme color
      const nativeTypes = new Set(['geo', 'arrow', 'draw', 'text', 'note', 'line', 'highlight'])
      const updates: Parameters<Editor['updateShapes']>[0] = []
      for (const shape of editor.getCurrentPageShapes()) {
        if (nativeTypes.has(shape.type) && (shape.props as any).color === oldColor) {
          updates.push({ id: shape.id, type: shape.type, props: { color: newColor } } as any)
        }
      }
      if (updates.length > 0) {
        editor.updateShapes(updates)
      }
    } catch { /* editor may not be ready */ }
  }, [isDark])

  /* ── Board switch: clear + reload shapes when currentBoardId changes ── */
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    // Skip on initial mount (handleMount handles that)
    if (prevBoardIdRef.current === null && currentBoardId) {
      prevBoardIdRef.current = currentBoardId
      return
    }
    if (prevBoardIdRef.current === currentBoardId) return

    // Flush pending native shape changes for the PREVIOUS board before switching
    if (nativeFlushTimerRef.current) {
      clearTimeout(nativeFlushTimerRef.current)
      nativeFlushTimerRef.current = null
      flushNativeStateRef.current?.()
    }

    prevBoardIdRef.current = currentBoardId

    // Suppress Zustand writes during shape deletion (we're clearing, not user-deleting)
    isSwitchingBoardRef.current = true
    loadBoardShapes(editor, currentBoardId)
    // Re-enable side effects after a tick
    requestAnimationFrame(() => {
      isSwitchingBoardRef.current = false
    })
  }, [currentBoardId])

  /* ── Cloud data reload: re-create tldraw shapes after applyCloudData updates stores ── */
  const boardDataVersion = useBoardStore((s) => s.boardDataVersion)
  const boardDataVersionRef = useRef(boardDataVersion)
  useEffect(() => {
    // Skip the initial render — handleMount already loaded shapes
    if (boardDataVersionRef.current === boardDataVersion) return
    boardDataVersionRef.current = boardDataVersion

    const editor = editorRef.current
    if (!editor || !currentBoardId) return

    // Full clear + recreate from the freshly-updated Zustand stores
    isSwitchingBoardRef.current = true
    loadBoardShapes(editor, currentBoardId)
    requestAnimationFrame(() => {
      isSwitchingBoardRef.current = false
    })
  }, [boardDataVersion, currentBoardId])

  /* ── Yjs incoming sync: observe Y.Doc tldraw maps and push remote changes into editor ── */
  useEffect(() => {
    // Attaches Y.Doc observers for tldraw shapes/bindings/assets.
    // Fires on remote Y.Doc changes → pushes into tldraw editor store.
    const attachObservers = (ydoc: import('yjs').Doc, editor: Editor) => {
      // Clean up any previous observers
      const prev = (editor as any).__yjsTldrawCleanup
      if (prev) { prev(); (editor as any).__yjsTldrawCleanup = null }

      const shapesMap = ydoc.getMap(YJS_KEYS.TLDRAW_SHAPES)
      const bindingsMap = ydoc.getMap(YJS_KEYS.TLDRAW_BINDINGS)
      const assetsMap = ydoc.getMap(YJS_KEYS.TLDRAW_ASSETS)

      const applyRemote = (map: any, typeName: string) => {
        return (event: any) => {
          console.log('[NativeSync:read] observer fired for', typeName, '— transaction.local:', event.transaction.local, 'changes:', event.changes.keys.size)
          // Only process remote changes (not our own local writes)
          if (event.transaction.local) {
            console.log('[NativeSync:read] SKIPPED — transaction.local is true')
            return
          }
          suppressRemoteTldrawRef.current = true
          try {
            const toCreate: any[] = []
            const toDelete: string[] = []

            event.changes.keys.forEach((change: any, key: string) => {
              console.log('[NativeSync:read] key:', key, 'action:', change.action, 'type:', typeName)
              if (change.action === 'add' || change.action === 'update') {
                const raw = map.get(key)
                if (!raw) { console.log('[NativeSync:read] raw is null for', key); return }
                // Normalize: convert Y.Map/Y.Array to plain object if needed
                const val = (raw && typeof raw.toJSON === 'function') ? raw.toJSON() : raw
                console.log('[NativeSync:read] val type:', typeof val, 'isYMap:', raw instanceof Object && typeof raw.toJSON === 'function', 'keys:', val ? Object.keys(val).slice(0, 5) : 'N/A')
                if (typeName === 'shape') {
                  const existing = editor.getShape(key as any)
                  console.log('[NativeSync:read] shape', key, existing ? 'EXISTS → updateShapes' : 'NEW → toCreate')
                  if (existing) {
                    editor.updateShapes([val])
                  } else {
                    const record = { ...val }
                    if (typeof record.parentId === 'string' && record.parentId.startsWith('page:')) {
                      record.parentId = editor.getCurrentPageId()
                    }
                    toCreate.push(record)
                  }
                } else {
                  // binding or asset — use store.put for both create and update
                  try { editor.store.put([val]) } catch { /* ignore */ }
                }
              } else if (change.action === 'delete') {
                if (typeName === 'shape') {
                  toDelete.push(key)
                } else {
                  try { editor.store.remove([key as any]) } catch { /* ignore */ }
                }
              }
            })

            if (toCreate.length > 0) {
              console.log('[NativeSync:read] creating', toCreate.length, typeName + 's:', toCreate.map((s: any) => s.id))
              try { editor.store.put(toCreate) } catch (e) { console.error('[NativeSync:read] store.put FAILED:', e) }
            }
            if (toDelete.length > 0) {
              console.log('[NativeSync:read] deleting', toDelete.length, typeName + 's:', toDelete)
              try { editor.deleteShapes(toDelete.map(id => id as any)) } catch (e) { console.error('[NativeSync:read] deleteShapes FAILED:', e) }
            }
          } finally {
            suppressRemoteTldrawRef.current = false
          }
        }
      }

      const shapesObs = applyRemote(shapesMap, 'shape')
      const bindingsObs = applyRemote(bindingsMap, 'binding')
      const assetsObs = applyRemote(assetsMap, 'asset')

      shapesMap.observe(shapesObs)
      bindingsMap.observe(bindingsObs)
      assetsMap.observe(assetsObs)
      console.log('[NativeSync:init] observers attached — shapesMap size:', shapesMap.size, 'bindingsMap size:', bindingsMap.size, 'assetsMap size:', assetsMap.size)

      ;(editor as any).__yjsTldrawCleanup = () => {
        shapesMap.unobserve(shapesObs)
        bindingsMap.unobserve(bindingsObs)
        assetsMap.unobserve(assetsObs)
      }
    }

    // Attach immediately if ydoc + editor are already available
    const { ydoc } = useCollabStore.getState()
    const editor = editorRef.current
    if (ydoc && editor) {
      attachObservers(ydoc, editor)
    }

    // Also re-attach whenever ydoc changes (reconnection, board switch)
    const unsub = useCollabStore.subscribe((state, prev) => {
      if (state.ydoc === prev.ydoc) return
      const ed = editorRef.current
      if (state.ydoc && ed) {
        attachObservers(state.ydoc, ed)
      } else if (!state.ydoc && ed) {
        // ydoc cleared — tear down observers
        const cleanup = (ed as any).__yjsTldrawCleanup
        if (cleanup) { cleanup(); (ed as any).__yjsTldrawCleanup = null }
      }
    })
    return () => {
      unsub()
      globalEditorRef = null
      const ed = editorRef.current
      if (ed) {
        const cleanup = (ed as any).__yjsTldrawCleanup
        if (cleanup) { cleanup(); (ed as any).__yjsTldrawCleanup = null }
      }
    }
  }, [])

  /* Sync ALL Zustand stores → tldraw shapes when the editor mounts */
  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor
      // Expose editor globally so RemoteCursors can use pageToScreen()
      globalEditorRef = editor

      // Set default color based on current theme
      const dark = useThemeStore.getState().isDark
      try {
        editor.setStyleForNextShapes(DefaultColorStyle, dark ? 'white' : 'black')
      } catch { /* fallback */ }

      // Zustand persist stores rehydrate asynchronously from localStorage.
      // We need to wait for ALL stores to finish rehydrating before loading shapes,
      // otherwise we read empty arrays and get a blank canvas on reload.
      const stores = [
        useBoardStore, useNoteStore, useTextStore, useChecklistStore,
        useKanbanStore, useMediaStore, useReminderStore, useTableStore,
        useTldrawNativeStore,
      ]

      const tryLoadShapes = () => {
        const boardId = useBoardStore.getState().currentBoardId
        prevBoardIdRef.current = boardId
        isSwitchingBoardRef.current = true
        loadBoardShapes(editor, boardId)
        requestAnimationFrame(() => {
          isSwitchingBoardRef.current = false
        })
      }

      // Check if all stores have already rehydrated
      const allRehydrated = stores.every((store) => {
        try {
          return (store as any).persist?.hasHydrated?.() ?? true
        } catch {
          return true
        }
      })

      if (allRehydrated) {
        tryLoadShapes()
      } else {
        // Wait for all stores to finish rehydrating
        const unsubs: (() => void)[] = []
        let loaded = false
        const checkAllDone = () => {
          if (loaded) return
          const ready = stores.every((store) => {
            try {
              return (store as any).persist?.hasHydrated?.() ?? true
            } catch {
              return true
            }
          })
          if (ready) {
            loaded = true
            unsubs.forEach((u) => u())
            tryLoadShapes()
          }
        }
        for (const store of stores) {
          try {
            const unsub = (store as any).persist?.onFinishHydration?.(checkAllDone)
            if (unsub) unsubs.push(unsub)
          } catch { /* not a persist store */ }
        }
        // Fallback: if stores hydrate really fast or the API doesn't work, try after a short delay
        setTimeout(() => {
          if (!loaded) {
            loaded = true
            unsubs.forEach((u) => u())
            tryLoadShapes()
          }
        }, 200)
      }

      // Guard flag: when true, store subscribers skip echoing changes back to tldraw.
      // This prevents the feedback loop: tldraw change → store → subscriber → updateShapes → loop.
      let _isLocalShapeUpdate = false
      // Guard flag: when true, afterChange/afterDelete handlers skip store+Y.Doc writes.
      // Set by subscribers when applying remote Y.Doc changes to the tldraw editor,
      // preventing the echo loop: remote Y.Doc → store → subscriber → editor.updateShapes()
      //   → afterChangeHandler → store.update → yjsWriteItem → Y.Doc echo back to sender.
      let _isRemoteSyncUpdate = false

      // ── Sync shape changes back to Zustand stores ──
      // Only sends fields that actually changed — during drag this means
      // only position, which enables the 50ms Y.Doc write debounce.
      editor.sideEffects.registerAfterChangeHandler('shape', (_prev, next) => {
        if (isSwitchingBoardRef.current) return
        if (_isRemoteSyncUpdate) return // Skip — driven by remote sync subscriber
        const { type, props } = next as { type: string; props: Record<string, any> }
        const pp = (_prev as any).props as Record<string, any> | undefined
        const posChanged = _prev.x !== next.x || _prev.y !== next.y

        _isLocalShapeUpdate = true
        try {
          switch (type) {
            case 'bords-sticky-note':
              if (props.noteId) {
                const u: Record<string, any> = {}
                if (posChanged) u.position = { x: next.x, y: next.y }
                if (pp?.w !== props.w) u.width = props.w
                if (pp?.h !== props.h) u.height = props.h
                if (pp?.text !== props.text) u.text = props.text
                if (pp?.color !== props.color) u.color = props.color
                if (Object.keys(u).length > 0) useNoteStore.getState().updateNote(props.noteId, u)
              }
              break

            case 'bords-text':
              if (props.textId) {
                const u: Record<string, any> = {}
                if (posChanged) u.position = { x: next.x, y: next.y }
                if (pp?.w !== props.w) u.width = props.w
                if (pp?.text !== props.text) u.text = props.text
                if (pp?.fontSize !== props.fontSize) u.fontSize = props.fontSize
                if (pp?.color !== props.color) u.color = props.color
                if (pp?.rotation !== props.rotation) u.rotation = props.rotation
                if (Object.keys(u).length > 0) useTextStore.getState().updateText(props.textId, u)
              }
              break

            case 'bords-checklist':
              if (props.checklistId) {
                const u: Record<string, any> = {}
                if (posChanged) u.position = { x: next.x, y: next.y }
                if (pp?.w !== props.w) u.width = props.w
                if (pp?.h !== props.h) u.height = props.h
                if (pp?.title !== props.title) u.title = props.title
                if (pp?.color !== props.color) u.color = props.color
                if (Object.keys(u).length > 0) useChecklistStore.getState().updateChecklist(props.checklistId, u)
              }
              break

            case 'bords-kanban':
              if (props.kanbanId) {
                const store = useKanbanStore.getState()
                if (posChanged) store.updateBoardPosition(props.kanbanId, { x: next.x, y: next.y })
                if (pp?.w !== props.w || pp?.h !== props.h) store.updateBoardSize(props.kanbanId, props.w, props.h)
                if (pp?.color !== props.color) store.updateBoardColor(props.kanbanId, props.color)
                if (pp?.title !== props.title) store.updateBoardTitle(props.kanbanId, props.title)
              }
              break

            case 'bords-media':
              if (props.mediaId) {
                const u: Record<string, any> = {}
                if (posChanged) u.position = { x: next.x, y: next.y }
                if (pp?.w !== props.w) u.width = props.w
                if (pp?.h !== props.h) u.height = props.h
                if (pp?.url !== props.url) u.url = props.url
                if (pp?.title !== props.title) u.title = props.title
                if (pp?.color !== props.color) u.color = props.color
                if (Object.keys(u).length > 0) useMediaStore.getState().updateMedia(props.mediaId, u)
              }
              break

            case 'bords-reminder':
              if (props.reminderId) {
                const u: Record<string, any> = {}
                if (posChanged) u.position = { x: next.x, y: next.y }
                if (pp?.w !== props.w) u.width = props.w
                if (pp?.h !== props.h) u.height = props.h
                if (pp?.title !== props.title) u.title = props.title
                if (pp?.color !== props.color) u.color = props.color
                if (Object.keys(u).length > 0) useReminderStore.getState().updateReminder(props.reminderId, u)
              }
              break

            case 'bords-table':
              if (props.tableId) {
                const u: Record<string, any> = {}
                if (posChanged) u.position = { x: next.x, y: next.y }
                if (pp?.w !== props.w) u.width = props.w
                if (pp?.h !== props.h) u.height = props.h
                if (pp?.title !== props.title) u.title = props.title
                if (pp?.color !== props.color) u.color = props.color
                if (Object.keys(u).length > 0) useTableStore.getState().updateTable(props.tableId, u)
              }
              break
          }
        } finally {
          _isLocalShapeUpdate = false
        }
      })

      // ── Sync shape deletions to Zustand stores ──
      editor.sideEffects.registerAfterDeleteHandler('shape', (deletedShape) => {
        if (isSwitchingBoardRef.current) return
        if (_isRemoteSyncUpdate) return // Skip — driven by remote sync subscriber
        const { type, props } = deletedShape as { type: string; props: Record<string, any> }
        const boardId = useBoardStore.getState().currentBoardId

        switch (type) {
          case 'bords-sticky-note':
            if (props.noteId) {
              useNoteStore.getState().deleteNote(props.noteId)
              if (boardId) useBoardStore.getState().removeItemFromBoard(boardId, 'notes', props.noteId)
            }
            break
          case 'bords-text':
            if (props.textId) {
              useTextStore.getState().deleteText(props.textId)
              if (boardId) useBoardStore.getState().removeItemFromBoard(boardId, 'texts', props.textId)
            }
            break
          case 'bords-checklist':
            if (props.checklistId) {
              useChecklistStore.getState().deleteChecklist(props.checklistId)
              if (boardId) useBoardStore.getState().removeItemFromBoard(boardId, 'checklists', props.checklistId)
            }
            break
          case 'bords-kanban':
            if (props.kanbanId) {
              useKanbanStore.getState().removeBoard(props.kanbanId)
              if (boardId) useBoardStore.getState().removeItemFromBoard(boardId, 'kanbans', props.kanbanId)
            }
            break
          case 'bords-media':
            if (props.mediaId) {
              useMediaStore.getState().deleteMedia(props.mediaId)
              if (boardId) useBoardStore.getState().removeItemFromBoard(boardId, 'medias', props.mediaId)
            }
            break
          case 'bords-reminder':
            if (props.reminderId) {
              useReminderStore.getState().deleteReminder(props.reminderId)
              if (boardId) useBoardStore.getState().removeItemFromBoard(boardId, 'reminders', props.reminderId)
            }
            break
          case 'bords-table':
            if (props.tableId) {
              useTableStore.getState().deleteTable(props.tableId)
              if (boardId) useBoardStore.getState().removeItemFromBoard(boardId, 'tables', props.tableId)
            }
            break
        }
      })

      // ── Store subscriptions: sync Zustand → tldraw shapes for adds/updates/deletes ──
      // When remote Yjs changes update Zustand stores, these subscribers push
      // the changes into the tldraw editor so shapes render correctly.
      const getBoardItemIds = (key: string) => {
        const board = useBoardStore.getState().boards.find(
          (b) => b.id === useBoardStore.getState().currentBoardId
        )
        return (board as any)?.[key] as string[] || []
      }

      // Notes
      const unsubNotes = useNoteStore.subscribe((state, prev) => {
        if (state.notes === prev.notes) return
        if (_isLocalShapeUpdate) return // Skip echo from local tldraw changes
        queueMicrotask(() => {
          const boardNoteIds = getBoardItemIds('notes')
          const prevMap = new Map(prev.notes.map(n => [n.id, n]))
          const currMap = new Map(state.notes.map(n => [n.id, n]))
          _isRemoteSyncUpdate = true
          try {
            for (const note of state.notes) {
              if (!boardNoteIds.includes(note.id)) continue
              const sid = createShapeId(note.id)
              const existing = editor.getShape(sid)
              if (!existing) {
                editor.createShape({
                  id: sid, type: 'bords-sticky-note' as const,
                  x: note.position.x, y: note.position.y,
                  props: { w: note.width || 192, h: note.height || 160, text: note.text || '', color: note.color || 'bg-yellow-200', noteId: note.id },
                })
              } else {
                const old = prevMap.get(note.id)
                const changed = old && (old.text !== note.text || old.color !== note.color || old.width !== note.width || old.height !== note.height ||
                  old.position?.x !== note.position?.x || old.position?.y !== note.position?.y)
                if (changed) {
                  editor.updateShapes([{
                    id: sid, type: 'bords-sticky-note' as const,
                    x: note.position.x, y: note.position.y,
                    props: { text: note.text || '', color: note.color || 'bg-yellow-200', w: note.width || 192, h: note.height || 160 },
                  }])
                }
              }
            }
            for (const [id] of prevMap) {
              if (!currMap.has(id)) {
                const sid = createShapeId(id)
                if (editor.getShape(sid)) editor.deleteShapes([sid])
              }
            }
          } finally {
            _isRemoteSyncUpdate = false
          }
        })
      })

      // Texts
      const unsubTexts = useTextStore.subscribe((state, prev) => {
        if (state.texts === prev.texts) return
        if (_isLocalShapeUpdate) return
        queueMicrotask(() => {
          const boardIds = getBoardItemIds('texts')
          const prevMap = new Map(prev.texts.map(t => [t.id, t]))
          const currMap = new Map(state.texts.map(t => [t.id, t]))
          _isRemoteSyncUpdate = true
          try {
            for (const t of state.texts) {
              if (!boardIds.includes(t.id)) continue
              const sid = createShapeId(t.id)
              const existing = editor.getShape(sid)
              if (!existing) {
                editor.createShape({
                  id: sid, type: 'bords-text' as const,
                  x: t.position.x, y: t.position.y,
                  props: { w: t.width || 200, h: 80, text: t.text || '', fontSize: t.fontSize || 16, color: t.color || '#000000', rotation: t.rotation || 0, textId: t.id },
                })
              } else {
                const old = prevMap.get(t.id)
                if (old && (old.text !== t.text || old.color !== t.color || old.fontSize !== t.fontSize ||
                  old.position?.x !== t.position?.x || old.position?.y !== t.position?.y)) {
                  editor.updateShapes([{
                    id: sid, type: 'bords-text' as const,
                    x: t.position.x, y: t.position.y,
                    props: { text: t.text || '', fontSize: t.fontSize || 16, color: t.color || '#000000' },
                  }])
                }
              }
            }
            for (const [id] of prevMap) {
              if (!currMap.has(id)) {
                const sid = createShapeId(id)
                if (editor.getShape(sid)) editor.deleteShapes([sid])
              }
            }
          } finally {
            _isRemoteSyncUpdate = false
          }
        })
      })

      // Checklists
      const unsubChecklists = useChecklistStore.subscribe((state, prev) => {
        if (state.checklists === prev.checklists) return
        if (_isLocalShapeUpdate) return
        queueMicrotask(() => {
          const boardIds = getBoardItemIds('checklists')
          const prevMap = new Map(prev.checklists.map(c => [c.id, c]))
          const currMap = new Map(state.checklists.map(c => [c.id, c]))
          _isRemoteSyncUpdate = true
          try {
            for (const c of state.checklists) {
              if (!boardIds.includes(c.id)) continue
              const sid = createShapeId(c.id)
              const existing = editor.getShape(sid)
              if (!existing) {
                editor.createShape({
                  id: sid, type: 'bords-checklist' as const,
                  x: c.position.x, y: c.position.y,
                  props: { w: c.width || 280, h: c.height || 320, title: c.title || '', color: c.color || 'bg-white/90', checklistId: c.id },
                })
              } else {
                const old = prevMap.get(c.id)
                if (old !== c) {
                  editor.updateShapes([{
                    id: sid, type: 'bords-checklist' as const,
                    x: c.position.x, y: c.position.y,
                    props: { title: c.title || '', color: c.color || 'bg-white/90', w: c.width || 280, h: c.height || 320 },
                  }])
                }
              }
            }
            for (const [id] of prevMap) {
              if (!currMap.has(id)) {
                const sid = createShapeId(id)
                if (editor.getShape(sid)) editor.deleteShapes([sid])
              }
            }
          } finally {
            _isRemoteSyncUpdate = false
          }
        })
      })

      // Kanban boards
      const unsubKanbans = useKanbanStore.subscribe((state, prev) => {
        if (state.boards === prev.boards) return
        if (_isLocalShapeUpdate) return
        queueMicrotask(() => {
          const boardIds = getBoardItemIds('kanbans')
          const prevMap = new Map(prev.boards.map(k => [k.id, k]))
          const currMap = new Map(state.boards.map(k => [k.id, k]))
          _isRemoteSyncUpdate = true
          try {
            for (const kb of state.boards) {
              if (!boardIds.includes(kb.id)) continue
              const sid = createShapeId(kb.id)
              const existing = editor.getShape(sid)
              if (!existing) {
                editor.createShape({
                  id: sid, type: 'bords-kanban' as const,
                  x: kb.position.x, y: kb.position.y,
                  props: { w: kb.width || 600, h: kb.height || 400, title: kb.title, color: kb.color, kanbanId: kb.id },
                })
              } else {
                const old = prevMap.get(kb.id)
                if (old !== kb) {
                  editor.updateShapes([{
                    id: sid, type: 'bords-kanban' as const,
                    x: kb.position.x, y: kb.position.y,
                    props: { title: kb.title, color: kb.color, w: kb.width || 600, h: kb.height || 400 },
                  }])
                }
              }
            }
            for (const [id] of prevMap) {
              if (!currMap.has(id)) {
                const sid = createShapeId(id)
                if (editor.getShape(sid)) editor.deleteShapes([sid])
              }
            }
          } finally {
            _isRemoteSyncUpdate = false
          }
        })
      })

      // Media
      const unsubMedias = useMediaStore.subscribe((state, prev) => {
        if (state.medias === prev.medias) return
        if (_isLocalShapeUpdate) return
        queueMicrotask(() => {
          const boardIds = getBoardItemIds('medias')
          const prevMap = new Map(prev.medias.map(m => [m.id, m]))
          const currMap = new Map(state.medias.map(m => [m.id, m]))
          _isRemoteSyncUpdate = true
          try {
            for (const m of state.medias) {
              if (!boardIds.includes(m.id)) continue
              const sid = createShapeId(m.id)
              const existing = editor.getShape(sid)
              if (!existing) {
                editor.createShape({
                  id: sid, type: 'bords-media' as const,
                  x: m.position.x, y: m.position.y,
                  props: { w: m.width || 320, h: m.height || 240, url: m.url || '', title: m.title || '', mediaType: m.type as 'image' | 'video' || 'image', color: m.color || 'bg-white/90', mediaId: m.id },
                })
              } else {
                const old = prevMap.get(m.id)
                if (old !== m) {
                  editor.updateShapes([{
                    id: sid, type: 'bords-media' as const,
                    x: m.position.x, y: m.position.y,
                    props: { url: m.url || '', title: m.title || '', w: m.width || 320, h: m.height || 240 },
                  }])
                }
              }
            }
            for (const [id] of prevMap) {
              if (!currMap.has(id)) {
                const sid = createShapeId(id)
                if (editor.getShape(sid)) editor.deleteShapes([sid])
              }
            }
          } finally {
            _isRemoteSyncUpdate = false
          }
        })
      })

      // Reminders
      const unsubReminders = useReminderStore.subscribe((state, prev) => {
        if (state.reminders === prev.reminders) return
        if (_isLocalShapeUpdate) return
        queueMicrotask(() => {
          const boardIds = getBoardItemIds('reminders')
          const prevMap = new Map(prev.reminders.map(r => [r.id, r]))
          const currMap = new Map(state.reminders.map(r => [r.id, r]))
          _isRemoteSyncUpdate = true
          try {
            for (const r of state.reminders) {
              if (!boardIds.includes(r.id)) continue
              const sid = createShapeId(r.id)
              const existing = editor.getShape(sid)
              if (!existing) {
                editor.createShape({
                  id: sid, type: 'bords-reminder' as const,
                  x: r.position.x, y: r.position.y,
                  props: { w: r.width || 280, h: r.height || 320, title: r.title || '', color: r.color || 'bg-white/90', reminderId: r.id },
                })
              } else {
                const old = prevMap.get(r.id)
                if (old !== r) {
                  editor.updateShapes([{
                    id: sid, type: 'bords-reminder' as const,
                    x: r.position.x, y: r.position.y,
                    props: { title: r.title || '', color: r.color || 'bg-white/90', w: r.width || 280, h: r.height || 320 },
                  }])
                }
              }
            }
            for (const [id] of prevMap) {
              if (!currMap.has(id)) {
                const sid = createShapeId(id)
                if (editor.getShape(sid)) editor.deleteShapes([sid])
              }
            }
          } finally {
            _isRemoteSyncUpdate = false
          }
        })
      })

      // Tables
      const unsubTables = useTableStore.subscribe((state, prev) => {
        if (state.tables === prev.tables) return
        if (_isLocalShapeUpdate) return
        queueMicrotask(() => {
          const boardIds = getBoardItemIds('tables')
          const prevMap = new Map(prev.tables.map(t => [t.id, t]))
          const currMap = new Map(state.tables.map(t => [t.id, t]))
          _isRemoteSyncUpdate = true
          try {
            for (const t of state.tables) {
              if (!boardIds.includes(t.id)) continue
              const sid = createShapeId(t.id)
              const existing = editor.getShape(sid)
              if (!existing) {
                editor.createShape({
                  id: sid, type: 'bords-table' as const,
                  x: t.position.x, y: t.position.y,
                  props: { w: t.width || 500, h: t.height || 300, title: t.title || '', color: t.color || 'bg-white/90', tableId: t.id },
                })
              } else {
                const old = prevMap.get(t.id)
                if (old !== t) {
                  editor.updateShapes([{
                    id: sid, type: 'bords-table' as const,
                    x: t.position.x, y: t.position.y,
                    props: { title: t.title || '', color: t.color || 'bg-white/90', w: t.width || 500, h: t.height || 300 },
                  }])
                }
              }
            }
            for (const [id] of prevMap) {
              if (!currMap.has(id)) {
                const sid = createShapeId(id)
                if (editor.getShape(sid)) editor.deleteShapes([sid])
              }
            }
          } finally {
            _isRemoteSyncUpdate = false
          }
        })
      })

      // ── Native tldraw shape persistence (Yjs → Zustand → localStorage) ──
      const NATIVE_FLUSH_DELAY = 500

      const flushNativeState = () => {
        if (isSwitchingBoardRef.current) return
        if (!nativeDirtyRef.current) return  // Nothing changed — skip expensive snapshot
        const boardId = useBoardStore.getState().currentBoardId
        if (!boardId) return
        nativeDirtyRef.current = false  // Reset before snapshot

        const shapes: Record<string, any> = {}
        const bindings: Record<string, any> = {}
        const assets: Record<string, any> = {}

        for (const record of editor.store.allRecords()) {
          if (record.typeName === 'shape' && !(record as any).type.startsWith('bords-')) {
            shapes[record.id] = JSON.parse(JSON.stringify(record))
          } else if (record.typeName === 'binding') {
            bindings[record.id] = JSON.parse(JSON.stringify(record))
          } else if (record.typeName === 'asset') {
            assets[record.id] = JSON.parse(JSON.stringify(record))
          }
        }

        // Update Zustand → triggers IndexedDB persist
        useTldrawNativeStore.getState().setBoardState(boardId, { shapes, bindings, assets })
      }

      flushNativeStateRef.current = flushNativeState

      const scheduleNativeFlush = () => {
        nativeDirtyRef.current = true  // Mark dirty so flush knows work is needed
        if (nativeFlushTimerRef.current) clearTimeout(nativeFlushTimerRef.current)
        nativeFlushTimerRef.current = setTimeout(flushNativeState, NATIVE_FLUSH_DELAY)
      }

      // Native shape create / change / delete → schedule debounced flush + Y.Doc sync
      editor.sideEffects.registerAfterCreateHandler('shape', (shape) => {
        if (isSwitchingBoardRef.current) return
        if (!(shape as any).type.startsWith('bords-')) {
          scheduleNativeFlush()
          if (!suppressRemoteTldrawRef.current) {
            const { ydoc } = useCollabStore.getState()
            console.log('[NativeSync:write] afterCreate', shape.id, shape.type, 'ydoc:', ydoc ? 'SET' : 'NULL', 'suppress:', suppressRemoteTldrawRef.current)
            if (ydoc) {
              const map = ydoc.getMap(YJS_KEYS.TLDRAW_SHAPES)
              const serialized = JSON.parse(JSON.stringify(shape))
              console.log('[NativeSync:write] transact set', shape.id, 'keys:', Object.keys(serialized))
              ydoc.transact(() => { map.set(shape.id, serialized) })
              console.log('[NativeSync:write] map size after set:', map.size)
            }
          } else {
            console.log('[NativeSync:write] SKIPPED afterCreate — suppressRemoteTldrawRef is true')
          }
        }
      })

      editor.sideEffects.registerAfterChangeHandler('shape', (_prev, next) => {
        if (isSwitchingBoardRef.current) return
        if (!(next as any).type.startsWith('bords-')) {
          scheduleNativeFlush()
          if (!suppressRemoteTldrawRef.current) {
            const { ydoc } = useCollabStore.getState()
            console.log('[NativeSync:write] afterChange', next.id, next.type, 'ydoc:', ydoc ? 'SET' : 'NULL')
            if (ydoc) {
              const map = ydoc.getMap(YJS_KEYS.TLDRAW_SHAPES)
              ydoc.transact(() => { map.set(next.id, JSON.parse(JSON.stringify(next))) })
            }
          }
        }
      })

      editor.sideEffects.registerAfterDeleteHandler('shape', (shape) => {
        if (isSwitchingBoardRef.current) return
        if (!(shape as any).type.startsWith('bords-')) {
          scheduleNativeFlush()
          if (!suppressRemoteTldrawRef.current) {
            const { ydoc } = useCollabStore.getState()
            if (ydoc) {
              const map = ydoc.getMap(YJS_KEYS.TLDRAW_SHAPES)
              ydoc.transact(() => { map.delete(shape.id) })
            }
          }
        }
      })

      // Binding create / change / delete
      editor.sideEffects.registerAfterCreateHandler('binding', (binding) => {
        if (!isSwitchingBoardRef.current) {
          scheduleNativeFlush()
          if (!suppressRemoteTldrawRef.current) {
            const { ydoc } = useCollabStore.getState()
            if (ydoc) {
              const map = ydoc.getMap(YJS_KEYS.TLDRAW_BINDINGS)
              ydoc.transact(() => { map.set(binding.id, JSON.parse(JSON.stringify(binding))) })
            }
          }
        }
      })
      editor.sideEffects.registerAfterChangeHandler('binding', (_prev, next) => {
        if (!isSwitchingBoardRef.current) {
          scheduleNativeFlush()
          if (!suppressRemoteTldrawRef.current) {
            const { ydoc } = useCollabStore.getState()
            if (ydoc) {
              const map = ydoc.getMap(YJS_KEYS.TLDRAW_BINDINGS)
              ydoc.transact(() => { map.set(next.id, JSON.parse(JSON.stringify(next))) })
            }
          }
        }
      })
      editor.sideEffects.registerAfterDeleteHandler('binding', (binding) => {
        if (!isSwitchingBoardRef.current) {
          scheduleNativeFlush()
          if (!suppressRemoteTldrawRef.current) {
            const { ydoc } = useCollabStore.getState()
            if (ydoc) {
              const map = ydoc.getMap(YJS_KEYS.TLDRAW_BINDINGS)
              ydoc.transact(() => { map.delete(binding.id) })
            }
          }
        }
      })

      // Asset create / change / delete
      editor.sideEffects.registerAfterCreateHandler('asset', (asset) => {
        if (!isSwitchingBoardRef.current) {
          scheduleNativeFlush()
          if (!suppressRemoteTldrawRef.current) {
            const { ydoc } = useCollabStore.getState()
            if (ydoc) {
              const map = ydoc.getMap(YJS_KEYS.TLDRAW_ASSETS)
              ydoc.transact(() => { map.set(asset.id, JSON.parse(JSON.stringify(asset))) })
            }
          }
        }
      })
      editor.sideEffects.registerAfterChangeHandler('asset', (_prev, next) => {
        if (!isSwitchingBoardRef.current) {
          scheduleNativeFlush()
          if (!suppressRemoteTldrawRef.current) {
            const { ydoc } = useCollabStore.getState()
            if (ydoc) {
              const map = ydoc.getMap(YJS_KEYS.TLDRAW_ASSETS)
              ydoc.transact(() => { map.set(next.id, JSON.parse(JSON.stringify(next))) })
            }
          }
        }
      })
      editor.sideEffects.registerAfterDeleteHandler('asset', (asset) => {
        if (!isSwitchingBoardRef.current) {
          scheduleNativeFlush()
          if (!suppressRemoteTldrawRef.current) {
            const { ydoc } = useCollabStore.getState()
            if (ydoc) {
              const map = ydoc.getMap(YJS_KEYS.TLDRAW_ASSETS)
              ydoc.transact(() => { map.delete(asset.id) })
            }
          }
        }
      })

      // Broadcast cursor position to remote collaborators via awareness
      // Uses pointermove instead of tick to avoid Safari performance issues
      let _cursorThrottle = 0
      const _cursorHandler = () => {
        const now = Date.now()
        if (now - _cursorThrottle < 50) return // throttle to 20fps
        _cursorThrottle = now
        const { provider } = useCollabStore.getState()
        if (!provider) return
        const pagePoint = editor.inputs.currentPagePoint
        if (pagePoint) {
          // Send tldraw page-space coords directly — these are board-space
          updateLocalCursor(provider, {
            x: pagePoint.x,
            y: pagePoint.y,
          })
        }
      }
      editor.on('tick', _cursorHandler)
      ;(editor as any).__bordsCursorHandler = _cursorHandler

      // Flush any pending native changes when the page is about to close
      const handleBeforeUnload = () => {
        if (nativeFlushTimerRef.current) {
          clearTimeout(nativeFlushTimerRef.current)
          nativeFlushTimerRef.current = null
          flushNativeState()
        }
      }
      window.addEventListener('beforeunload', handleBeforeUnload)

      // Store cleanup functions for unmount
      ;(editor as any).__bordsUnsubscribers = [
        unsubNotes, unsubTexts, unsubChecklists, unsubKanbans, unsubMedias, unsubReminders, unsubTables,
      ]
      ;(editor as any).__bordsNativeCleanup = handleBeforeUnload
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  return (
    <div className={className} style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
        shapeUtils={customShapeUtils}
        components={components}
        overrides={overrides}
        onMount={handleMount}
        inferDarkMode={false}
        options={{
          maxPages: 1,
        }}
      >
        {/* Editor context provider — wraps children so Dock/TopBar/SideBar can access editor */}
        <TldrawEditorBridge editorRef={editorRef}>
          {children}
        </TldrawEditorBridge>
      </Tldraw>

      {/* Dark mode class override — tldraw uses .tl-theme__dark / .tl-theme__light */}
      <style>{`
        .tl-theme__light {
          --color-background: ${isDark ? '#18181b' : '#f4f4f5'};
          --color-brush-fill: ${isDark ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.1)'};
          --color-brush-stroke: ${isDark ? 'rgba(59,130,246,0.4)' : 'rgba(59,130,246,0.4)'};
          --color-selection-fill: ${isDark ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.08)'};
          --color-selection-stroke: ${isDark ? '#3b82f6' : '#3b82f6'};
        }
        .tl-theme__dark {
          --color-background: #18181b;
          --color-brush-fill: rgba(59,130,246,0.1);
          --color-brush-stroke: rgba(59,130,246,0.4);
          --color-selection-fill: rgba(59,130,246,0.08);
          --color-selection-stroke: #3b82f6;
        }
        /* Hide any remaining tldraw chrome */
        .tlui-layout__top,
        .tlui-layout__bottom {
          display: none !important;
        }
      `}</style>
    </div>
  )
}

/* ── Bridge component: captures editor from tldraw context and provides it ── */
function TldrawEditorBridge({
  editorRef,
  children,
}: {
  editorRef: React.MutableRefObject<Editor | null>
  children?: React.ReactNode
}) {
  // We need to force a re-render when the editor becomes available
  const [editor, setEditor] = useState<Editor | null>(null)

  useEffect(() => {
    // Poll briefly for the editor ref to be populated (set in handleMount)
    const check = setInterval(() => {
      if (editorRef.current && editorRef.current !== editor) {
        setEditor(editorRef.current)
        clearInterval(check)
      }
    }, 50)
    return () => clearInterval(check)
  }, [editorRef, editor])

  return (
    <TldrawEditorContext.Provider value={editor}>
      {children}
    </TldrawEditorContext.Provider>
  )
}
