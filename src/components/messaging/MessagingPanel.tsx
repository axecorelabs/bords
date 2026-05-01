'use client'
import { useState, useEffect } from 'react'
import { useMessagingStore } from '@/store/messagingStore'
import { useThemeStore } from '@/store/themeStore'
import ConversationList from './ConversationList'
import ConversationView from './ConversationView'
import NewConversationModal from './NewConversationModal'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

interface AvailableMember {
  userId: string
  profile: { firstName: string; lastName: string; image: string | null; email: string } | null
}

interface Props {
  currentUserId: string
  context: 'org' | 'personal'
  orgId?: string
  workspaceId?: string
  canViewAssignedTasksPanel?: boolean
  /** All people available to start a conversation with */
  availableMembers: AvailableMember[]
  /** Layout: 'panel' = fixed height panel, 'full' = fills parent */
  layout?: 'panel' | 'full'
}

export default function MessagingPanel({
  currentUserId,
  context,
  orgId,
  workspaceId,
  canViewAssignedTasksPanel = false,
  availableMembers,
  layout = 'full',
}: Props) {
  const isDark = useThemeStore((s) => s.isDark)
  const {
    conversations,
    activeConversationId,
    loading,
    setActiveConversation,
    fetchConversations,
    createConversation,
  } = useMessagingStore()

  const [showNewModal, setShowNewModal] = useState(false)
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list')
  // iPad collapsible sidebar: collapsed by default on medium screens (≤1024px)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)')
    setSidebarCollapsed(mq.matches)
    const handler = (e: MediaQueryListEvent) => setSidebarCollapsed(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    fetchConversations(context, orgId)
  }, [context, orgId])

  const activeConversation = conversations.find((c) => c.id === activeConversationId) ?? null

  const handleSelect = (id: string) => {
    setActiveConversation(id)
    setMobileView('chat')
  }

  const handleBack = () => {
    setMobileView('list')
    setActiveConversation(null)
  }

  const handleCreated = (id: string) => {
    setShowNewModal(false)
    fetchConversations(context, orgId)
    setActiveConversation(id)
    setMobileView('chat')
  }

  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

  return (
    <div style={{
      display: 'flex', width: '100%',
      height: layout === 'panel' ? 600 : '100%',
      flex: layout === 'full' ? 1 : undefined,
      minHeight: layout === 'full' ? 0 : undefined,
      border: `1px solid ${border}`, borderRadius: layout === 'panel' ? 16 : 0,
      overflow: 'hidden',
    }}>
      {/* Left: conversation list — hidden on mobile when chat is open, collapsible on iPad */}
      <div
        style={{
          width: sidebarCollapsed ? 0 : 290,
          minWidth: sidebarCollapsed ? 0 : 290,
          flexShrink: 0,
          overflow: 'hidden',
          display: mobileView === 'chat' ? 'none' : 'flex',
          flexDirection: 'column',
          transition: 'width 0.22s ease, min-width 0.22s ease',
          borderRight: sidebarCollapsed ? 'none' : `1px solid ${border}`,
        }}
        className="messaging-list-col"
      >
        <ConversationList
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={handleSelect}
          onNew={() => setShowNewModal(true)}
          currentUserId={currentUserId}
          loading={loading}
        />
      </div>

      {/* Right: chat view */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative',
      }}>
        {/* iPad sidebar toggle button */}
        <button
          onClick={() => setSidebarCollapsed((v) => !v)}
          title={sidebarCollapsed ? 'Show chats list' : 'Hide chats list'}
          className="messaging-sidebar-toggle"
          style={{
            position: 'absolute', top: 12, left: 12, zIndex: 10,
            width: 28, height: 28, borderRadius: 8, border: 'none',
            background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
            color: isDark ? '#a1a1aa' : '#71717a',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s',
          }}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
        {activeConversation ? (
          <ConversationView
            conversation={activeConversation}
            currentUserId={currentUserId}
            orgId={context === 'org' ? orgId : undefined}
            organizationMembers={availableMembers}
            canViewAssignedTasksPanel={context === 'org' && canViewAssignedTasksPanel}
            onConversationUpdated={() => { void fetchConversations(context, orgId) }}
            onBack={mobileView === 'chat' ? handleBack : undefined}
          />
        ) : (
          <EmptyState isDark={isDark} onNew={() => setShowNewModal(true)} />
        )}
      </div>

      {/* New conversation modal */}
      {showNewModal && (
        <NewConversationModal
          members={availableMembers}
          currentUserId={currentUserId}
          context={context}
          orgId={orgId}
          workspaceId={workspaceId}
          onClose={() => setShowNewModal(false)}
          onCreated={handleCreated}
          createConversation={createConversation}
        />
      )}

      <style>{`
        @media (min-width: 640px) {
          .messaging-list-col { display: flex !important; }
        }
        /* Only show the toggle on iPad / medium screens */
        .messaging-sidebar-toggle { display: none !important; }
        @media (max-width: 1024px) {
          .messaging-sidebar-toggle { display: flex !important; }
        }
      `}</style>
    </div>
  )
}

function EmptyState({ isDark, onNew }: { isDark: boolean; onNew: () => void }) {
  const muted = isDark ? '#52525b' : '#9ca3af'
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
      <div style={{ fontSize: 40 }}>💬</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: isDark ? '#e4e4e7' : '#18181b' }}>Your messages</div>
      <div style={{ fontSize: 13, color: muted, textAlign: 'center', maxWidth: 260 }}>
        Select a conversation on the left, or start a new one.
      </div>
      <button
        onClick={onNew}
        style={{
          marginTop: 8, padding: '8px 20px', borderRadius: 10, border: 'none',
          background: '#3b82f6', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}
      >
        New Conversation
      </button>
    </div>
  )
}
