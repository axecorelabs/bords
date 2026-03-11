"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { X, Layout, Plus } from "lucide-react";

import { DndContext, DragEndEvent, DragStartEvent, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { GridBackground } from "@/components/GridBackground";
import { Dock } from "@/components/Dock";
import { TopBar } from "@/components/TopBar";
import { RemoteCursors } from "@/components/RemoteCursors";
import { StickyNote } from "@/components/StickyNote";
import { Checklist } from "@/components/Checklist";
import { useThemeStore } from "@/store/themeStore";
import { useNoteStore } from "@/store/stickyNoteStore";
import { useChecklistStore } from "@/store/checklistStore";
import { Connections, ConnectionLines, notifyConnectionsDragStart, notifyConnectionsDragEnd, scheduleConnectionUpdate } from "@/components/Connections";
import { DragLayer } from "@/components/DragLayer";
import { useConnectionStore } from "@/store/connectionStore";
import { Text } from "@/components/Text";
import { useTextStore } from "@/store/textStore";
import { OrganizePanel } from "@/components/OrganizePanel";
import { useBoardStore } from "@/store/boardStore";
import { DrawingCanvas, DrawingSVGLayer } from "@/components/DrawingCanvas";
import { KanbanBoard } from "@/components/KanbanBoard";
import { useKanbanStore } from "@/store/kanbanStore";
import { Reminder } from "@/components/Reminder";
import { useReminderStore } from "@/store/reminderStore";
import { SideBar } from "@/components/SideBar";
import { ExportModal } from "@/components/ExportModal";
import { Media } from "@/components/Media";
import { useMediaStore } from "@/store/mediaStore";
import { MediaModal } from "@/components/MediaModal";
import { useDrawingStore } from "@/store/drawingStore";
import { BackgroundModal } from "@/components/BackgroundModal";
import { ConnectionLineModal } from "@/components/ConnectionLineModal";
import { useGridStore } from "@/store/gridStore";
import { useDragModeStore } from "@/store/dragModeStore";
import { usePresentationStore } from "@/store/presentationStore";
import { useFullScreenStore } from "@/store/fullScreenStore";
import { AssignTaskModal } from "@/components/delegation/AssignTaskModal";
import { useDelegationStore } from "@/store/delegationStore";
import { useOrganizationStore } from "@/store/organizationStore";
import { useViewportScale } from "@/hooks/useViewportScale";
import { PresentationDock } from "@/components/PresentationDock";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { useZIndexStore } from "@/store/zIndexStore";
import { isTldraw } from "@/config/canvas";
import { connectToBoard, disconnectFromBoard } from "@/lib/yjs-provider";
import { setupYjsBindings } from "@/lib/yjs-bindings";
import { setupAwareness, updateLocalCursor } from "@/lib/yjs-awareness";
import { useCollabStore } from "@/store/collabStore";
import { fetchRoomAwareness } from "@/lib/collab-api";
import { CallRoom } from "@/components/call/CallRoom";
import { CallBanner } from "@/components/call/CallBanner";

// Lazy-load tldraw canvas to avoid bundling it when not used
import dynamic from "next/dynamic";
const TldrawCanvas = dynamic(
  () => import("@/tldraw/TldrawCanvas").then((m) => ({ default: m.TldrawCanvas })),
  { ssr: false }
);


// Fullscreen presentation mode is handled inline in the Home component
// (no separate overlay component needed — avoids stacking context issues)

export default function Home() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [hoveredCell, setHoveredCell] = useState<number | null>(null);
  const [deviceType, setDeviceType] = useState<'desktop' | 'tablet-landscape' | 'tablet-portrait' | 'phone'>('desktop');
  const [isRestoringBoard, setIsRestoringBoard] = useState(true);
  const isDark = useThemeStore((state) => state.isDark);
  const zoom = useGridStore((state) => state.zoom);
  const setZoom = useGridStore((state) => state.setZoom);
  const setCurrentUserId = useBoardStore((state) => state.setCurrentUserId);
  
  // Get delete functions from all stores for cascade cleanup
  const { deleteNote } = useNoteStore();
  const { deleteChecklist } = useChecklistStore();
  const { deleteText } = useTextStore();
  const { removeBoard: deleteKanban } = useKanbanStore();
  const { deleteMedia } = useMediaStore();
  const { deleteDrawing } = useDrawingStore();
  const { clearBoardConnections } = useConnectionStore();
  const { reminders, updateReminder: updateReminderPos } = useReminderStore();
  const { deleteReminder } = useReminderStore();

  // All hooks must be called before any conditional returns
  const { notes, updateNote } = useNoteStore();
  const { checklists, updateChecklist } = useChecklistStore();
  const { clearSelection } = useConnectionStore();
  const connections = useConnectionStore((state) => state.connections);
  const { texts, updateText } = useTextStore();
  const { boards: kanbanBoards, updateBoardPosition } = useKanbanStore();
  const { medias, updateMedia } = useMediaStore();
  const currentBoardId = useBoardStore((state) => state.currentBoardId);
  const currentBoard = useBoardStore((state) =>
    state.boards.find((board) => board.id === currentBoardId)
  );

  // Setup @dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,      // Hold 200ms before drag activates
        tolerance: 6,    // Allow 6px finger wobble during hold
      },
    })
  );

  const vScale = useViewportScale();

  // Handle drag start — notify connection lines to start tracking
  const handleDragStart = (_event: DragStartEvent) => {
    notifyConnectionsDragStart()
  }

  // Handle drag end
  const handleDragEnd = (event: DragEndEvent) => {
    notifyConnectionsDragEnd()
    const { active, delta } = event;
    const data = active.data.current;
    const snap = useGridStore.getState().snapValue;
    const z = useGridStore.getState().zoom;
    // Convert screen-pixel delta to logical-space delta (account for both zoom and viewport scale)
    const dx = delta.x / (z * vScale);
    const dy = delta.y / (z * vScale);
    // Canvas scroll width is in rendered pixels; divide by zoom*vScale to get logical-space boundary
    const canvasEl = document.querySelector('[data-board-canvas]');
    const logicalContentW = canvasEl ? canvasEl.scrollWidth / (z * vScale) : window.innerWidth * 2;
    const padding = 16;
    
    if (data?.type === 'note') {
      const noteWidth = data.width || 192;
      const newPosition = {
        x: snap(Math.max(padding, Math.min(logicalContentW - (noteWidth + padding), data.position.x + dx))),
        y: snap(data.position.y + dy)
      };
      updateNote(data.id, { position: newPosition });
    } else if (data?.type === 'checklist') {
      const checklistWidth = data.width || 320;
      const newPosition = {
        x: snap(Math.max(padding, Math.min(logicalContentW - (checklistWidth + padding), data.position.x + dx))),
        y: snap(data.position.y + dy)
      };
      updateChecklist(data.id, { position: newPosition });
    } else if (data?.type === 'media') {
      const newPosition = {
        x: snap(data.position.x + dx),
        y: snap(data.position.y + dy)
      };
      updateMedia(data.id, { position: newPosition });
    } else if (data?.type === 'text') {
      const textItem = texts.find(t => t.id === data.id);
      const textWidth = textItem?.width || 200;
      const newPosition = {
        x: snap(Math.max(padding, Math.min(logicalContentW - (textWidth + padding), data.position.x + dx))),
        y: snap(data.position.y + dy)
      };
      updateText(data.id, { position: newPosition });
    } else if (data?.type === 'kanban') {
      const newPosition = {
        x: snap(Math.max(padding, Math.min(logicalContentW - 800, data.position.x + dx))),
        y: snap(data.position.y + dy)
      };
      updateBoardPosition(data.id, newPosition);
    } else if (data?.type === 'reminder') {
      const newPosition = {
        x: snap(Math.max(padding, Math.min(logicalContentW - 280, data.position.x + dx))),
        y: snap(data.position.y + dy)
      };
      updateReminderPos(data.id, { position: newPosition });
    }
  };

  const isDragEnabled = useDragModeStore((state) => state.isDragEnabled);
  const { isPresentationMode, setPresentationMode } = usePresentationStore();
  const { isFullScreen, setFullScreen } = useFullScreenStore();

  // Full screen mode: computed transform to fit all items in viewport
  const [presTransform, setPresTransform] = useState<{ tx: number; ty: number; s: number } | null>(null)
  const [presHintVisible, setPresHintVisible] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const cursorThrottleRef = useRef(0)

  // Ctrl/Cmd+Wheel or trackpad pinch zoom handler — global so it works
  // even when cursor is over Dock, TopBar, SideBar, etc.
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()

      // Trackpad pinch fires small deltaY (±1-10); mouse wheel fires larger (±100+)
      // Use adaptive sensitivity so both feel responsive
      const absDelta = Math.abs(e.deltaY)
      const sensitivity = absDelta < 10 ? 0.01 : 0.002
      const delta = -e.deltaY * sensitivity
      const currentZoom = useGridStore.getState().zoom
      const raw = currentZoom + delta
      const newZoom = Math.min(Math.max(0.25, raw), 2)
      // Round to nearest 1% to prevent floating-point drift
      useGridStore.getState().setZoom(Math.round(newZoom * 100) / 100)
      scheduleConnectionUpdate()
    }

    document.addEventListener('wheel', handleWheel, { passive: false })
    return () => document.removeEventListener('wheel', handleWheel)
  }, [])

  // Canvas panning: hold-click on empty background → drag to scroll
  const panRef = useRef({ active: false, panning: false, x: 0, y: 0, scrollLeft: 0, scrollTop: 0 })
  const panCleanupRef = useRef<(() => void) | null>(null)
  const isDrawing = useDrawingStore((state) => state.isDrawing)
  const isDrawingPaused = useDrawingStore((state) => state.isPaused)

  // Safety cleanup: if component unmounts mid-pan, remove document listeners
  useEffect(() => {
    return () => {
      panCleanupRef.current?.()
      panCleanupRef.current = null
    }
  }, [])

  const handleCanvasPanStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    if ((isDrawing && !isDrawingPaused) || isPresentationMode || isFullScreen) return
    const target = e.target as HTMLElement
    if (target.closest('[data-board-item]') || target.closest('.item-container') || target.closest('[data-ui-control]')) return

    panRef.current = {
      active: true,
      panning: false,
      x: e.clientX,
      y: e.clientY,
      scrollLeft: canvasRef.current?.scrollLeft || 0,
      scrollTop: canvasRef.current?.scrollTop || 0,
    }

    const PAN_THRESHOLD = 5

    const handleMouseMove = (ev: MouseEvent) => {
      const pan = panRef.current
      if (!pan.active || !canvasRef.current) return
      const dx = ev.clientX - pan.x
      const dy = ev.clientY - pan.y

      if (!pan.panning) {
        if (Math.abs(dx) > PAN_THRESHOLD || Math.abs(dy) > PAN_THRESHOLD) {
          pan.panning = true
          document.body.style.cursor = 'grabbing'
          document.body.style.userSelect = 'none'
        }
        return
      }

      canvasRef.current.scrollLeft = pan.scrollLeft - dx
      canvasRef.current.scrollTop = pan.scrollTop - dy
    }

    const handleMouseUp = () => {
      panRef.current.active = false
      panRef.current.panning = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      panCleanupRef.current = null
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    panCleanupRef.current = handleMouseUp
  }, [isDrawing, isDrawingPaused, isPresentationMode, isFullScreen])

  // Detect device type: phone, tablet (portrait/landscape), or desktop
  useEffect(() => {
    const checkDevice = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const isLandscape = w > h;
      // Detect touch-capable tablets via UA or pointer
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 1;
      const isTabletUA = /iPad|Macintosh.*Mobile/i.test(navigator.userAgent) ||
                         (/Android/i.test(navigator.userAgent) && !/Mobile/i.test(navigator.userAgent));
      const isTabletSize = isTouchDevice && Math.min(w, h) >= 600 && Math.max(w, h) >= 900;
      const isTablet = isTabletUA || isTabletSize;

      if (isTablet) {
        setDeviceType(isLandscape ? 'tablet-landscape' : 'tablet-portrait');
      } else if (w < 1024 && isTouchDevice) {
        setDeviceType('phone');
      } else if (w < 768) {
        setDeviceType('phone');
      } else {
        setDeviceType('desktop');
      }
    };

    checkDevice();
    window.addEventListener('resize', checkDevice);
    window.addEventListener('orientationchange', checkDevice);

    return () => {
      window.removeEventListener('resize', checkDevice);
      window.removeEventListener('orientationchange', checkDevice);
    };
  }, []);

  // Set current user ID and redirect to login if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated" && session?.user?.email) {
      setCurrentUserId(session.user.email);
      // Auto-provision personal + org_container workspaces
      useWorkspaceStore.getState().fetchWorkspaces();
    }
  }, [status, router, session, setCurrentUserId]);

  // Restore last visited board after reload — waits for cloud sync
  useEffect(() => {
    if (status !== 'authenticated') return
    if (currentBoardId) {
      setIsRestoringBoard(false)
      return
    }

    let cancelled = false
    const lastId = localStorage.getItem('bords-last-board')

    const restore = async () => {
      // 1. Try immediate restore from hydrated Zustand store
      const tryRestore = () => {
        const boards = useBoardStore.getState().boards
        const userId = useBoardStore.getState().currentUserId
        if (lastId && boards.some(b => b.id === lastId && b.userId === userId)) {
          useBoardStore.getState().setCurrentBoard(lastId)
          return true
        }
        return false
      }
      if (tryRestore()) { if (!cancelled) setIsRestoringBoard(false); return }

      // 2. Wait for Zustand hydration (throttledStorage may be async)
      await new Promise<void>(resolve => {
        let attempts = 0
        const interval = setInterval(() => {
          attempts++
          if (tryRestore() || attempts >= 5 || cancelled) {
            clearInterval(interval)
            resolve()
          }
        }, 80)
      })
      if (cancelled || useBoardStore.getState().currentBoardId) {
        if (!cancelled) setIsRestoringBoard(false)
        return
      }

      // 3. Board content is now loaded from Y.Doc (IndexedDB + WebSocket),
      // so no cloud fetch needed here. Just finalize restore.
      if (!cancelled) {
        tryRestore()
        setIsRestoringBoard(false)
      }
    }

    restore()
    return () => { cancelled = true }
  }, [status, currentBoardId]);

  /* ── Yjs collaboration: connect to collab server when board + session are ready ── */
  // Y.Doc is the single source of truth. IndexedDB provides offline state,
  // WebSocket merges remote changes via CRDT. No REST content sync needed.

  useEffect(() => {
    if (status !== 'authenticated' || !currentBoardId || !session?.user) return

    console.log('[Collab] Connecting to room:', currentBoardId)

    let cancelled = false
    let cleanupBindings: (() => void) | null = null
    let cleanupAwareness: (() => void) | null = null

    const init = async () => {
      try {
        console.log('[Collab] init() starting for board:', currentBoardId)
        // Phase 1: Local-only — always succeeds.
        // Creates Y.Doc + IndexedDB persistence. Board works offline.
        // Fetch awareness snapshot in parallel.
        const [snapshot, connectionResult] = await Promise.all([
          fetchRoomAwareness(currentBoardId).catch(() => null),
          connectToBoard(currentBoardId),
        ])

        if (cancelled) {
          console.warn('[Collab] Cancelled after connect — tearing down')
          disconnectFromBoard()
          return
        }

        const { ydoc, provider } = connectionResult
        console.log('[Collab] connectToBoard returned — provider:', provider ? 'present' : 'null (offline mode)')

        // ALWAYS set up bindings (Y.Doc ↔ Zustand) — this only needs ydoc,
        // not the WebSocket. Content flows: Zustand → Y.Doc → IndexedDB.
        cleanupBindings = setupYjsBindings(ydoc, currentBoardId)
        console.log('[Collab] Yjs bindings set up')

        // Phase 2: Remote sync — optional, may not be available.
        if (provider) {
          // Seed awareness from REST snapshot
          console.log('[Collab] Awareness snapshot:', snapshot?.length ?? 0, 'users')
          if (snapshot && snapshot.length > 0) {
            const currentId = (session.user as any).id || session.user.email
            useCollabStore.getState().setRemoteUsers(
              snapshot
                .filter(s => s.user?.id && s.user.id !== currentId)
                .map(s => ({
                  clientId: s.clientId,
                  user: { ...s.user, email: '', avatar: null },
                  cursor: s.cursor,
                  selection: s.selection,
                  editingItem: s.editingItem,
                }))
            )
          }

          // Set up awareness BEFORE opening the WebSocket so our user state
          // is ready when the first awareness sync fires.
          cleanupAwareness = setupAwareness(provider, {
            id: (session.user as any).id || session.user.email || 'anon',
            name: session.user.name || session.user.email || 'Anonymous',
            email: session.user.email || '',
            avatar: session.user.image || null,
          })

          // NOW open the WebSocket (bindings + awareness already wired)
          // IndexedDB state is already loaded → Zustand populated immediately.
          // WebSocket sync will merge any remote changes via CRDT.
          console.log('[Collab] Calling websocketProvider.connect() NOW')
          provider.configuration.websocketProvider.connect()
          console.log('[Collab] websocketProvider.connect() called')
        } else {
          console.log('[Collab] No provider — board running in offline mode')
        }
      } catch (err) {
        console.error('[Collab] *** init() FAILED ***', err)
      }
    }

    init()

    return () => {
      cancelled = true
      cleanupBindings?.()
      cleanupAwareness?.()
      disconnectFromBoard()
    }
  }, [status, currentBoardId, session]);

  // Drag mode cursor
  useEffect(() => {
    document.body.style.cursor = isDragEnabled ? 'grab' : '';
    return () => { document.body.style.cursor = '' }
  }, [isDragEnabled]);

  // Presentation mode: Escape key to exit
  useEffect(() => {
    if (!isPresentationMode) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresentationMode(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isPresentationMode, setPresentationMode]);

  // Full screen mode: Escape key to exit
  useEffect(() => {
    if (!isFullScreen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullScreen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isFullScreen, setFullScreen]);

  // Full screen mode: compute bounding box of all items → scale to fit viewport
  useEffect(() => {
    if (!isFullScreen) {
      setPresTransform(null)
      setPresHintVisible(false)
      return
    }

    setPresHintVisible(true)
    const hintTimer = setTimeout(() => setPresHintVisible(false), 3000)

    // Small delay so items are rendered and the canvas ref is available
    const computeTimer = setTimeout(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      const items = canvas.querySelectorAll('[data-board-item]')
      if (items.length === 0) return

      // Bounding box in canvas-scroll coordinate space
      const scrollL = canvas.scrollLeft
      const scrollT = canvas.scrollTop
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      items.forEach((el) => {
        const rect = el.getBoundingClientRect()
        const x = rect.left + scrollL
        const y = rect.top + scrollT
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x + rect.width)
        maxY = Math.max(maxY, y + rect.height)
      })

      const cw = maxX - minX
      const ch = maxY - minY
      if (cw <= 0 || ch <= 0) return

      const pad = 60
      const vw = window.innerWidth - pad * 2
      const vh = window.innerHeight - pad * 2
      const s = Math.min(1, vw / cw, vh / ch)
      const sw = cw * s
      const sh = ch * s
      const tx = (window.innerWidth - sw) / 2 - minX * s
      const ty = (window.innerHeight - sh) / 2 - minY * s

      setPresTransform({ tx, ty, s })
    }, 50)

    return () => { clearTimeout(hintTimer); clearTimeout(computeTimer) }
  }, [isFullScreen]);

  // Listen for board deletion to cleanup associated items
  useEffect(() => {
    const handleBoardDeleted = (event: CustomEvent) => {
      const { boardId, noteIds, checklistIds, textIds, kanbanIds, mediaIds, drawingIds, reminderIds } = event.detail;
      
      // Delete all connections for this board
      clearBoardConnections(boardId);
      
      // Delete all notes
      noteIds.forEach((id: string) => deleteNote(id));
      
      // Delete all checklists
      checklistIds.forEach((id: string) => deleteChecklist(id));
      
      // Delete all texts
      textIds.forEach((id: string) => deleteText(id));
      
      // Delete all kanban boards
      kanbanIds.forEach((id: string) => deleteKanban(id));
      
      // Delete all media
      mediaIds.forEach((id: string) => deleteMedia(id));
      
      // Delete all drawings
      drawingIds.forEach((id: string) => deleteDrawing(id));

      // Delete all reminders
      (reminderIds || []).forEach((id: string) => deleteReminder(id));

      // Clean up zIndex entries for deleted items
      const allDeletedIds = [...noteIds, ...checklistIds, ...textIds, ...kanbanIds, ...mediaIds, ...drawingIds, ...(reminderIds || [])]
      allDeletedIds.forEach((id: string) => useZIndexStore.getState().removeItem(id))
    };
    
    window.addEventListener('boardDeleted', handleBoardDeleted as EventListener);
    return () => window.removeEventListener('boardDeleted', handleBoardDeleted as EventListener);
  }, [deleteNote, deleteChecklist, deleteText, deleteKanban, deleteMedia, deleteDrawing, deleteReminder, clearBoardConnections]);

  // Initialize delegation data when authenticated
  useEffect(() => {
    if (status === 'authenticated') {
      useOrganizationStore.getState().fetchOrganizations();
      useDelegationStore.getState().fetchBords();
      useDelegationStore.getState().fetchNotifications();
    }
  }, [status]);

  // Fetch assignments when board changes and is linked to a bord
  useEffect(() => {
    if (!currentBoardId || status !== 'authenticated') return;
    const { getBordForLocalBoard, fetchAssignments } = useDelegationStore.getState();
    const bord = getBordForLocalBoard(currentBoardId);
    if (bord) {
      fetchAssignments(bord._id);
    }
  }, [currentBoardId, status]);

  // Rewire connection lines after board items render (on page load / board switch)
  // The DOM nodes need to exist before positions can be calculated, so we wait
  // a tick after React renders the filtered items.
  useEffect(() => {
    if (!currentBoardId) return
    const t1 = setTimeout(() => scheduleConnectionUpdate(), 100)
    const t2 = setTimeout(() => scheduleConnectionUpdate(), 400)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [currentBoardId]);

  // Show loading state while checking authentication
  if (status === "loading") {
    return (
      <div
        className="fixed inset-0 bg-zinc-900 flex items-center justify-center"
      >
        <div className="text-center">
          <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center p-3 mx-auto mb-6 border border-zinc-800">
            <img src="/bordclear.png" alt="BORDS" className="w-full h-full object-contain" />
          </div>
          <div className="w-8 h-8 border-3 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm text-zinc-500">
            Loading...
          </p>
        </div>
      </div>
    );
  }

  // Don't render anything if not authenticated (will redirect)
  if (!session) {
    return null;
  }

  // Show appropriate screen for non-desktop devices
  if (deviceType === 'phone') {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center p-3 mx-auto mb-6 border border-zinc-800">
            <img src="/bordclear.png" alt="BORDS" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">
            Desktop Only
          </h1>
          <p className="text-zinc-400 mb-8 leading-relaxed">
            The BORDS canvas requires a larger screen. You can still view and manage your inbox.
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => router.push('/inbox')}
              className="w-full px-6 py-3.5 bg-white text-black rounded-xl font-semibold hover:bg-zinc-100 transition-colors"
            >
              View Inbox
            </button>
            <button
              onClick={() => router.push('/login')}
              className="w-full px-6 py-3.5 bg-zinc-800 text-zinc-300 rounded-xl font-medium hover:bg-zinc-700 transition-colors border border-zinc-700"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (deviceType === 'tablet-portrait') {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center p-8">
        <div className="max-w-lg text-center">
          <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center p-3 mx-auto mb-6 border border-zinc-800">
            <img src="/bordclear.png" alt="BORDS" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">
            Rotate Your Device
          </h1>
          <p className="text-zinc-400 mb-4 leading-relaxed">
            BORDS is available on your tablet in landscape mode. Please rotate your device horizontally to use the full canvas.
          </p>
          {/* Rotate icon */}
          <div className="mb-8">
            <svg className="w-16 h-16 text-zinc-600 mx-auto animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5l2 2m0 0l-2 2m2-2H15" />
            </svg>
          </div>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => router.push('/inbox')}
              className="w-full px-6 py-3.5 bg-white text-black rounded-xl font-semibold hover:bg-zinc-100 transition-colors"
            >
              View Inbox Instead
            </button>
            <button
              onClick={() => router.push('/login')}
              className="w-full px-6 py-3.5 bg-zinc-800 text-zinc-300 rounded-xl font-medium hover:bg-zinc-700 transition-colors border border-zinc-700"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Filter items based on current board
  const filteredNotes = notes.filter((note) =>
    currentBoard?.notes.includes(note.id)
  );
  const filteredChecklists = checklists.filter((checklist) =>
    currentBoard?.checklists.includes(checklist.id)
  );
  const filteredTexts = texts.filter((text) =>
    currentBoard?.texts.includes(text.id)
  );
  const filteredKanbans = kanbanBoards.filter((kanban) =>
    currentBoard?.kanbans?.includes(kanban.id)
  );
  const filteredMedias = medias.filter((media) =>
    currentBoard?.medias?.includes(media.id)
  );
  const filteredReminders = reminders.filter((reminder) =>
    currentBoard?.reminders?.includes(reminder.id)
  );

  const handleGlobalClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.classList.contains("app-background") ||
      target.classList.contains("grid-cell")
    ) {
      clearSelection();
      // Hide all nodes by triggering blur on all items
      document.querySelectorAll(".item-container").forEach((item) => {
        (item as HTMLElement).blur();
      });
    }
  };

  // Empty state — no board selected
  if (!currentBoardId || !currentBoard) {
    // Show branded loading while restoring board from localStorage / cloud
    if (isRestoringBoard) {
      return (
        <div className="fixed inset-0 bg-zinc-900 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center p-3 mx-auto mb-6 border border-zinc-800">
              <img src="/bordclear.png" alt="BORDS" className="w-full h-full object-contain" />
            </div>
            <div className="w-8 h-8 border-3 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-3"></div>
            <p className="text-sm text-zinc-500">Loading your workspace...</p>
          </div>
        </div>
      )
    }
    return (
      <div className={`fixed inset-0 ${isDark ? 'bg-zinc-900' : 'bg-zinc-100'}`}>
        <GridBackground hoveredCell={null} onCellHover={() => {}} onCellClick={() => {}} />
        <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 1 }}>
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center p-3 mx-auto mb-6 border border-zinc-800">
            <img src="/bordclear.png" alt="BORDS" className="w-full h-full object-contain" />
          </div>
          <h2 className={`text-xl font-semibold mb-2 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
            No board selected
          </h2>
          <p className={`text-sm mb-6 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
            Select an existing board or create a new one to get started.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => useBoardStore.getState().setBoardsPanelOpen(true)}
              className={`px-5 py-2.5 rounded-xl font-medium text-sm transition-colors ${
                isDark
                  ? 'bg-zinc-800 text-white hover:bg-zinc-700 border border-zinc-700'
                  : 'bg-white text-zinc-900 hover:bg-zinc-50 border border-zinc-200'
              }`}
            >
              <Layout size={16} className="inline mr-2 -mt-0.5" />
              Select Board
            </button>
            <button
              onClick={() => {
                useBoardStore.getState().setBoardsPanelOpen(true)
                // Small delay so the panel opens first
                setTimeout(() => {
                  const createBtn = document.querySelector('[data-create-board-btn]') as HTMLElement
                  createBtn?.click()
                }, 100)
              }}
              className="px-5 py-2.5 rounded-xl font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <Plus size={16} className="inline mr-2 -mt-0.5" />
              Create Board
            </button>
          </div>
        </div>
        </div>
        {/* Still render TopBar + BoardsPanel so user can navigate */}
        <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 50 }}>
          <div className="pointer-events-auto">
            <TopBar />
          </div>
        </div>
      </div>
    )
  }

  // ── tldraw canvas provider ──
  if (isTldraw()) {
    return (
      <TldrawCanvas>
          {/* UI Chrome — rendered on top of tldraw canvas via portal-like fixed positioning */}
          <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 50 }}>
          {/* Connection controls (connect/disconnect buttons, connections panel) */}
          {/* <div className="pointer-events-auto">
            {currentBoardId && <Connections key={`tl-conns-${currentBoardId}`} />}
          </div> */}

          <div className="pointer-events-auto">
            <TopBar />
            <RemoteCursors />
            {isPresentationMode ? (
              <>
                <PresentationDock />
                <ExportModal />
              </>
            ) : (
              <>
                <Dock />
                <SideBar />
                <ExportModal />
                <MediaModal />
                <BackgroundModal />
                <ConnectionLineModal />
                <AssignTaskModal />
              </>
            )}
          </div>
          {!isPresentationMode && (
            <div className="pointer-events-auto">
              <OrganizePanel />
            </div>
          )}

          {/* Call overlays */}
          <div className="pointer-events-auto">
            <CallRoom />
            <CallBanner />
          </div>
        </div>
      </TldrawCanvas>
    )
  }

  // ── Custom canvas provider (original) ──
  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} autoScroll={false}>
      <div
        className={`fixed inset-0 ${isDark ? "bg-zinc-900" : "bg-zinc-100"} app-background ${isFullScreen ? 'overflow-hidden' : 'overflow-auto'}`}
        onClick={isFullScreen ? undefined : handleGlobalClick}
        style={{
          backgroundImage: !isFullScreen && currentBoard?.backgroundImage
            ? `url(${currentBoard.backgroundImage})`
            : undefined,
          backgroundColor: isFullScreen
            ? (isDark ? '#09090b' : '#f4f4f5')
            : (currentBoard?.backgroundColor || undefined),
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >

      {/* Fullscreen mode UI */}
      {isFullScreen && (
        <>
          {/* Interaction blocker — covers the scaled canvas */}
          <div className="fixed inset-0" style={{ zIndex: 100, pointerEvents: 'auto' }} />

          {/* Exit button */}
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            onClick={() => setFullScreen(false)}
            className={`fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm shadow-2xl backdrop-blur-md transition-colors ${
              isDark
                ? 'bg-white/10 text-white hover:bg-white/20 border border-white/10'
                : 'bg-black/10 text-zinc-900 hover:bg-black/20 border border-black/10'
            }`}
            style={{ zIndex: 101 }}
          >
            <X size={16} />
            Exit Full Screen
          </motion.button>

          {/* Hint toast */}
          {presHintVisible && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="fixed top-8 left-1/2 -translate-x-1/2 bg-black/70 text-white px-5 py-3 rounded-xl backdrop-blur-md text-center"
              style={{ zIndex: 101, animation: 'fadeOut 1s ease-in 2s forwards' }}
            >
              <p className="text-sm font-medium">Full Screen Mode</p>
              <p className="text-xs text-white/60 mt-0.5">Press <kbd className="px-1.5 py-0.5 bg-white/20 rounded text-[10px]">ESC</kbd> to exit</p>
            </motion.div>
          )}
          <style>{`@keyframes fadeOut { to { opacity: 0; } }`}</style>
        </>
      )}

      <div className="relative min-h-[470vh]">
        {!isFullScreen && (
          <GridBackground
            hoveredCell={hoveredCell}
            onCellHover={setHoveredCell}
            onCellClick={() => {}}
          />
        )}

        {/* Remote collaborator cursors */}
        <RemoteCursors />

        {/* Content and Connection Lines */}
        <div
          ref={canvasRef}
          className={`fixed inset-0 ${isFullScreen ? 'overflow-visible' : 'overflow-auto'} pb-[450vh]`}
          data-board-canvas
          onMouseDown={handleCanvasPanStart}
          onPointerMove={(e) => {
            const now = Date.now()
            if (now - cursorThrottleRef.current < 50) return
            cursorThrottleRef.current = now
            const provider = useCollabStore.getState().provider
            if (provider && canvasRef.current) {
              const z = useGridStore.getState().zoom
              const scrollLeft = canvasRef.current.scrollLeft
              const scrollTop = canvasRef.current.scrollTop
              // Convert screen coords → board-space (logical) coords
              updateLocalCursor(provider, {
                x: (e.clientX + scrollLeft) / z,
                y: (e.clientY + scrollTop) / z,
              })
            }
          }}
          onPointerLeave={() => {
            const provider = useCollabStore.getState().provider
            if (provider) updateLocalCursor(provider, null)
          }}
          style={isFullScreen && presTransform ? {
            transform: `translate(${presTransform.tx}px, ${presTransform.ty}px) scale(${presTransform.s})`,
            transformOrigin: '0 0',
            pointerEvents: 'none' as const,
          } : undefined}
        >
          {/* Connection Lines SVG - rendered before items so lines appear behind */}
          {currentBoardId && <ConnectionLines key={`lines-${currentBoardId}`} />}

          {/* Items Layer */}
          <div
            className="relative"
            data-items-layer
            style={{
              paddingTop: "20vh",
              paddingBottom: "200vh",
              minWidth: "200vw",
              transform: `scale(${zoom})`,
              transformOrigin: '0 0',
            }}
          >
            {/* Drawing SVG strokes - scales with items */}
            <DrawingSVGLayer />

            {filteredNotes.map((note) => (
              <div
                key={note.id}
                className="pointer-events-auto"
                data-board-item
              >
                <StickyNote {...note} />
              </div>
            ))}
            {filteredChecklists.map((checklist) => (
              <div
                key={checklist.id}
                className="pointer-events-auto"
                data-board-item
              >
                <Checklist {...checklist} />
              </div>
            ))}
            {filteredTexts.map((text) => (
              <div
                key={text.id}
                className="pointer-events-auto"
                data-board-item
              >
                <Text {...text} />
              </div>
            ))}
            {filteredKanbans.map((kanban) => (
              <div
                key={kanban.id}
                className="pointer-events-auto"
                data-board-item
              >
                <KanbanBoard board={kanban} />
              </div>
            ))}
            {filteredMedias.map((media) => (
              <div
                key={media.id}
                className="pointer-events-auto"
                data-board-item
              >
                <Media {...media} />
              </div>
            ))}
            {filteredReminders.map((reminder) => (
              <div
                key={reminder.id}
                className="pointer-events-auto"
                data-board-item
              >
                <Reminder {...reminder} />
              </div>
            ))}
          </div>
        </div>

        {/* Drawing UI Layer — outside zoomed div so position:fixed works correctly */}
        <DrawingCanvas />

        {/* UI Controls Layer - Higher z-index */}
        {/* Full screen: hide everything. Presentation: show only TopBar (collapsed). Normal: show all. */}
        {!isFullScreen && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{ zIndex: 50 }}
        >
          {/* Connection Lines + Controls */}
          <div className="pointer-events-auto">
            {currentBoardId && <Connections key={currentBoardId} />}
          </div>

          {/* Navigation Controls */}
          <div className="pointer-events-auto">
            {/* TopBar always visible — it self-collapses in presentation mode */}
            <TopBar />
            <RemoteCursors />
            {isPresentationMode && (
              <>
                <PresentationDock />
                <ExportModal />
              </>
            )}
            {!isPresentationMode && (
              <>
                <Dock />
                <SideBar />

                {/* Modals */}
                <ExportModal />
                <MediaModal />
                <BackgroundModal />
                <ConnectionLineModal />
                <AssignTaskModal />
              </>
            )}
          </div>

          {/* Interaction Controls — hidden in presentation mode */}
          {!isPresentationMode && (
          <div className="pointer-events-auto">
            <DragLayer />
            <OrganizePanel />
          </div>
          )}

          {/* Call overlays */}
          <div className="pointer-events-auto">
            <CallRoom />
            <CallBanner />
          </div>
        </div>
        )}
      </div>
    </div>
    </DndContext>
  );
}
