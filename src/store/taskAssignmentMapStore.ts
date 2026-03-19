import { create } from 'zustand'
import type { TaskAssignmentDTO } from '@/types/delegation'

/**
 * Lightweight lookup map: sourceId → assignment metadata.
 * Populated whenever delegation store fetches assignments.
 * Used by checklist/kanban stores to fire DB sync on completion toggling.
 */

interface MappedAssignment {
  assignmentId: string
  status: 'draft' | 'assigned' | 'completed'
  contextType: 'personal' | 'organization'
  sourceType: string
}

interface TaskAssignmentMapStore {
  /** Map from sourceId → assignment info (only active, non-deleted, non-draft) */
  map: Map<string, MappedAssignment>

  /** True while syncAssignmentsToLocalStores is running — suppresses DB writes */
  _syncingFromDb: boolean

  /** Rebuild map from a list of assignments */
  buildMap: (assignments: TaskAssignmentDTO[], contextType: 'personal' | 'organization') => void

  /** Merge personal assignments into the map without clearing org assignments */
  mergePersonalMap: (assignments: TaskAssignmentDTO[]) => void

  /** Look up an assignment for a given source item */
  getAssignment: (sourceId: string) => MappedAssignment | undefined

  /** Fire-and-forget: sync completion toggle to DB. Returns void — never throws. */
  syncCompletionToDb: (sourceId: string, isNowCompleted: boolean) => void

  /** Fire-and-forget: sync kanban column move to DB. Returns void — never throws. */
  syncColumnMoveToDb: (sourceId: string, columnId: string, columnTitle: string) => void
}

export const useTaskAssignmentMapStore = create<TaskAssignmentMapStore>((set, get) => ({
  map: new Map(),
  _syncingFromDb: false,

  buildMap: (assignments, contextType) => {
    const newMap = new Map<string, MappedAssignment>()
    // Preserve personal entries if we're rebuilding org, and vice versa
    const existing = get().map
    for (const [key, value] of existing) {
      if (value.contextType !== contextType) {
        newMap.set(key, value)
      }
    }
    for (const a of assignments) {
      if (a.isDeleted || a.status === 'draft') continue
      newMap.set(a.sourceId, {
        assignmentId: a._id,
        status: a.status,
        contextType,
        sourceType: a.sourceType,
      })
    }
    set({ map: newMap })
  },

  mergePersonalMap: (assignments) => {
    get().buildMap(assignments, 'personal')
  },

  getAssignment: (sourceId) => {
    return get().map.get(sourceId)
  },

  syncCompletionToDb: (sourceId, isNowCompleted) => {
    if (get()._syncingFromDb) return
    const entry = get().map.get(sourceId)
    if (!entry) return

    // Only sync if the DB status actually differs
    const dbIsCompleted = entry.status === 'completed'
    if (dbIsCompleted === isNowCompleted) return

    const url = entry.contextType === 'personal'
      ? `/api/personal/assignments/${entry.assignmentId}/complete`
      : `/api/execution/tasks/${entry.assignmentId}/complete`

    // Fire-and-forget POST
    fetch(url, { method: 'POST' })
      .then((res) => {
        if (res.ok) {
          // Update the local map to reflect the new status
          const current = get().map.get(sourceId)
          if (current) {
            const updated = new Map(get().map)
            updated.set(sourceId, {
              ...current,
              status: isNowCompleted ? 'completed' : 'assigned',
            })
            set({ map: updated })
          }
        }
      })
      .catch(() => {
        // Silent — user is on the board, they'll see the YJS state.
        // The next board open will reconcile via fetchAssignments.
      })
  },

  syncColumnMoveToDb: (sourceId, columnId, columnTitle) => {
    if (get()._syncingFromDb) return
    const entry = get().map.get(sourceId)
    if (!entry || entry.sourceType !== 'kanban_task') return

    const url = entry.contextType === 'personal'
      ? `/api/personal/assignments/${entry.assignmentId}/update`
      : `/api/execution/tasks/${entry.assignmentId}/update`

    fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId, columnTitle }),
    }).catch(() => {
      // Silent — YJS is the source of truth on the board.
    })
  },
}))
