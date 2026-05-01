'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Smile, Reply, Trash2 } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useThemeStore } from '@/store/themeStore'
import { useBoardStore } from '@/store/boardStore'
import { useBoardSyncStore } from '@/store/boardSyncStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import type { Message } from '@/store/messagingStore'

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

function normalizeBoardHandle(title: string) {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
  return cleaned || 'board'
}

interface Props {
  message: Message
  isMine: boolean
  currentUserId: string
  onReact: (messageId: string, emoji: string) => void
  onReply: (message: Message) => void
  showSenderName?: boolean
  groupedWithPrev?: boolean
  groupedWithNext?: boolean
  animateIn?: boolean
}

export default function MessageBubble({
  message,
  isMine,
  currentUserId,
  onReact,
  onReply,
  showSenderName = false,
  groupedWithPrev = false,
  groupedWithNext = false,
  animateIn = false,
}: Props) {
  const router = useRouter()
  const isDark = useThemeStore((s) => s.isDark)
  const setCurrentBoard = useBoardStore((s) => s.setCurrentBoard)
  const [showActions, setShowActions] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

  const openTaggedBoard = async (tag: { boardId: string; title: string; organizationId: string | null; hasAccess?: boolean }) => {
    if (tag.hasAccess === false) {
      toast.error('You do not have access to this board')
      return
    }

    let fetchedBoard: any = null
    let fetchedPermission: 'owner' | 'view' | 'edit' = 'view'
    try {
      const accessRes = await fetch(`/api/boards/sync/${encodeURIComponent(tag.boardId)}`)
      if (!accessRes.ok) {
        toast.error('You do not have access to this board')
        return
      }
      const json = await accessRes.json().catch(() => ({}))
      fetchedBoard = json?.board ?? null
      if (json?.permission === 'owner' || json?.permission === 'edit' || json?.permission === 'view') {
        fetchedPermission = json.permission
      }
    } catch {
      toast.error('Unable to verify board access right now')
      return
    }

    const workspace = useWorkspaceStore.getState()
    const boardStore = useBoardStore.getState()
    const boardSync = useBoardSyncStore.getState()

    const effectiveOrgId = fetchedBoard?.organizationId ?? tag.organizationId

    if (effectiveOrgId && workspace.orgContainerWorkspace) {
      const org = workspace.orgContainerWorkspace.organizations.find((o) => o._id === effectiveOrgId)
      workspace.switchToOrganization(effectiveOrgId, org?.name || 'Organization')
    } else {
      workspace.switchToPersonal()
    }

    boardSync.setBoardPermission(tag.boardId, fetchedPermission)

    const existsLocally = boardStore.boards.some((b) => b.id === tag.boardId)
    if (!existsLocally) {
      useBoardStore.setState((state) => ({
        boards: [...state.boards, {
          id: tag.boardId,
          userId: boardStore.currentUserId || '',
          name: fetchedBoard?.name || tag.title || 'Board',
          createdAt: new Date(),
          lastModified: new Date(),
          notes: [], checklists: [], texts: [], connections: [],
          drawings: [], kanbans: [], medias: [], reminders: [], tables: [], richTexts: [],
          contextType: effectiveOrgId ? 'organization' as const : 'personal' as const,
          organizationId: effectiveOrgId || undefined,
        }],
      }))
    }

    setCurrentBoard(tag.boardId)
    router.push('/')
  }

  const bubbleBg = message.isSystemMessage
    ? isDark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)'
    : isMine
      ? '#3b82f6'
      : isDark ? '#27272a' : '#f3f4f6'
  const bubbleText = message.isSystemMessage
    ? (isDark ? '#93c5fd' : '#2563eb')
    : isMine ? 'white' : (isDark ? '#e4e4e7' : '#18181b')
  const muted = isDark ? '#71717a' : '#9ca3af'
  const actionsBg = isDark ? '#1c1c1e' : 'white'
  const actionsBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  // Group reactions by emoji
  const reactionGroups = message.reactions.reduce<Record<string, { count: number; mine: boolean }>>((acc, r) => {
    acc[r.emoji] = acc[r.emoji] ?? { count: 0, mine: false }
    acc[r.emoji].count++
    if (r.userId === currentUserId) acc[r.emoji].mine = true
    return acc
  }, {})

  if (message.isDeleted) {
    return (
      <div style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start', padding: '2px 16px' }}>
        <span style={{ fontSize: 12, color: muted, fontStyle: 'italic' }}>Message deleted</span>
      </div>
    )
  }

  const bubbleRadius = isMine
    ? `${groupedWithPrev ? 8 : 14}px 14px ${groupedWithNext ? 8 : 4}px 14px`
    : `14px ${groupedWithPrev ? 8 : 14}px 14px ${groupedWithNext ? 8 : 4}px`

  const renderMessageContent = () => {
    const content = message.content ?? ''
    if (!content) return null
    if (message.boardTags.length === 0) return content

    const handleSet = new Set(message.boardTags.map((t) => normalizeBoardHandle(t.title)))
    const parts = content.split(/(#[a-z0-9_-]+)/gi)

    return parts.map((part, idx) => {
      if (!part.startsWith('#')) return <span key={`${part}-${idx}`}>{part}</span>
      const token = part.slice(1).toLowerCase()
      if (!handleSet.has(token)) return <span key={`${part}-${idx}`}>{part}</span>
      return (
        <span
          key={`${part}-${idx}`}
          style={{
            color: isMine ? 'rgba(255,255,255,0.95)' : '#3b82f6',
            fontWeight: 700,
          }}
        >
          {part}
        </span>
      )
    })
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isMine ? 'flex-end' : 'flex-start',
        padding: `${groupedWithNext ? 1 : 3}px 16px ${groupedWithPrev ? 1 : 3}px`,
        animation: animateIn ? 'msg-in 180ms ease-out' : undefined,
        transformOrigin: isMine ? 'right bottom' : 'left bottom',
      }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); setShowEmojiPicker(false) }}
    >
      {/* Sender name (for group chats, non-mine, non-system) */}
      {showSenderName && !isMine && !message.isSystemMessage && (
        <span style={{ fontSize: 11, fontWeight: 600, color: muted, marginBottom: 2, marginLeft: 4 }}>
          {message.senderName}
        </span>
      )}

      {/* System message indicator */}
      {message.isSystemMessage && (
        <span style={{ fontSize: 10, color: muted, marginBottom: 2, marginLeft: 4 }}>
          📋 System
        </span>
      )}

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Action buttons (hover) — left for mine, right for others */}
        {showActions && (
          <div
            style={{
              order: isMine ? -1 : 1,
              display: 'flex', alignItems: 'center', gap: 4,
              background: actionsBg, border: `1px solid ${actionsBorder}`,
              borderRadius: 10, padding: '2px 6px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            }}
          >
            <button
              onClick={() => setShowEmojiPicker((v) => !v)}
              style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, display: 'flex' }}
              title="React"
            >
              <Smile size={13} color={muted} />
            </button>
            <button
              onClick={() => onReply(message)}
              style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, display: 'flex' }}
              title="Reply"
            >
              <Reply size={13} color={muted} />
            </button>
          </div>
        )}

        {/* Emoji picker */}
        {showEmojiPicker && (
          <div style={{
            position: 'absolute', [isMine ? 'right' : 'left']: '100%', top: 0,
            display: 'flex', gap: 4, background: actionsBg, border: `1px solid ${actionsBorder}`,
            borderRadius: 10, padding: '4px 8px', zIndex: 10,
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          }}>
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => { onReact(message.id, emoji); setShowEmojiPicker(false) }}
                style={{ fontSize: 18, border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 2px', borderRadius: 4 }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {/* Bubble */}
        <div style={{
          maxWidth: 320, padding: '8px 12px', borderRadius: bubbleRadius,
          background: bubbleBg, color: bubbleText,
          fontSize: 13, lineHeight: '1.5', wordBreak: 'break-word',
        }}>
          {message.boardTags.length > 0 && (
            <div style={{ marginBottom: message.content ? 6 : 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {message.boardTags.map((tag) => {
                const hasAccess = tag.hasAccess !== false
                return (
                  <button
                    key={tag.boardId}
                    onClick={() => openTaggedBoard(tag)}
                    style={{
                      border: 'none',
                      borderRadius: 999,
                      padding: '3px 8px',
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: hasAccess ? 'pointer' : 'not-allowed',
                      background: hasAccess
                        ? (isDark ? 'rgba(59,130,246,0.22)' : 'rgba(59,130,246,0.14)')
                        : (isDark ? 'rgba(244,63,94,0.18)' : 'rgba(244,63,94,0.13)'),
                      color: hasAccess
                        ? (isDark ? '#bfdbfe' : '#1d4ed8')
                        : (isDark ? '#fecdd3' : '#be123c'),
                    }}
                    title={hasAccess ? 'Open board' : 'You do not currently have access to this board'}
                  >
                    {hasAccess ? '🗂' : '🔒'} {tag.title}
                  </button>
                )
              })}
            </div>
          )}
          {renderMessageContent()}

          {/* Attachments */}
          {message.attachments.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {message.attachments.map((a) => (
                <a
                  key={a.id}
                  href={`/api/media/attachment?path=${encodeURIComponent(a.storagePath)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 11, color: isMine ? 'rgba(255,255,255,0.85)' : '#3b82f6',
                    textDecoration: 'underline', display: 'block',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  📎 {a.fileName}
                </a>
              ))}
            </div>
          )}

          <span style={{ fontSize: 10, opacity: 0.6, display: 'block', textAlign: isMine ? 'right' : 'left', marginTop: 2 }}>
            {formatTime(message.createdAt)}{message.editedAt ? ' (edited)' : ''}
            {isMine && message._status === 'sending' && <span style={{ marginLeft: 4, opacity: 0.7 }}>· sending…</span>}
            {isMine && message._status === 'failed' && <span style={{ marginLeft: 4, color: '#fca5a5' }}>· failed to send</span>}
          </span>
        </div>
      </div>

      {/* Reactions */}
      {Object.keys(reactionGroups).length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap', justifyContent: isMine ? 'flex-end' : 'flex-start' }}>
          {Object.entries(reactionGroups).map(([emoji, { count, mine }]) => (
            <button
              key={emoji}
              onClick={() => onReact(message.id, emoji)}
              style={{
                fontSize: 11, padding: '2px 6px', borderRadius: 99,
                border: `1px solid ${mine ? '#3b82f6' : actionsBorder}`,
                background: mine ? 'rgba(59,130,246,0.1)' : actionsBg,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
              }}
            >
              <span style={{ fontSize: 13 }}>{emoji}</span>
              <span style={{ color: mine ? '#3b82f6' : muted }}>{count}</span>
            </button>
          ))}
        </div>
      )}

      <style>{`@keyframes msg-in { 0% { opacity: .2; transform: translateY(6px) scale(.985); } 100% { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
    </div>
  )
}
