'use client'
import { motion } from 'framer-motion'
import { useBoardStore, type Board } from '../store/boardStore'
import { useThemeStore } from '../store/themeStore'
import { useNoteStore } from '../store/stickyNoteStore'
import { useChecklistStore } from '../store/checklistStore'
import { useTextStore } from '../store/textStore'
import { useKanbanStore } from '../store/kanbanStore'
import { useMediaStore } from '../store/mediaStore'
import { useDrawingStore } from '../store/drawingStore'
import { useConnectionStore } from '../store/connectionStore'
import { Trash2, Edit2, Plus, Layout, X, Share2, Download, Users } from 'lucide-react'
import { useState, useRef, useEffect, useMemo } from 'react'
import { format } from 'date-fns'
import { useSession } from 'next-auth/react'
import { ShareModal } from './BoardSyncControls'
import { useBoardSyncStore } from '../store/boardSyncStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useZIndexStore } from '../store/zIndexStore'
import { useDelegationStore } from '../store/delegationStore'
import type { BordDTO } from '../types/delegation'


interface BoardsPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function BoardsPanel({ isOpen, onClose }: BoardsPanelProps) {
  const { data: session } = useSession()
  const isDark = useThemeStore((state) => state.isDark)
  const { currentBoardId, addBoard, deleteBoard, setCurrentBoard, updateBoard } = useBoardStore()
  const currentUserId = useBoardStore((state) => state.currentUserId)
  const allBoards = useBoardStore((state) => state.boards)
  const activeContext = useWorkspaceStore((s) => s.activeContext)
  const bords = useDelegationStore((s) => s.bords)
  const fetchBords = useDelegationStore((s) => s.fetchBords)
  const deleteBord = useDelegationStore((s) => s.deleteBord)
  const boardPermissions = useBoardSyncStore((s) => s.boardPermissions)
  const boardSharedBy = useBoardSyncStore((s) => s.boardSharedBy)
  const isOrgContext = activeContext?.type === 'organization'

  // Filter boards by active workspace context
  const userBoards = useMemo(() => {
    const owned = allBoards.filter(b => b.userId === currentUserId)
    if (!activeContext) return owned
    if (activeContext.type === 'organization') {
      return owned.filter(b => b.contextType === 'organization' && b.organizationId === activeContext.organizationId)
    }
    // Personal context: show only boards we OWN (not shared-with-us)
    return owned.filter(b => {
      const isPersonal = !b.contextType || b.contextType === 'personal'
      const isOwner = !boardPermissions[b.id] || boardPermissions[b.id] === 'owner'
      return isPersonal && isOwner
    })
  }, [allBoards, currentUserId, activeContext, boardPermissions])

  // Shared personal boards (boards other people shared with us via sharedWith)
  const sharedPersonalBoards = useMemo(() => {
    if (isOrgContext) return []
    return allBoards.filter(b => {
      const isPersonal = !b.contextType || b.contextType === 'personal'
      const perm = boardPermissions[b.id]
      return isPersonal && perm && perm !== 'owner'
    })
  }, [allBoards, boardPermissions, isOrgContext])

  // Accessible bords from other owners in this org (via accessList)
  const accessibleBords = useMemo(() => {
    if (!isOrgContext || !activeContext || activeContext.type !== 'organization') return []
    return bords.filter(b =>
      b.organizationId === activeContext.organizationId &&
      b.role === 'member'
    )
  }, [bords, isOrgContext, activeContext])

  // Personal bords from DB that the user owns but aren't yet in localStorage
  const remotePersonalBords = useMemo(() => {
    if (isOrgContext) return []
    const localIds = new Set(allBoards.map(b => b.id))
    return bords.filter(b =>
      b.contextType === 'personal' &&
      b.role === 'owner' &&
      !localIds.has(b.localBoardId)
    )
  }, [bords, allBoards, isOrgContext])

  // Org bords from DB that the user owns but aren't yet in localStorage
  const remoteOrgBords = useMemo(() => {
    if (!isOrgContext || !activeContext || activeContext.type !== 'organization') return []
    const localIds = new Set(allBoards.map(b => b.id))
    return bords.filter(b =>
      b.contextType === 'organization' &&
      b.organizationId === activeContext.organizationId &&
      b.role === 'owner' &&
      !localIds.has(b.localBoardId)
    )
  }, [bords, allBoards, isOrgContext, activeContext])

  // Personal bords shared with the user (from DB — not owner)
  const sharedBordsFromDB = useMemo(() => {
    if (isOrgContext) return []
    return bords.filter(b =>
      b.contextType === 'personal' &&
      b.role !== 'owner'
    )
  }, [bords, isOrgContext])
  
  // Get delete functions from all stores
  const { deleteNote } = useNoteStore()
  const { deleteChecklist } = useChecklistStore()
  const { deleteText } = useTextStore()
  const { removeBoard: deleteKanban } = useKanbanStore()
  const { deleteMedia } = useMediaStore()
  const { deleteDrawing } = useDrawingStore()
  const { clearBoardConnections } = useConnectionStore()
  
  const [newBoardName, setNewBoardName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [boardToDelete, setBoardToDelete] = useState<string | null>(null)
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null)
  const [editingBoardName, setEditingBoardName] = useState('')
  const [sharingBoardId, setSharingBoardId] = useState<string | null>(null)
  const [cloudBordToDelete, setCloudBordToDelete] = useState<{ _id: string; title: string } | null>(null)
  const [loadingBordId, setLoadingBordId] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose])

  // Fetch bords when panel opens (any context)
  useEffect(() => {
    if (isOpen) fetchBords()
  }, [isOpen, fetchBords])

  // Listen for board deletion to cleanup associated items
  useEffect(() => {
    const handleBoardDeleted = (event: CustomEvent) => {
      const { boardId, noteIds, checklistIds, textIds, kanbanIds, mediaIds, drawingIds } = event.detail
      
      // Delete all connections for this board
      clearBoardConnections(boardId)
      
      // Delete all notes
      noteIds.forEach((id: string) => deleteNote(id))
      
      // Delete all checklists
      checklistIds.forEach((id: string) => deleteChecklist(id))
      
      // Delete all texts
      textIds.forEach((id: string) => deleteText(id))
      
      // Delete all kanban boards
      kanbanIds.forEach((id: string) => deleteKanban(id))
      
      // Delete all media
      mediaIds.forEach((id: string) => deleteMedia(id))
      
      // Delete all drawings
      drawingIds.forEach((id: string) => deleteDrawing(id))

      // Clean up zIndex entries for deleted items
      const allDeletedIds = [...noteIds, ...checklistIds, ...textIds, ...kanbanIds, ...mediaIds, ...drawingIds]
      allDeletedIds.forEach((id: string) => useZIndexStore.getState().removeItem(id))
    }
    
    window.addEventListener('boardDeleted', handleBoardDeleted as EventListener)
    return () => window.removeEventListener('boardDeleted', handleBoardDeleted as EventListener)
  }, [deleteNote, deleteChecklist, deleteText, deleteKanban, deleteMedia, deleteDrawing, clearBoardConnections])

  const handleCreateBoard = () => {
    if (!newBoardName.trim() || !session?.user?.email) return
    
    // Tag the board with the active workspace context
    const ctx = useWorkspaceStore.getState().activeContext
    const context = ctx?.type === 'organization'
      ? { contextType: 'organization' as const, organizationId: ctx.organizationId }
      : { contextType: 'personal' as const }

    addBoard(newBoardName, session.user.email, context)
    setNewBoardName('')
    setIsCreating(false)
  }

  const handleBoardSelect = (boardId: string) => {
    setCurrentBoard(boardId)
    onClose()
  }

  const handleAccessibleBordSelect = async (bord: BordDTO) => {
    // Check if already loaded locally
    const existingBoard = allBoards.find(b => b.id === bord.localBoardId)
    if (existingBoard) {
      setCurrentBoard(bord.localBoardId)
      onClose()
      return
    }

    // Board not loaded locally yet — create a local shell and switch to it;
    // Y.Doc sync via WebSocket will pull the real content.
    setLoadingBordId(bord._id)
    try {
      const ctx = bord.contextType === 'organization'
        ? { contextType: 'organization' as const, organizationId: bord.organizationId }
        : { contextType: 'personal' as const }

      // Create a local shell board entry
      const shellBoard: Board = {
        id: bord.localBoardId,
        userId: currentUserId || '',
        name: bord.title,
        createdAt: new Date(bord.createdAt),
        lastModified: new Date(),
        notes: [],
        checklists: [],
        texts: [],
        connections: [],
        drawings: [],
        kanbans: [],
        medias: [],
        reminders: [],
        tables: [],
        contextType: ctx.contextType,
        ...(ctx.contextType === 'organization' && { organizationId: ctx.organizationId }),
      }
      // Insert into boardStore directly
      useBoardStore.setState((state) => ({
        boards: [...state.boards, shellBoard],
      }))
      setCurrentBoard(bord.localBoardId)
      onClose()
    } finally {
      setLoadingBordId(null)
    }
  }

  return (
    <motion.div
      ref={panelRef}
      initial={{ x: -300, opacity: 0 }}
      animate={{ x: isOpen ? 0 : -300, opacity: isOpen ? 1 : 0 }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className={`
        fixed left-0 top-0 bottom-0 w-80 z-50 flex flex-col
        ${isDark ? 'bg-zinc-800/90' : 'bg-white/90'}
        backdrop-blur-xl border-r
        ${isDark ? 'border-zinc-700/50' : 'border-zinc-200/50'}
      `}
    >
      {/* Fixed Header & Create */}
      <div className="p-4 pb-2">
        <div className="flex justify-between items-center mb-4">
          <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-800'}`}>
            {activeContext?.type === 'organization' ? activeContext.organizationName : 'My'} Boards
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={onClose}
              className={`p-2 rounded-lg hover:bg-gray-100 ${isDark ? 'hover:bg-zinc-700' : ''}`}
            >
              <X size={20} className={isDark ? 'text-white' : 'text-gray-600'} />
            </button>
          </div>
        </div>

        {/* Create New Board */}
        {isCreating ? (
          <div className="mb-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                placeholder="Board name"
                className="flex-1 p-2 rounded-lg border focus:ring-2 focus:ring-blue-500 bg-white text-gray-900 placeholder:text-gray-500"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateBoard()
                  if (e.key === 'Escape') {
                    setIsCreating(false)
                    setNewBoardName('')
                  }
                }}
              />
              <button
                onClick={handleCreateBoard}
                disabled={!newBoardName.trim()}
                className={`px-3 py-2 rounded-lg font-medium text-sm transition-colors ${
                  newBoardName.trim()
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                Create
              </button>
            </div>
            <button
              onClick={() => { setIsCreating(false); setNewBoardName('') }}
              className={`mt-2 w-full p-1.5 text-xs rounded-lg transition-colors ${
                isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            className={`
              w-full p-3 rounded-lg mb-2 flex items-center gap-2
              ${isDark 
                ? 'bg-zinc-700/50 hover:bg-zinc-700 text-white' 
                : 'bg-gray-50 hover:bg-gray-100 text-gray-700'}
            `}
          >
            <Plus size={16} />
            <span>New Board</span>
          </button>
        )}
      </div>

      {/* Scrollable Boards List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="space-y-2">
          {userBoards.length === 0 && accessibleBords.length === 0 && sharedPersonalBoards.length === 0 && remotePersonalBords.length === 0 && remoteOrgBords.length === 0 && sharedBordsFromDB.length === 0 && (
            <div className={`text-center py-8 ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>
              <Layout size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No boards yet</p>
              <p className="text-xs mt-1">
                {isOrgContext ? 'Create a board or ask the owner for access' : 'Create your first board to get started'}
              </p>
            </div>
          )}
          {userBoards.map((board) => (
            <div
              key={board.id}
              className={`
                p-3 rounded-lg flex items-center justify-between group
                ${board.id === currentBoardId 
                  ? isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-50 text-blue-600'
                  : isDark ? 'hover:bg-zinc-700/50' : 'hover:bg-gray-50'
                }
                ${isDark ? 'text-white' : 'text-gray-700'}
                cursor-pointer
              `}
              onClick={() => handleBoardSelect(board.id)}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Layout size={16} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  {editingBoardId === board.id ? (
                    <input
                      type="text"
                      value={editingBoardName}
                      onChange={(e) => setEditingBoardName(e.target.value)}
                      className="w-full px-2 py-0.5 rounded border text-sm font-medium bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter' && editingBoardName.trim()) {
                          updateBoard(board.id, { name: editingBoardName.trim() })
                          setEditingBoardId(null)
                        }
                        if (e.key === 'Escape') setEditingBoardId(null)
                      }}
                      onBlur={() => {
                        if (editingBoardName.trim()) {
                          updateBoard(board.id, { name: editingBoardName.trim() })
                        }
                        setEditingBoardId(null)
                      }}
                    />
                  ) : (
                    <div className="font-medium truncate">{board.name}</div>
                  )}
                  <div className="text-xs opacity-60">
                    {format(new Date(board.lastModified), 'MMM d, yyyy')}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setSharingBoardId(board.id)
                  }}
                  className={`p-1.5 rounded-lg transition-colors ${
                    isDark ? 'hover:bg-zinc-600 text-zinc-400' : 'hover:bg-gray-200 text-gray-500'
                  }`}
                  title="Share board"
                >
                  <Share2 size={14} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingBoardId(board.id)
                    setEditingBoardName(board.name)
                  }}
                  className={`p-1.5 rounded-lg transition-colors ${
                    isDark ? 'hover:bg-zinc-600' : 'hover:bg-gray-200'
                  }`}
                  title="Rename board"
                >
                  <Edit2 size={14} className={isDark ? 'text-zinc-400' : 'text-gray-500'} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setBoardToDelete(board.id)
                  }}
                  className="p-1.5 rounded-lg hover:bg-red-100/10"
                  title="Delete board"
                >
                  <Trash2 size={14} className="text-red-500" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Shared personal boards (boards shared with you by friends) */}
        {!isOrgContext && sharedPersonalBoards.length > 0 && (
          <div className="mt-4">
            <div className={`flex items-center gap-2 mb-2 px-1 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
              <Users size={14} />
              <span className="text-xs font-medium uppercase tracking-wide">Shared with you</span>
            </div>
            <div className="space-y-2">
              {sharedPersonalBoards.map((board) => {
                const isActive = currentBoardId === board.id
                const perm = boardPermissions[board.id]
                const sharedBy = boardSharedBy[board.id]

                return (
                  <div
                    key={board.id}
                    className={`
                      p-3 rounded-lg flex items-center justify-between group
                      ${isActive
                        ? isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-50 text-blue-600'
                        : isDark ? 'hover:bg-zinc-700/50' : 'hover:bg-gray-50'
                      }
                      ${isDark ? 'text-white' : 'text-gray-700'}
                      cursor-pointer
                    `}
                    onClick={() => handleBoardSelect(board.id)}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Layout size={16} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{board.name}</span>
                          <span className={`shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${
                            isDark ? 'bg-violet-500/20 text-violet-400' : 'bg-violet-100 text-violet-600'
                          }`}>
                            {perm === 'edit' ? 'Editor' : 'Viewer'}
                          </span>
                        </div>
                        <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>
                          {sharedBy
                            ? `Shared by ${sharedBy.name}`
                            : format(new Date(board.lastModified), 'MMM d, yyyy')
                          }
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Remote personal bords (owned by user but not in localStorage yet) */}
        {!isOrgContext && remotePersonalBords.length > 0 && (
          <div className="mt-4">
            <div className={`flex items-center gap-2 mb-2 px-1 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
              <Download size={14} />
              <span className="text-xs font-medium uppercase tracking-wide">Cloud boards</span>
            </div>
            <div className="space-y-2">
              {remotePersonalBords.map((bord) => {
                const isLoading = loadingBordId === bord._id

                return (
                  <div
                    key={bord._id}
                    className={`
                      p-3 rounded-lg flex items-center justify-between group
                      ${isDark ? 'hover:bg-zinc-700/50' : 'hover:bg-gray-50'}
                      ${isDark ? 'text-white' : 'text-gray-700'}
                      cursor-pointer
                    `}
                    onClick={() => !isLoading && handleAccessibleBordSelect(bord)}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Layout size={16} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{bord.title}</div>
                        <div className="text-xs opacity-60">Available to pull</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5">
                      {isLoading ? (
                        <div className={`p-1.5 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                          <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleAccessibleBordSelect(bord)
                            }}
                            className={`p-1.5 rounded-lg transition-colors ${
                              isDark ? 'hover:bg-zinc-600 text-zinc-400' : 'hover:bg-gray-200 text-gray-500'
                            }`}
                            title="Pull board from cloud"
                          >
                            <Download size={14} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setCloudBordToDelete({ _id: bord._id, title: bord.title })
                            }}
                            className="p-1.5 rounded-lg hover:bg-red-100/10"
                            title="Delete from cloud"
                          >
                            <Trash2 size={14} className="text-red-500" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Shared bords from DB (personal bords others shared with the user) */}
        {!isOrgContext && sharedBordsFromDB.length > 0 && (
          <div className="mt-4">
            <div className={`flex items-center gap-2 mb-2 px-1 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
              <Share2 size={14} />
              <span className="text-xs font-medium uppercase tracking-wide">Shared with you</span>
            </div>
            <div className="space-y-2">
              {sharedBordsFromDB.map((bord) => {
                const isLoadedLocally = allBoards.some(b => b.id === bord.localBoardId)
                const isActive = currentBoardId === bord.localBoardId
                const isLoading = loadingBordId === bord._id

                return (
                  <div
                    key={bord._id}
                    className={`
                      p-3 rounded-lg flex items-center justify-between group
                      ${isActive
                        ? isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-50 text-blue-600'
                        : isDark ? 'hover:bg-zinc-700/50' : 'hover:bg-gray-50'
                      }
                      ${isDark ? 'text-white' : 'text-gray-700'}
                      cursor-pointer
                    `}
                    onClick={() => !isLoading && handleAccessibleBordSelect(bord)}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Layout size={16} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{bord.title}</span>
                          <span className={`shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${
                            isDark ? 'bg-violet-500/20 text-violet-400' : 'bg-violet-100 text-violet-600'
                          }`}>
                            {bord.role === 'collaborator' ? 'Collaborator' : 'Member'}
                          </span>
                        </div>
                        <div className="text-xs opacity-60">
                          {isLoadedLocally ? 'Synced' : 'Available to pull'}
                        </div>
                      </div>
                    </div>
                    {!isLoadedLocally && (
                      <div className="flex items-center">
                        {isLoading ? (
                          <div className={`p-1.5 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                            <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          </div>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleAccessibleBordSelect(bord)
                            }}
                            className={`p-1.5 rounded-lg transition-colors ${
                              isDark ? 'hover:bg-zinc-600 text-zinc-400' : 'hover:bg-gray-200 text-gray-500'
                            }`}
                            title="Pull board from cloud"
                          >
                            <Download size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Remote org bords (owned by user but not in localStorage yet) */}
        {isOrgContext && remoteOrgBords.length > 0 && (
          <div className="mt-4">
            <div className={`flex items-center gap-2 mb-2 px-1 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
              <Download size={14} />
              <span className="text-xs font-medium uppercase tracking-wide">Cloud boards</span>
            </div>
            <div className="space-y-2">
              {remoteOrgBords.map((bord) => {
                const isLoading = loadingBordId === bord._id

                return (
                  <div
                    key={bord._id}
                    className={`
                      p-3 rounded-lg flex items-center justify-between group
                      ${isDark ? 'hover:bg-zinc-700/50' : 'hover:bg-gray-50'}
                      ${isDark ? 'text-white' : 'text-gray-700'}
                      cursor-pointer
                    `}
                    onClick={() => !isLoading && handleAccessibleBordSelect(bord)}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Layout size={16} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{bord.title}</div>
                        <div className="text-xs opacity-60">Available to pull</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5">
                      {isLoading ? (
                        <div className={`p-1.5 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                          <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleAccessibleBordSelect(bord)
                            }}
                            className={`p-1.5 rounded-lg transition-colors ${
                              isDark ? 'hover:bg-zinc-600 text-zinc-400' : 'hover:bg-gray-200 text-gray-500'
                            }`}
                            title="Pull board from cloud"
                          >
                            <Download size={14} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setCloudBordToDelete({ _id: bord._id, title: bord.title })
                            }}
                            className="p-1.5 rounded-lg hover:bg-red-100/10"
                            title="Delete from cloud"
                          >
                            <Trash2 size={14} className="text-red-500" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Accessible Bords (via accessList — org members only) */}
        {isOrgContext && accessibleBords.length > 0 && (
          <div className="mt-4">
            <div className={`flex items-center gap-2 mb-2 px-1 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
              <Users size={14} />
              <span className="text-xs font-medium uppercase tracking-wide">Shared with you</span>
            </div>
            <div className="space-y-2">
              {accessibleBords.map((bord) => {
                const isLoadedLocally = allBoards.some(b => b.id === bord.localBoardId)
                const isActive = currentBoardId === bord.localBoardId
                const isLoading = loadingBordId === bord._id

                return (
                  <div
                    key={bord._id}
                    className={`
                      p-3 rounded-lg flex items-center justify-between group
                      ${isActive
                        ? isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-50 text-blue-600'
                        : isDark ? 'hover:bg-zinc-700/50' : 'hover:bg-gray-50'
                      }
                      ${isDark ? 'text-white' : 'text-gray-700'}
                      cursor-pointer
                    `}
                    onClick={() => !isLoading && handleAccessibleBordSelect(bord)}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Layout size={16} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{bord.title}</div>
                        <div className="text-xs opacity-60">
                          {isLoadedLocally ? 'Synced' : 'Available to pull'}
                        </div>
                      </div>
                    </div>
                    {!isLoadedLocally && (
                      <div className="flex items-center">
                        {isLoading ? (
                          <div className={`p-1.5 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                            <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          </div>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleAccessibleBordSelect(bord)
                            }}
                            className={`p-1.5 rounded-lg transition-colors ${
                              isDark ? 'hover:bg-zinc-600 text-zinc-400' : 'hover:bg-gray-200 text-gray-500'
                            }`}
                            title="Pull board from cloud"
                          >
                            <Download size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {boardToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={() => setBoardToDelete(null)}>
          <div 
            className={`p-6 rounded-2xl shadow-2xl max-w-md w-full mx-4 ${
              isDark ? 'bg-zinc-800 border border-zinc-700' : 'bg-white'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-4 mb-4">
              <div className="p-3 rounded-full bg-red-100">
                <Trash2 size={24} className="text-red-600" />
              </div>
              <div className="flex-1">
                <h3 className={`text-lg font-semibold mb-2 ${
                  isDark ? 'text-white' : 'text-gray-900'
                }`}>
                  Delete Board?
                </h3>
                <p className={`text-sm ${
                  isDark ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  This will permanently delete the board <span className="font-semibold">"{userBoards.find(b => b.id === boardToDelete)?.name}"</span> and all its items (notes, checklists, kanban boards, text elements, media, and connections). This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setBoardToDelete(null)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  isDark 
                    ? 'bg-zinc-700 hover:bg-zinc-600 text-white'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const id = boardToDelete
                  setBoardToDelete(null)
                  await useBoardSyncStore.getState().deleteBoardFromCloud(id)
                  deleteBoard(id)
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
              >
                Delete Board
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Share Modal */}
      {sharingBoardId && (
        <ShareModal
          localBoardId={sharingBoardId}
          boardName={userBoards.find(b => b.id === sharingBoardId)?.name || 'Board'}
          onClose={() => setSharingBoardId(null)}
        />
      )}

      {/* Cloud Bord Delete Confirmation Modal */}
      {cloudBordToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={() => setCloudBordToDelete(null)}>
          <div 
            className={`p-6 rounded-2xl shadow-2xl max-w-md w-full mx-4 ${
              isDark ? 'bg-zinc-800 border border-zinc-700' : 'bg-white'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-4 mb-4">
              <div className="p-3 rounded-full bg-red-100">
                <Trash2 size={24} className="text-red-600" />
              </div>
              <div className="flex-1">
                <h3 className={`text-lg font-semibold mb-2 ${
                  isDark ? 'text-white' : 'text-gray-900'
                }`}>
                  Delete Cloud Board?
                </h3>
                <p className={`text-sm ${
                  isDark ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  This will permanently delete <span className="font-semibold">"{cloudBordToDelete.title}"</span> from the cloud. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setCloudBordToDelete(null)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  isDark 
                    ? 'bg-zinc-700 hover:bg-zinc-600 text-white'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const id = cloudBordToDelete._id
                  setCloudBordToDelete(null)
                  await deleteBord(id)
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}
