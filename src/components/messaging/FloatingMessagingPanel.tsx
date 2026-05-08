'use client'
import { useState, useEffect } from 'react'
import { MessageCircle, X } from 'lucide-react'
import { useMessagingStore } from '@/store/messagingStore'
import { useThemeStore } from '@/store/themeStore'
import { useSession } from '@/components/AuthProvider'
import { useWorkspaceStore } from '@/store/workspaceStore'
import MessagingPanel from './MessagingPanel'

export default function FloatingMessagingPanel() {
  const [open, setOpen] = useState(false)
  const isDark = useThemeStore((s) => s.isDark)
  const { data: session } = useSession()
  const getActiveOrgId = useWorkspaceStore((s) => s.getActiveOrgId)
  const totalUnread = useMessagingStore((s) => s.totalUnread)
  const fetchConversations = useMessagingStore((s) => s.fetchConversations)

  const currentUserId = (session?.user as any)?.id as string | undefined
  const currentOrganizationId = getActiveOrgId()
  const context = currentOrganizationId ? 'org' : 'personal'

  // Load conversations and start realtime subscription as soon as user is known.
  // This keeps the unread badge accurate even when the panel is closed.
  useEffect(() => {
    if (!currentUserId) return
    fetchConversations(context, currentOrganizationId ?? undefined)
  }, [currentUserId, context, currentOrganizationId])

  if (!currentUserId) return null

  const border = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
  const panelBg = isDark ? '#18181b' : 'white'

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          position: 'fixed', bottom: 80, right: 20, zIndex: 200,
          width: 44, height: 44, borderRadius: '50%', border: 'none',
          background: '#3b82f6',
          boxShadow: '0 4px 16px rgba(59,130,246,0.4)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'transform 0.2s',
        }}
        title="Messages"
        onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.08)')}
        onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
      >
        {open ? <X size={18} color="white" /> : <MessageCircle size={18} color="white" />}
        {!open && totalUnread > 0 && (
          <span style={{
            position: 'absolute', top: -3, right: -3,
            minWidth: 18, height: 18, borderRadius: 99, padding: '0 4px',
            background: '#ef4444', color: 'white', fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxSizing: 'border-box',
          }}>
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 134, right: 20, zIndex: 200,
          width: 600, height: 520, borderRadius: 16,
          background: panelBg, border: `1px solid ${border}`,
          boxShadow: '0 24px 48px rgba(0,0,0,0.2)',
          overflow: 'hidden',
          display: 'flex',
        }}>
          <MessagingPanel
            currentUserId={currentUserId}
            context={context}
            orgId={currentOrganizationId ?? undefined}
            layout="full"
            availableMembers={[]}  // floating panel starts with existing conversations; new ones via dashboard
          />
        </div>
      )}
    </>
  )
}
