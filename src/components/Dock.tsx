'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useThemeStore } from '../store/themeStore'
import { useGridStore } from '../store/gridStore'
import { useViewportScale } from '../hooks/useViewportScale'
import { useBoardStore } from '../store/boardStore'
import { useNoteStore} from '../store/stickyNoteStore'
import { StickyNoteForm } from './StickyNoteForm'
import { ChecklistForm } from './ChecklistForm'
import { useDragModeStore } from '../store/dragModeStore'
import { useCommentStore } from '../store/commentStore';
import { Comments } from './Comments';
import { useConnectionStore } from '../store/connectionStore';
import { usePresentationStore } from '../store/presentationStore'
import { useFullScreenStore } from '../store/fullScreenStore'
import { useBoardSyncStore } from '../store/boardSyncStore'
import {
  GripHorizontal,
  Pencil,
  StickyNote,
  LayoutGrid,
  FileEdit,
  Kanban,
  Network,
  MessageSquare,
  Palette,
  FolderTree,
  ListChecks,
  Calculator,
  Link,
  Link2,
  Type,
  Eraser,
  X,
  Layout,
  Magnet,
  Maximize,
  Bell,
  ZoomIn,
  ZoomOut,
  MousePointer2,
  Hand,
  ArrowUpRight,
  Square,
  Circle as CircleIcon,
  Triangle,
  Diamond,
  Minus,
  Highlighter,
  Table2,
  Shapes,
  Phone,
  PhoneOff,
} from 'lucide-react'
import { useTextStore } from '../store/textStore'
import { useOrganizePanelStore } from '../store/organizePanelStore'
import { useDrawingStore } from '../store/drawingStore'
import { KanbanForm } from './KanbanForm'
import { ReminderForm } from './ReminderForm'
import { useZIndexStore } from '../store/zIndexStore'
import { scheduleConnectionUpdate } from './Connections'
import { useMediaStore } from '../store/mediaStore'
import { isTldraw } from '../config/canvas'
import { useTldrawEditor } from '../tldraw/TldrawCanvas'
import { useTableStore } from '../store/tableStore'
import { GeoShapeGeoStyle } from 'tldraw'
import { useCallStore } from '../store/callStore'
import { createClient } from '@/lib/supabase/client'

export function Dock() {
  const [hoveredItem, setHoveredItem] = useState<string | number | null>(null);
  const [showNoBoardModal, setShowNoBoardModal] = useState(false);
  const isDark = useThemeStore((state) => state.isDark)
  const { isGridVisible, toggleGrid, snapEnabled, toggleSnap } = useGridStore()
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [showChecklistForm, setShowChecklistForm] = useState(false)
  const [showKanbanForm, setShowKanbanForm] = useState(false)
  const [showReminderForm, setShowReminderForm] = useState(false)
  const { addNote } = useNoteStore()
  const { isDragEnabled, toggleDragMode } = useDragModeStore()
  const { isCommenting, toggleCommenting, setCommenting, localComments, unreadCounts } = useCommentStore();
  const connections = useConnectionStore((state) => state.connections)
  const isPresentationMode = usePresentationStore((state) => state.isPresentationMode)
  const isFullScreen = useFullScreenStore((state) => state.isFullScreen)
  const { isVisible, toggleVisibility } = useConnectionStore()
  const { addText } = useTextStore()
  const toggleOrganizePanel = useOrganizePanelStore((state) => state.togglePanel)
  const currentBoardId = useBoardStore((state) => state.currentBoardId)
  const addItemToBoard = useBoardStore((state) => state.addItemToBoard)
  const toggleBoardsPanel = useBoardStore((state) => state.toggleBoardsPanel)
  const { isDrawing, toggleDrawing, isErasing, toggleEraser } = useDrawingStore()
  const bringToFront = useZIndexStore((state) => state.bringToFront)
  const { openMediaModal } = useMediaStore()
  const boardPermission = useBoardSyncStore((s) => s.boardPermissions[currentBoardId || ''] || 'owner')
  const isViewOnly = boardPermission === 'view'
  const tldrawEditor = isTldraw() ? useTldrawEditor() : null
  const usingTldraw = isTldraw()
  const { isInCall, startCall: startCallAction, leaveCall: leaveCallAction } = useCallStore()

  // Track active tldraw tool for button highlighting
  const [activeTldrawTool, setActiveTldrawTool] = useState('select')
  const [activeGeoShape, setActiveGeoShape] = useState('rectangle')
  const [tldrawZoom, setTldrawZoom] = useState(1)
  const [showShapesMenu, setShowShapesMenu] = useState(false)
  const shapesMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!usingTldraw || !tldrawEditor) return
    const interval = setInterval(() => {
      try {
        const toolId = tldrawEditor.getCurrentToolId()
        setActiveTldrawTool(prev => prev !== toolId ? toolId : prev)
        const z = tldrawEditor.getZoomLevel()
        setTldrawZoom(prev => Math.abs(prev - z) > 0.005 ? z : prev)
      } catch { /* editor may be unmounted */ }
    }, 200)
    return () => clearInterval(interval)
  }, [usingTldraw, tldrawEditor])

  // Unread comment count: synced boards use per-user unread count, local boards use local store
  const isSyncedBoard = boardPermission === 'view' || boardPermission === 'edit' || boardPermission === 'owner'
  const boardUnreadCount = isSyncedBoard
    ? (currentBoardId ? unreadCounts[currentBoardId] ?? 0 : 0)
    : localComments.filter(c => c.boardId === currentBoardId).length;

  // Fetch unread count on board change + Realtime subscription for new comments
  useEffect(() => {
    if (!isSyncedBoard || !currentBoardId) return

    // Fetch initial unread count for this user
    fetch(`/api/boards/${currentBoardId}/comments/unread`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          useCommentStore.getState().setUnreadCount(currentBoardId, d.unread ?? 0)
          useCommentStore.getState().setRealtimeCount(currentBoardId, d.total ?? 0)
        }
      })
      .catch(() => {})

    const supabase = createClient()
    const channel = supabase
      .channel(`dock-comments:${currentBoardId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'board_comments', filter: `board_id=eq.${currentBoardId}` },
        () => {
          const store = useCommentStore.getState()
          store.setRealtimeCount(currentBoardId, (store.realtimeCounts[currentBoardId] ?? 0) + 1)
          // Only increment unread if the comments panel is NOT currently open
          if (!store.isCommenting) {
            store.incrementUnread(currentBoardId)
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'board_comments', filter: `board_id=eq.${currentBoardId}` },
        () => {
          const store = useCommentStore.getState()
          store.setRealtimeCount(currentBoardId, Math.max(0, (store.realtimeCounts[currentBoardId] ?? 0) - 1))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSyncedBoard, currentBoardId])

  const zoom = useGridStore((state) => state.zoom)
  const setZoom = useGridStore((state) => state.setZoom)
  // In tldraw mode, use tldraw's actual zoom level for display
  const displayZoom = usingTldraw ? tldrawZoom : zoom
  const vScale = useViewportScale()
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)

  /** Get the center of the viewport in the correct coordinate system.
   *  tldraw mode: converts screen center → tldraw page coords via editor.screenToPage()
   *  custom mode: uses screen center / vScale as before */
  const getViewportCenter = useCallback(() => {
    if (usingTldraw && tldrawEditor) {
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      const page = tldrawEditor.screenToPage({ x: cx, y: cy })
      return { x: page.x, y: page.y }
    }
    return {
      x: (window.innerWidth / 2) / vScale,
      y: (window.innerHeight / 2) / vScale,
    }
  }, [usingTldraw, tldrawEditor, vScale])

  const handleZoomIn = () => {
    if (usingTldraw && tldrawEditor) {
      tldrawEditor.zoomIn(undefined, { animation: { duration: 200 } })
      return
    }
    const newZoom = Math.min(2, Math.round((zoom + 0.1) * 100) / 100)
    setZoom(newZoom)
    scheduleConnectionUpdate()
  }
  const handleZoomOut = () => {
    if (usingTldraw && tldrawEditor) {
      tldrawEditor.zoomOut(undefined, { animation: { duration: 200 } })
      return
    }
    const newZoom = Math.max(0.25, Math.round((zoom - 0.1) * 100) / 100)
    setZoom(newZoom)
    scheduleConnectionUpdate()
  }
  const handleZoomReset = () => {
    if (usingTldraw && tldrawEditor) {
      tldrawEditor.resetZoom(undefined, { animation: { duration: 200 } })
      return
    }
    setZoom(1)
    scheduleConnectionUpdate()
  }

  // Show modal when no board is selected
  useEffect(() => {
    if (!currentBoardId) {
      const timer = setTimeout(() => {
        setShowNoBoardModal(true);
      }, 500);
      return () => clearTimeout(timer);
    } else {
      setShowNoBoardModal(false);
    }
  }, [currentBoardId]);

  if (isPresentationMode || isFullScreen) return null

  const handleAddNote = ({ text, color, id }: { text: string; color: string; id?: string }) => {
    const center = getViewportCenter()
    
    // Calculate height based on text content
    const lineHeight = 20
    const textPadding = 60 // Top and bottom padding + label space
    const lines = text.split('\n').length
    const calculatedHeight = Math.max(100, (lines * lineHeight) + textPadding)
    
    // Use the ID from the form if provided, otherwise generate one
    const noteId = id || Date.now().toString()
    addNote({
      id: noteId,
      text,
      color,
      position: { 
        x: center.x - 96,
        y: center.y - 64
      },
      width: 192,
      height: calculatedHeight,
    })
    bringToFront(noteId)
    // Add note to current board
    if (currentBoardId) {
      addItemToBoard(currentBoardId, 'notes', noteId)
    }
    setShowNoteForm(false)
  }

  const handleCommentClick = () => {
    toggleCommenting();
  };

  const handleAddText = () => {
    const textId = Date.now().toString()
    const center = getViewportCenter()
    addText({
      id: textId,
      text: 'Double click to edit',
      position: {
        x: center.x - 100,
        y: center.y - 25
      },
      fontSize: 16,
      color: isDark ? '#fff' : '#000',
      width: 200
    })
    bringToFront(textId)
    
    // Add text to current board
    if (currentBoardId) {
      addItemToBoard(currentBoardId, 'texts', textId)
    }
  }

  const handleAddTable = () => {
    const tableId = Date.now().toString()
    const center = getViewportCenter()
    useTableStore.getState().addTable({
      id: tableId,
      title: 'Untitled Table',
      position: {
        x: center.x - 250,
        y: center.y - 150
      },
      width: 500,
      height: 300,
      color: isDark ? '#1e293b' : '#ffffff',
      columns: ['Column 1', 'Column 2', 'Column 3'],
      rows: [
        [{ value: '' }, { value: '' }, { value: '' }],
        [{ value: '' }, { value: '' }, { value: '' }],
        [{ value: '' }, { value: '' }, { value: '' }],
      ],
    })
    bringToFront(tableId)
    if (currentBoardId) {
      addItemToBoard(currentBoardId, 'tables', tableId)
    }
  }

  const dockItems = [
    // Navigation & Layout (custom canvas only — tldraw handles drag/snap natively)
    ...(!usingTldraw ? [
    { 
      id: 1, 
      icon: GripHorizontal, 
      label: "Drag Mode", 
      description: isViewOnly ? "View-only mode" : isDragEnabled ? "Click to disable drag" : "Click to enable drag",
      onClick: isViewOnly ? undefined : toggleDragMode,
      isActive: isDragEnabled,
      disabled: isViewOnly,
      customStyle: isViewOnly ? undefined : isDragEnabled 
        ? 'text-green-500 hover:text-green-600' 
        : 'text-red-500 hover:text-red-600'
    },
    ] : []),
    { 
      id: 4, 
      icon: LayoutGrid, 
      label: "Toggle Grid", 
      description: "Grid/Free layout",
      onClick: toggleGrid,
      isActive: isGridVisible 
    },
    ...(!usingTldraw ? [
    { 
      id: 41, 
      icon: Magnet, 
      label: "Snap to Grid", 
      description: snapEnabled ? "Snapping ON" : "Snapping OFF",
      onClick: toggleSnap,
      isActive: snapEnabled,
      customStyle: snapEnabled 
        ? 'text-blue-500 hover:text-blue-600' 
        : undefined
    },
    ] : []),
    { id: 'separator-1', isSeparator: true },
    
    // Content Creation
    { 
      id: 3, 
      icon: StickyNote, 
      label: "Sticky Note", 
      description: isViewOnly ? "View-only mode" : !currentBoardId ? "Select/create a board to get started" : "Add quick notes",
      onClick: currentBoardId && !isViewOnly ? () => setShowNoteForm(true) : undefined,
      disabled: !currentBoardId || isViewOnly
    },
    { 
      id: 7, 
      icon: Type, 
      label: "Add Text", 
      description: isViewOnly ? "View-only mode" : !currentBoardId ? "Select/create a board to get started" : "Add text anywhere",
      onClick: currentBoardId && !isViewOnly ? handleAddText : undefined,
      disabled: !currentBoardId || isViewOnly
    },
    { 
      id: 13, 
      icon: ListChecks, 
      label: "Checklist", 
      description: isViewOnly ? "View-only mode" : !currentBoardId ? "Select/create a board to get started" : "Track progress",
      onClick: currentBoardId && !isViewOnly ? () => setShowChecklistForm(true) : undefined,
      disabled: !currentBoardId || isViewOnly
    },
    { 
      id: 6, 
      icon: Kanban, 
      label: "Kanban", 
      description: isViewOnly ? "View-only mode" : !currentBoardId ? "Select/create a board to get started" : "Create kanban board",
      onClick: currentBoardId && !isViewOnly ? () => setShowKanbanForm(true) : undefined,
      disabled: !currentBoardId || isViewOnly
    },
    { 
      id: 15, 
      icon: Bell, 
      label: "Reminder", 
      description: isViewOnly ? "View-only mode" : !currentBoardId ? "Select/create a board to get started" : "Create a reminder",
      onClick: currentBoardId && !isViewOnly ? () => setShowReminderForm(true) : undefined,
      disabled: !currentBoardId || isViewOnly
    },
    { 
      id: 19, 
      icon: Link2, 
      label: "Media", 
      description: isViewOnly ? "View-only mode" : !currentBoardId ? "Select/create a board to get started" : "Add images & videos",
      onClick: currentBoardId && !isViewOnly ? openMediaModal : undefined,
      disabled: !currentBoardId || isViewOnly
    },
    { 
      id: 20, 
      icon: Table2, 
      label: "Table", 
      description: isViewOnly ? "View-only mode" : !currentBoardId ? "Select/create a board to get started" : "Add a table",
      onClick: currentBoardId && !isViewOnly ? handleAddTable : undefined,
      disabled: !currentBoardId || isViewOnly
    },
    { id: 'separator-2', isSeparator: true },
    
    // Drawing & Shape Tools
    ...(usingTldraw ? [
    // ── tldraw native tools ──
    {
      id: 'tl-select',
      icon: MousePointer2,
      label: "Select",
      description: "Select & move objects (V)",
      onClick: () => tldrawEditor?.setCurrentTool('select'),
      isActive: activeTldrawTool === 'select',
      customStyle: activeTldrawTool === 'select' ? 'text-blue-500 hover:text-blue-600' : undefined,
    },
    {
      id: 'tl-hand',
      icon: Hand,
      label: "Hand",
      description: "Pan canvas (H)",
      onClick: () => tldrawEditor?.setCurrentTool('hand'),
      isActive: activeTldrawTool === 'hand',
      customStyle: activeTldrawTool === 'hand' ? 'text-blue-500 hover:text-blue-600' : undefined,
    },
    {
      id: 'tl-draw',
      icon: Pencil,
      label: "Draw",
      description: "Freehand drawing (D)",
      onClick: () => tldrawEditor?.setCurrentTool('draw'),
      isActive: activeTldrawTool === 'draw',
      customStyle: activeTldrawTool === 'draw' ? 'text-blue-500 hover:text-blue-600' : undefined,
    },
    {
      id: 'tl-eraser',
      icon: Eraser,
      label: "Eraser",
      description: "Erase drawings (E)",
      onClick: () => tldrawEditor?.setCurrentTool('eraser'),
      isActive: activeTldrawTool === 'eraser',
      customStyle: activeTldrawTool === 'eraser' ? 'text-orange-500 hover:text-orange-600' : undefined,
    },
    {
      id: 'tl-arrow',
      icon: ArrowUpRight,
      label: "Arrow",
      description: "Draw arrows between items",
      onClick: () => tldrawEditor?.setCurrentTool('arrow'),
      isActive: activeTldrawTool === 'arrow',
      customStyle: activeTldrawTool === 'arrow' ? 'text-green-500 hover:text-green-600' : undefined,
    },
    {
      id: 'tl-highlight',
      icon: Highlighter,
      label: "Highlight",
      description: "Highlight areas",
      onClick: () => tldrawEditor?.setCurrentTool('highlight'),
      isActive: activeTldrawTool === 'highlight',
      customStyle: activeTldrawTool === 'highlight' ? 'text-yellow-500 hover:text-yellow-600' : undefined,
    },
    {
      id: 'tl-shapes',
      icon: Shapes,
      label: "Shapes",
      description: "Shapes & lines",
      onClick: () => setShowShapesMenu(!showShapesMenu),
      isActive: ['geo', 'line'].includes(activeTldrawTool),
      customStyle: ['geo', 'line'].includes(activeTldrawTool) ? 'text-purple-500 hover:text-purple-600' : undefined,
      isShapesButton: true,
    },
    
    ] : [
    // ── Custom canvas draw tools ──
    { 
      id: 2, 
      icon: Pencil, 
      label: "Draw", 
      description: isViewOnly ? "View-only mode" : !currentBoardId ? "Select/create a board to get started" : (isDrawing ? "Drawing mode active" : "Click to draw"),
      onClick: currentBoardId && !isViewOnly ? toggleDrawing : undefined,
      isActive: isDrawing,
      disabled: !currentBoardId || isViewOnly,
      customStyle: isDrawing ? 'text-blue-500 hover:text-blue-600' : undefined
    },
    { 
      id: 14, 
      icon: Eraser, 
      label: "Eraser", 
      description: isViewOnly ? "View-only mode" : !currentBoardId ? "Select/create a board to get started" : (isErasing ? "Erasing mode active" : "Click to erase drawings"),
      onClick: currentBoardId && !isViewOnly ? toggleEraser : undefined,
      isActive: isErasing,
      disabled: !currentBoardId || isViewOnly,
      customStyle: isErasing ? 'text-orange-500 hover:text-orange-600' : undefined
    },
    ]),
    { id: 'separator-3', isSeparator: true },
    
    // Collaboration & Management
    { 
      id: 8, 
      icon: MessageSquare, 
      label: "Comments", 
      description: !currentBoardId ? "Select/create a board to get started" : boardUnreadCount > 0 ? `${boardUnreadCount} new comment${boardUnreadCount !== 1 ? 's' : ''}` : 'No new comments',
      onClick: currentBoardId ? handleCommentClick : undefined,
      isActive: isCommenting,
      disabled: !currentBoardId,
      customStyle: isCommenting ? 'text-blue-500 hover:text-blue-600' : undefined,
      badge: boardUnreadCount > 0 ? boardUnreadCount : undefined,
    },
    { 
      id: 12, 
      icon: FolderTree, 
      label: "Organize", 
      description: "Manage board items",
      onClick: toggleOrganizePanel
    },
    {
      id: 'call',
      icon: isInCall ? PhoneOff : Phone,
      label: isInCall ? "Leave Call" : "Call",
      description: isInCall
        ? "Leave the current call"
        : isViewOnly
          ? "View-only mode"
          : !currentBoardId
            ? "Select/create a board to get started"
            : "Start or join a voice call",
      onClick: currentBoardId
        ? isInCall
          ? () => leaveCallAction()
          : () => startCallAction(currentBoardId)
        : undefined,
      isActive: isInCall,
      disabled: !currentBoardId || (!isInCall && isViewOnly),
      customStyle: isInCall ? 'text-green-500 hover:text-red-500' : undefined,
    },
    { id: 'separator-4', isSeparator: true },
    
    // View / Zoom
    { 
      id: 16, 
      icon: ZoomOut, 
      label: "Zoom Out", 
      description: `${Math.round(displayZoom * 100)}% — ${isMac ? '⌘' : 'Ctrl'} + scroll down`,
      onClick: handleZoomOut,
      disabled: displayZoom <= 0.25
    },
    { 
      id: 18,
      label: `${Math.round(displayZoom * 100)}%`,
      description: "Click to reset to 100%",
      onClick: handleZoomReset,
      customContent: true,
    },
    { 
      id: 17, 
      icon: ZoomIn, 
      label: "Zoom In", 
      description: `${Math.round(displayZoom * 100)}% — ${isMac ? '⌘' : 'Ctrl'} + scroll up`,
      onClick: handleZoomIn,
      disabled: displayZoom >= 2
    },
  ]

  // Close shapes menu on outside click
  useEffect(() => {
    if (!showShapesMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      if (shapesMenuRef.current && !shapesMenuRef.current.contains(e.target as Node)) {
        setShowShapesMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showShapesMenu])

  const shapeOptions = [
    { id: 'line', icon: Minus, label: 'Line', color: 'text-blue-500', onClick: () => { tldrawEditor?.setCurrentTool('line'); setShowShapesMenu(false) } },
    { id: 'rectangle', icon: Square, label: 'Rectangle', color: 'text-purple-500', onClick: () => { if (!tldrawEditor) return; tldrawEditor.setStyleForNextShapes(GeoShapeGeoStyle, 'rectangle'); tldrawEditor.setCurrentTool('geo'); setActiveGeoShape('rectangle'); setShowShapesMenu(false) } },
    { id: 'ellipse', icon: CircleIcon, label: 'Ellipse', color: 'text-purple-500', onClick: () => { if (!tldrawEditor) return; tldrawEditor.setStyleForNextShapes(GeoShapeGeoStyle, 'ellipse'); tldrawEditor.setCurrentTool('geo'); setActiveGeoShape('ellipse'); setShowShapesMenu(false) } },
    { id: 'triangle', icon: Triangle, label: 'Triangle', color: 'text-purple-500', onClick: () => { if (!tldrawEditor) return; tldrawEditor.setStyleForNextShapes(GeoShapeGeoStyle, 'triangle'); tldrawEditor.setCurrentTool('geo'); setActiveGeoShape('triangle'); setShowShapesMenu(false) } },
    { id: 'diamond', icon: Diamond, label: 'Diamond', color: 'text-purple-500', onClick: () => { if (!tldrawEditor) return; tldrawEditor.setStyleForNextShapes(GeoShapeGeoStyle, 'diamond'); tldrawEditor.setCurrentTool('geo'); setActiveGeoShape('diamond'); setShowShapesMenu(false) } },
  ]

  return (
    <>
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
        <div className={`
          flex items-end gap-3 px-6 py-3 rounded-2xl backdrop-blur-xl border shadow-lg
          ${isDark 
            ? 'bg-zinc-800/90 border-zinc-700/50' 
            : 'bg-white/90 border-zinc-200/50'}
          transition-colors duration-200
        `}>
          {dockItems.map((item) => (
            item.isSeparator ? (
              <div 
                key={item.id}
                className={`w-px h-6 ${isDark ? 'bg-zinc-700/50' : 'bg-zinc-300/50'} mx-1`}
              />
            ) : item.customContent ? (
              <button
                key={item.id}
                onClick={item.onClick}
                className={`
                  flex flex-col items-center transition-all duration-200 px-0.5
                  ${hoveredItem === item.id ? 'scale-110 -translate-y-1' : 'hover:scale-105'}
                  group relative cursor-pointer
                `}
                onPointerEnter={(e) => { if (e.pointerType !== 'touch') setHoveredItem(item.id) }}
                onPointerLeave={(e) => { if (e.pointerType !== 'touch') setHoveredItem(null) }}
                onTouchEnd={() => setHoveredItem(null)}
              >
                <span className={`text-[10px] font-semibold tabular-nums leading-5 ${
                  isDark ? 'text-zinc-400 group-hover:text-zinc-200' : 'text-zinc-500 group-hover:text-zinc-900'
                }`}>
                  {item.label}
                </span>
                <div className={`
                  absolute -top-12 whitespace-nowrap
                  bg-zinc-800 text-white px-2 py-1 rounded-md
                  text-xs transform -translate-x-1/2 left-1/2
                  transition-all duration-200 pointer-events-none
                  ${hoveredItem === item.id ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
                `}>
                  <div className="font-medium">{item.label}</div>
                  <div className="text-zinc-400 text-[10px]">{item.description}</div>
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 
                       border-4 border-transparent border-t-zinc-800"></div>
                </div>
              </button>
            ) : (
              <div key={item.id} className="relative" ref={(item as any).isShapesButton ? shapesMenuRef : undefined}>
                <button
                  onClick={item.onClick}
                  disabled={item.disabled}
                  className={`
                    flex flex-col items-center transition-all duration-200 px-1.5
                    ${hoveredItem === item.id ? 'scale-125 -translate-y-2' : 'hover:scale-110'}
                    group relative
                    ${item.isActive ? 'text-blue-500' : ''}
                    ${item.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                  onPointerEnter={(e) => { if (e.pointerType !== 'touch') setHoveredItem(item.id) }}
                  onPointerLeave={(e) => { if (e.pointerType !== 'touch') setHoveredItem(null) }}
                  onTouchEnd={() => setHoveredItem(null)}
                >
                  {item.icon && (
                    <item.icon 
                      className={`w-5 h-5 transition-colors
                        ${item.customStyle || // Use custom style if provided
                          (isDark 
                            ? 'text-zinc-400 group-hover:text-zinc-200' 
                            : 'text-zinc-600 group-hover:text-zinc-900')
                        }`}
                      strokeWidth={1.5}
                    />
                  )}
                  {/* Comment count badge */}
                  {(item as any).badge != null && (
                    <span className="absolute -top-1 -right-0.5 min-w-[16px] h-4 flex items-center justify-center px-1 rounded-full bg-blue-500 text-white text-[9px] font-bold leading-none shadow-sm">
                      {(item as any).badge > 99 ? '99+' : (item as any).badge}
                    </span>
                  )}
                  {!((item as any).isShapesButton && showShapesMenu) && (
                    <div className={`
                      absolute -top-12 whitespace-nowrap
                      bg-zinc-800 text-white px-2 py-1 rounded-md
                      text-xs transform -translate-x-1/2 left-1/2
                      transition-all duration-200 pointer-events-none
                      ${hoveredItem === item.id ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
                    `}>
                      <div className="font-medium">{item.label}</div>
                      <div className="text-zinc-400 text-[10px]">{item.description}</div>
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 
                           border-4 border-transparent border-t-zinc-800"></div>
                    </div>
                  )}
                </button>

                {/* Shapes popup menu */}
                {(item as any).isShapesButton && showShapesMenu && (
                  <div className={`
                    absolute bottom-full mb-3 left-1/2 -translate-x-1/2
                    rounded-xl shadow-xl border backdrop-blur-xl
                    py-2 px-1 min-w-[140px]
                    transition-all duration-200
                    ${isDark
                      ? 'bg-zinc-800/95 border-zinc-700/50'
                      : 'bg-white/95 border-zinc-200/50'}
                  `}>
                    {shapeOptions.map((opt) => {
                      const isActiveShape = (opt.id === 'line' && activeTldrawTool === 'line')
                        || (activeTldrawTool === 'geo' && activeGeoShape === opt.id)
                      return (
                        <button
                          key={opt.id}
                          onClick={opt.onClick}
                          className={`
                            flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm
                            transition-colors duration-150
                            ${isActiveShape
                              ? (isDark ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-900')
                              : (isDark ? 'text-zinc-300 hover:bg-zinc-700/60' : 'text-zinc-700 hover:bg-zinc-100')}
                          `}
                        >
                          <opt.icon className={`w-4 h-4 ${isActiveShape ? opt.color : ''}`} strokeWidth={1.5} />
                          <span>{opt.label}</span>
                        </button>
                      )
                    })}
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 
                         border-4 border-transparent border-t-zinc-800"></div>
                  </div>
                )}
              </div>
            )
          ))}
        </div>
      </div>
      
      {showNoteForm && (
        <StickyNoteForm
          onSubmit={handleAddNote}
          onClose={() => setShowNoteForm(false)}
        />
      )}
      
      {showChecklistForm && (() => {
        const c = getViewportCenter()
        return (
          <ChecklistForm
            onClose={() => setShowChecklistForm(false)}
            position={{ x: c.x - 200, y: c.y - 200 }}
          />
        )
      })()}

      {showKanbanForm && (() => {
        const c = getViewportCenter()
        return (
          <KanbanForm
            onClose={() => setShowKanbanForm(false)}
            position={{ x: c.x - 400, y: c.y - 200 }}
          />
        )
      })()}

      {showReminderForm && (() => {
        const c = getViewportCenter()
        return (
          <ReminderForm
            onClose={() => setShowReminderForm(false)}
            position={{ x: c.x - 140, y: c.y - 160 }}
          />
        )
      })()}

      <AnimatePresence>
        {isCommenting && (
          <Comments
            onClose={() => setCommenting(false)}
          />
        )}
      </AnimatePresence>

      {showNoBoardModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div className="relative max-w-md w-full mx-4 p-8 rounded-2xl">
            <div className="text-center">
              <div className={`
                w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center
                ${isDark ? 'bg-blue-400/20' : 'bg-blue-100'}
              `}>
                <Layout className={`w-8 h-8 ${isDark ? 'text-blue-400' : 'text-blue-500'}`} />
              </div>

              <h3 className={`
                text-2xl font-semibold mb-2
                ${isDark ? 'text-white' : 'text-zinc-900'}
              `}>
                BORDS!
              </h3>

              <p className={`
                mb-6
                ${isDark ? 'text-zinc-400' : 'text-zinc-600'}
              `}>
                Create or select a board to get started. Boards help you organize your work and ideas.
              </p>

              <button
                onClick={toggleBoardsPanel}
                className={`
                  w-full py-3 px-6 rounded-lg font-medium transition-colors
                  ${isDark 
                    ? 'bg-blue-400/20 hover:bg-blue-400/30 text-blue-400' 
                    : 'bg-blue-500 hover:bg-blue-600 text-white'}
                `}
              >
                Create Board
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-4 right-4 z-50">
        {/* <div className="flex items-center gap-2">
          {connections.length > 0 && (
            <button
              onClick={toggleVisibility}
              className={`
                p-3 rounded-xl shadow-lg border transition-colors
                ${isVisible 
                  ? 'bg-blue-500 text-white hover:bg-blue-600' 
                  : 'bg-white text-gray-500 hover:bg-gray-50'
                }
              `}
            >
              <Network size={20} />
            </button>
          )}
          
        </div> */}
      </div>

    </>
  )
}
