'use client'
import { motion } from 'framer-motion'
import { useOrganizePanelStore } from '../store/organizePanelStore'
import { useNoteStore } from '../store/stickyNoteStore'
import { useChecklistStore } from '../store/checklistStore'
import { useTextStore } from '../store/textStore'
import { StickyNote, ListChecks, Type, Eye, Trash2, X, LayoutGrid, Image, Pencil } from 'lucide-react'
import { useThemeStore } from '../store/themeStore'
import { useRef, useEffect, useState } from 'react'
import { useBoardStore } from '../store/boardStore'
import { useKanbanStore } from '../store/kanbanStore'
import { useMediaStore } from '../store/mediaStore'
import { useDrawingStore } from '../store/drawingStore'
import { useConnectionStore } from '../store/connectionStore'
import { useZIndexStore } from '../store/zIndexStore'
import { DeleteConfirmModal } from './DeleteConfirmModal'

export function OrganizePanel() {
  const { isOpen, togglePanel } = useOrganizePanelStore()
  const isDark = useThemeStore((state) => state.isDark)
  const notes = useNoteStore((state) => state.notes)
  const { deleteNote } = useNoteStore()
  const checklists = useChecklistStore((state) => state.checklists)
  const { deleteChecklist } = useChecklistStore()
  const texts = useTextStore((state) => state.texts)
  const { deleteText } = useTextStore()
  const kanbanBoards = useKanbanStore((state) => state.boards)
  const { removeBoard: deleteKanban } = useKanbanStore()
  const medias = useMediaStore((state) => state.medias)
  const { deleteMedia } = useMediaStore()
  const drawings = useDrawingStore((state) => state.drawings)
  const { deleteDrawing } = useDrawingStore()
  const { removeConnectionsByItemId } = useConnectionStore()
  const { bringToFront } = useZIndexStore()
  const { removeItemFromBoard } = useBoardStore()
  const panelRef = useRef<HTMLDivElement>(null)
  const currentBoard = useBoardStore((state) => 
    state.boards.find(board => board.id === state.currentBoardId)
  )
  const currentBoardId = useBoardStore((state) => state.currentBoardId)

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; type: string } | null>(null)

  // Filter items by current board
  const boardNotes = notes.filter(note => currentBoard?.notes.includes(note.id))
  const boardChecklists = checklists.filter(checklist => currentBoard?.checklists.includes(checklist.id))
  const boardTexts = texts.filter(text => currentBoard?.texts.includes(text.id))
  const boardKanbans = kanbanBoards.filter(kb => currentBoard?.kanbans.includes(kb.id))
  const boardMedias = medias.filter(media => currentBoard?.medias.includes(media.id))
  const boardDrawings = drawings.filter(drawing => currentBoard?.drawings.includes(drawing.id))

  // Scroll viewport to an item's current position instead of teleporting it
  const bringToView = (id: string) => {
    const el = document.querySelector(`[data-item-id="${id}"]`) as HTMLElement | null
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
      bringToFront(id)
    }
  }

  // Perform the actual delete after confirmation
  const confirmDelete = () => {
    if (!deleteTarget || !currentBoardId) return
    const { id, type } = deleteTarget
    removeConnectionsByItemId(id)
    switch (type) {
      case 'note':
        deleteNote(id)
        removeItemFromBoard(currentBoardId, 'notes', id)
        break
      case 'checklist':
        deleteChecklist(id)
        removeItemFromBoard(currentBoardId, 'checklists', id)
        break
      case 'text':
        deleteText(id)
        removeItemFromBoard(currentBoardId, 'texts', id)
        break
      case 'kanban':
        deleteKanban(id)
        removeItemFromBoard(currentBoardId, 'kanbans', id)
        break
      case 'media':
        deleteMedia(id)
        removeItemFromBoard(currentBoardId, 'medias', id)
        break
      case 'drawing':
        deleteDrawing(id)
        removeItemFromBoard(currentBoardId, 'drawings', id)
        break
    }
    useZIndexStore.getState().removeItem(id)
    setDeleteTarget(null)
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        togglePanel()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, togglePanel])

  // Reusable item row
  const ItemRow = ({ id, label, sublabel, type }: { id: string; label: string; sublabel?: string; type: string }) => (
    <div className={`p-3 rounded-lg flex items-center justify-between ${isDark ? 'bg-zinc-700/50' : 'bg-gray-50'}`}>
      <div className="flex-1 min-w-0 mr-2">
        <p className={`text-sm truncate ${isDark ? 'text-white' : 'text-gray-700'}`}>{label}</p>
        {sublabel && <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>{sublabel}</p>}
      </div>
      <div className="flex gap-1 shrink-0">
        <button
          onClick={() => bringToView(id)}
          className="p-1.5 rounded-lg hover:bg-white/10"
          title="Bring to view"
        >
          <Eye size={14} className={isDark ? 'text-white' : 'text-gray-600'} />
        </button>
        <button
          onClick={() => setDeleteTarget({ id, name: label, type })}
          className="p-1.5 rounded-lg hover:bg-red-100/10"
          title={`Delete ${type}`}
        >
          <Trash2 size={14} className="text-red-500" />
        </button>
      </div>
    </div>
  )

  return (
    <motion.div
      ref={panelRef}
      initial={{ x: 400 }}
      animate={{ x: isOpen ? 0 : 400 }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className={`
        fixed right-0 top-0 bottom-0 w-96 z-40
        ${isDark ? 'bg-zinc-800/90' : 'bg-white/90'}
        backdrop-blur-xl border-l
        ${isDark ? 'border-zinc-700/50' : 'border-zinc-200/50'}
      `}
    >
      <div className="p-4 h-full overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-800'}`}>
            Organize Items
          </h2>
          <button
            onClick={togglePanel}
            className={`p-2 rounded-lg hover:bg-gray-100 ${isDark ? 'hover:bg-zinc-700' : ''}`}
          >
            <X size={20} className={isDark ? 'text-white' : 'text-gray-600'} />
          </button>
        </div>

        <div className="space-y-6 pb-8">
          {/* Sticky Notes */}
          <section>
            <h3 className={`text-sm font-medium mb-2 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-600'}`}>
              <StickyNote size={16} />
              Sticky Notes ({boardNotes.length})
            </h3>
            <div className="space-y-2">
              {boardNotes.map(note => (
                <ItemRow key={note.id} id={note.id} label={note.text || 'Untitled Note'} type="note" />
              ))}
              {boardNotes.length === 0 && (
                <p className={`text-xs italic ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>No sticky notes</p>
              )}
            </div>
          </section>

          {/* Checklists */}
          <section>
            <h3 className={`text-sm font-medium mb-2 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-600'}`}>
              <ListChecks size={16} />
              Checklists ({boardChecklists.length})
            </h3>
            <div className="space-y-2">
              {boardChecklists.map(list => (
                <ItemRow key={list.id} id={list.id} label={list.title} sublabel={`${(list.items || []).length} items`} type="checklist" />
              ))}
              {boardChecklists.length === 0 && (
                <p className={`text-xs italic ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>No checklists</p>
              )}
            </div>
          </section>

          {/* Kanban Boards */}
          <section>
            <h3 className={`text-sm font-medium mb-2 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-600'}`}>
              <LayoutGrid size={16} />
              Kanban Boards ({boardKanbans.length})
            </h3>
            <div className="space-y-2">
              {boardKanbans.map(kb => (
                <ItemRow key={kb.id} id={kb.id} label={kb.title} sublabel={`${kb.columns.length} columns`} type="kanban" />
              ))}
              {boardKanbans.length === 0 && (
                <p className={`text-xs italic ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>No kanban boards</p>
              )}
            </div>
          </section>

          {/* Media */}
          <section>
            <h3 className={`text-sm font-medium mb-2 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-600'}`}>
              <Image size={16} />
              Media ({boardMedias.length})
            </h3>
            <div className="space-y-2">
              {boardMedias.map(media => (
                <ItemRow key={media.id} id={media.id} label={media.title || `${media.type} media`} sublabel={media.type} type="media" />
              ))}
              {boardMedias.length === 0 && (
                <p className={`text-xs italic ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>No media</p>
              )}
            </div>
          </section>

          {/* Text Elements */}
          <section>
            <h3 className={`text-sm font-medium mb-2 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-600'}`}>
              <Type size={16} />
              Text Elements ({boardTexts.length})
            </h3>
            <div className="space-y-2">
              {boardTexts.map(text => (
                <ItemRow key={text.id} id={text.id} label={text.text || 'Untitled Text'} type="text" />
              ))}
              {boardTexts.length === 0 && (
                <p className={`text-xs italic ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>No text elements</p>
              )}
            </div>
          </section>

          {/* Drawings */}
          <section>
            <h3 className={`text-sm font-medium mb-2 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-600'}`}>
              <Pencil size={16} />
              Drawings ({boardDrawings.length})
            </h3>
            <div className="space-y-2">
              {boardDrawings.map(drawing => (
                <ItemRow key={drawing.id} id={drawing.id} label={`Drawing ${drawing.id.slice(0, 6)}`} sublabel={`${drawing.paths.length} paths`} type="drawing" />
              ))}
              {boardDrawings.length === 0 && (
                <p className={`text-xs italic ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>No drawings</p>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <DeleteConfirmModal
          isOpen={true}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
          itemName={deleteTarget.name}
          itemType={deleteTarget.type}
        />
      )}
    </motion.div>
  )
}
