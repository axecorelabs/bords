'use client'

import { useBoardStore } from '@/store/boardStore'
import { useChecklistStore } from '@/store/checklistStore'
import { useKanbanStore } from '@/store/kanbanStore'
import { useNoteStore } from '@/store/stickyNoteStore'
import { useMediaStore } from '@/store/mediaStore'
import { useTextStore } from '@/store/textStore'
import { useDrawingStore } from '@/store/drawingStore'
import { useConnectionStore } from '@/store/connectionStore'
import { useReminderStore } from '@/store/reminderStore'
import { useTableStore } from '@/store/tableStore'
import { useRichTextStore } from '@/store/richTextStore'
import { useZIndexStore } from '@/store/zIndexStore'

function toArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const byId = new Map<string, T>()
  for (const item of existing) byId.set(item.id, item)
  for (const item of incoming) byId.set(item.id, item)
  return Array.from(byId.values())
}

type HydrateInput = {
  boardId: string
  userId: string
  fallbackTitle: string
  organizationId?: string | null
  boardPayload: any
}

export function hydrateLocalBoardFromCloud(input: HydrateInput): void {
  const { boardId, userId, fallbackTitle, organizationId, boardPayload } = input

  const stickyNotes = toArray(boardPayload?.stickyNotes)
  const checklists = toArray(boardPayload?.checklists)
  const textElements = toArray(boardPayload?.textElements)
  const kanbanBoards = toArray(boardPayload?.kanbanBoards)
  const mediaItems = toArray(boardPayload?.mediaItems)
  const drawings = toArray(boardPayload?.drawings)
  const connections = toArray(boardPayload?.connections)
  const reminders = toArray(boardPayload?.reminders)
  const tables = toArray(boardPayload?.tables)
  const richTexts = toArray(boardPayload?.richTexts)

  const itemIds = boardPayload?.itemIds || {}

  const notesIds = toArray<string>(itemIds.notes).length > 0
    ? toArray<string>(itemIds.notes)
    : stickyNotes.map((n: any) => String(n.id)).filter(Boolean)

  const checklistIds = toArray<string>(itemIds.checklists).length > 0
    ? toArray<string>(itemIds.checklists)
    : checklists.map((c: any) => String(c.id)).filter(Boolean)

  const textIds = toArray<string>(itemIds.texts).length > 0
    ? toArray<string>(itemIds.texts)
    : textElements.map((t: any) => String(t.id)).filter(Boolean)

  const kanbanIds = toArray<string>(itemIds.kanbans).length > 0
    ? toArray<string>(itemIds.kanbans)
    : kanbanBoards.map((k: any) => String(k.id)).filter(Boolean)

  const mediaIds = toArray<string>(itemIds.medias).length > 0
    ? toArray<string>(itemIds.medias)
    : mediaItems.map((m: any) => String(m.id)).filter(Boolean)

  const drawingIds = toArray<string>(itemIds.drawings).length > 0
    ? toArray<string>(itemIds.drawings)
    : drawings.map((d: any) => String(d.id)).filter(Boolean)

  const reminderIds = toArray<string>(itemIds.reminders).length > 0
    ? toArray<string>(itemIds.reminders)
    : reminders.map((r: any) => String(r.id)).filter(Boolean)

  const tableIds = toArray<string>(itemIds.tables).length > 0
    ? toArray<string>(itemIds.tables)
    : tables.map((t: any) => String(t.id)).filter(Boolean)

  const connectionIds = toArray<string>(itemIds.connections).length > 0
    ? toArray<string>(itemIds.connections)
    : connections.map((c: any) => String(c.id)).filter(Boolean)

  const richTextIds = toArray<string>(itemIds.richTexts).length > 0
    ? toArray<string>(itemIds.richTexts)
    : richTexts.map((r: any) => String(r.id)).filter(Boolean)

  useBoardStore.setState((state) => {
    const idx = state.boards.findIndex((b) => b.id === boardId)
    const nextBoard = {
      id: boardId,
      userId,
      name: boardPayload?.name || fallbackTitle || 'Board',
      createdAt: boardPayload?.createdAt ? new Date(boardPayload.createdAt) : new Date(),
      lastModified: boardPayload?.updatedAt ? new Date(boardPayload.updatedAt) : new Date(),
      notes: notesIds,
      checklists: checklistIds,
      texts: textIds,
      connections: connectionIds,
      drawings: drawingIds,
      kanbans: kanbanIds,
      medias: mediaIds,
      reminders: reminderIds,
      tables: tableIds,
      richTexts: richTextIds,
      contextType: organizationId ? 'organization' as const : 'personal' as const,
      organizationId: organizationId || undefined,
      backgroundImage: boardPayload?.backgroundImage ?? undefined,
      backgroundColor: boardPayload?.backgroundColor ?? undefined,
      backgroundOverlay: boardPayload?.backgroundOverlay ?? undefined,
      backgroundOverlayColor: boardPayload?.backgroundOverlayColor ?? undefined,
      backgroundBlurLevel: boardPayload?.backgroundBlurLevel ?? undefined,
    }

    if (idx === -1) {
      return { boards: [...state.boards, nextBoard] }
    }

    const updatedBoards = [...state.boards]
    updatedBoards[idx] = {
      ...updatedBoards[idx],
      ...nextBoard,
    }
    return { boards: updatedBoards }
  })

  useNoteStore.setState((s: any) => ({ notes: mergeById(s.notes || [], stickyNotes as any[]) }))
  useChecklistStore.setState((s: any) => ({ checklists: mergeById(s.checklists || [], checklists as any[]) }))
  useTextStore.setState((s: any) => ({ texts: mergeById(s.texts || [], textElements as any[]) }))
  useKanbanStore.setState((s: any) => ({ boards: mergeById(s.boards || [], kanbanBoards as any[]) }))
  useMediaStore.setState((s: any) => ({ medias: mergeById(s.medias || [], mediaItems as any[]) }))
  useDrawingStore.setState((s: any) => ({ drawings: mergeById(s.drawings || [], drawings as any[]) }))
  useConnectionStore.setState((s: any) => ({ connections: mergeById(s.connections || [], connections as any[]) }))
  useReminderStore.setState((s: any) => ({ reminders: mergeById(s.reminders || [], reminders as any[]) }))
  useTableStore.setState((s: any) => ({ tables: mergeById(s.tables || [], tables as any[]) }))
  useRichTextStore.setState((s: any) => ({ docs: mergeById(s.docs || [], richTexts as any[]) }))

  const zData = boardPayload?.zIndexData
  if (zData && typeof zData === 'object') {
    const entries = toArray<{ itemId?: string; zIndex?: number }>(zData.entries)
    if (entries.length > 0) {
      useZIndexStore.setState((s: any) => {
        const merged = { ...(s.zIndexMap || {}) }
        let maxZ = Number(s.counter || 1)
        for (const e of entries) {
          if (!e?.itemId || typeof e.zIndex !== 'number') continue
          merged[String(e.itemId)] = e.zIndex
          if (e.zIndex > maxZ) maxZ = e.zIndex
        }
        return {
          zIndexMap: merged,
          counter: Math.max(maxZ, Number(zData.counter || 1)),
        }
      })
    }
  }
}
