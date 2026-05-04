'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { UsersRound, User, Send, ChevronLeft, Loader2, X, Contrast, Paperclip, Smile, Bot, PanelRightOpen, PanelRightClose, Plus, Pencil, Trash2 } from 'lucide-react'
import EmojiPicker, { Theme, type EmojiClickData } from 'emoji-picker-react'
import { useMessagingStore, type Message, type Conversation, type MessageBoardTag } from '@/store/messagingStore'
import { useDelegationStore } from '@/store/delegationStore'
import { useThemeStore } from '@/store/themeStore'
import { messagingSocket } from '@/lib/messaging-socket'
import { usePresenceStore } from '@/store/presenceStore'
import MessageBubble from './MessageBubble'
import AssignedTasksPanel from './AssignedTasksPanel'
import GroupDetailsModal from './GroupDetailsModal'
import AiPlanReviewModal from './AiPlanReviewModal'

const CHAT_BG_URL = 'https://res.cloudinary.com/dhmnkd7hi/image/upload/v1777600366/bordsbgchatimg2_hqr0aa.png'
const BORDS_LOGO_SRC = '/bordlogo.png'

const CHAT_COMMANDS = [
  {
    name: '/ai',
    description: 'Ask Bords AI anything',
    dmExample: '/ai summarize this conversation',
    groupExample: '/ai summarize this conversation',
  },
  {
    name: '/assigntask',
    description: 'Assign a task from chat',
    dmExample: '/assigntask Follow up on the API docs',
    groupExample: '/assigntask @alex Follow up on the API docs',
  },
] as const

const AI_CHAT_COMMANDS = [
  {
    name: '/plan',
    description: 'Draft a structured plan for review and approval',
    dmExample: '/plan Launch onboarding revamp for enterprise users',
    groupExample: '/plan Reduce support ticket volume by 30%',
  },
  {
    name: '/create-board',
    description: 'Create a new board in your current context',
    dmExample: '/create-board Q3 Roadmap',
    groupExample: '/create-board Q3 Roadmap',
  },
  {
    name: '/board-details',
    description: 'Get details for a board by name or UUID',
    dmExample: '/board-details Growth Roadmap',
    groupExample: '/board-details 550e8400-e29b-41d4-a716-446655440000',
  },
] as const

type MentionContext = {
  start: number
  end: number
  query: string
}

type BoardTagOption = {
  boardId: string
  title: string
  organizationId: string | null
  handle: string
  accessibility: {
    scope: 'everyone' | 'some_members' | 'only_you'
    accessibleCount: number
    totalMembers: number
  }
}

function getMentionContext(value: string, caret: number): MentionContext | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length))
  const prefix = value.slice(0, safeCaret)
  const atIndex = prefix.lastIndexOf('@')
  if (atIndex === -1) return null

  const beforeAt = atIndex > 0 ? prefix[atIndex - 1] : ' '
  if (!/\s|[([{"'.,!?;:]/.test(beforeAt)) return null

  const query = prefix.slice(atIndex + 1)
  if (/\s/.test(query)) return null

  return {
    start: atIndex,
    end: safeCaret,
    query,
  }
}

function getHashTagContext(value: string, caret: number): MentionContext | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length))
  const prefix = value.slice(0, safeCaret)
  const hashIndex = prefix.lastIndexOf('#')
  if (hashIndex === -1) return null

  const beforeHash = hashIndex > 0 ? prefix[hashIndex - 1] : ' '
  if (!/\s|[([{"'.,!?;:]/.test(beforeHash)) return null

  const query = prefix.slice(hashIndex + 1)
  if (/\s/.test(query)) return null
  if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(query)) return null

  return {
    start: hashIndex,
    end: safeCaret,
    query,
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface Props {
  conversation: Conversation
  currentUserId: string
  orgId?: string
  canViewAssignedTasksPanel?: boolean
  organizationMembers?: Array<{
    userId: string
    profile: { firstName: string; lastName: string; image: string | null; email: string } | null
  }>
  onConversationUpdated?: () => void
  onBack?: () => void  // mobile: go back to list
}

export default function ConversationView({
  conversation,
  currentUserId,
  orgId,
  canViewAssignedTasksPanel = false,
  organizationMembers = [],
  onConversationUpdated,
  onBack,
}: Props) {
  const isDark = useThemeStore((s) => s.isDark)
  const chatWallpaperIntensity = useThemeStore((s) => s.chatWallpaperIntensity)
  const setChatWallpaperIntensity = useThemeStore((s) => s.setChatWallpaperIntensity)
  const {
    conversations,
    messages,
    loadingMessages,
    fetchConversations,
    fetchMessages,
    sendMessage,
    toggleReaction,
    insertLocalAiMessage,
    updateLocalMessage,
    replaceLocalMessage,
    removeLocalMessage,
    setActiveConversation,
    leaveConversation,
  } = useMessagingStore()
  const [input, setInput] = useState('')
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [showComposerEmoji, setShowComposerEmoji] = useState(false)
  const [showCommandMenu, setShowCommandMenu] = useState(false)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const [selectedBoardTagIndex, setSelectedBoardTagIndex] = useState(0)
  const [composerCaret, setComposerCaret] = useState(0)
  const [boardTagOptions, setBoardTagOptions] = useState<BoardTagOption[]>([])
  const [isLoadingBoardTagOptions, setIsLoadingBoardTagOptions] = useState(false)
  const [selectedBoardTags, setSelectedBoardTags] = useState<MessageBoardTag[]>([])
  const [canGrantBoardAccess, setCanGrantBoardAccess] = useState(false)
  const [grantBoardAccessOnSend, setGrantBoardAccessOnSend] = useState(false)
  const [showAssignedTasksPanel, setShowAssignedTasksPanel] = useState(false)
  const [showGroupDetails, setShowGroupDetails] = useState(false)
  const [commandFeedback, setCommandFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isAiThinking, setIsAiThinking] = useState(false)
  const [activePlanReviewId, setActivePlanReviewId] = useState<string | null>(null)
  const [isBuildingBoard, setIsBuildingBoard] = useState(false)
  const [showAiSessions, setShowAiSessions] = useState(false)
  const [isCreatingAiSession, setIsCreatingAiSession] = useState(false)
  const [unreadDividerMessageId, setUnreadDividerMessageId] = useState<string | null>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)
  const smileButtonRef = useRef<HTMLButtonElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const wasNearBottomRef = useRef(true)
  const prevMessageCountRef = useRef(0)
  const initialUnreadCountRef = useRef(0)
  const paginationAnchorRef = useRef<{ top: number; height: number } | null>(null)
  const convMessages = messages[conversation.id] ?? []
  const isLoadingMessages = loadingMessages[conversation.id] ?? false

  useEffect(() => {
    initialUnreadCountRef.current = Math.max(0, conversation.unreadCount ?? 0)
    setUnreadDividerMessageId(null)
  }, [conversation.id])

  useEffect(() => {
    if (unreadDividerMessageId || convMessages.length === 0) return
    const unreadCount = initialUnreadCountRef.current
    if (unreadCount <= 0) return

    const firstUnreadIndex = convMessages.length - unreadCount
    if (firstUnreadIndex < 0 || firstUnreadIndex >= convMessages.length) return

    setUnreadDividerMessageId(convMessages[firstUnreadIndex]?.id ?? null)
  }, [convMessages, unreadDividerMessageId])

  useEffect(() => {
    if (!commandFeedback) return
    // Don't auto-dismiss while building a board — it clears itself on completion/error
    if (isBuildingBoard) return
    const t = setTimeout(() => setCommandFeedback(null), 4000)
    return () => clearTimeout(t)
  }, [commandFeedback, isBuildingBoard])

  useEffect(() => {
    if (!showComposerEmoji) return
    const handler = (e: MouseEvent) => {
      if (
        emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node) &&
        smileButtonRef.current && !smileButtonRef.current.contains(e.target as Node)
      ) {
        setShowComposerEmoji(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showComposerEmoji])

  useEffect(() => {
    let cancelled = false
    const loadBoardTags = async () => {
      setIsLoadingBoardTagOptions(true)
      try {
        const res = await fetch(`/api/messages/conversations/${conversation.id}/board-tags`)
        if (!res.ok) {
          if (!cancelled) {
            setBoardTagOptions([])
            setCanGrantBoardAccess(false)
          }
          return
        }
        const data = await res.json().catch(() => ({ boards: [] }))
        if (!cancelled) {
          const boards = Array.isArray(data?.boards) ? data.boards : []
          setBoardTagOptions(boards)
          setCanGrantBoardAccess(!!data?.canGrantAccess)
        }
      } finally {
        if (!cancelled) setIsLoadingBoardTagOptions(false)
      }
    }

    loadBoardTags()
    return () => {
      cancelled = true
    }
  }, [conversation.id])

  // Current user's profile from conversation members (for optimistic send)
  const currentMember = conversation.members.find((m) => m.userId === currentUserId)
  const senderName = currentMember?.profile
    ? `${currentMember.profile.firstName} ${currentMember.profile.lastName}`.trim()
    : ''
  const senderImage = currentMember?.profile?.image ?? null

  async function handleBuildBoardFromPlan(planArtifactId: string) {
    if (isBuildingBoard) return
    setIsBuildingBoard(true)
    setCommandFeedback({ type: 'success', text: 'Building your board… this may take a moment.' })
    try {
      const res = await fetch(`/api/ai/plans/${planArtifactId}/materialize-board`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: isDark ? 'dark' : 'light' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.boardLocalId) {
        setCommandFeedback({ type: 'error', text: data?.error || 'Failed to build board from plan.' })
        return
      }
      // Fetch latest messages immediately so the confirmation with "Open board"
      // appears without requiring a full page reload.
      await fetchMessages(conversation.id)
      // Refresh delegation store so the new server-created board is known locally.
      void useDelegationStore.getState().fetchBords()
      setCommandFeedback(null)
    } catch {
      setCommandFeedback({ type: 'error', text: 'Failed to build board from plan.' })
    } finally {
      setIsBuildingBoard(false)
    }
  }

  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const bg = isDark ? '#09090b' : 'white'
  const headerBg = isDark ? '#18181b' : '#f9fafb'
  const text = isDark ? '#e4e4e7' : '#18181b'
  const muted = isDark ? '#71717a' : '#9ca3af'
  const intensityRatio = chatWallpaperIntensity / 100
  const chatOverlay = isDark
    ? `linear-gradient(rgba(10,12,16,${0.45 + intensityRatio * 0.45}), rgba(10,12,16,${0.45 + intensityRatio * 0.45}))`
    : `linear-gradient(rgba(255,255,255,${0.38 + intensityRatio * 0.45}), rgba(255,255,255,${0.38 + intensityRatio * 0.45}))`

  const conversationContext: 'org' | 'personal' = conversation.organizationId ? 'org' : 'personal'
  const aiSessions = conversations
    .filter((c) => c.isAiConversation)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  const formatShortTime = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return 'now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
    if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  async function refreshConversationList() {
    // Pass silent=true so the full skeleton shimmer doesn't flash during background refreshes
    await fetchConversations(conversationContext, conversation.organizationId ?? undefined, true)
    onConversationUpdated?.()
  }

  async function handleCreateAiSession() {
    if (isCreatingAiSession) return
    setIsCreatingAiSession(true)
    try {
      const res = await fetch('/api/ai/conversation/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: conversation.organizationId ?? null }),
      })
      if (!res.ok) return
      const created = await res.json().catch(() => null)
      await refreshConversationList()
      if (created?.id) setActiveConversation(created.id)
    } finally {
      setIsCreatingAiSession(false)
    }
  }

  async function handleRenameAiSession(sessionId: string, currentName: string) {
    const next = window.prompt('Rename AI chat', currentName)
    if (!next || !next.trim()) return
    await fetch(`/api/messages/conversations/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next.trim() }),
    })
    await refreshConversationList()
  }

  async function handleDeleteAiSession(sessionId: string) {
    if (!window.confirm('Delete this AI chat session?')) return
    await leaveConversation(sessionId)
    await refreshConversationList()
  }

  // Initial load
  useEffect(() => {
    fetchMessages(conversation.id)
  }, [conversation.id])

  useEffect(() => {
    setShowAiSessions(false)
  }, [conversation.id])

  useEffect(() => {
    setSelectedBoardTags([])
    setSelectedBoardTagIndex(0)
    setGrantBoardAccessOnSend(false)
  }, [conversation.id])

  // Per-conversation WebSocket subscription via collab server.
  // Subscribe on mount, unsubscribe on unmount or conversation change.
  useEffect(() => {
    if (!currentUserId) return

    messagingSocket.subscribeToConversation(conversation.id)

    const off = messagingSocket.on((event) => {
      if (event.type === 'new_message') {
        const raw = event.payload as any
        if (raw.conversation_id !== conversation.id) return
        const member = conversation.members.find((m) => m.userId === raw.sender_id)
        const p = member?.profile
        const newMsg: Message = {
          id: raw.id,
          conversationId: conversation.id,
          senderId: raw.sender_id,
          senderName: p ? `${p.firstName} ${p.lastName}`.trim() : '',
          senderImage: p?.image ?? null,
          content: raw.is_deleted ? null : raw.content,
          isDeleted: raw.is_deleted ?? false,
          isSystemMessage: raw.is_system_message ?? false,
          isAiMessage: raw.is_ai_message ?? false,
          aiMeta: raw.is_ai_message ? (raw.metadata ?? null) : null,
          boardTags: Array.isArray(raw.board_tags)
            ? raw.board_tags
                .filter((t: any) => typeof t?.board_id === 'string')
                .map((t: any) => ({
                  boardId: t.board_id,
                  title: t.title ?? 'Untitled board',
                  organizationId: t.organization_id ?? null,
                  hasAccess: raw.sender_id === currentUserId ? true : undefined,
                }))
            : [],
          replyToId: raw.reply_to_id ?? null,
          editedAt: raw.edited_at ?? null,
          createdAt: raw.created_at,
          attachments: [],
          reactions: [],
        }
        useMessagingStore.getState().appendRealtimeMessage(newMsg)
      } else if (event.type === 'update_message') {
        useMessagingStore.getState().updateRealtimeMessage(event.payload as any)
      }
    })

    return () => {
      off()
      messagingSocket.unsubscribeFromConversation(conversation.id)
    }
  }, [conversation.id, currentUserId])

  // Auto-follow only when user is already near bottom (Telegram/WhatsApp behavior)
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const prevCount = prevMessageCountRef.current
    const isNewMessage = convMessages.length > prevCount
    prevMessageCountRef.current = convMessages.length

    if (!isNewMessage) return
    if (wasNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [convMessages.length])

  // Load more (pagination) on scroll to top
  const handleScroll = useCallback(async () => {
    if (!listRef.current) return
    const list = listRef.current
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight
    wasNearBottomRef.current = distanceFromBottom < 120

    if (list.scrollTop > 80 || loadingMore) return
    const oldest = convMessages[0]
    if (!oldest) return

    const prevHeight = list.scrollHeight
    const prevTop = list.scrollTop
    paginationAnchorRef.current = { top: prevTop, height: prevHeight }
    setLoadingMore(true)
    await fetchMessages(conversation.id, oldest.createdAt)
    requestAnimationFrame(() => {
      const next = listRef.current
      if (!next) return
      const anchor = paginationAnchorRef.current
      if (!anchor) return

      // If user moved away while fetch was in flight, do not force-scroll.
      if (Math.abs(next.scrollTop - anchor.top) > 40) {
        paginationAnchorRef.current = null
        return
      }

      const added = next.scrollHeight - anchor.height
      next.scrollTop = anchor.top + added
      paginationAnchorRef.current = null
    })
    setLoadingMore(false)
  }, [conversation.id, convMessages, loadingMore, fetchMessages])

  const handleSend = async () => {
    const content = input.trim()
    if (!content) return

    // ── AI invocation: /ai <prompt> or @bords <prompt> ──────────────────────
    const isAiSlash = content.toLowerCase().startsWith('/ai ')
    const isAiBordsAt = /^@bords\s+/i.test(content)
    if (!conversation.isAiConversation && (isAiSlash || isAiBordsAt)) {
      const prompt = isAiSlash
        ? content.slice('/ai '.length).trim()
        : content.replace(/^@bords\s+/i, '').trim()

      if (!prompt) {
        setCommandFeedback({ type: 'error', text: 'Tell Bords AI what you need. Example: /ai summarize this conversation' })
        return
      }

      setInput('')
      setReplyTo(null)
      setIsAiThinking(true)

      // Build conversation history context (last 12 messages, excluding AI messages)
      const historyMessages = (messages[conversation.id] ?? [])
        .filter((m) => !m.isAiMessage && !m.isDeleted && m.content)
        .slice(-12)
        .map((m) => ({ role: 'user' as const, content: `${m.senderName}: ${m.content}` }))

      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task: 'chat',
            messages: [
              {
                role: 'system',
                content: [
                  'You are Bords AI, a helpful assistant embedded in the Bords collaboration platform.',
                  'You help teams with tasks, boards, summaries, and productivity.',
                  'Keep answers concise and actionable.',
                  historyMessages.length > 0
                    ? 'Here is recent conversation context:'
                    : '',
                  ...historyMessages.map((h) => h.content),
                  'Now answer the user request below.',
                ].filter(Boolean).join('\n'),
              },
              { role: 'user', content: prompt },
            ],
            maxTokens: 600,
            temperature: 0.3,
          }),
        })

        const data = await res.json().catch(() => ({}))

        if (!res.ok || !data?.text) {
          setCommandFeedback({ type: 'error', text: data?.error || 'Bords AI is unavailable right now' })
          return
        }

        insertLocalAiMessage(conversation.id, {
          id: `ai-${Date.now()}`,
          conversationId: conversation.id,
          senderId: 'bords-ai',
          senderName: 'Bords AI',
          senderImage: null,
          content: data.text,
          isDeleted: false,
          isSystemMessage: false,
          isAiMessage: true,
          aiMeta: data.meta ?? null,
          boardTags: [],
          replyToId: null,
          editedAt: null,
          createdAt: new Date().toISOString(),
          attachments: [],
          reactions: [],
        })
      } catch {
        setCommandFeedback({ type: 'error', text: 'Bords AI is unavailable right now' })
      } finally {
        setIsAiThinking(false)
      }
      return
    }

    // Slash command: /assigntask
    if (!conversation.isAiConversation && content.toLowerCase().startsWith('/assigntask')) {
      const rest = content.slice('/assigntask'.length).trim()
      if (!rest) {
        setCommandFeedback({
          type: 'error',
          text: conversation.type === 'group'
            ? 'Use: /assigntask @member task details'
            : 'Use: /assigntask task details',
        })
        return
      }

      const others = conversation.members.filter((m) => m.userId !== currentUserId)
      let assigneeId = ''
      let taskContent = rest
      let assigneeName = ''

      if (conversation.type === 'dm') {
        const other = others[0]
        if (!other) {
          setCommandFeedback({ type: 'error', text: 'Could not resolve DM recipient' })
          return
        }
        assigneeId = other.userId
        assigneeName = other.profile
          ? `${other.profile.firstName} ${other.profile.lastName}`.trim() || other.profile.email
          : other.userId
      } else {
        const mentionMatch = rest.match(/^@([^\s]+)\s+([\s\S]+)$/)
        if (!mentionMatch) {
          setCommandFeedback({ type: 'error', text: 'Use: /assigntask @member task details' })
          return
        }

        const mention = mentionMatch[1]
        taskContent = mentionMatch[2].trim()
        const query = mention.toLowerCase().replace(/[^a-z0-9]/g, '')

        const matches = others.filter((m) => {
          const first = (m.profile?.firstName ?? '').toLowerCase()
          const last = (m.profile?.lastName ?? '').toLowerCase()
          const email = (m.profile?.email ?? '').toLowerCase()
          const emailLocal = email.split('@')[0] ?? ''
          const full = `${first}${last}`
          const userIdShort = m.userId.toLowerCase()
          const keys = [
            first,
            last,
            `${first}.${last}`,
            `${first}_${last}`,
            full,
            emailLocal,
          ].map((k) => k.replace(/[^a-z0-9]/g, ''))
          return keys.includes(query) || userIdShort.startsWith(query)
        })

        if (matches.length === 0) {
          setCommandFeedback({ type: 'error', text: `No group member matches @${mention}` })
          return
        }
        if (matches.length > 1) {
          setCommandFeedback({ type: 'error', text: `@${mention} matches multiple members, be more specific` })
          return
        }

        const target = matches[0]
        assigneeId = target.userId
        assigneeName = target.profile
          ? `${target.profile.firstName} ${target.profile.lastName}`.trim() || target.profile.email
          : target.userId
      }

      if (!taskContent) {
        setCommandFeedback({ type: 'error', text: 'Task details are required' })
        return
      }

      const res = await fetch(`/api/messages/conversations/${conversation.id}/assign-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedTo: assigneeId, content: taskContent }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setCommandFeedback({ type: 'error', text: err.error || 'Failed to assign task' })
        return
      }

      setInput('')
      setReplyTo(null)
      setSelectedBoardTags([])
      setCommandFeedback({ type: 'success', text: `Task assigned to ${assigneeName}` })
      return
    }

    const outgoingBoardTags = selectedBoardTags.filter((tag) => {
      const handle = boardHandleById.get(tag.boardId)
      if (!handle) return false
      const pattern = new RegExp(`(^|\\s)#${escapeRegExp(handle)}(?=\\s|$|[.,!?;:])`, 'i')
      return pattern.test(content)
    })
    const shouldGrant = grantBoardAccessOnSend && canGrantBoardAccess && outgoingBoardTags.length > 0

    // ── AI conversation: route directly to AI respond endpoint ────────────────
    if (conversation.isAiConversation) {
      setInput('')
      setReplyTo(null)
      setSelectedBoardTags([])
      setIsAiThinking(true)

      // Persist the user's message first via the normal messages endpoint
      await sendMessage(conversation.id, content, replyTo?.id, {
        id: currentUserId,
        name: senderName,
        image: senderImage,
      }, { boardTags: [] })

      const tempAiId = `ai-temp-${Date.now()}`
      insertLocalAiMessage(conversation.id, {
        id: tempAiId,
        conversationId: conversation.id,
        senderId: '00000000-0000-0000-0000-000000000001',
        senderName: 'Bords AI',
        senderImage: null,
        content: '',
        isDeleted: false,
        isSystemMessage: false,
        isAiMessage: true,
        boardTags: [],
        replyToId: null,
        editedAt: null,
        createdAt: new Date().toISOString(),
        attachments: [],
        reactions: [],
      })

      try {
        const res = await fetch(`/api/ai/conversation/${conversation.id}/respond`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream, application/json',
          },
          body: JSON.stringify({
            userMessage: content,
            orgId: conversation.organizationId ?? null,
            // Send IDs of boards the user has explicitly tagged in this message
            taggedBoardIds: selectedBoardTags.map((t) => t.boardId),
            stream: true,
          }),
        })

        const contentType = res.headers.get('content-type') || ''

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          removeLocalMessage(conversation.id, tempAiId)
          setCommandFeedback({ type: 'error', text: err?.error || 'Bords AI is unavailable right now' })
          return
        }

        if (!contentType.includes('text/event-stream')) {
          const data = await res.json().catch(() => ({}))
          if (!data?.content) {
            removeLocalMessage(conversation.id, tempAiId)
            setCommandFeedback({ type: 'error', text: data?.error || 'Bords AI is unavailable right now' })
            return
          }

          replaceLocalMessage(conversation.id, tempAiId, {
            id: data.id ?? tempAiId,
            conversationId: conversation.id,
            senderId: '00000000-0000-0000-0000-000000000001',
            senderName: 'Bords AI',
            senderImage: null,
            content: data.content,
            isDeleted: false,
            isSystemMessage: false,
            isAiMessage: true,
            aiMeta: data.aiMeta ?? undefined,
            boardTags: [],
            replyToId: null,
            editedAt: null,
            createdAt: data.createdAt ?? new Date().toISOString(),
            attachments: [],
            reactions: [],
          })
          return
        }

        const reader = res.body?.getReader()
        if (!reader) {
          removeLocalMessage(conversation.id, tempAiId)
          setCommandFeedback({ type: 'error', text: 'Bords AI stream was unavailable' })
          return
        }

        const decoder = new TextDecoder()
        let buffer = ''
        let streamedContent = ''

        const handleEventBlock = (block: string) => {
          const lines = block.split('\n')
          let event = 'message'
          const dataLines: string[] = []

          for (const line of lines) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
          }

          if (dataLines.length === 0) return
          const payload = JSON.parse(dataLines.join('\n')) as any

          if (event === 'chunk') {
            const delta = typeof payload?.delta === 'string' ? payload.delta : ''
            if (!delta) return
            streamedContent += delta
            updateLocalMessage(conversation.id, tempAiId, { content: streamedContent })
            return
          }

          if (event === 'done') {
            replaceLocalMessage(conversation.id, tempAiId, {
              id: payload.id ?? tempAiId,
              conversationId: conversation.id,
              senderId: '00000000-0000-0000-0000-000000000001',
              senderName: 'Bords AI',
              senderImage: null,
              content: payload.content ?? streamedContent,
              isDeleted: false,
              isSystemMessage: false,
              isAiMessage: true,
              aiMeta: payload.aiMeta ?? undefined,
              boardTags: [],
              replyToId: null,
              editedAt: null,
              createdAt: payload.createdAt ?? new Date().toISOString(),
              attachments: [],
              reactions: [],
            })
            return
          }

          if (event === 'error') {
            throw new Error(payload?.error || 'Bords AI is unavailable right now')
          }
        }

        while (true) {
          const { done, value } = await reader.read()
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

          let splitIndex = buffer.indexOf('\n\n')
          while (splitIndex !== -1) {
            const block = buffer.slice(0, splitIndex)
            buffer = buffer.slice(splitIndex + 2)
            if (block.trim()) handleEventBlock(block)
            splitIndex = buffer.indexOf('\n\n')
          }

          if (done) break
        }

        if (buffer.trim()) handleEventBlock(buffer)
      } catch {
        removeLocalMessage(conversation.id, tempAiId)
        setCommandFeedback({ type: 'error', text: 'Bords AI is unavailable right now' })
      } finally {
        setIsAiThinking(false)
      }
      return
    }

    setInput('')
    setReplyTo(null)
    setSelectedBoardTags([])
    setGrantBoardAccessOnSend(false)
    const sent = await sendMessage(conversation.id, content, replyTo?.id, {
      id: currentUserId,
      name: senderName,
      image: senderImage,
    }, {
      boardTags: outgoingBoardTags,
    })

    if (sent && shouldGrant) {
      const boardIds = outgoingBoardTags.map((tag) => tag.boardId)
      const grantRes = await fetch(`/api/messages/conversations/${conversation.id}/board-tags/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardIds }),
      })
      if (!grantRes.ok) {
        const err = await grantRes.json().catch(() => ({}))
        setCommandFeedback({ type: 'error', text: err.error || 'Message sent, but granting board access failed' })
      } else {
        const grantData = await grantRes.json().catch(() => ({ grants: [] }))
        const grants = Array.isArray(grantData?.grants) ? grantData.grants : []
        const totalGranted = grants.reduce((sum: number, g: any) => sum + (typeof g?.grantedCount === 'number' ? g.grantedCount : 0), 0)
        const touchedBoards = grants.filter((g: any) => (g?.grantedCount ?? 0) > 0).length

        if (totalGranted > 0) {
          setCommandFeedback({
            type: 'success',
            text: `Access granted to ${totalGranted} member${totalGranted !== 1 ? 's' : ''} across ${touchedBoards} board${touchedBoards !== 1 ? 's' : ''}`,
          })
        } else {
          setCommandFeedback({
            type: 'success',
            text: 'No additional board access changes were needed',
          })
        }
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showBoardTagMenu) {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedBoardTagIndex((i) => (i - 1 + boardTagSuggestions.length) % boardTagSuggestions.length)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedBoardTagIndex((i) => (i + 1) % boardTagSuggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const target = boardTagSuggestions[selectedBoardTagIndex]
        if (target) applyBoardTag(target)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setComposerCaret(-1)
        return
      }
    }

    if (showMentionMenu) {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedMentionIndex((i) => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedMentionIndex((i) => (i + 1) % mentionSuggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const target = mentionSuggestions[selectedMentionIndex]
        if (target) applyMention(target)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setComposerCaret(-1)
        return
      }
    }

    // Command menu keyboard navigation
    if (showCommandMenu && matchingCommands.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedCommandIndex((i) => (i - 1 + matchingCommands.length) % matchingCommands.length)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedCommandIndex((i) => (i + 1) % matchingCommands.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const cmd = matchingCommands[selectedCommandIndex]
        if (cmd) {
          applyCommandTemplate(cmd.name)
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowCommandMenu(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleReact = (messageId: string, emoji: string) => {
    toggleReaction(conversation.id, messageId, emoji)
  }

  const addComposerEmoji = (emojiData: EmojiClickData) => {
    setInput((prev) => `${prev}${emojiData.emoji}`)
    setShowComposerEmoji(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  // Keep textarea height in sync with value changes, including programmatic clears
  // after sending a message.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(Math.max(el.scrollHeight, 26), 132)
    el.style.height = `${next}px`
  }, [input])

  // Group messages by date
  const grouped: { date: string; messages: Message[] }[] = []
  for (const m of convMessages) {
    const dateKey = new Date(m.createdAt).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
    const last = grouped[grouped.length - 1]
    if (last?.date === dateKey) last.messages.push(m)
    else grouped.push({ date: dateKey, messages: [m] })
  }

  const isGroup = conversation.type === 'group'
  const memberCount = conversation.members.length
  const dmOtherMemberUserId = !isGroup
    ? conversation.members.find((m) => m.userId !== currentUserId)?.userId
    : undefined

  const trimmedStartInput = input.trimStart()
  const isSlashMode = trimmedStartInput.startsWith('/')
  const firstToken = isSlashMode ? trimmedStartInput.split(/\s+/)[0].toLowerCase() : ''
  const activeCommandSet = conversation.isAiConversation ? AI_CHAT_COMMANDS : CHAT_COMMANDS
  const matchingCommands = isSlashMode
    ? activeCommandSet.filter((cmd) => cmd.name.startsWith(firstToken || '/'))
    : []

  const isValidAssignTaskCommand = (() => {
    if (conversation.isAiConversation) return false
    if (!trimmedStartInput.toLowerCase().startsWith('/assigntask')) return false
    const rest = trimmedStartInput.slice('/assigntask'.length).trim()
    if (!rest) return false
    if (!isGroup) return true
    return /^@([^\s]+)\s+([\s\S]+)$/.test(rest)
  })()

  const mentionableMembers = isGroup
    ? conversation.members.filter((m) => m.userId !== currentUserId)
    : []
  const mentionContext = getMentionContext(input, composerCaret)
  const mentionSuggestions = mentionContext
    ? mentionableMembers.filter((m) => {
        const first = (m.profile?.firstName ?? '').toLowerCase()
        const last = (m.profile?.lastName ?? '').toLowerCase()
        const email = (m.profile?.email ?? '').toLowerCase()
        const emailLocal = email.split('@')[0] ?? ''
        const full = `${first} ${last}`.trim()
        const query = mentionContext.query.toLowerCase()
        if (!query) return true
        return (
          first.includes(query)
          || last.includes(query)
          || full.includes(query)
          || emailLocal.includes(query)
          || email.includes(query)
        )
      })
    : []
  const showMentionMenu = isGroup && !!mentionContext && mentionSuggestions.length > 0

  const hashTagContext = getHashTagContext(input, composerCaret)
  const boardTagSuggestions = hashTagContext
    ? boardTagOptions.filter((b) => {
        const query = hashTagContext.query.toLowerCase()
        if (!query) return true
        return b.title.toLowerCase().includes(query) || b.handle.includes(query)
      })
    : []
  const showBoardTagMenu = !!hashTagContext && boardTagSuggestions.length > 0
  const showBoardTagLoading = !!hashTagContext && isLoadingBoardTagOptions && boardTagSuggestions.length === 0
  const boardHandleById = new Map(boardTagOptions.map((b) => [b.boardId, b.handle]))
  const boardOptionById = new Map(boardTagOptions.map((b) => [b.boardId, b]))
  const hasSelectedRestrictedBoardTags = selectedBoardTags.some((tag) => {
    const option = boardOptionById.get(tag.boardId)
    return option ? option.accessibility.scope !== 'everyone' : false
  })
  const showGrantAccessToggle = canGrantBoardAccess && hasSelectedRestrictedBoardTags

  // Presence — subscribe to the Set so re-renders fire when it changes
  const onlineUsers = usePresenceStore((s) => s.onlineUsers)
  const otherMember = !isGroup ? conversation.members.find((m) => m.userId !== currentUserId) : null
  const otherIsOnline = otherMember ? onlineUsers.has(otherMember.userId) : false
  const onlineMemberCount = isGroup
    ? conversation.members.filter((m) => m.userId !== currentUserId && onlineUsers.has(m.userId)).length
    : 0
  const headerAvatar = isGroup ? (conversation.avatarUrl ?? null) : (otherMember?.profile?.image ?? null)
  const headerInitials = otherMember?.profile
    ? `${(otherMember.profile.firstName ?? '').slice(0, 1)}${(otherMember.profile.lastName ?? '').slice(0, 1)}`.toUpperCase()
    : 'DM'

  const cycleWallpaperIntensity = () => {
    const presets = [42, 60, 78]
    const idx = presets.findIndex((p) => p >= chatWallpaperIntensity)
    const next = idx === -1 || idx === presets.length - 1 ? presets[0] : presets[idx + 1]
    setChatWallpaperIntensity(next)
  }

  const applyCommandTemplate = (commandName: string) => {
    if (commandName === '/ai') {
      setInput('/ai ')
      setShowCommandMenu(false)
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
    if (commandName === '/assigntask') {
      const template = isGroup ? '/assigntask @member ' : '/assigntask '
      setInput(template)
      setShowCommandMenu(false)
      requestAnimationFrame(() => textareaRef.current?.focus())
      return
    }
    if (commandName === '/create-board') {
      setInput('/create-board ')
      setShowCommandMenu(false)
      requestAnimationFrame(() => textareaRef.current?.focus())
      return
    }
    if (commandName === '/board-details') {
      setInput('/board-details ')
      setShowCommandMenu(false)
      requestAnimationFrame(() => textareaRef.current?.focus())
      return
    }
    if (commandName === '/plan') {
      setInput('/plan ')
      setShowCommandMenu(false)
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }

  useEffect(() => {
    if (!showMentionMenu) {
      setSelectedMentionIndex(0)
      return
    }
    setSelectedMentionIndex((i) => Math.min(i, mentionSuggestions.length - 1))
  }, [showMentionMenu, mentionSuggestions.length])

  useEffect(() => {
    if (!showBoardTagMenu) {
      setSelectedBoardTagIndex(0)
      return
    }
    setSelectedBoardTagIndex((i) => Math.min(i, boardTagSuggestions.length - 1))
  }, [showBoardTagMenu, boardTagSuggestions.length])

  const applyMention = (member: Conversation['members'][number]) => {
    const ctx = mentionContext
    const textarea = textareaRef.current
    if (!ctx || !textarea) return

    const first = member.profile?.firstName?.trim() ?? ''
    const last = member.profile?.lastName?.trim() ?? ''
    const emailLocal = member.profile?.email?.split('@')[0] ?? ''
    const fallback = member.userId
    const mentionName = (first || last)
      ? `${first}${last ? `.${last}` : ''}`
      : (emailLocal || fallback)

    const replacement = `@${mentionName} `
    const next = `${input.slice(0, ctx.start)}${replacement}${input.slice(ctx.end)}`
    const nextCaret = ctx.start + replacement.length

    setInput(next)
    setComposerCaret(nextCaret)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const applyBoardTag = (board: BoardTagOption) => {
    const ctx = hashTagContext
    const textarea = textareaRef.current
    if (!ctx || !textarea) return

    const replacement = `#${board.handle} `
    const next = `${input.slice(0, ctx.start)}${replacement}${input.slice(ctx.end)}`
    const nextCaret = ctx.start + replacement.length

    setInput(next)
    setComposerCaret(nextCaret)
    setSelectedBoardTags((prev) => {
      const exists = prev.some((t) => t.boardId === board.boardId)
      if (exists) return prev
      return [
        ...prev,
        {
          boardId: board.boardId,
          title: board.title,
          organizationId: board.organizationId,
          hasAccess: true,
        },
      ]
    })
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const handleInputChange = (value: string, caret?: number) => {
    const wasSlashMode = input.trimStart().startsWith('/')
    const isNowSlashMode = value.trimStart().startsWith('/')
    setInput(value)
    setComposerCaret(caret ?? value.length)
    setSelectedBoardTags((prev) => {
      const kept = prev.filter((tag) => {
        const handle = boardHandleById.get(tag.boardId)
        if (!handle) return false
        const pattern = new RegExp(`(^|\\s)#${escapeRegExp(handle)}(?=\\s|$|[.,!?;:])`, 'i')
        return pattern.test(value)
      })
      return kept.length === prev.length ? prev : kept
    })

    if (isNowSlashMode && !wasSlashMode) {
      setShowCommandMenu(true)
      setSelectedCommandIndex(0)
    }
    if (!isNowSlashMode) setShowCommandMenu(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bg, position: 'relative', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: `1px solid ${border}`,
        background: isDark ? 'rgba(24,24,27,0.9)' : 'rgba(249,250,251,0.92)',
        backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        {onBack && (
          <button onClick={onBack} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, display: 'flex' }}>
            <ChevronLeft size={16} color={muted} />
          </button>
        )}
        {/* Avatar with online dot */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            width: 36, height: 36, borderRadius: isGroup ? 10 : '50%',
            background: isDark ? '#3f3f46' : '#e4e4e7',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
          }}>
            {headerAvatar ? (
              <img src={headerAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : conversation.isAiConversation ? (
              <img src={BORDS_LOGO_SRC} alt="Bords" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : isGroup ? (
              <UsersRound size={15} color="#8b5cf6" />
            ) : (
              <span style={{ fontSize: 12, fontWeight: 700, color: muted }}>{headerInitials || 'DM'}</span>
            )}
          </div>
          {!isGroup && otherIsOnline && (
            <div style={{
              position: 'absolute', bottom: 0, right: 0,
              width: 9, height: 9, borderRadius: '50%',
              background: '#22c55e', border: `2px solid ${headerBg}`,
            }} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button
            onClick={() => { if (isGroup) setShowGroupDetails(true) }}
            title={isGroup ? 'View group details' : undefined}
            style={{
              border: 'none',
              background: 'transparent',
              padding: 0,
              margin: 0,
              cursor: isGroup ? 'pointer' : 'default',
              color: text,
              fontSize: 15,
              fontWeight: 700,
              textAlign: 'left',
              maxWidth: '100%',
            }}
          >
            {conversation.isAiConversation ? (conversation.name?.trim() || 'New chat') : (conversation.name ?? 'Direct Message')}
          </button>
          <div style={{ fontSize: 11, color: muted, display: 'flex', alignItems: 'center', gap: 4 }}>
            {conversation.isAiConversation ? (
              <>Bords AI assistant</>
            ) : isGroup ? (
              onlineMemberCount > 0
                ? <><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />{onlineMemberCount} online · {memberCount} member{memberCount !== 1 ? 's' : ''}</>
                : `${memberCount} member${memberCount !== 1 ? 's' : ''}`
            ) : (
              otherIsOnline
                ? 'Online'
                : 'Offline'
            )}
          </div>
        </div>
        <button
          onClick={cycleWallpaperIntensity}
          title="Wallpaper intensity"
          style={{
            border: `1px solid ${border}`,
            background: isDark ? '#27272a' : '#ffffff',
            color: muted,
            borderRadius: 8,
            width: 30,
            height: 30,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Contrast size={13} />
        </button>
        {conversation.isAiConversation && (
          <button
            onClick={() => setShowAiSessions((v) => !v)}
            title={showAiSessions ? 'Hide AI sessions' : 'Show AI sessions'}
            style={{
              border: `1px solid ${border}`,
              background: isDark ? '#27272a' : '#ffffff',
              color: muted,
              borderRadius: 8,
              height: 30,
              padding: '0 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              cursor: 'pointer',
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            <span>Chats</span>
            {showAiSessions ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
          </button>
        )}
        {canViewAssignedTasksPanel && orgId && organizationMembers.length > 0 && (
          <button
            onClick={() => setShowAssignedTasksPanel(true)}
            title="View assigned tasks by member"
            style={{
              border: `1px solid ${border}`,
              background: isDark ? '#27272a' : '#ffffff',
              color: muted,
              borderRadius: 8,
              height: 30,
              padding: '0 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            Assigned Tasks
          </button>
        )}
      </div>

      {conversation.isAiConversation && (
        <>
          {showAiSessions && (
            <div
              onClick={() => setShowAiSessions(false)}
              style={{
                position: 'absolute',
                inset: 0,
                background: isDark ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.08)',
                zIndex: 39,
              }}
            />
          )}
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: 320,
            borderLeft: `1px solid ${border}`,
            background: isDark ? '#111113' : '#ffffff',
            zIndex: 40,
            transform: showAiSessions ? 'translateX(0)' : 'translateX(100%)',
            transition: 'transform 0.22s ease',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: '12px 12px 10px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: text }}>AI Sessions</div>
              <div style={{ fontSize: 11, color: muted }}>Start fresh or continue previous threads</div>
            </div>
            <button
              onClick={handleCreateAiSession}
              disabled={isCreatingAiSession}
              style={{
                border: `1px solid ${border}`,
                background: isDark ? '#27272a' : '#ffffff',
                color: muted,
                borderRadius: 8,
                width: 30,
                height: 30,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: isCreatingAiSession ? 'default' : 'pointer',
                opacity: isCreatingAiSession ? 0.6 : 1,
              }}
              title="Create new session"
            >
              {isCreatingAiSession ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {aiSessions.length === 0 ? (
              <div style={{ padding: 14, color: muted, fontSize: 12 }}>No sessions found.</div>
            ) : (
              aiSessions.map((session) => {
                const active = session.id === conversation.id
                return (
                  <div
                    key={session.id}
                    onClick={() => setActiveConversation(session.id)}
                    style={{
                      border: `1px solid ${active ? (isDark ? 'rgba(167,139,250,0.45)' : 'rgba(124,58,237,0.35)') : border}`,
                      background: active ? (isDark ? 'rgba(139,92,246,0.12)' : 'rgba(124,58,237,0.08)') : 'transparent',
                      borderRadius: 10,
                      padding: '9px 10px',
                      marginBottom: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: active ? (isDark ? '#c4b5fd' : '#6d28d9') : text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {session.name?.trim() || 'New chat'}
                      </div>
                      <div style={{ fontSize: 10, color: muted, flexShrink: 0 }}>{formatShortTime(session.updatedAt)}</div>
                    </div>
                    {session.lastMessage?.content && (
                      <div style={{ marginTop: 4, fontSize: 11, color: muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {session.lastMessage.content}
                      </div>
                    )}
                    <div style={{ marginTop: 7, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleRenameAiSession(session.id, session.name?.trim() || 'New chat')
                        }}
                        title="Rename session"
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          border: `1px solid ${border}`,
                          background: 'transparent',
                          color: muted,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleDeleteAiSession(session.id)
                        }}
                        title="Delete session"
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          border: `1px solid ${border}`,
                          background: 'transparent',
                          color: muted,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
        </>
      )}

      {/* Messages */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 0',
          backgroundImage: `${chatOverlay}, url(${CHAT_BG_URL})`,
          backgroundRepeat: 'repeat, repeat',
          backgroundSize: 'auto, 420px auto',
          backgroundPosition: 'center, center',
        }}
      >
        {loadingMore && (
          <div style={{ textAlign: 'center', padding: 8 }}>
            <Loader2 size={14} color={muted} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        )}
        {isLoadingMessages && convMessages.length === 0 && (
          <div style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[...Array(5)].map((_, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: i % 2 === 0 ? 'flex-start' : 'flex-end' }}>
                <div style={{
                  height: 36, borderRadius: 12,
                  width: `${120 + (i * 37) % 140}px`,
                  background: isDark ? '#27272a' : '#f3f4f6',
                  animation: 'pulse 1.5s ease-in-out infinite',
                  opacity: 0.7,
                }} />
              </div>
            ))}
            <style>{`@keyframes pulse { 0%,100%{opacity:.7} 50%{opacity:.4} }`}</style>
          </div>
        )}
        {!isLoadingMessages && convMessages.length === 0 && (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: muted, fontSize: 13 }}>
            No messages yet. Say hello 👋
          </div>
        )}
        {grouped.map(({ date, messages: dayMsgs }) => (
          <div key={date}>
            {/* Date divider */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 10 }}>
              <div style={{ flex: 1, height: 1, background: border }} />
              <span style={{ fontSize: 11, color: muted, fontWeight: 500, whiteSpace: 'nowrap' }}>{date}</span>
              <div style={{ flex: 1, height: 1, background: border }} />
            </div>
            {dayMsgs.map((msg, idx) => {
              const prev = dayMsgs[idx - 1]
              const next = dayMsgs[idx + 1]
              const isMine = msg.senderId === currentUserId
              const groupedWithPrev = !!prev
                && prev.senderId === msg.senderId
                && (new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime()) < 5 * 60 * 1000
              const groupedWithNext = !!next
                && next.senderId === msg.senderId
                && (new Date(next.createdAt).getTime() - new Date(msg.createdAt).getTime()) < 5 * 60 * 1000
              const showSenderName = isGroup && !isMine && !groupedWithPrev
              const animateIn = idx === dayMsgs.length - 1 && (Date.now() - new Date(msg.createdAt).getTime()) < 10_000
              const showUnreadDivider = unreadDividerMessageId === msg.id

              return (
                <div key={msg.id}>
                  {showUnreadDivider && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 16px 8px',
                      }}
                    >
                      <div style={{ flex: 1, height: 1, background: isDark ? 'rgba(59,130,246,0.4)' : 'rgba(59,130,246,0.32)' }} />
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: '#2563eb',
                          background: isDark ? 'rgba(30,58,138,0.22)' : 'rgba(219,234,254,0.9)',
                          border: `1px solid ${isDark ? 'rgba(59,130,246,0.45)' : 'rgba(59,130,246,0.3)'}`,
                          borderRadius: 999,
                          padding: '2px 9px',
                          letterSpacing: '0.02em',
                          textTransform: 'uppercase',
                        }}
                      >
                        New messages
                      </span>
                      <div style={{ flex: 1, height: 1, background: isDark ? 'rgba(59,130,246,0.4)' : 'rgba(59,130,246,0.32)' }} />
                    </div>
                  )}
                  <MessageBubble
                    message={msg}
                    isMine={isMine}
                    currentUserId={currentUserId}
                    onReact={handleReact}
                    onReply={setReplyTo}
                    onOpenPlanReview={(planId) => setActivePlanReviewId(planId)}
                    onBuildBoardFromPlan={handleBuildBoardFromPlan}
                    isBuildingBoard={isBuildingBoard}
                    showSenderName={showSenderName}
                    groupedWithPrev={groupedWithPrev}
                    groupedWithNext={groupedWithNext}
                    animateIn={animateIn}
                  />
                </div>
              )
            })}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Reply preview */}
      {replyTo && (
        <div style={{
          padding: '6px 16px', borderTop: `1px solid ${border}`,
          display: 'flex', alignItems: 'center', gap: 8,
          background: isDark ? '#1c1c1f' : '#f3f4f6',
          fontSize: 12, color: muted,
        }}>
          <div style={{ flex: 1, borderLeft: '3px solid #3b82f6', paddingLeft: 8, overflow: 'hidden' }}>
            <span style={{ fontWeight: 600, color: '#3b82f6' }}>{replyTo.senderName}</span>
            <span style={{ marginLeft: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: 300 }}>
              {replyTo.content}
            </span>
          </div>
          <button onClick={() => setReplyTo(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex' }}>
            <X size={13} color={muted} />
          </button>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${border}`, flexShrink: 0 }}>
        <div style={{
          position: 'relative',
          display: 'flex', alignItems: 'center', gap: 8,
          background: isValidAssignTaskCommand
            ? (isDark ? 'rgba(37,99,235,0.16)' : 'rgba(59,130,246,0.12)')
            : (isDark ? 'rgba(39,39,42,0.88)' : 'rgba(243,244,246,0.92)'),
          borderRadius: 16,
          padding: '6px 10px',
          border: isValidAssignTaskCommand ? '1px solid rgba(59,130,246,0.65)' : `1px solid ${border}`,
          boxShadow: isValidAssignTaskCommand
            ? (isDark ? '0 8px 24px rgba(37,99,235,0.24)' : '0 8px 24px rgba(59,130,246,0.2)')
            : (isDark ? '0 8px 24px rgba(0,0,0,0.28)' : '0 8px 24px rgba(15,23,42,0.08)'),
        }}>
          {isSlashMode && showCommandMenu && (
            <div
              style={{
                position: 'absolute',
                left: 12,
                right: 12,
                bottom: 44,
                zIndex: 22,
                borderRadius: 12,
                border: `1px solid ${border}`,
                background: isDark ? 'rgba(24,24,27,0.97)' : 'rgba(255,255,255,0.97)',
                boxShadow: isDark ? '0 14px 34px rgba(0,0,0,0.42)' : '0 14px 34px rgba(15,23,42,0.16)',
                overflow: 'hidden',
              }}
            >
              {matchingCommands.length > 0 ? matchingCommands.map((cmd, idx) => {
                const isSelected = idx === selectedCommandIndex
                return (
                  <button
                    key={cmd.name}
                    onClick={() => applyCommandTemplate(cmd.name)}
                    style={{
                      width: '100%',
                      padding: '9px 10px',
                      border: 'none',
                      borderBottom: `1px solid ${border}`,
                      background: isSelected ? (isDark ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.12)') : 'transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: '#3b82f6', fontSize: 12, fontWeight: 700 }}>{cmd.name}</span>
                      <span style={{ color: muted, fontSize: 10 }}>{isGroup ? cmd.groupExample : cmd.dmExample}</span>
                    </div>
                    <div style={{ marginTop: 2, fontSize: 11, color: muted }}>{cmd.description}</div>
                  </button>
                )
              }) : (
                <div style={{ padding: '9px 10px', fontSize: 11, color: muted }}>
                  No matching commands
                </div>
              )}
            </div>
          )}
          {showMentionMenu && (
            <div
              style={{
                position: 'absolute',
                left: 12,
                right: 12,
                bottom: 44,
                zIndex: 23,
                borderRadius: 12,
                border: `1px solid ${border}`,
                background: isDark ? 'rgba(24,24,27,0.97)' : 'rgba(255,255,255,0.97)',
                boxShadow: isDark ? '0 14px 34px rgba(0,0,0,0.42)' : '0 14px 34px rgba(15,23,42,0.16)',
                overflow: 'hidden',
              }}
            >
              {mentionSuggestions.map((member, idx) => {
                const isSelected = idx === selectedMentionIndex
                const memberFirst = member.profile?.firstName ?? ''
                const memberLast = member.profile?.lastName ?? ''
                const memberName = `${memberFirst} ${memberLast}`.trim() || member.profile?.email || member.userId
                const memberHandle = memberFirst || memberLast
                  ? `${memberFirst}${memberLast ? `.${memberLast}` : ''}`
                  : (member.profile?.email?.split('@')[0] ?? member.userId)
                const initials = `${memberFirst.slice(0, 1)}${memberLast.slice(0, 1)}`.toUpperCase() || '@'

                return (
                  <button
                    key={member.userId}
                    onClick={() => applyMention(member)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: 'none',
                      borderBottom: `1px solid ${border}`,
                      background: isSelected ? (isDark ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.12)') : 'transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: isDark ? '#3f3f46' : '#e4e4e7', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                      {member.profile?.image
                        ? <img src={member.profile.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span style={{ fontSize: 10, fontWeight: 700, color: muted }}>{initials}</span>}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: text }}>{memberName}</div>
                      <div style={{ marginTop: 1, fontSize: 10, color: muted }}>@{memberHandle}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          {showBoardTagMenu && (
            <div
              style={{
                position: 'absolute',
                left: 12,
                right: 12,
                bottom: 44,
                zIndex: 24,
                borderRadius: 12,
                border: `1px solid ${border}`,
                background: isDark ? 'rgba(24,24,27,0.97)' : 'rgba(255,255,255,0.97)',
                boxShadow: isDark ? '0 14px 34px rgba(0,0,0,0.42)' : '0 14px 34px rgba(15,23,42,0.16)',
                overflow: 'hidden',
              }}
            >
              {boardTagSuggestions.map((board, idx) => {
                const isSelected = idx === selectedBoardTagIndex
                const summaryText = board.accessibility.scope === 'everyone'
                  ? 'Everyone in this chat can open'
                  : board.accessibility.scope === 'some_members'
                    ? `${board.accessibility.accessibleCount}/${board.accessibility.totalMembers} members can open`
                    : 'Only you can open right now'

                return (
                  <button
                    key={board.boardId}
                    onClick={() => applyBoardTag(board)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: 'none',
                      borderBottom: `1px solid ${border}`,
                      background: isSelected ? (isDark ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.12)') : 'transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {board.title}
                      </div>
                      <div style={{ marginTop: 1, fontSize: 10, color: muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        #{board.handle} · {summaryText}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: board.accessibility.scope === 'everyone' ? '#22c55e' : board.accessibility.scope === 'some_members' ? '#f59e0b' : '#ef4444' }}>
                      {board.accessibility.scope === 'everyone' ? 'OPEN' : board.accessibility.scope === 'some_members' ? 'PARTIAL' : 'RESTRICTED'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          {showBoardTagLoading && (
            <div
              style={{
                position: 'absolute',
                left: 12,
                right: 12,
                bottom: 44,
                zIndex: 24,
                borderRadius: 12,
                border: `1px solid ${border}`,
                background: isDark ? 'rgba(24,24,27,0.97)' : 'rgba(255,255,255,0.97)',
                boxShadow: isDark ? '0 14px 34px rgba(0,0,0,0.42)' : '0 14px 34px rgba(15,23,42,0.16)',
                padding: '9px 10px',
                color: muted,
                fontSize: 11,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
              Loading boards...
            </div>
          )}
          <button
            title="Attach file"
            style={{
              width: 30, height: 30, borderRadius: 10, border: 'none',
              background: 'transparent', color: muted, cursor: 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.75,
            }}
          >
            <Paperclip size={14} />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onClick={(e) => setComposerCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
            onKeyUp={(e) => setComposerCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
            onKeyDown={handleKeyDown}
            placeholder="Message…"
            rows={1}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              resize: 'none', fontSize: 13, color: isValidAssignTaskCommand ? '#3b82f6' : text, fontFamily: 'inherit',
              lineHeight: '1.45', maxHeight: 132, minHeight: 26, overflowY: 'auto',
              paddingTop: 2, paddingBottom: 2,
            }}
          />
          <button
            ref={smileButtonRef}
            onClick={() => setShowComposerEmoji((v) => !v)}
            title="Add emoji"
            style={{
              width: 30, height: 30, borderRadius: 10, border: 'none', flexShrink: 0,
              background: 'transparent', color: muted, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Smile size={14} />
          </button>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isAiThinking}
            title={isAiThinking ? 'Bords AI is thinking…' : 'Send'}
            style={{
              width: 32, height: 32, borderRadius: 10, border: 'none', flexShrink: 0,
              background: input.trim() && !isAiThinking ? '#3b82f6' : (isDark ? '#3f3f46' : '#e4e4e7'),
              cursor: input.trim() && !isAiThinking ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.15s',
            }}
          >
            {isAiThinking
              ? <Loader2 size={14} color={muted} className="animate-spin" />
              : <Send size={14} color={input.trim() ? 'white' : muted} />
            }
          </button>

          {showComposerEmoji && (
            <div ref={emojiPickerRef} style={{
              position: 'absolute',
              right: 52,
              bottom: 44,
              zIndex: 20,
              borderRadius: 12,
              overflow: 'hidden',
              boxShadow: isDark ? '0 12px 28px rgba(0,0,0,0.45)' : '0 12px 28px rgba(15,23,42,0.16)',
            }}>
              <EmojiPicker
                theme={isDark ? Theme.DARK : Theme.LIGHT}
                onEmojiClick={addComposerEmoji}
                width={320}
                height={360}
                lazyLoadEmojis
                skinTonesDisabled
                previewConfig={{ showPreview: false }}
              />
            </div>
          )}
        </div>
        {selectedBoardTags.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {selectedBoardTags.map((tag) => (
              <span
                key={tag.boardId}
                style={{
                  fontSize: 10,
                  borderRadius: 999,
                  padding: '3px 8px',
                  border: `1px solid ${isDark ? 'rgba(59,130,246,0.45)' : 'rgba(59,130,246,0.35)'}`,
                  background: isDark ? 'rgba(59,130,246,0.16)' : 'rgba(59,130,246,0.1)',
                  color: isDark ? '#bfdbfe' : '#1d4ed8',
                }}
              >
                #{boardHandleById.get(tag.boardId) ?? tag.title}
              </span>
            ))}
          </div>
        )}
        {showGrantAccessToggle && (
          <label
            style={{
              marginTop: 6,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 10,
              color: isDark ? '#86efac' : '#166534',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={grantBoardAccessOnSend}
              onChange={(e) => setGrantBoardAccessOnSend(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Mention + grant missing members view access (organization owner only)
          </label>
        )}
        <p style={{ margin: '4px 0 0', fontSize: 10, color: muted }}>
          {conversation.isAiConversation
            ? 'Enter to send | Shift+Enter for new line | Try: /create-board Q3 Roadmap or /board-details <name>'
            : `Enter to send | Shift+Enter for new line | @ to mention people | # to tag boards | /ai to ask Bords AI | ${isGroup ? '/assigntask @member task' : '/assigntask task'}`}
        </p>
        {isAiThinking && (
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#3b82f6', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Bot size={11} />
            Bords AI is thinking…
          </p>
        )}
        {commandFeedback && !isAiThinking && (
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 11,
              color: commandFeedback.type === 'success' ? '#22c55e' : '#ef4444',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {isBuildingBoard && commandFeedback.type === 'success' && (
              <Loader2 size={11} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
            )}
            {commandFeedback.text}
          </p>
        )}
      </div>

      {showAssignedTasksPanel && canViewAssignedTasksPanel && orgId && organizationMembers.length > 0 && (
        <AssignedTasksPanel
          orgId={orgId}
          members={organizationMembers}
          initialSelectedUserId={dmOtherMemberUserId}
          onClose={() => setShowAssignedTasksPanel(false)}
        />
      )}

      {showGroupDetails && isGroup && (
        <GroupDetailsModal
          conversationId={conversation.id}
          currentUserId={currentUserId}
          onClose={() => setShowGroupDetails(false)}
          onUpdated={onConversationUpdated}
          onLeft={() => {
            onConversationUpdated?.()
            onBack?.()
          }}
        />
      )}

      {activePlanReviewId && (
        <AiPlanReviewModal
          planId={activePlanReviewId}
          onClose={() => setActivePlanReviewId(null)}
          onApproved={() => setCommandFeedback({ type: 'success', text: 'Plan approved. Next step: create board from approved plan.' })}
        />
      )}
    </div>
  )
}
