'use client'
import { useState, useRef, useEffect, useMemo } from 'react'
import {
  Tags, Handshake, Command, Brain, Share2,
  Image, Presentation, GitBranch
} from 'lucide-react'
import { useThemeStore } from '../store/themeStore'
import { usePresentationStore } from '../store/presentationStore'
import { useBoardStore } from '../store/boardStore'
import { useConnectionLineStore } from '../store/connectionLineStore'
import { useBoardSyncStore } from '../store/boardSyncStore'
import { useOrganizationStore } from '../store/organizationStore'
import { useDelegationStore } from '../store/delegationStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { BordAccessModal } from './workspace/BordAccessModal'
import { PersonalBordAccessModal } from './workspace/PersonalBordAccessModal'
import { ShareModal } from './BoardSyncControls'

export function SideBar() {
  const [hoveredItem, setHoveredItem] = useState<number | null>(null);
  const [showAccessModal, setShowAccessModal] = useState(false)
  const [showPersonalAccessModal, setShowPersonalAccessModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [isLinkingBord, setIsLinkingBord] = useState(false)
  const isDark = useThemeStore((state) => state.isDark)
  const { isPresentationMode, togglePresentationMode } = usePresentationStore()
  const { openBackgroundModal, currentBoardId } = useBoardStore()
  const currentBoard = useBoardStore(s => s.boards.find(b => b.id === currentBoardId))
  const { openModal: openConnectionLineModal } = useConnectionLineStore()
  const boardPermission = useBoardSyncStore((s) => s.boardPermissions[currentBoardId || ''] || 'owner')
  const isViewOnly = boardPermission === 'view'
  const activeContext = useWorkspaceStore(s => s.activeContext)
  const isOrgContext = activeContext?.type === 'organization'
  const isOwnerOfCurrentOrg = useOrganizationStore(s => s.isOwnerOfCurrentOrg)
  const callerRole = useOrganizationStore(s => s.callerRole)
  const bords = useDelegationStore(s => s.bords)
  const linkBoardToOrg = useDelegationStore(s => s.linkBoardToOrg)
  const currentBord = isOrgContext && currentBoardId
    ? bords.find(b => b.localBoardId === currentBoardId)
    : null

  const friends = useWorkspaceStore(s => s.friends)
  const fetchFriends = useWorkspaceStore(s => s.fetchFriends)
  const acceptedFriends = useMemo(() => friends.filter(f => f.status === 'accepted'), [friends])

  // Show Collaborate in org context for owner/admin and board collaborators.
  const canCollaborateInOrg =
    isOwnerOfCurrentOrg ||
    callerRole === 'admin' ||
    !!(currentBord && (currentBord.role === 'owner' || currentBord.role === 'collaborator'))
  const showCollaborate = !isOrgContext || canCollaborateInOrg

  // Eagerly fetch friends when in personal context so the list is populated
  useEffect(() => {
    if (!isOrgContext) fetchFriends()
  }, [isOrgContext, fetchFriends])

  const toolItems = [
    { id: 1, icon: Image, label: "Custom Backgrounds", description: isViewOnly ? "View-only mode" : !currentBoardId ? "Select/create a board to get started" : "Personalize your board", disabled: !currentBoardId || isViewOnly },
    { id: 4, icon: Presentation, label: "Presentation Mode", description: !currentBoardId ? "Select/create a board to get started" : "Full-screen view", disabled: !currentBoardId },
    { id: 5, icon: GitBranch, label: "Connection Lines", description: isViewOnly ? "View-only mode" : !currentBoardId ? "Select/create a board to get started" : "Customize line colors", disabled: !currentBoardId || isViewOnly },
    // { id: 6, icon: Tags, label: "Tags", description: "Organize & filter", comingSoon: true },
    ...(showCollaborate ? [{ id: 7, icon: Handshake, label: "Collaborate", description: !currentBoardId ? "Select/create a board to get started" : isLinkingBord ? "Setting up..." : isOrgContext ? "Manage team access" : "Share with friends", disabled: !currentBoardId || isLinkingBord }] : []),
    // { id: 8, icon: Command, label: "Commands", description: "Quick actions", comingSoon: true },
    // { id: 9, icon: Brain, label: "AI Helper", description: "Smart suggestions", comingSoon: true },
    { id: 11, icon: Share2, label: "Share Board", description: boardPermission !== 'owner' ? "Only board owners can share" : !currentBoardId ? "Select/create a board to get started" : "Share board publicly", disabled: !currentBoardId || boardPermission !== 'owner' },
  ]

  if (isPresentationMode) {
    // Reset hovered state when entering presentation mode so tooltips don't persist
    if (hoveredItem !== null) setHoveredItem(null)
    return null
  }

  const handleItemClick = async (itemId: number) => {
    const item = toolItems.find(i => i.id === itemId)
    if (item?.disabled) return // Don't do anything for disabled items
    
    if (itemId === 1) { // Custom Backgrounds
      openBackgroundModal()
    } else if (itemId === 4) { // Presentation Mode
      togglePresentationMode()
    } else if (itemId === 5) { // Connection Lines
      openConnectionLineModal()
    } else if (itemId === 7) { // Collaborate
      if (!isOrgContext) {
        // Personal context — share with friends
        if (!currentBoardId) return
        setShowPersonalAccessModal(true)
        return
      }
      // Org context — open Bord Access Modal
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
    } else if (itemId === 11) { // Share Board
      setShowShareModal(true)
    }
    // Add other item handlers here as needed
  }

  return (
    <>
    <div className="fixed right-4 top-1/2 -translate-y-1/2 z-40">
      <div className={`flex flex-col backdrop-blur-xl border shadow-lg rounded-2xl w-16
        ${isDark 
          ? 'bg-zinc-800/90 border-zinc-700/50' 
          : 'bg-white/90 border-zinc-200/50'}
        transition-colors duration-200`}>
        <div className="py-4 flex flex-col items-center gap-4">{toolItems.map((item) => (
            <button
              key={item.id}
              className={`group relative flex-shrink-0 transition-all duration-200 p-1 w-full
                ${item.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
              onMouseEnter={() => setHoveredItem(item.id)}
              onMouseLeave={() => setHoveredItem(null)}
              onClick={() => handleItemClick(item.id)}
              disabled={item.disabled}
            >
              <div className={`
                flex items-center justify-center
                ${hoveredItem === item.id && !item.disabled ? 'scale-110' : !item.disabled ? 'hover:scale-105' : ''}
                transition-all duration-200
              `}>
                <item.icon 
                  className={`w-6 h-6 transition-colors
                    ${isDark 
                      ? 'text-zinc-400 group-hover:text-zinc-200' 
                      : 'text-zinc-600 group-hover:text-zinc-900'}`}
                  strokeWidth={1.5}
                />
              </div>
              <div 
                style={{ position: 'fixed', right: '88px' }}
                className={`
                  top-auto translate-y-[-50%]
                  bg-zinc-800 text-white px-3 py-2 rounded-lg
                  text-xs min-w-[200px] pointer-events-none
                  transition-all duration-200 ease-out shadow-lg
                  z-[100]
                  ${hoveredItem === item.id 
                    ? 'opacity-100 translate-x-0' 
                    : 'opacity-0 translate-x-2'}
                `}
              >
                <div className="font-medium mb-1">
                  {item.label}
                </div>
                <div className="text-zinc-400 text-[10px] leading-relaxed">
                  {item.description}
                </div>
                <div className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-[7px]
                     border-[7px] border-transparent border-l-zinc-800"/>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>

      {/* Share Modal */}
      {showShareModal && currentBoardId && currentBoard && (
        <ShareModal
          localBoardId={currentBoardId}
          boardName={currentBoard.name}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {/* Bord Access Modal — triggered by Collaborate button (org context) */}
      {showAccessModal && (() => {
        const bordId = currentBord?._id
        if (!bordId) return null
        return (
          <BordAccessModal
            bordId={bordId}
            bordTitle={currentBoard?.name || 'Board'}
            isOpen={showAccessModal}
            onClose={() => setShowAccessModal(false)}
          />
        )
      })()}

      {/* Personal Access Modal — triggered by Collaborate button (personal context) */}
      {showPersonalAccessModal && currentBoardId && (
        <PersonalBordAccessModal
          localBoardId={currentBoardId}
          boardTitle={currentBoard?.name || 'Board'}
          isOpen={showPersonalAccessModal}
          onClose={() => setShowPersonalAccessModal(false)}
        />
      )}
    </>
  )
}
