'use client'

import { useState } from 'react'
import {
  X, GitMerge, AlertTriangle, Check, Loader2,
  StickyNote, ListChecks, Columns3, Image, Type,
  Pencil, MessageSquare, Cable, Bell, Layout,
} from 'lucide-react'
import { useThemeStore } from '@/store/themeStore'
import { useBoardSyncStore, type MergeState } from '@/store/boardSyncStore'
import { useBoardStore } from '@/store/boardStore'
import { type MergeConflict } from '@/lib/boardMerge'
import { COLLECTION_LABELS } from '@/lib/boardDiff'
import { motion, AnimatePresence } from 'framer-motion'

/* ── Icon per collection type ── */
const COLLECTION_ICONS: Record<string, any> = {
  stickyNotes:  StickyNote,
  checklists:   ListChecks,
  kanbanBoards: Columns3,
  mediaItems:   Image,
  textElements: Type,
  drawings:     Pencil,
  comments:     MessageSquare,
  connections:  Cable,
  reminders:    Bell,
  _board:       Layout,
}

/* ── Main component ── */

export function MergeConflictModal() {
  const isDark = useThemeStore((s) => s.isDark)
  const mergeState = useBoardSyncStore((s) => s.mergeState)
  const resolveConflicts = useBoardSyncStore((s) => s.resolveConflicts)
  const dismissMerge = useBoardSyncStore((s) => s.dismissMerge)
  const loadBoardFromCloud = useBoardSyncStore((s) => s.loadBoardFromCloud)
  const isSyncing = useBoardSyncStore((s) => s.isSyncing)
  const boardPermissions = useBoardSyncStore((s) => s.boardPermissions)
  const currentBoardId = useBoardStore((s) => s.currentBoardId)
  const isViewOnly = boardPermissions[currentBoardId || ''] === 'view'

  const [resolutions, setResolutions] = useState<Record<string, 'local' | 'cloud' | 'both'>>({})

  if (!mergeState) return null

  const { conflicts, autoResolved, boardName } = mergeState
  const isFullBoardConflict = conflicts.length === 1 && conflicts[0].itemId === '_board'
  const allResolved = conflicts.every((c) => {
    const key = `${c.collection}:${c.itemId}`
    return !!resolutions[key]
  })

  const setResolution = (conflict: MergeConflict, value: 'local' | 'cloud' | 'both') => {
    const key = `${conflict.collection}:${conflict.itemId}`
    setResolutions((prev) => ({ ...prev, [key]: value }))
  }

  const handleApply = () => {
    if (isViewOnly) {
      // Viewers can't sync back — just load the cloud version
      if (currentBoardId) {
        loadBoardFromCloud(currentBoardId)
        dismissMerge()
      }
      return
    }
    if (!allResolved) return
    resolveConflicts(resolutions)
  }

  const getIcon = (collection: string) => {
    return COLLECTION_ICONS[collection] || Layout
  }

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]"
        onClick={dismissMerge}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className={`w-full max-w-lg mx-4 rounded-2xl shadow-2xl border overflow-hidden max-h-[85vh] flex flex-col ${
            isDark
              ? 'bg-zinc-800 border-zinc-700'
              : 'bg-white border-zinc-200'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Header ── */}
          <div
            className={`flex items-center justify-between px-5 py-4 border-b ${
              isDark ? 'border-zinc-700' : 'border-zinc-200'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className={`p-2 rounded-lg ${isDark ? 'bg-amber-500/10' : 'bg-amber-50'}`}>
                <GitMerge size={18} className="text-amber-500" />
              </div>
              <div className="min-w-0">
                <h3 className={`font-semibold text-sm ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                  Merge Conflicts
                </h3>
                <p className={`text-xs truncate ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  {boardName}
                </p>
              </div>
            </div>
            <button
              onClick={dismissMerge}
              className={`p-1.5 rounded-lg ${
                isDark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-500'
              }`}
            >
              <X size={16} />
            </button>
          </div>

          {/* ── Content ── */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

            {/* Auto-resolved summary */}
            {autoResolved.length > 0 && (
              <div className={`rounded-xl px-4 py-3 ${isDark ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-emerald-50 border border-emerald-100'}`}>
                <div className="flex items-center gap-2">
                  <Check size={14} className="text-emerald-500 flex-shrink-0" />
                  <p className={`text-xs font-medium ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>
                    {autoResolved.length} change{autoResolved.length !== 1 ? 's' : ''} merged automatically
                  </p>
                </div>
              </div>
            )}

            {/* Conflict description */}
            <div className={`flex items-start gap-2 text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
              <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p>
                {isViewOnly
                  ? 'This board has been updated by an editor. Click "Apply Changes" to load the latest version.'
                  : isFullBoardConflict
                    ? 'Another editor changed this board but no merge base is available. Choose which version to keep.'
                    : `${conflicts.length} conflict${conflicts.length !== 1 ? 's' : ''} need${conflicts.length === 1 ? 's' : ''} your attention. For each, choose which version to keep.`
                }
              </p>
            </div>

            {/* Conflict cards — hidden for viewers who just apply the cloud version */}
            {!isViewOnly && (
            <div className="space-y-3">
              {conflicts.map((conflict) => {
                const key = `${conflict.collection}:${conflict.itemId}`
                const chosen = resolutions[key]
                const Icon = getIcon(conflict.collection)
                const label = COLLECTION_LABELS[conflict.collection] || conflict.collection
                const showBoth = conflict.type === 'both_modified' || conflict.type === 'both_added'

                return (
                  <div
                    key={key}
                    className={`rounded-xl border p-4 transition-colors ${
                      chosen
                        ? isDark
                          ? 'border-blue-500/30 bg-blue-500/5'
                          : 'border-blue-200 bg-blue-50/50'
                        : isDark
                          ? 'border-zinc-700 bg-zinc-800/50'
                          : 'border-zinc-200 bg-zinc-50'
                    }`}
                  >
                    {/* Conflict header */}
                    <div className="flex items-start gap-3 mb-3">
                      <div className={`p-1.5 rounded-lg flex-shrink-0 ${isDark ? 'bg-zinc-700' : 'bg-zinc-100'}`}>
                        <Icon size={14} className={isDark ? 'text-zinc-400' : 'text-zinc-500'} />
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>
                          {isFullBoardConflict ? 'Entire Board' : label}
                        </p>
                        <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                          {conflict.description}
                        </p>
                      </div>
                    </div>

                    {/* Item preview for non-board conflicts */}
                    {!isFullBoardConflict && (conflict.localVersion || conflict.cloudVersion) && (
                      <div className={`grid ${showBoth ? 'grid-cols-2' : 'grid-cols-1'} gap-2 mb-3`}>
                        {conflict.localVersion && (
                          <ItemPreview
                            label="Your version"
                            item={conflict.localVersion}
                            isDark={isDark}
                            color="blue"
                          />
                        )}
                        {conflict.cloudVersion && (
                          <ItemPreview
                            label="Their version"
                            item={conflict.cloudVersion}
                            isDark={isDark}
                            color="purple"
                          />
                        )}
                      </div>
                    )}

                    {/* Resolution buttons */}
                    <div className="flex gap-2 flex-wrap">
                      {conflict.type === 'delete_vs_modify' && !conflict.localVersion ? (
                        <>
                          <ResolutionButton
                            label="Delete It"
                            value="local"
                            chosen={chosen}
                            isDark={isDark}
                            onClick={() => setResolution(conflict, 'local')}
                          />
                          <ResolutionButton
                            label="Keep Modified"
                            value="cloud"
                            chosen={chosen}
                            isDark={isDark}
                            onClick={() => setResolution(conflict, 'cloud')}
                          />
                        </>
                      ) : conflict.type === 'delete_vs_modify' && !conflict.cloudVersion ? (
                        <>
                          <ResolutionButton
                            label="Keep Modified"
                            value="local"
                            chosen={chosen}
                            isDark={isDark}
                            onClick={() => setResolution(conflict, 'local')}
                          />
                          <ResolutionButton
                            label="Delete It"
                            value="cloud"
                            chosen={chosen}
                            isDark={isDark}
                            onClick={() => setResolution(conflict, 'cloud')}
                          />
                        </>
                      ) : (
                        <>
                          <ResolutionButton
                            label="Keep Mine"
                            value="local"
                            chosen={chosen}
                            isDark={isDark}
                            onClick={() => setResolution(conflict, 'local')}
                          />
                          <ResolutionButton
                            label="Take Theirs"
                            value="cloud"
                            chosen={chosen}
                            isDark={isDark}
                            onClick={() => setResolution(conflict, 'cloud')}
                          />
                          {showBoth && !isFullBoardConflict && (
                            <ResolutionButton
                              label="Keep Both"
                              value="both"
                              chosen={chosen}
                              isDark={isDark}
                              onClick={() => setResolution(conflict, 'both')}
                            />
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            )}
          </div>

          {/* ── Footer ── */}
          <div
            className={`px-5 py-4 border-t flex items-center justify-between ${
              isDark ? 'border-zinc-700' : 'border-zinc-200'
            }`}
          >
            <button
              onClick={dismissMerge}
              className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                isDark
                  ? 'text-zinc-400 hover:bg-zinc-700/50'
                  : 'text-zinc-500 hover:bg-zinc-100'
              }`}
            >
              {isViewOnly ? 'Dismiss' : 'Cancel (keep local)'}
            </button>
            <button
              onClick={handleApply}
              disabled={isViewOnly ? isSyncing : (!allResolved || isSyncing)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5 transition-colors ${
                (isViewOnly || allResolved) && !isSyncing
                  ? isDark
                    ? 'bg-white text-black hover:bg-zinc-200'
                    : 'bg-zinc-900 text-white hover:bg-zinc-800'
                  : isDark
                    ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                    : 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
              }`}
            >
              {isSyncing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <GitMerge size={14} />
              )}
              {isSyncing ? 'Updating…' : isViewOnly ? 'Apply Changes' : 'Apply & Sync'}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}

/* ── Sub-components ── */

function ItemPreview({
  label,
  item,
  isDark,
  color,
}: {
  label: string
  item: any
  isDark: boolean
  color: 'blue' | 'purple'
}) {
  const preview =
    item?.title || item?.name || item?.text || item?.content || item?.id || '—'
  const truncated = typeof preview === 'string' && preview.length > 60
    ? preview.slice(0, 60) + '…'
    : preview

  const colorClasses = color === 'blue'
    ? isDark ? 'border-blue-500/20 bg-blue-500/5' : 'border-blue-200 bg-blue-50'
    : isDark ? 'border-purple-500/20 bg-purple-500/5' : 'border-purple-200 bg-purple-50'

  const labelColor = color === 'blue'
    ? isDark ? 'text-blue-400' : 'text-blue-600'
    : isDark ? 'text-purple-400' : 'text-purple-600'

  return (
    <div className={`rounded-lg border px-3 py-2 ${colorClasses}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${labelColor}`}>
        {label}
      </p>
      <p className={`text-xs truncate ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
        {truncated}
      </p>
      {item?.position && (
        <p className={`text-[10px] mt-0.5 ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
          pos: {Math.round(item.position.x)}, {Math.round(item.position.y)}
        </p>
      )}
    </div>
  )
}

function ResolutionButton({
  label,
  value,
  chosen,
  isDark,
  onClick,
}: {
  label: string
  value: 'local' | 'cloud' | 'both'
  chosen: 'local' | 'cloud' | 'both' | undefined
  isDark: boolean
  onClick: () => void
}) {
  const isActive = chosen === value

  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
        isActive
          ? value === 'local'
            ? 'bg-blue-500 text-white shadow-sm'
            : value === 'cloud'
              ? 'bg-purple-500 text-white shadow-sm'
              : 'bg-emerald-500 text-white shadow-sm'
          : isDark
            ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
      }`}
    >
      {isActive && <Check size={10} className="inline mr-1 -mt-0.5" />}
      {label}
    </button>
  )
}
