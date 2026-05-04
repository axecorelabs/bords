'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Bot, MessageCircle, Sparkles, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { useSession } from '@/components/AuthProvider'
import { subscribeAiToasts } from '@/lib/ai-toast-bus'
import { messagingSocket } from '@/lib/messaging-socket'
import { type Conversation, useMessagingStore } from '@/store/messagingStore'
import { useThemeStore } from '@/store/themeStore'

function compactText(input: string | null | undefined, max = 140): string {
  const normalized = (input ?? '').trim().replace(/\s+/g, ' ')
  if (!normalized) return 'Sent a message'
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized
}

type ToastVariant = 'dm' | 'group' | 'ai' | 'system'

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

function getVariantMeta(variant: ToastVariant, isDark: boolean) {
  if (variant === 'ai') {
    return {
      accent: '#3b82f6',
      accentSoft: isDark ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.12)',
      label: 'AI',
      Icon: Bot,
    }
  }

  if (variant === 'group') {
    return {
      accent: '#f97316',
      accentSoft: isDark ? 'rgba(249,115,22,0.22)' : 'rgba(249,115,22,0.14)',
      label: 'GROUP',
      Icon: Users,
    }
  }

  if (variant === 'system') {
    return {
      accent: '#fb923c',
      accentSoft: isDark ? 'rgba(251,146,60,0.2)' : 'rgba(251,146,60,0.12)',
      label: 'SYSTEM',
      Icon: Bell,
    }
  }

  return {
    accent: '#60a5fa',
    accentSoft: isDark ? 'rgba(96,165,250,0.2)' : 'rgba(96,165,250,0.12)',
    label: 'DM',
    Icon: MessageCircle,
  }
}

function IncomingMessageToast(props: {
  isDark: boolean
  variant: ToastVariant
  sender: string
  senderImage: string | null
  where: string
  preview: string
  visible: boolean
  onClick: () => void
}) {
  const { isDark, variant, sender, senderImage, where, preview, visible, onClick } = props

  const cardBg = isDark
    ? 'linear-gradient(135deg, rgba(24,24,27,0.94) 0%, rgba(39,39,42,0.92) 100%)'
    : 'linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(244,244,245,0.96) 100%)'

  const cardBorder = isDark ? 'rgba(255,255,255,0.11)' : 'rgba(17,24,39,0.12)'
  const text = isDark ? '#f4f4f5' : '#111827'
  const muted = isDark ? '#a1a1aa' : '#6b7280'
  const { accent, accentSoft, label, Icon } = getVariantMeta(variant, isDark)
  const showAvatar = variant === 'dm' || variant === 'group'

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: 'min(92vw, 430px)',
        borderRadius: 16,
        border: `1px solid ${cardBorder}`,
        background: cardBg,
        boxShadow: isDark
          ? '0 14px 40px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.06)'
          : '0 14px 36px rgba(15,23,42,0.14), inset 0 1px 0 rgba(255,255,255,0.9)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        padding: 12,
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        textAlign: 'left',
        cursor: 'pointer',
        outline: 'none',
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(-8px) scale(0.97)',
        opacity: visible ? 1 : 0,
        transition: 'all 180ms ease',
      }}
    >
      {showAvatar ? (
        senderImage ? (
          <img
            src={senderImage}
            alt={sender}
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              objectFit: 'cover',
              flexShrink: 0,
              border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)'}`,
            }}
          />
        ) : (
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              display: 'grid',
              placeItems: 'center',
              background: accentSoft,
              color: accent,
              fontSize: 11,
              fontWeight: 700,
              flexShrink: 0,
              border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}`,
            }}
          >
            {initialsFromName(sender)}
          </div>
        )
      ) : (
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            display: 'grid',
            placeItems: 'center',
            background: accentSoft,
            color: accent,
            flexShrink: 0,
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}`,
          }}
        >
          <Icon size={16} />
        </div>
      )}

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: text,
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {variant === 'ai' ? 'Bords AI' : sender}
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.35,
              textTransform: 'uppercase',
              color: accent,
            }}
          >
            <Sparkles size={11} />
            {label}
          </div>
        </div>

        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: muted,
            marginTop: 2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {where}
        </div>

        <div
          style={{
            fontSize: 12.5,
            color: text,
            marginTop: 7,
            lineHeight: 1.4,
            wordBreak: 'break-word',
          }}
        >
          {preview}
        </div>
      </div>
    </button>
  )
}

export default function GlobalMessageToasts() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const isDark = useThemeStore((s) => s.isDark)
  const subscribeToMessages = useMessagingStore((s) => s.subscribeToMessages)
  const activeConversationId = useMessagingStore((s) => s.activeConversationId)
  const conversations = useMessagingStore((s) => s.conversations)
  const setActiveConversation = useMessagingStore((s) => s.setActiveConversation)

  const activeConversationRef = useRef<string | null>(activeConversationId)
  const conversationsRef = useRef(conversations)
  const seenIdsRef = useRef<string[]>([])
  const conversationMetaRef = useRef<Record<string, Conversation>>({})

  useEffect(() => {
    activeConversationRef.current = activeConversationId
  }, [activeConversationId])

  useEffect(() => {
    conversationsRef.current = conversations
    const nextMeta: Record<string, Conversation> = { ...conversationMetaRef.current }
    for (const conversation of conversations) {
      nextMeta[conversation.id] = conversation
    }
    conversationMetaRef.current = nextMeta
  }, [conversations])

  useEffect(() => {
    if (status !== 'authenticated') return
    const userId = (session?.user as any)?.id as string | undefined
    if (!userId) return

    const stopRealtime = subscribeToMessages(userId)

    const resolveConversation = async (conversationId: string): Promise<Conversation | undefined> => {
      const existing = conversationsRef.current.find((c) => c.id === conversationId) ?? conversationMetaRef.current[conversationId]
      if (existing) return existing

      try {
        const res = await fetch(`/api/messages/conversations/${conversationId}`, { cache: 'no-store' })
        if (!res.ok) return undefined
        const json = await res.json()
        const resolved = json as Conversation
        conversationMetaRef.current = {
          ...conversationMetaRef.current,
          [conversationId]: resolved,
        }
        return resolved
      } catch {
        return undefined
      }
    }

    const handleBadgeUpdate = async (event: Extract<Parameters<typeof messagingSocket.on>[0] extends (arg: infer E) => void ? E : never, { type: 'badge_update' }>) => {
      if (event.type !== 'badge_update') return

      const lastMessage = event.lastMessage
      if (!lastMessage?.id) return
      if (lastMessage.senderId === userId) return
      if (activeConversationRef.current === event.conversationId) return

      if (seenIdsRef.current.includes(lastMessage.id)) return
      seenIdsRef.current.push(lastMessage.id)
      if (seenIdsRef.current.length > 250) {
        seenIdsRef.current = seenIdsRef.current.slice(-200)
      }

      const conversation = await resolveConversation(event.conversationId)
      const senderName = (lastMessage.senderName || '').trim() || 'Teammate'
      const isAi = /bords\s*ai/i.test(senderName) || Boolean(conversation?.isAiConversation)
      const isSystem = /system/i.test(senderName) || lastMessage.senderId === 'system'
      const variant: ToastVariant = isAi
        ? 'ai'
        : isSystem
          ? 'system'
          : conversation?.type === 'group'
            ? 'group'
            : 'dm'

      const senderImage = (() => {
        const member = conversation?.members.find((m) => m.userId === lastMessage.senderId)
        return member?.profile?.image ?? null
      })()

      const where = conversation?.name?.trim()
        ? conversation.name
        : conversation?.type === 'group'
          ? 'Group chat'
          : conversation
            ? 'Direct message'
            : 'Conversation'

      const preview = compactText(lastMessage.content)
      const toastId = `incoming-${lastMessage.id}`

      const openConversation = () => {
        toast.dismiss(toastId)
        setActiveConversation(event.conversationId)
        const destination = conversation?.organizationId
          ? `/dashboard/${conversation.organizationId}#messages`
          : '/dashboard/personal#messages'
        router.push(destination)
      }

      toast.custom(
        (t) => (
          <IncomingMessageToast
            isDark={isDark}
            variant={variant}
            sender={senderName}
            senderImage={senderImage}
            where={where}
            preview={preview}
            visible={t.visible}
            onClick={openConversation}
          />
        ),
        {
          id: toastId,
          duration: 5000,
          position: 'top-right',
        }
      )
    }

    const offSocket = messagingSocket.on((event) => {
      if (event.type !== 'badge_update') return
      void handleBadgeUpdate(event)
    })

    const offAiToasts = subscribeAiToasts(async (payload) => {
      if (!payload.messageId) return
      if (activeConversationRef.current === payload.conversationId) return

      if (seenIdsRef.current.includes(payload.messageId)) return
      seenIdsRef.current.push(payload.messageId)
      if (seenIdsRef.current.length > 250) {
        seenIdsRef.current = seenIdsRef.current.slice(-200)
      }

      const conversation = await resolveConversation(payload.conversationId)
      const where = conversation?.name?.trim()
        ? conversation.name
        : 'AI conversation'
      const toastId = `incoming-${payload.messageId}`

      const openConversation = () => {
        toast.dismiss(toastId)
        setActiveConversation(payload.conversationId)
        const destination = payload.organizationId
          ? `/dashboard/${payload.organizationId}#messages`
          : '/dashboard/personal#messages'
        router.push(destination)
      }

      toast.custom(
        (t) => (
          <IncomingMessageToast
            isDark={isDark}
            variant="ai"
            sender="Bords AI"
            senderImage={null}
            where={where}
            preview={compactText(payload.content)}
            visible={t.visible}
            onClick={openConversation}
          />
        ),
        {
          id: toastId,
          duration: 5000,
          position: 'top-right',
        }
      )
    })

    return () => {
      offSocket()
      offAiToasts()
      stopRealtime()
    }
  }, [status, session, subscribeToMessages, isDark, router, setActiveConversation])

  return null
}