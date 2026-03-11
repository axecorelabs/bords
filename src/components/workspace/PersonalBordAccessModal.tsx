'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Users, Loader2, Check, Handshake, Eye, Pencil, CloudOff } from 'lucide-react'
import { useThemeStore } from '@/store/themeStore'
import { useBoardSyncStore } from '@/store/boardSyncStore'
import { useWorkspaceStore, type Friend } from '@/store/workspaceStore'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'react-hot-toast'

interface AccessEntry {
  userId: string
  permission: 'view' | 'edit'
  email: string
}

interface Props {
  localBoardId: string
  boardTitle: string
  isOpen: boolean
  onClose: () => void
}

/**
 * PersonalBordAccessModal — lets the board owner share their personal
 * board with accepted friends, setting view/edit permissions per friend.
 *
 * Uses BoardDocument.sharedWith (System B) via the existing share API.
 */
export function PersonalBordAccessModal({ localBoardId, boardTitle, isOpen, onClose }: Props) {
  const isDark = useThemeStore((s) => s.isDark)
  const { getShareSettings, addShareUser, removeShareUser, updateSharePermission } = useBoardSyncStore()
  const friends = useWorkspaceStore((s) => s.friends)

  const [accessMap, setAccessMap] = useState<Record<string, 'view' | 'edit'>>({})
  const [originalMap, setOriginalMap] = useState<Record<string, 'view' | 'edit'>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [notSynced, setNotSynced] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Only show accepted friends
  const acceptedFriends = friends.filter((f) => f.status === 'accepted')

  useEffect(() => {
    if (!isOpen) return
    setIsLoading(true)
    setNotSynced(false)

    // With Y.Doc as source of truth, boards are always cloud-synced
    // No need to check contentHashes

    // Fetch current share settings from the existing share API
    getShareSettings(localBoardId).then((data) => {
      if (data) {
        const map: Record<string, 'view' | 'edit'> = {}
        for (const entry of data.sharedWith || []) {
          map[entry.userId] = entry.permission as 'view' | 'edit'
        }
        setAccessMap(map)
        setOriginalMap(map)
      }
      setIsLoading(false)
    })
  }, [isOpen, localBoardId, getShareSettings])

  const toggleAccess = (userId: string) => {
    setAccessMap((prev) => {
      if (prev[userId]) {
        const next = { ...prev }
        delete next[userId]
        return next
      }
      return { ...prev, [userId]: 'view' }
    })
  }

  const selectAll = (permission: 'view' | 'edit' = 'view') => {
    const map: Record<string, 'view' | 'edit'> = {}
    for (const f of acceptedFriends) {
      map[f.userId] = permission
    }
    setAccessMap(map)
  }

  const deselectAll = () => {
    setAccessMap({})
  }

  const accessCount = Object.keys(accessMap).length

  const handleSave = async () => {
    setIsSaving(true)

    try {
      // Determine diffs: added, removed, permission-changed
      const newUserIds = new Set(Object.keys(accessMap))
      const oldUserIds = new Set(Object.keys(originalMap))

      // Users to add (in new but not in original)
      for (const userId of newUserIds) {
        if (!oldUserIds.has(userId)) {
          const friend = acceptedFriends.find((f) => f.userId === userId)
          if (friend) {
            await addShareUser(localBoardId, friend.email, accessMap[userId])
          }
        }
      }

      // Users to remove (in original but not in new)
      for (const userId of oldUserIds) {
        if (!newUserIds.has(userId)) {
          await removeShareUser(localBoardId, userId)
        }
      }

      // Users whose permission changed
      for (const userId of newUserIds) {
        if (oldUserIds.has(userId) && accessMap[userId] !== originalMap[userId]) {
          await updateSharePermission(localBoardId, userId, accessMap[userId])
        }
      }

      toast.success('Friend access updated')
      onClose()
    } catch {
      toast.error('Failed to update access')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            className={`w-full max-w-md mx-4 rounded-2xl shadow-2xl border overflow-hidden max-h-[80vh] flex flex-col ${
              isDark
                ? 'bg-zinc-800 border-zinc-700'
                : 'bg-white border-zinc-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className={`flex items-center justify-between px-5 py-4 border-b ${
                isDark ? 'border-zinc-700' : 'border-zinc-200'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`p-2 rounded-lg ${
                    isDark ? 'bg-zinc-700' : 'bg-zinc-100'
                  }`}
                >
                  <Handshake
                    size={16}
                    className={isDark ? 'text-zinc-300' : 'text-zinc-600'}
                  />
                </div>
                <div className="min-w-0">
                  <h3
                    className={`font-semibold text-sm ${
                      isDark ? 'text-white' : 'text-zinc-900'
                    }`}
                  >
                    Share with Friends
                  </h3>
                  <p
                    className={`text-xs truncate ${
                      isDark ? 'text-zinc-500' : 'text-zinc-400'
                    }`}
                  >
                    {boardTitle}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className={`p-1.5 rounded-lg ${
                  isDark
                    ? 'hover:bg-zinc-700 text-zinc-400'
                    : 'hover:bg-zinc-100 text-zinc-500'
                }`}
              >
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={20} className="animate-spin text-zinc-400" />
                </div>
              ) : notSynced ? (
                <div
                  className={`text-center py-8 ${
                    isDark ? 'text-zinc-500' : 'text-zinc-400'
                  }`}
                >
                  <CloudOff size={28} className="mx-auto mb-2 opacity-50" />
                  <p className={`text-sm font-medium ${
                    isDark ? 'text-zinc-300' : 'text-zinc-600'
                  }`}>Board not synced</p>
                  <p className="text-xs mt-1">
                    Sync this board to the cloud first before sharing with friends.
                  </p>
                </div>
              ) : acceptedFriends.length === 0 ? (
                <div
                  className={`text-center py-8 ${
                    isDark ? 'text-zinc-500' : 'text-zinc-400'
                  }`}
                >
                  <Users size={28} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No friends yet</p>
                  <p className="text-xs mt-0.5">
                    Add friends to your workspace first to share boards
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p
                      className={`text-[10px] font-bold uppercase tracking-wider ${
                        isDark ? 'text-zinc-500' : 'text-zinc-400'
                      }`}
                    >
                      Friends ({acceptedFriends.length})
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => selectAll('view')}
                        className={`text-[10px] font-medium ${
                          isDark
                            ? 'text-blue-400 hover:text-blue-300'
                            : 'text-blue-600 hover:text-blue-700'
                        }`}
                      >
                        All view
                      </button>
                      <button
                        onClick={() => selectAll('edit')}
                        className={`text-[10px] font-medium ${
                          isDark
                            ? 'text-emerald-400 hover:text-emerald-300'
                            : 'text-emerald-600 hover:text-emerald-700'
                        }`}
                      >
                        All edit
                      </button>
                      <button
                        onClick={deselectAll}
                        className={`text-[10px] font-medium ${
                          isDark
                            ? 'text-zinc-400 hover:text-zinc-300'
                            : 'text-zinc-500 hover:text-zinc-600'
                        }`}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    {acceptedFriends.map((friend) => {
                      const permission = accessMap[friend.userId]
                      const hasAccess = !!permission
                      const displayName = friend.nickname
                        || `${friend.firstName} ${friend.lastName}`.trim()
                        || friend.email
                      return (
                        <div
                          key={friend.userId}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors cursor-pointer ${
                            hasAccess
                              ? isDark
                                ? 'bg-blue-500/10 hover:bg-blue-500/15'
                                : 'bg-blue-50 hover:bg-blue-100/80'
                              : isDark
                                ? 'hover:bg-zinc-700/50'
                                : 'hover:bg-zinc-50'
                          }`}
                          onClick={() => toggleAccess(friend.userId)}
                        >
                          {/* Avatar */}
                          <div
                            className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${
                              hasAccess
                                ? isDark
                                  ? 'bg-blue-500/20 text-blue-400'
                                  : 'bg-blue-100 text-blue-600'
                                : isDark
                                  ? 'bg-zinc-700 text-zinc-400'
                                  : 'bg-zinc-200 text-zinc-500'
                            }`}
                          >
                            {friend.image ? (
                              <img
                                src={friend.image}
                                alt=""
                                className="w-full h-full rounded-full object-cover"
                              />
                            ) : (
                              (friend.firstName?.[0] || friend.email?.[0] || '?').toUpperCase()
                            )}
                          </div>

                          {/* Name & email */}
                          <div className="flex-1 min-w-0 text-left">
                            <p
                              className={`text-sm font-medium truncate ${
                                isDark ? 'text-zinc-200' : 'text-zinc-900'
                              }`}
                            >
                              {displayName}
                            </p>
                            <p
                              className={`text-xs truncate ${
                                isDark ? 'text-zinc-500' : 'text-zinc-400'
                              }`}
                            >
                              {friend.email}
                            </p>
                          </div>

                          {/* Permission toggle — only show when friend has access */}
                          {hasAccess && (
                            <div
                              className={`flex rounded-lg overflow-hidden border flex-shrink-0 ${
                                isDark ? 'border-zinc-600' : 'border-zinc-200'
                              }`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={() => setAccessMap((prev) => ({ ...prev, [friend.userId]: 'view' }))}
                                className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                  permission === 'view'
                                    ? isDark
                                      ? 'bg-blue-500/20 text-blue-400'
                                      : 'bg-blue-50 text-blue-600'
                                    : isDark
                                      ? 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                                      : 'bg-white text-zinc-400 hover:text-zinc-600'
                                }`}
                              >
                                <Eye size={10} />
                                View
                              </button>
                              <div className={`w-px ${isDark ? 'bg-zinc-600' : 'bg-zinc-200'}`} />
                              <button
                                onClick={() => setAccessMap((prev) => ({ ...prev, [friend.userId]: 'edit' }))}
                                className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                  permission === 'edit'
                                    ? isDark
                                      ? 'bg-emerald-500/20 text-emerald-400'
                                      : 'bg-emerald-50 text-emerald-600'
                                    : isDark
                                      ? 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                                      : 'bg-white text-zinc-400 hover:text-zinc-600'
                                }`}
                              >
                                <Pencil size={10} />
                                Edit
                              </button>
                            </div>
                          )}

                          {/* Checkbox */}
                          <div
                            className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${
                              hasAccess
                                ? 'bg-blue-500 border-blue-500'
                                : isDark
                                  ? 'border-zinc-600'
                                  : 'border-zinc-300'
                            }`}
                          >
                            {hasAccess && (
                              <Check size={12} className="text-white" />
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            {!isLoading && !notSynced && acceptedFriends.length > 0 && (
              <div
                className={`px-5 py-4 border-t flex items-center justify-between ${
                  isDark ? 'border-zinc-700' : 'border-zinc-200'
                }`}
              >
                <p
                  className={`text-xs ${
                    isDark ? 'text-zinc-500' : 'text-zinc-400'
                  }`}
                >
                  {accessCount === 0
                    ? 'Only you can access this board'
                    : `${accessCount} friend${accessCount !== 1 ? 's' : ''} can access`}
                </p>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5 transition-colors ${
                    isDark
                      ? 'bg-white text-black hover:bg-zinc-200 disabled:opacity-40'
                      : 'bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-40'
                  }`}
                >
                  {isSaving && <Loader2 size={14} className="animate-spin" />}
                  Save
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
