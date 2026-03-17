'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { MessageCircle, Send, Trash2, X, Loader2 } from 'lucide-react'
import { useCommentStore, Comment } from '../store/commentStore'
import { format, isToday, isYesterday } from 'date-fns'
import { toast } from 'react-hot-toast'
import { useBoardStore } from '../store/boardStore'
import { useThemeStore } from '../store/themeStore'
import { useBoardSyncStore } from '../store/boardSyncStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useSession } from '@/components/AuthProvider'
import { createClient } from '@/lib/supabase/client'

interface CommentsProps {
  onClose: () => void
}

export function Comments({ onClose }: CommentsProps) {
  const { data: session } = useSession()
  const currentBoardId = useBoardStore((state) => state.currentBoardId)
  const isDark = useThemeStore((state) => state.isDark)

  // Local store (fallback for non-synced boards)
  const localComments = useCommentStore((state) => state.localComments)
  const addLocalComment = useCommentStore((state) => state.addLocalComment)
  const deleteLocalComment = useCommentStore((state) => state.deleteLocalComment)

  // Is this a synced/shared board?
  const boardPermission = useBoardSyncStore(
    (s) => (currentBoardId ? s.boardPermissions[currentBoardId] : undefined) || 'owner'
  )
  const isSyncedBoard = boardPermission === 'view' || boardPermission === 'edit' || boardPermission === 'owner'

  // Permission checks
  const activeContext = useWorkspaceStore((s) => s.activeContext)
  const orgContainerWorkspace = useWorkspaceStore((s) => s.orgContainerWorkspace)
  const isOrgOwner = activeContext?.type === 'organization'
    && orgContainerWorkspace?.organizations?.some(
      (org) => org._id === (activeContext as any).organizationId && org.isOwner
    )
  const isBoardOwner = boardPermission === 'owner'
  const canDeleteAny = isBoardOwner || isOrgOwner

  // Server-side comments state
  const [serverComments, setServerComments] = useState<Comment[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [isSending, setIsSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)

  // Choose which comments to display
  const comments = isSyncedBoard
    ? serverComments
    : localComments.filter(c => c.boardId === currentBoardId)

  // Oldest first — chronological (chat style)
  const sortedComments = [...comments].sort(
    (a: any, b: any) => new Date(a.created_at ?? a.createdAt).getTime() - new Date(b.created_at ?? b.createdAt).getTime()
  )

  // Auto-scroll to bottom when new comments arrive
  useEffect(() => {
    if (comments.length > prevCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevCountRef.current = comments.length
  }, [comments.length])

  // Scroll to bottom on initial load
  const didInitialScroll = useRef(false)
  useEffect(() => {
    if (!isLoading && comments.length > 0 && !didInitialScroll.current) {
      didInitialScroll.current = true
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'instant' as any }))
    }
  }, [isLoading, comments.length])

  // Date separator helper
  const formatDateSeparator = (dateStr: string) => {
    const d = new Date(dateStr)
    if (isToday(d)) return 'Today'
    if (isYesterday(d)) return 'Yesterday'
    return format(d, 'MMM d, yyyy')
  }

  // Fetch full comments list from API
  const fetchComments = useCallback(async () => {
    if (!currentBoardId || !isSyncedBoard) return
    try {
      const res = await fetch(`/api/boards/${currentBoardId}/comments`)
      if (!res.ok) return
      const data = await res.json()
      if (data.comments) {
        setServerComments(data.comments)
      }
    } catch { /* silent */ }
  }, [currentBoardId, isSyncedBoard])

  // Sync serverComments.length → realtimeCount in a separate effect (avoids setState-in-render)
  useEffect(() => {
    if (isSyncedBoard && currentBoardId) {
      useCommentStore.getState().setRealtimeCount(currentBoardId, serverComments.length)
    }
  }, [serverComments.length, isSyncedBoard, currentBoardId])

  // Mark comments as read when the panel opens, and again when it unmounts
  useEffect(() => {
    if (!isSyncedBoard || !currentBoardId) return
    const markRead = () => {
      useCommentStore.getState().markRead(currentBoardId)
      fetch(`/api/boards/${currentBoardId}/comments/unread`, { method: 'POST' }).catch(() => {})
    }
    // Mark read on open (after initial fetch completes)
    const timer = setTimeout(markRead, 300)
    return () => {
      clearTimeout(timer)
      // Mark read on close
      markRead()
    }
  }, [isSyncedBoard, currentBoardId])

  // Supabase Realtime subscription for live comment updates
  useEffect(() => {
    if (!isSyncedBoard || !currentBoardId) return

    setIsLoading(true)

    // Initial fetch
    fetchComments().finally(() => setIsLoading(false))

    // Subscribe to Realtime changes on board_comments table
    const supabase = createClient()
    const channel = supabase
      .channel(`board-comments:${currentBoardId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'board_comments',
          filter: `board_id=eq.${currentBoardId}`,
        },
        (payload) => {
          const newRow = payload.new as Comment
          setServerComments((prev) => {
            if (prev.some(c => c.id === newRow.id)) return prev
            return [...prev, newRow]
          })
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'board_comments',
          filter: `board_id=eq.${currentBoardId}`,
        },
        (payload) => {
          const deletedId = (payload.old as any).id
          setServerComments((prev) => prev.filter(c => c.id !== deletedId))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchComments is stable via useCallback
  }, [isSyncedBoard, currentBoardId])

  // Submit comment
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newComment.trim() || !currentBoardId) return

    const text = newComment.trim()
    setNewComment('')

    if (isSyncedBoard) {
      // Post to API — Realtime subscription will add it automatically
      setIsSending(true)
      try {
        const res = await fetch(`/api/boards/${currentBoardId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
        if (!res.ok) {
          const err = await res.json()
          toast.error(err.error || 'Failed to post comment')
          setNewComment(text) // restore
          return
        }
        const data = await res.json()
        // Optimistically add (Realtime will dedupe via id check)
        setServerComments(prev => {
          if (prev.some(c => c.id === data.comment.id)) return prev
          return [...prev, data.comment]
        })
      } catch {
        toast.error('Failed to post comment')
        setNewComment(text)
      } finally {
        setIsSending(false)
      }
    } else {
      // Local-only board
      addLocalComment(text, currentBoardId, session?.user ? {
        id: session.user.id || session.user.email || '',
        name: session.user.name || session.user.email || 'Anonymous',
        email: session.user.email || '',
      } : undefined)
    }
  }

  // Delete comment
  const handleDelete = async (commentId: string) => {
    if (isSyncedBoard) {
      // Optimistically remove — Realtime will confirm
      setServerComments(prev => prev.filter(c => c.id !== commentId))
      try {
        const res = await fetch(`/api/boards/${currentBoardId}/comments`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commentId }),
        })
        if (!res.ok) {
          const err = await res.json()
          toast.error(err.error || 'Failed to delete comment')
          // Re-fetch to restore
          fetchComments()
        }
      } catch {
        toast.error('Failed to delete comment')
        fetchComments()
      }
    } else {
      deleteLocalComment(commentId)
    }
  }

  // Get initials from name or email
  const getInitials = (name?: string, email?: string) => {
    if (name && name !== email) {
      return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    }
    if (email) return email[0].toUpperCase()
    return '?'
  }

  // Generate consistent color from string
  const getAvatarColor = (str?: string) => {
    const colors = [
      'bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-rose-500',
      'bg-orange-500', 'bg-amber-500', 'bg-emerald-500', 'bg-teal-500',
      'bg-cyan-500', 'bg-indigo-500', 'bg-violet-500', 'bg-fuchsia-500',
    ]
    if (!str) return colors[0]
    let hash = 0
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
    return colors[Math.abs(hash) % colors.length]
  }

  // Can user delete this specific comment?
  const canDelete = (comment: any) => {
    if (canDeleteAny) return true
    const userId = session?.user?.id || session?.user?.email
    if (!userId) return false
    // Server comments use user_id, local comments use authorId/authorEmail
    return comment.user_id === userId || comment.authorId === userId || comment.authorEmail === session?.user?.email
  }

  return (
    <>
      {/* Backdrop — click outside to close */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[199]"
      />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 250 }}
      className={`fixed top-0 right-0 h-full w-[480px] max-w-[90vw] z-[200] shadow-2xl flex flex-col ${
        isDark
          ? 'bg-zinc-900 border-l border-zinc-700/50'
          : 'bg-white border-l border-zinc-200'
      }`}
    >
      {/* Header */}
      <div className={`flex-shrink-0 flex items-center justify-between px-5 py-4 border-b ${
        isDark ? 'border-zinc-700/50' : 'border-zinc-200'
      }`}>
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded-lg ${isDark ? 'bg-blue-500/15' : 'bg-blue-50'}`}>
            <MessageCircle size={18} className="text-blue-500" />
          </div>
          <div>
            <h3 className={`font-semibold text-sm ${isDark ? 'text-white' : 'text-zinc-900'}`}>
              Comments
            </h3>
            <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
              {comments.length} comment{comments.length !== 1 ? 's' : ''}
              {isSyncedBoard && <span className="ml-1">&middot; live</span>}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className={`p-1.5 rounded-lg transition-colors ${
            isDark ? 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-700'
          }`}
        >
          <X size={18} />
        </button>
      </div>

      {/* Comments List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className={`animate-spin ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`} />
          </div>
        ) : (
          <div className="px-4 py-3 space-y-2">
            {sortedComments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-3 ${
                  isDark ? 'bg-zinc-800' : 'bg-zinc-100'
                }`}>
                  <MessageCircle size={24} className={isDark ? 'text-zinc-600' : 'text-zinc-400'} />
                </div>
                <p className={`text-sm font-medium mb-1 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                  No comments yet
                </p>
                <p className={`text-xs text-center ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                  Be the first to share your thoughts
                </p>
              </div>
            ) : (
              <>
              {sortedComments.map((comment: any, idx: number) => {
                // Support both server (snake_case) and local comment shapes
                const name = comment.user_name || comment.authorName
                const email = comment.authorEmail
                const uid = comment.user_id || comment.authorId
                const initials = getInitials(name, email)
                const avatarColor = getAvatarColor(uid || email)
                const displayName = name || email || 'Anonymous'
                const createdAt = comment.created_at || comment.createdAt

                // Date separator: show when day changes between consecutive messages
                const currentDay = format(new Date(createdAt), 'yyyy-MM-dd')
                const prevComment = idx > 0 ? sortedComments[idx - 1] : null
                const prevDay = prevComment ? format(new Date((prevComment as any).created_at || (prevComment as any).createdAt), 'yyyy-MM-dd') : null
                const showDateSeparator = !prevDay || prevDay !== currentDay
                const isOwnComment = !!(session?.user && (
                  uid === session.user.id ||
                  uid === session.user.email ||
                  email === session.user.email
                ))

                return (
                  <div key={comment.id}>
                    {/* Date separator */}
                    {showDateSeparator && (
                      <div className="flex items-center justify-center my-3">
                        <span className={`text-[11px] px-3 py-0.5 rounded-full ${
                          isDark ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-200/70 text-zinc-500'
                        }`}>
                          {formatDateSeparator(createdAt)}
                        </span>
                      </div>
                    )}
                    <div
                      className={`group flex ${isOwnComment ? 'justify-end' : 'justify-start'}`}
                    >
                    <div className={`flex gap-2 max-w-[85%] ${
                      isOwnComment ? 'flex-row-reverse' : 'flex-row'
                    }`}>
                      {/* Avatar */}
                      {!isOwnComment && (
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-white text-[10px] font-semibold mt-0.5 ${avatarColor}`}>
                          {initials}
                        </div>
                      )}
                      {/* Bubble */}
                      <div className={`rounded-2xl px-3 py-2 relative ${
                        isOwnComment
                          ? 'bg-blue-500 text-white rounded-br-md'
                          : isDark
                            ? 'bg-zinc-800 text-zinc-200 rounded-bl-md'
                            : 'bg-zinc-100 text-zinc-800 rounded-bl-md'
                      }`}>
                        {/* Sender name (only for others) */}
                        {!isOwnComment && (
                          <p className={`text-[11px] font-semibold mb-0.5 ${
                            isDark ? 'text-zinc-400' : 'text-zinc-500'
                          }`}>
                            {displayName}
                          </p>
                        )}
                        <p className={`text-sm leading-relaxed break-words ${
                          isOwnComment ? 'text-white' : isDark ? 'text-zinc-200' : 'text-zinc-800'
                        }`}>
                          {comment.text}
                        </p>
                        <div className={`flex items-center gap-1.5 mt-1 ${
                          isOwnComment ? 'justify-end' : 'justify-start'
                        }`}>
                          <span className={`text-[10px] ${
                            isOwnComment
                              ? 'text-blue-200'
                              : isDark ? 'text-zinc-500' : 'text-zinc-400'
                          }`}>
                            {format(new Date(createdAt), 'h:mm a')}
                          </span>
                          {/* Delete button */}
                          {canDelete(comment) && (
                            <button
                              onClick={() => handleDelete(comment.id)}
                              className={`opacity-0 group-hover:opacity-100 p-0.5 rounded transition-all flex-shrink-0 ${
                                isOwnComment
                                  ? 'hover:bg-blue-600 text-blue-200 hover:text-white'
                                  : isDark
                                    ? 'hover:bg-red-500/20 text-zinc-500 hover:text-red-400'
                                    : 'hover:bg-red-50 text-zinc-400 hover:text-red-500'
                              }`}
                              title="Delete comment"
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  </div>
                )
              })}
              </>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Comment Input — everyone can comment including viewers */}
      <div className={`flex-shrink-0 border-t px-4 py-3 ${
        isDark ? 'border-zinc-700/50' : 'border-zinc-200'
      }`}>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Write a comment..."
            disabled={isSending}
            className={`flex-1 text-sm border rounded-xl px-3.5 py-2 focus:ring-2 focus:ring-blue-500/30 outline-none transition-colors ${
              isDark
                ? 'bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-blue-500/50'
                : 'bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400 focus:border-blue-400'
            } ${isSending ? 'opacity-50' : ''}`}
          />
          <button
            type="submit"
            disabled={!newComment.trim() || isSending}
            className="p-2 bg-blue-500 text-white rounded-xl hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </form>
      </div>
    </motion.div>
    </>
  )
}
