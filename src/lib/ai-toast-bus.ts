'use client'

export type AiToastPayload = {
  messageId: string
  conversationId: string
  organizationId: string | null
  content: string
  createdAt: string
}

const CHANNEL_NAME = 'bords-ai-toast'
const WINDOW_EVENT = 'bords:ai-toast'

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null
  return new BroadcastChannel(CHANNEL_NAME)
}

export function publishAiToast(payload: AiToastPayload): void {
  if (typeof window === 'undefined') return

  try {
    const channel = getChannel()
    channel?.postMessage(payload)
    channel?.close()
  } catch {
    // Ignore BroadcastChannel failures and fall back to same-tab event below.
  }

  window.dispatchEvent(new CustomEvent<AiToastPayload>(WINDOW_EVENT, { detail: payload }))
}

export function subscribeAiToasts(handler: (payload: AiToastPayload) => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const channel = getChannel()
  const onMessage = (event: MessageEvent<AiToastPayload>) => {
    if (event.data) handler(event.data)
  }
  const onWindowEvent = (event: Event) => {
    const customEvent = event as CustomEvent<AiToastPayload>
    if (customEvent.detail) handler(customEvent.detail)
  }

  channel?.addEventListener('message', onMessage)
  window.addEventListener(WINDOW_EVENT, onWindowEvent)

  return () => {
    channel?.removeEventListener('message', onMessage)
    channel?.close()
    window.removeEventListener(WINDOW_EVENT, onWindowEvent)
  }
}