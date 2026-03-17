'use client'
import { useState, useEffect, useRef } from 'react'
import { Moon, Sun, Share2, User, ChevronRight, Layout, LogOut, Minimize2, Maximize2, Building2, Trash2, Users, UserPlus, LayoutDashboard } from 'lucide-react'
import { useSession, useAuth } from '@/components/AuthProvider'
import { useRouter } from 'next/navigation'
import { useThemeStore, THEME_COLORS } from '../store/themeStore'
import { useGridStore } from '../store/gridStore'
import { create } from 'zustand'
import { BoardsPanel } from './BoardsPanel'
import { useBoardStore } from '../store/boardStore'
import { usePresentationStore } from '../store/presentationStore'
import { PublishButton } from './delegation/PublishButton'
import { ActivitySidebar } from './delegation/ActivitySidebar'
import { useBoardSyncStore } from '../store/boardSyncStore'
import { ShareModal } from './BoardSyncControls'
import { WorkspaceSwitcher } from './workspace/WorkspaceSwitcher'
import { useWorkspaceStore } from '../store/workspaceStore'
import { CreateOrgModal } from './workspace/CreateOrgModal'
import { TeamPanel } from './workspace/TeamPanel'
import { FriendsPanel } from './workspace/FriendsPanel'
import { BordAccessModal } from './workspace/BordAccessModal'
import { useDelegationStore } from '../store/delegationStore'
import { useOrganizationStore } from '../store/organizationStore'
import { ActiveCollaborators } from './ActiveCollaborators'
import { ServerStatusIndicator } from './ServerStatusIndicator'
import { CallButton } from './call/CallButton'

/** Small badge showing pending tasks assigned TO the current user (employee inbox) */
function InboxBadge() {
  const [pendingCount, setPendingCount] = useState(0)
  const { data: session } = useSession()

  useEffect(() => {
    if (!session?.user) return
    let cancelled = false

    const fetchCount = async () => {
      try {
        const res = await fetch('/api/execution/tasks')
        if (!res.ok || cancelled) return
        const data = await res.json()
        const groups = data.tasksByOrganization || []
        const orgCount = groups.reduce(
          (sum: number, g: any) => sum + g.tasks.filter((t: any) => t.status === 'assigned').length,
          0
        )
        const personalCount = (data.personalTasks || []).filter((t: any) => t.status === 'assigned').length
        if (!cancelled) setPendingCount(orgCount + personalCount)
      } catch { /* silent */ }
    }

    fetchCount()
    // Re-check every 60s
    const interval = setInterval(fetchCount, 60_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [session?.user])

  if (pendingCount === 0) return null
  return (
    <span className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold bg-blue-500 text-white ring-2 ring-white dark:ring-zinc-800">
      {pendingCount > 9 ? '9+' : pendingCount}
    </span>
  )
}

const profileItems: any[] = []

const GRID_COLORS = {
  gray: '#333333',
  blue: '#1e3a8a',
  green: '#064e3b',
  purple: '#4c1d95',
  pink: '#831843',
  orange: '#7c2d12',
} as const

export function TopBar() {
  const { data: session } = useSession()
  const { signOut } = useAuth()
  const router = useRouter()
  const { isDark, toggleDark, colorTheme, setColorTheme } = useThemeStore()
  const [hoveredProfile, setHoveredProfile] = useState<string | null>(null)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showCreateOrg, setShowCreateOrg] = useState(false)
  const [showTeamPanel, setShowTeamPanel] = useState(false)
  const [showFriendsPanel, setShowFriendsPanel] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showBoardsTooltip, setShowBoardsTooltip] = useState(false)
  const [showPresentationTooltip, setShowPresentationTooltip] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showAccessModal, setShowAccessModal] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const currentBoard = useBoardStore((state) => 
    state.boards.find(board => board.id === state.currentBoardId)
  )
  const { isBoardsPanelOpen, toggleBoardsPanel, clearUserData, deleteBoard } = useBoardStore()
  const { isPresentationMode, togglePresentationMode } = usePresentationStore()
  const { deleteBoardFromCloud } = useBoardSyncStore()
  const currentBoardId = useBoardStore(s => s.currentBoardId)
  const boardPermission = useBoardSyncStore(s => s.boardPermissions[currentBoardId || ''] || 'owner')
  const isViewOnly = boardPermission === 'view'
  const activeContext = useWorkspaceStore(s => s.activeContext)
  const isOrgContext = activeContext?.type === 'organization'

  // Bord access list — resolve current board's server-side Bord record
  const bords = useDelegationStore(s => s.bords)
  const fetchBords = useDelegationStore(s => s.fetchBords)
  const linkBoardToOrg = useDelegationStore(s => s.linkBoardToOrg)
  const currentBord = isOrgContext && currentBoardId
    ? bords.find(b => b.localBoardId === currentBoardId)
    : null
  const isOwnerOfCurrentOrg = useOrganizationStore(s => s.isOwnerOfCurrentOrg)
  const [isLinkingBord, setIsLinkingBord] = useState(false)

  // Fetch bords when switching to org context (needed for access list resolution)
  useEffect(() => {
    if (isOrgContext) fetchBords()
  }, [isOrgContext, fetchBords])

  // Handle access list button — auto-create Bord record if it doesn't exist
  const handleAccessClick = async () => {
    if (currentBord) {
      setShowAccessModal(true)
      return
    }
    // No Bord record yet — create one on the fly
    if (!currentBoardId || !currentBoard || !activeContext || activeContext.type !== 'organization') return
    setIsLinkingBord(true)
    try {
      const bord = await linkBoardToOrg(activeContext.organizationId, currentBoardId, currentBoard.name)
      if (bord) {
        setShowAccessModal(true)
      }
    } finally {
      setIsLinkingBord(false)
    }
  }

  const handleLogout = async () => {
    clearUserData() // Clear user-specific data before signing out
    await signOut()
    router.push('/login')
  }

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false)
      }
    }

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showUserMenu])

  return (
    <>
      {/* Left side controls */}
      <div className="fixed top-4 left-4 z-50 flex items-center gap-2">
        <div className={`flex items-center gap-3 px-4 py-2 rounded-xl border shadow-lg
          ${isDark 
            ? 'bg-zinc-800/90 border-zinc-700/50' 
            : 'bg-white/90 border-zinc-200/50'} 
          backdrop-blur-xl transition-colors duration-200`}
        >
          {/* BORDS Logo - Clickable */}
          {!isPresentationMode ? (
            <button 
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              onClick={() => useBoardStore.getState().setBoardsPanelOpen(true)}
            >
              <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center p-1.5">
                <img src="/bordclear.png" alt="BORDS" className="w-full h-full object-contain" />
              </div>
              <span className={`text-lg font-bold brand-font tracking-tighter ${isDark ? 'text-white' : 'text-black'}`}>
                BORDS
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center p-1.5">
                <img src="/bordclear.png" alt="BORDS" className="w-full h-full object-contain" />
              </div>
              <span className={`text-lg font-bold brand-font tracking-tighter ${isDark ? 'text-white' : 'text-black'}`}>
                BORDS
              </span>
            </div>
          )}

          {!isPresentationMode && (
            <>
              <div className={`w-px h-5 ${isDark ? 'bg-zinc-700/75' : 'bg-zinc-200/75'} mx-1`} />

              {/* User Menu */}
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors
                    ${isDark 
                      ? 'hover:bg-zinc-700/50' 
                      : 'hover:bg-zinc-100'}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold
                    ${isDark 
                      ? 'bg-black text-white' 
                      : 'bg-white text-black'}`}>
                    {session?.user?.name?.charAt(0).toUpperCase() || session?.user?.email?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <div className="flex flex-col items-start">
                    <span className={`text-sm font-medium leading-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {session?.user?.name || 'User'}
                    </span>
                    <span className={`text-xs leading-tight ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                      {session?.user?.email}
                    </span>
                  </div>
                  <ChevronRight className={`w-4 h-4 transition-transform ${showUserMenu ? 'rotate-90' : ''} ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`} />
                </button>

                {showUserMenu && (
                  <div
                    className={`absolute top-full left-0 mt-2 w-64 rounded-xl border shadow-xl overflow-hidden z-50
                      ${isDark 
                        ? 'bg-zinc-800 border-zinc-700' 
                        : 'bg-white border-zinc-200'}`}
                  >
                    <div className={`px-4 py-3 border-b ${isDark ? 'border-zinc-700' : 'border-zinc-200'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-semibold
                          ${isDark 
                            ? 'bg-black text-white' 
                            : 'bg-white text-black'}`}>
                          {session?.user?.name?.charAt(0).toUpperCase() || session?.user?.email?.charAt(0).toUpperCase() || 'U'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                            {session?.user?.name || 'User'}
                          </p>
                          <p className={`text-xs truncate ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                            {session?.user?.email}
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="py-1">
                      <button
                        onClick={() => {
                          toggleDark()
                          setShowUserMenu(false)
                        }}
                        className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-3 transition-colors
                          ${isDark 
                            ? 'text-zinc-300 hover:bg-zinc-700/50' 
                            : 'text-gray-700 hover:bg-zinc-100'}`}
                      >
                        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                        <span className="font-medium">{isDark ? 'Light Mode' : 'Dark Mode'}</span>
                      </button>
                      <button
                        onClick={handleLogout}
                        className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-3 transition-colors
                          ${isDark 
                            ? 'text-zinc-300 hover:bg-zinc-700/50' 
                            : 'text-gray-700 hover:bg-zinc-100'}`}
                      >
                        <LogOut className="w-4 h-4" />
                        <span className="font-medium">Sign Out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Workspace Context Switcher */}
              <div className={`w-px h-5 ${isDark ? 'bg-zinc-700/75' : 'bg-zinc-200/75'} mx-1`} />
              <WorkspaceSwitcher onCreateOrg={() => setShowCreateOrg(true)} />

              {profileItems.map((item: any) => (
                <button
                  key={item.id}
                  className={`
                    group relative
                    transition-all duration-200
                    ${hoveredProfile === item.id ? 'scale-110' : 'hover:scale-105'}
                  `}
                  onMouseEnter={() => setHoveredProfile(item.id)}
                  onMouseLeave={() => setHoveredProfile(null)}
                >
                  <item.icon 
                    className="w-5 h-5 text-zinc-700 group-hover:text-zinc-900 transition-colors"
                    strokeWidth={1.5}
                  />
                  <div className={`
                    absolute top-full mt-2 left-0 whitespace-nowrap
                    bg-zinc-800 text-white px-2 py-1 rounded-md
                    text-xs transition-all duration-200 pointer-events-none
                    ${hoveredProfile === item.id ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
                  `}>
                    <div className="font-medium">{item.label}</div>
                    <div className="text-zinc-400 text-[10px]">{item.description}</div>
                  </div>
                </button>
              ))}

              {/* Share Button — only for board owner */}
              {currentBoardId && currentBoard && boardPermission === 'owner' && (
                <button
                  onClick={() => setShowShareModal(true)}
                  className={`relative p-1.5 rounded-lg transition-colors
                    ${isDark
                      ? 'hover:bg-zinc-700/50 text-zinc-400 hover:text-zinc-200'
                      : 'hover:bg-zinc-100 text-zinc-600 hover:text-zinc-900'}`}
                  title="Share board"
                >
                  <Share2 size={20} />
                </button>
              )}

              {/* Active Collaborators — avatar stack of connected users */}
              {currentBoardId && currentBoard && (
                <ActiveCollaborators />
              )}

              {/* Call Button */}
              {currentBoardId && currentBoard && (
                <CallButton />
              )}
            </>
          )}

          <div className={`w-px h-5 ${isDark ? 'bg-zinc-700/75' : 'bg-zinc-200/75'} mx-1`} />

          {/* Presentation Mode Toggle */}
          <button
            onClick={() => {
              setShowPresentationTooltip(false)
              setShowBoardsTooltip(false)
              togglePresentationMode()
            }}
            onMouseEnter={() => setShowPresentationTooltip(true)}
            onMouseLeave={() => setShowPresentationTooltip(false)}
            className={`relative p-1.5 rounded-lg transition-colors
              ${isDark 
                ? 'hover:bg-zinc-700/50 text-zinc-400 hover:text-zinc-200' 
                : 'hover:bg-zinc-100 text-zinc-600 hover:text-zinc-900'}`}
          >
            {isPresentationMode ? <Maximize2 size={20} /> : <Minimize2 size={20} />}
            {/* Tooltip */}
            {!isPresentationMode && (
              <div className={`
                absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap
                ${isDark ? 'bg-zinc-700' : 'bg-zinc-800'} text-white px-3 py-1.5 rounded-lg
                text-xs font-medium transition-all duration-200 pointer-events-none shadow-lg
                ${showPresentationTooltip ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
              `}>
                Presentation Mode
              </div>
            )}
          </button>
        </div>

        {/* Board name + actions - always inline next to controls */}
        {currentBoard && (
          <div
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border shadow-lg backdrop-blur-xl
              ${isDark
                ? 'bg-zinc-800/70 border-zinc-700/50'
                : 'bg-white/70 border-zinc-200/50'}`}
          >
            <h1
              className={`text-sm font-semibold tracking-tight truncate max-w-[200px]
                ${isDark ? 'text-white' : 'text-zinc-900'}`}
            >
              {currentBoard.name}
            </h1>
            {/* Role tag for shared boards */}
            {isViewOnly && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                isDark
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-amber-100 text-amber-700 border border-amber-200'
              }`}>
                VIEWER
              </span>
            )}
            {boardPermission === 'edit' && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                isDark
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
              }`}>
                EDITOR
              </span>
            )}
            {!isPresentationMode && boardPermission === 'owner' && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className={`p-1 rounded-md transition-colors flex-shrink-0 ${
                  isDark ? 'hover:bg-red-500/20 text-zinc-500 hover:text-red-400' : 'hover:bg-red-50 text-zinc-400 hover:text-red-500'
                }`}
                title="Delete board"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Boards Panel */}
      {!isPresentationMode && (
        <BoardsPanel 
          isOpen={isBoardsPanelOpen} 
          onClose={() => useBoardStore.getState().setBoardsPanelOpen(false)} 
        />
      )}

      {/* Right side controls - Adjusted spacing for connect button */}
      {!isPresentationMode && (
        <div className="fixed top-4 right-4 z-50">
        <div className="relative flex items-center gap-2">

          {/* Collab Server Status */}
          <ServerStatusIndicator />

          {/* Delegation controls */}
          {isOrgContext && <PublishButton />}
          <ActivitySidebar />
          <button
            onClick={() => {
              if (isOrgContext && activeContext?.type === 'organization') {
                router.push(`/dashboard/${activeContext.organizationId}`)
              } else {
                router.push('/dashboard/personal')
              }
            }}
            className={`relative p-2 rounded-lg shadow-lg backdrop-blur-sm border
              ${isDark 
                ? 'bg-zinc-800/90 border-zinc-700/50 text-zinc-400 hover:text-zinc-200' 
                : 'bg-white/90 border-zinc-200/50 text-zinc-600 hover:text-zinc-900'}
              transition-colors`}
            title="Dashboard"
          >
            <LayoutDashboard size={20} />
            <InboxBadge />
          </button>
          {isOrgContext && (
            <button
              onClick={() => setShowTeamPanel(true)}
              className={`p-2 rounded-lg shadow-lg backdrop-blur-sm border
                ${isDark 
                  ? 'bg-zinc-800/90 border-zinc-700/50 text-zinc-400 hover:text-zinc-200' 
                  : 'bg-white/90 border-zinc-200/50 text-zinc-600 hover:text-zinc-900'}
                transition-colors`}
              title="Team"
            >
              <Users size={20} />
            </button>
          )}
          {!isOrgContext && (
            <button
              onClick={() => setShowFriendsPanel(true)}
              className={`p-2 rounded-lg shadow-lg backdrop-blur-sm border
                ${isDark 
                  ? 'bg-zinc-800/90 border-zinc-700/50 text-zinc-400 hover:text-zinc-200' 
                  : 'bg-white/90 border-zinc-200/50 text-zinc-600 hover:text-zinc-900'}
                transition-colors`}
              title="Friends"
            >
              <UserPlus size={20} />
            </button>
          )}

        </div>
      </div>
      )}

      {/* Create Organization Modal */}
      <CreateOrgModal isOpen={showCreateOrg} onClose={() => setShowCreateOrg(false)} />

      {/* Team Management Panel */}
      <TeamPanel isOpen={showTeamPanel} onClose={() => setShowTeamPanel(false)} />

      {/* Friends Panel */}
      <FriendsPanel isOpen={showFriendsPanel} onClose={() => setShowFriendsPanel(false)} />

      {/* Share Modal */}
      {showShareModal && currentBoardId && currentBoard && (
        <ShareModal
          localBoardId={currentBoardId}
          boardName={currentBoard.name}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {/* Bord Access Modal */}
      {showAccessModal && (() => {
        const bord = currentBord || (currentBoardId ? bords.find(b => b.localBoardId === currentBoardId) : null)
        return bord ? (
          <BordAccessModal
            bordId={bord._id}
            bordTitle={bord.title}
            isOpen={showAccessModal}
            onClose={() => setShowAccessModal(false)}
          />
        ) : null
      })()}

      {/* Delete Board Confirmation */}
      {showDeleteConfirm && currentBoard && currentBoardId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60]" onClick={() => setShowDeleteConfirm(false)}>
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
                <h3 className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  Delete Board?
                </h3>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                  This will permanently delete <span className="font-semibold">"{currentBoard.name}"</span> and all its items. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  isDark ? 'bg-zinc-700 hover:bg-zinc-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowDeleteConfirm(false)
                  // Delete from cloud (awaited), then delete locally
                  await useBoardSyncStore.getState().deleteBoardFromCloud(currentBoardId)
                  deleteBoard(currentBoardId)
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
              >
                Delete Board
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

