'use client'
import { create } from 'zustand'
import { messagingSocket } from '@/lib/messaging-socket'
import { usePresenceStore } from '@/store/presenceStore'

// Reference-counted so multiple callers (dashboard, floating panel, etc.) share
// one connection but it's torn down only when the last caller unmounts.
let _socketRefs = 0
let _badgeUnsub: (() => void) | null = null

/* ── Types ─────────────────────────────────────────────────────── */

export interface MessageAttachment {
  id: string
  fileName: string
  fileSize: number | null
  mimeType: string | null
  storagePath: string
}

export interface MessageReaction {
  id: string
  userId: string
  emoji: string
}

export interface MessageBoardTag {
  boardId: string
  title: string
  organizationId: string | null
  hasAccess?: boolean
}

export interface Message {
  id: string
  conversationId: string
  senderId: string
  senderName: string
  senderImage: string | null
  content: string | null
  isDeleted: boolean
  isSystemMessage: boolean
  boardTags: MessageBoardTag[]
  replyToId: string | null
  editedAt: string | null
  createdAt: string
  attachments: MessageAttachment[]
  reactions: MessageReaction[]
  /** Client-only: undefined = confirmed sent, 'sending' = in flight, 'failed' = error */
  _status?: 'sending' | 'failed'
}

export interface ConversationMember {
  userId: string
  role: 'admin' | 'member'
  profile: {
    id: string
    firstName: string
    lastName: string
    image: string | null
    email: string
  } | null
}

export interface Conversation {
  id: string
  type: 'dm' | 'group'
  name: string | null
  description: string | null
  avatarUrl: string | null
  organizationId: string | null
  workspaceId: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  members: ConversationMember[]
  lastMessage: {
    id: string
    content: string | null
    senderId: string
    senderName: string
    createdAt: string
  } | null
  unreadCount: number
}

interface MessagingState {
  conversations: Conversation[]
  activeConversationId: string | null
  messages: Record<string, Message[]>   // keyed by conversationId
  loading: boolean
  loadingMessages: Record<string, boolean>
  sending: boolean
  /** Total unread across ALL conversations */
  totalUnread: number

  // Actions
  setActiveConversation: (id: string | null) => void
  fetchConversations: (context: 'org' | 'personal', orgId?: string) => Promise<void>
  fetchMessages: (conversationId: string, before?: string) => Promise<void>
  sendMessage: (
    conversationId: string,
    content: string,
    replyToId?: string,
    sender?: { id: string; name: string; image: string | null },
    options?: { boardTags?: MessageBoardTag[] }
  ) => Promise<boolean>
  createConversation: (params: {
    type: 'dm' | 'group'
    memberIds: string[]
    name?: string
    description?: string
    organizationId?: string
    workspaceId?: string
  }) => Promise<string | null>
  toggleReaction: (conversationId: string, messageId: string, emoji: string) => Promise<void>
  markRead: (conversationId: string) => Promise<void>
  leaveConversation: (conversationId: string) => Promise<void>

  // Realtime helpers called directly by ConversationView's per-conversation subscription
  appendRealtimeMessage: (msg: Message) => void
  updateRealtimeMessage: (raw: any) => void

  // Realtime
  /** Subscribe to a per-user broadcast channel to keep badge counts up-to-date. */
  subscribeToMessages: (userId: string) => () => void
}

/* ── Store ─────────────────────────────────────────────────────── */

export const useMessagingStore = create<MessagingState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: {},
  loading: false,
  loadingMessages: {},
  sending: false,
  totalUnread: 0,

  setActiveConversation: (id) => {
    set({ activeConversationId: id })
    if (id) get().markRead(id)
  },

  fetchConversations: async (context, orgId) => {
    set({ loading: true })
    try {
      const params = new URLSearchParams({ context })
      if (orgId) params.set('orgId', orgId)
      const res = await fetch(`/api/messages/conversations?${params}`)
      if (!res.ok) throw new Error('Failed to fetch conversations')
      const data: Conversation[] = await res.json()
      const totalUnread = data.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0)
      set({ conversations: data, totalUnread })
    } finally {
      set({ loading: false })
    }
  },

  fetchMessages: async (conversationId, before) => {
    if (!before) {
      set((state) => ({ loadingMessages: { ...state.loadingMessages, [conversationId]: true } }))
    }
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (before) params.set('before', before)
      const res = await fetch(`/api/messages/conversations/${conversationId}/messages?${params}`)
      if (!res.ok) return
      const data: Message[] = await res.json()
      set((state) => {
        const existing = state.messages[conversationId] ?? []
        const merged = before ? [...data, ...existing] : data
        return { messages: { ...state.messages, [conversationId]: merged } }
      })
      get().markRead(conversationId)
    } finally {
      if (!before) {
        set((state) => ({ loadingMessages: { ...state.loadingMessages, [conversationId]: false } }))
      }
    }
  },

  sendMessage: async (conversationId, content, replyToId, sender, options) => {
    const outgoingBoardTags = options?.boardTags ?? []
    const tempId = `temp-${Date.now()}-${Math.random()}`
    if (sender) {
      const tempMsg: Message = {
        id: tempId,
        conversationId,
        senderId: sender.id,
        senderName: sender.name,
        senderImage: sender.image,
        content,
        isDeleted: false,
        isSystemMessage: false,
        boardTags: outgoingBoardTags,
        replyToId: replyToId ?? null,
        editedAt: null,
        createdAt: new Date().toISOString(),
        attachments: [],
        reactions: [],
        _status: 'sending',
      }
      set((state) => ({
        messages: { ...state.messages, [conversationId]: [...(state.messages[conversationId] ?? []), tempMsg] },
      }))
    }
    try {
      const res = await fetch(`/api/messages/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, replyToId, boardTags: outgoingBoardTags }),
      })
      if (!res.ok) throw new Error('Failed to send message')
      const raw = await res.json()
      const realMsg: Message = {
        id: raw.id,
        conversationId: raw.conversation_id,
        senderId: raw.sender_id,
        senderName: sender?.name ?? '',
        senderImage: sender?.image ?? null,
        content: raw.content,
        isDeleted: raw.is_deleted ?? false,
        isSystemMessage: raw.is_system_message ?? false,
        boardTags: Array.isArray(raw.board_tags)
          ? raw.board_tags
              .filter((t: any) => typeof t?.board_id === 'string')
              .map((t: any) => ({
                boardId: t.board_id,
                title: t.title ?? 'Untitled board',
                organizationId: t.organization_id ?? null,
                hasAccess: true,
              }))
          : outgoingBoardTags,
        replyToId: raw.reply_to_id ?? null,
        editedAt: raw.edited_at ?? null,
        createdAt: raw.created_at,
        attachments: [],
        reactions: [],
      }
      set((state) => {
        const existing = state.messages[conversationId] ?? []
        if (existing.some((m) => m.id === realMsg.id)) {
          // Realtime already delivered it — just remove temp
          return { messages: { ...state.messages, [conversationId]: existing.filter((m) => m.id !== tempId) } }
        }
        return {
          messages: {
            ...state.messages,
            [conversationId]: existing.map((m) => m.id === tempId ? realMsg : m),
          },
        }
      })
      return true
    } catch {
      if (sender) {
        set((state) => ({
          messages: {
            ...state.messages,
            [conversationId]: (state.messages[conversationId] ?? []).map((m) =>
              m.id === tempId ? { ...m, _status: 'failed' as const } : m
            ),
          },
        }))
      }
      return false
    }
  },

  createConversation: async (params) => {
    const res = await fetch('/api/messages/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.id ?? null
  },

  toggleReaction: async (conversationId, messageId, emoji) => {
    await fetch(`/api/messages/conversations/${conversationId}/messages/${messageId}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    })
    // Optimistic update handled by Realtime; otherwise refetch messages
  },

  markRead: async (conversationId) => {
    await fetch(`/api/messages/conversations/${conversationId}/read`, { method: 'PATCH' })
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c
      ),
      totalUnread: state.conversations.reduce(
        (sum, c) => sum + (c.id === conversationId ? 0 : (c.unreadCount ?? 0)),
        0
      ),
    }))
  },

  leaveConversation: async (conversationId) => {
    await fetch(`/api/messages/conversations/${conversationId}`, { method: 'DELETE' })
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== conversationId),
      activeConversationId:
        state.activeConversationId === conversationId ? null : state.activeConversationId,
    }))
  },

  appendRealtimeMessage: (newMsg) => {
    const { conversationId } = newMsg
    set((state) => {
      const existing = state.messages[conversationId] ?? []
      // Deduplicate: could arrive from both per-conversation sub and global sub
      if (existing.some((m) => m.id === newMsg.id)) return state

      const updatedConvs = state.conversations.map((c) => {
        if (c.id !== conversationId) return c
        const isActive = state.activeConversationId === conversationId
        return {
          ...c,
          lastMessage: {
            id: newMsg.id,
            content: newMsg.content,
            senderId: newMsg.senderId,
            senderName: newMsg.senderName,
            createdAt: newMsg.createdAt,
          },
          unreadCount: isActive ? 0 : (c.unreadCount ?? 0) + 1,
          updatedAt: newMsg.createdAt,
        }
      })
      updatedConvs.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      return {
        messages: { ...state.messages, [conversationId]: [...existing, newMsg] },
        conversations: updatedConvs,
        totalUnread: updatedConvs.reduce((s, c) => s + (c.unreadCount ?? 0), 0),
      }
    })
    // Mark read if this conversation is active
    if (get().activeConversationId === conversationId) {
      get().markRead(conversationId)
    }
  },

  updateRealtimeMessage: (raw) => {
    const conversationId: string = raw.conversation_id
    set((state) => {
      if (!state.messages[conversationId]) return state
      return {
        messages: {
          ...state.messages,
          [conversationId]: state.messages[conversationId].map((m) =>
            m.id === raw.id
              ? {
                  ...m,
                  content: raw.is_deleted !== undefined ? (raw.is_deleted ? null : raw.content) : m.content,
                  isDeleted: raw.is_deleted !== undefined ? raw.is_deleted : m.isDeleted,
                  editedAt: raw.edited_at !== undefined ? raw.edited_at : m.editedAt,
                  reactions: Array.isArray(raw.reactions)
                    ? raw.reactions.map((r: any) => ({
                        id: r.id,
                        userId: r.user_id,
                        emoji: r.emoji,
                      }))
                    : m.reactions,
                }
              : m
          ),
        },
      }
    })
  },

  subscribeToMessages: (_userId) => {
    _socketRefs += 1

    if (_socketRefs === 1) {
      // First caller — open the connection, listen for badge + presence updates
      messagingSocket.connect()

      // Start presence subscription
      const stopPresence = usePresenceStore.getState().subscribe()

      _badgeUnsub = () => {
        stopPresence()
        // Also remove the badge handler registered below
      }

      const badgeOff = messagingSocket.on((event) => {
        if (event.type !== 'badge_update') return
        const { conversationId, lastMessage, updatedAt } = event
        set((state) => {
          const updatedConvs = state.conversations.map((c) => {
            if (c.id !== conversationId) return c
            const isActive = state.activeConversationId === conversationId
            return {
              ...c,
              unreadCount: isActive ? c.unreadCount ?? 0 : (c.unreadCount ?? 0) + 1,
              lastMessage: lastMessage
                ? {
                    id: lastMessage.id,
                    content: lastMessage.content,
                    senderId: lastMessage.senderId,
                    senderName: lastMessage.senderName,
                    createdAt: lastMessage.createdAt,
                  }
                : c.lastMessage,
              updatedAt: updatedAt ?? c.updatedAt,
            }
          })
          updatedConvs.sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          )
          return {
            conversations: updatedConvs,
            totalUnread: updatedConvs.reduce((s, c) => s + (c.unreadCount ?? 0), 0),
          }
        })
      })

      _badgeUnsub = () => {
        stopPresence()
        badgeOff()
      }
    }

    return () => {
      _socketRefs -= 1
      if (_socketRefs <= 0) {
        _badgeUnsub?.()
        _badgeUnsub = null
        _socketRefs = 0
        // Do NOT call messagingSocket.destroy() here — the socket is also used
        // by ConversationView. It will persist for the lifetime of the page.
      }
    }
  },
}))
