'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircle, Plus, Search, UsersRound, User, Lock } from 'lucide-react'
import { useMessagingStore, type Conversation } from '@/store/messagingStore'
import { useThemeStore } from '@/store/themeStore'
import { usePresenceStore } from '@/store/presenceStore'

const BORDS_LOGO_SRC = '/bordlogo.png'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  currentUserId: string
  loading?: boolean
}

export default function ConversationList({
  conversations,
  activeId,
  onSelect,
  onNew,
  currentUserId,
  loading,
}: Props) {
  const isDark = useThemeStore((s) => s.isDark)
  const [search, setSearch] = useState('')
  const onlineUsers = usePresenceStore((s) => s.onlineUsers)

  const filtered = conversations.filter((c) => {
    const name = (c.name ?? '').toLowerCase()
    return !search || name.includes(search.toLowerCase())
  })
  // Pin the AI conversation first, then sort the rest by updatedAt
  const aiConv = filtered.find((c) => c.isAiConversation)
  const regularConvs = filtered.filter((c) => !c.isAiConversation)
  const sorted = aiConv ? [aiConv, ...regularConvs] : regularConvs
  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0)

  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const bg = isDark ? '#18181b' : '#f9fafb'
  const hoverBg = isDark ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.03)'
  const activeBg = isDark ? 'rgba(59,130,246,0.18)' : 'rgba(59,130,246,0.1)'
  const text = isDark ? '#e4e4e7' : '#18181b'
  const muted = isDark ? '#71717a' : '#6b7280'
  const inputBg = isDark ? '#27272a' : '#f3f4f6'

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return 'now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
    if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bg, borderRight: `1px solid ${border}` }}>
      {/* Header */}
      <div style={{ padding: '16px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <MessageCircle size={16} color="#3b82f6" />
          <span style={{ fontSize: 14, fontWeight: 600, color: text }}>Messages</span>
          {totalUnread > 0 && (
            <span style={{
              marginLeft: 2,
              fontSize: 10,
              fontWeight: 700,
              color: '#ffffff',
              background: '#ef4444',
              borderRadius: 999,
              minWidth: 18,
              height: 18,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 6px',
              boxSizing: 'border-box',
            }}>
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </div>
        <button
          onClick={onNew}
          style={{
            width: 28, height: 28, borderRadius: 8, border: `1px solid ${border}`,
            background: 'transparent', cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
          title="New conversation"
        >
          <Plus size={14} color={muted} />
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: '0 12px 10px' }}>
        <div style={{ position: 'relative' }}>
          <Search size={13} color={muted} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            style={{
              width: '100%', padding: '7px 9px 7px 28px', fontSize: 12,
              background: inputBg, border: 'none', borderRadius: 8,
              color: text, outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ padding: '8px 8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[0, 1, 2, 3, 4, 5].map((idx) => (
              <div
                key={idx}
                style={{
                  margin: '0 0 2px',
                  padding: '10px 10px',
                  borderRadius: 12,
                  borderLeft: '2px solid transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: isDark ? '#2b2b31' : '#e9edf2',
                    animation: 'conv-skeleton-pulse 1.2s ease-in-out infinite',
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      height: 11,
                      width: idx % 2 === 0 ? '52%' : '64%',
                      borderRadius: 999,
                      background: isDark ? '#2b2b31' : '#e9edf2',
                      animation: 'conv-skeleton-pulse 1.2s ease-in-out infinite',
                    }}
                  />
                  <div
                    style={{
                      marginTop: 7,
                      height: 9,
                      width: idx % 3 === 0 ? '70%' : '58%',
                      borderRadius: 999,
                      background: isDark ? '#23232a' : '#f1f4f8',
                      animation: 'conv-skeleton-pulse 1.2s ease-in-out infinite',
                    }}
                  />
                </div>
              </div>
            ))}
            <style>{`
              @keyframes conv-skeleton-pulse {
                0%, 100% { opacity: 0.65; }
                50% { opacity: 1; }
              }
            `}</style>
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: muted, fontSize: 12 }}>
            {search ? 'No results' : 'No conversations yet'}
          </div>
        )}
        {sorted.map((conv) => {
          const isActive = conv.id === activeId
          const isAi = !!conv.isAiConversation
          const otherMember = conv.type === 'dm' && !isAi
            ? conv.members.find((m) => m.userId !== currentUserId)
            : null
          const avatar = conv.type === 'group'
            ? (conv.avatarUrl ?? null)
            : (otherMember?.profile?.image ?? null)
          const initials = conv.name
            ? conv.name.slice(0, 2).toUpperCase()
            : otherMember?.profile
              ? `${otherMember.profile.firstName[0] ?? ''}${otherMember.profile.lastName[0] ?? ''}`.toUpperCase()
              : '?'
          const showOnlineDot = !isAi && conv.type === 'dm' && otherMember && onlineUsers.has(otherMember.userId)

          return (
            <div
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              style={{
                margin: '0 8px 4px',
                padding: '10px 10px',
                cursor: 'pointer',
                background: isActive ? (isAi ? 'rgba(139,92,246,0.15)' : activeBg) : 'transparent',
                borderLeft: isActive ? `2px solid ${isAi ? '#8b5cf6' : '#3b82f6'}` : '2px solid transparent',
                borderRadius: 12,
                display: 'flex', alignItems: 'center', gap: 10, transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = hoverBg }}
              onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              {/* Avatar / Icon */}
                <div style={{ position: 'relative', flexShrink: 0, width: 38, height: 38 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: isAi ? 12 : (conv.type === 'group' ? 10 : '50%'),
                  background: isAi
                    ? (isDark
                      ? (isActive ? '#3b2b5f' : '#2a2144')
                      : (isActive ? '#ddd6fe' : '#ede9fe'))
                    : isActive ? '#3b82f6' : (isDark ? '#3f3f46' : '#e4e4e7'),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden',
                }}>
                  {isAi ? (
                    <img src={BORDS_LOGO_SRC} alt="Bords" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : avatar ? (
                    <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : conv.type === 'group' ? (
                    <UsersRound size={14} color={isActive ? 'white' : '#8b5cf6'} />
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 700, color: isActive ? 'white' : muted }}>{initials}</span>
                  )}
                </div>
                {conv.unreadCount > 0 && (
                  <div style={{
                    position: 'absolute', top: -2, right: -2,
                    minWidth: 18, height: 18, borderRadius: 99, padding: '0 4px',
                    background: '#ef4444', border: `2px solid ${bg}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700, color: 'white', boxSizing: 'border-box',
                  }}>
                    {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
                  </div>
                )}
                {showOnlineDot && !conv.unreadCount && (
                  <div style={{
                    position: 'absolute', bottom: 0, right: 0,
                    width: 10, height: 10, borderRadius: '50%',
                    background: '#22c55e', border: `2px solid ${bg}`,
                  }} />
                )}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{
                    fontSize: 14, fontWeight: conv.unreadCount > 0 ? 650 : 550,
                    color: isAi ? (isActive ? '#a78bfa' : '#8b5cf6') : text,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: isAi ? 80 : 120,
                  }}>
                    {isAi ? 'Bords AI' : (conv.name ?? 'Direct Message')}
                  </span>
                  {isAi && (
                    <span style={{ fontSize: 10, color: muted, marginLeft: 6, flexShrink: 0 }}>(your assistant)</span>
                  )}
                  {conv.lastMessage && !isAi && (
                    <span style={{ fontSize: 10, color: muted, flexShrink: 0, marginLeft: 4, fontWeight: 500 }}>
                      {formatTime(conv.lastMessage.createdAt)}
                    </span>
                  )}
                  {conv.lastMessage && isAi && (
                    <span style={{ fontSize: 10, color: muted, flexShrink: 0, marginLeft: 'auto', fontWeight: 500 }}>
                      {formatTime(conv.lastMessage.createdAt)}
                    </span>
                  )}
                </div>
                {conv.lastMessage && (
                  <p style={{
                    margin: '1px 0 0', fontSize: 12, color: muted,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontWeight: conv.unreadCount > 0 ? 600 : 400,
                  }}>
                    {conv.lastMessage.senderId === currentUserId ? 'You: ' : `${conv.lastMessage.senderName.split(' ')[0]}: `}
                    {conv.lastMessage.content ?? '📎 Attachment'}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
