/**
 * boardData.ts — Helper for purging a board's items from all Zustand stores.
 * Used when deleting a board locally.
 *
 * All REST sync helpers (gatherBoardData, applyCloudData, computeHash) have
 * been removed — Y.Doc + Hocuspocus is now the single source of truth.
 */

import { useBoardStore } from '@/store/boardStore'
import { useChecklistStore } from '@/store/checklistStore'
import { useKanbanStore } from '@/store/kanbanStore'
import { useNoteStore } from '@/store/stickyNoteStore'
import { useMediaStore } from '@/store/mediaStore'
import { useTextStore } from '@/store/textStore'
import { useDrawingStore } from '@/store/drawingStore'
import { useCommentStore } from '@/store/commentStore'
import { useConnectionStore } from '@/store/connectionStore'
import { useReminderStore } from '@/store/reminderStore'
import { useTableStore } from '@/store/tableStore'
import { useZIndexStore } from '@/store/zIndexStore'

/* ═══════════════════  purgeLocalBoard ═══════════════════ */

export function purgeLocalBoard(localBoardId: string) {
  const boardStore = useBoardStore.getState()
  const board = boardStore.boards.find((b: any) => b.id === localBoardId)
  if (!board) return

  const checklistStore = useChecklistStore.getState()
  const kanbanStore = useKanbanStore.getState()
  const stickyStore = useNoteStore.getState()
  const mediaStore = useMediaStore.getState()
  const textStore = useTextStore.getState()
  const drawingStore = useDrawingStore.getState()
  const commentStore = useCommentStore.getState()
  const connectionStore = useConnectionStore.getState()
  const reminderStore = useReminderStore.getState()
  const tableStore = useTableStore.getState()
  const zIndexStore = useZIndexStore.getState()

  const noteIds = new Set(board.notes || [])
  const checklistIds = new Set(board.checklists || [])
  const textIds = new Set(board.texts || [])
  const kanbanIds = new Set(board.kanbans || [])
  const mediaIds = new Set(board.medias || [])
  const drawingIds = new Set(board.drawings || [])
  const reminderIds = new Set(board.reminders || [])
  const tableIds = new Set(board.tables || [])

  useNoteStore.setState({ notes: stickyStore.notes.filter((n: any) => !noteIds.has(n.id)) })
  useChecklistStore.setState({ checklists: checklistStore.checklists.filter((c: any) => !checklistIds.has(c.id)) })
  useTextStore.setState({ texts: textStore.texts.filter((t: any) => !textIds.has(t.id)) })
  useKanbanStore.setState({ boards: kanbanStore.boards.filter((k: any) => !kanbanIds.has(k.id)) })
  useMediaStore.setState({ medias: mediaStore.medias.filter((m: any) => !mediaIds.has(m.id)) })
  useDrawingStore.setState({ drawings: drawingStore.drawings.filter((d: any) => !drawingIds.has(d.id)) })
  useReminderStore.setState({ reminders: reminderStore.reminders.filter((r: any) => !reminderIds.has(r.id)) })
  useTableStore.setState({ tables: tableStore.tables.filter((t: any) => !tableIds.has(t.id)) })
  useCommentStore.setState({ localComments: commentStore.localComments.filter((c: any) => c.boardId !== localBoardId) })
  useConnectionStore.setState({ connections: connectionStore.connections.filter((c: any) => c.boardId !== localBoardId) })

  const allItemIds = [...noteIds, ...checklistIds, ...textIds, ...kanbanIds, ...mediaIds, ...drawingIds, ...reminderIds, ...tableIds]
  const newZMap = { ...zIndexStore.zIndexMap }
  for (const id of allItemIds) newZMap[id] && delete newZMap[id]
  useZIndexStore.setState({ zIndexMap: newZMap })

  const currentId = boardStore.currentBoardId
  const remaining = boardStore.boards.filter((b: any) => b.id !== localBoardId)

  let nextBoardId: string | null = currentId === localBoardId ? null : currentId
  if (currentId === localBoardId && remaining.length > 0 && board) {
    const sameContext = remaining.filter((b: any) => {
      if (board.contextType === 'organization') {
        return b.contextType === 'organization' && b.organizationId === board.organizationId
      }
      return !b.contextType || b.contextType === 'personal'
    })
    nextBoardId = sameContext.length > 0 ? sameContext[0].id : null
  }

  useBoardStore.setState({
    boards: remaining,
    currentBoardId: nextBoardId,
  })
}
