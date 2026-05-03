'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Smile, Reply, Trash2, Bot } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'react-hot-toast'
import { useThemeStore } from '@/store/themeStore'
import { useBoardStore } from '@/store/boardStore'
import { useBoardSyncStore } from '@/store/boardSyncStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { hydrateLocalBoardFromCloud } from '@/lib/cloud-board-hydration'
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
  onOpenPlanReview?: (planId: string) => void
  showSenderName?: boolean
  groupedWithPrev?: boolean
  groupedWithNext?: boolean
  animateIn?: boolean
}

function renderMarkdownText(content: string, color: string) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        p: ({ children }) => <p style={{ margin: '0 0 8px', color }}>{children}</p>,
        strong: ({ children }) => <strong style={{ fontWeight: 700, color }}>{children}</strong>,
        em: ({ children }) => <em style={{ fontStyle: 'italic', color }}>{children}</em>,
        ul: ({ children }) => <ul style={{ margin: '0 0 8px', paddingLeft: 18, color }}>{children}</ul>,
        ol: ({ children }) => <ol style={{ margin: '0 0 8px', paddingLeft: 18, color }}>{children}</ol>,
        li: ({ children }) => <li style={{ margin: '2px 0', color }}>{children}</li>,
        code: ({ children }) => (
          <code
            style={{
              fontSize: '0.92em',
              padding: '1px 4px',
              borderRadius: 4,
              background: 'rgba(0,0,0,0.08)',
              color,
            }}
          >
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre
            style={{
              margin: '0 0 8px',
              padding: '10px 12px',
              borderRadius: 8,
              overflowX: 'auto',
              background: 'rgba(0,0,0,0.08)',
              color,
              whiteSpace: 'pre-wrap',
            }}
          >
            {children}
          </pre>
        ),
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'underline' }}>
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

export default function MessageBubble({
  message,
  isMine,
  currentUserId,
  onReact,
  onReply,
  onOpenPlanReview,
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
    const workspace = useWorkspaceStore.getState()
    const boardStore = useBoardStore.getState()
    const boardSync = useBoardSyncStore.getState()
    const localBoard = boardStore.boards.find((board) => board.id === tag.boardId)

    const openLocalBoard = () => {
      const effectiveOrgId = localBoard?.organizationId ?? tag.organizationId
      const localPermission = localBoard?.userId && boardStore.currentUserId && localBoard.userId === boardStore.currentUserId
        ? 'owner'
        : (boardSync.boardPermissions[tag.boardId] || 'view')

      if (effectiveOrgId && workspace.orgContainerWorkspace) {
        const org = workspace.orgContainerWorkspace.organizations.find((o) => o._id === effectiveOrgId)
        workspace.switchToOrganization(effectiveOrgId, org?.name || 'Organization')
      } else {
        workspace.switchToPersonal()
      }

      boardSync.setBoardPermission(tag.boardId, localPermission)
      setCurrentBoard(tag.boardId)
      router.push('/')
    }

    if (tag.hasAccess === false && !localBoard) {
      toast.error('You do not have access to this board')
      return
    }

    let fetchedBoard: any = null
    let fetchedPermission: 'owner' | 'view' | 'edit' = 'view'
    try {
      const accessRes = await fetch(`/api/boards/sync/${encodeURIComponent(tag.boardId)}`)
      if (!accessRes.ok) {
        if (localBoard) {
          openLocalBoard()
          return
        }
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

    const effectiveOrgId = fetchedBoard?.organizationId ?? tag.organizationId

    if (effectiveOrgId && workspace.orgContainerWorkspace) {
      const org = workspace.orgContainerWorkspace.organizations.find((o) => o._id === effectiveOrgId)
      workspace.switchToOrganization(effectiveOrgId, org?.name || 'Organization')
    } else {
      workspace.switchToPersonal()
    }

    boardSync.setBoardPermission(tag.boardId, fetchedPermission)

      if (fetchedBoard) {
        hydrateLocalBoardFromCloud({
          boardId: tag.boardId,
          userId: boardStore.currentUserId || '',
          fallbackTitle: tag.title || 'Board',
          organizationId: effectiveOrgId,
          boardPayload: fetchedBoard,
        })
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

  // ── AI message card ─────────────────────────────────────────────────────
  if (message.isAiMessage) {
    const aiBorder = isDark ? 'rgba(139,92,246,0.35)' : 'rgba(139,92,246,0.2)'
    const aiBg = isDark ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.06)'
    const aiText = isDark ? '#e4e4e7' : '#18181b'
    const aiMuted = isDark ? '#a1a1aa' : '#71717a'
    const aiAccent = isDark ? '#c4b5fd' : '#7c3aed'
    const isAiLoading = !message.aiMeta && !(message.content ?? '').trim()
    const canOpenCreatedBoard = (message.aiMeta?.capability === 'create_board' || message.aiMeta?.capability === 'board_created') && !!message.aiMeta?.capabilityData?.boardLocalId
    const canReviewPlan = message.aiMeta?.capability === 'plan_draft' && !!message.aiMeta?.capabilityData?.planArtifactId
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          padding: '6px 16px',
          animation: animateIn ? 'msg-in 180ms ease-out' : undefined,
        }}
      >
        <div
          style={{
            maxWidth: 380,
            border: `1px solid ${aiBorder}`,
            borderRadius: '14px 14px 14px 4px',
            background: aiBg,
            padding: '10px 13px',
            wordBreak: 'break-word',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
            <Bot size={12} color={aiAccent} />
            <span style={{ fontSize: 10, fontWeight: 700, color: aiAccent, letterSpacing: '0.03em' }}>Bords AI</span>
            {message.aiMeta && (
              <span style={{ fontSize: 9, color: aiMuted, marginLeft: 2 }}>
                {message.aiMeta.model ?? 'model'} · {message.aiMeta.latencyMs ?? 0}ms
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: aiText, lineHeight: '1.55' }}>
            {isAiLoading ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 18 }}>
                <span className="ai-typing-dot" />
                <span className="ai-typing-dot" />
                <span className="ai-typing-dot" />
              </span>
            ) : (
              renderMarkdownText(message.content ?? '', aiText)
            )}
          </div>
          {canOpenCreatedBoard && (
            <button
              onClick={() => openTaggedBoard({
                boardId: message.aiMeta?.capabilityData?.boardLocalId as string,
                title: message.aiMeta?.capabilityData?.boardTitle ?? 'Board',
                organizationId: message.aiMeta?.capabilityData?.organizationId ?? null,
                hasAccess: true,
              })}
              style={{
                marginTop: 8,
                border: `1px solid ${isDark ? 'rgba(167,139,250,0.55)' : 'rgba(124,58,237,0.35)'}`,
                background: isDark ? 'rgba(124,58,237,0.2)' : 'rgba(124,58,237,0.12)',
                color: aiAccent,
                borderRadius: 8,
                padding: '5px 9px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Open board
            </button>
          )}
          {canReviewPlan && (
            <button
              onClick={() => onOpenPlanReview?.(message.aiMeta?.capabilityData?.planArtifactId as string)}
              style={{
                marginTop: 8,
                marginLeft: 8,
                border: `1px solid ${isDark ? 'rgba(148,163,184,0.45)' : 'rgba(100,116,139,0.35)'}`,
                background: isDark ? 'rgba(71,85,105,0.2)' : 'rgba(148,163,184,0.12)',
                color: isDark ? '#e2e8f0' : '#334155',
                borderRadius: 8,
                padding: '5px 9px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Review plan
            </button>
          )}
          <span style={{ fontSize: 10, color: aiMuted, display: 'block', textAlign: 'left', marginTop: 4 }}>
            {formatTime(message.createdAt)}
          </span>
        </div>
        <style>{`
          @keyframes msg-in { 0% { opacity: .2; transform: translateY(6px) scale(.985); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
          @keyframes ai-typing-dot { 0%, 80%, 100% { transform: translateY(0); opacity: 0.35; } 40% { transform: translateY(-3px); opacity: 1; } }
          .ai-typing-dot {
            width: 5px;
            height: 5px;
            border-radius: 999px;
            background: ${aiAccent};
            display: inline-block;
            animation: ai-typing-dot 1s infinite ease-in-out;
          }
          .ai-typing-dot:nth-child(2) { animation-delay: 0.12s; }
          .ai-typing-dot:nth-child(3) { animation-delay: 0.24s; }
        `}</style>
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
