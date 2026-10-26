import type { CollabProvider } from '@/lib/yjs-provider'

/**
 * Server-pushed board events. The realtime Worker relays Postgres row changes
 * (a trigger on board_comments posts them to its /events endpoint) into the
 * board's room, where they arrive as the sync provider's "custom-message" event.
 * Only people connected to the board hear about them.
 */

type BoardEvent =
  | { type: 'comment_insert'; row: Record<string, unknown> }
  | { type: 'comment_delete'; id: string }

interface CommentHandlers {
  onInsert?: (row: Record<string, unknown>) => void
  onDelete?: (id: string) => void
}

/** Subscribe to comment inserts/deletes for the board the provider is connected to. Returns an unsubscribe fn. */
export function onBoardCommentEvents(provider: CollabProvider | null, handlers: CommentHandlers): () => void {
  if (!provider) return () => {}

  const listener = (raw: string) => {
    let evt: BoardEvent
    try {
      evt = JSON.parse(raw)
    } catch {
      return
    }
    if (evt.type === 'comment_insert') handlers.onInsert?.(evt.row)
    else if (evt.type === 'comment_delete') handlers.onDelete?.(evt.id)
  }

  provider.on('custom-message', listener)
  return () => provider.off('custom-message', listener)
}
