'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { MessageCircle, Send, Trash2, X, Loader2 } from 'lucide-react'
import { useCommentStore, Comment } from '../store/commentStore'
import { format } from 'date-fns'
import { toast } from 'react-hot-toast'
import { useBoardStore } from '../store/boardStore'
import { useThemeStore } from '../store/themeStore'
import { useBoardSyncStore } from '../store/boardSyncStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useSession } from 'next-auth/react'

interface CommentsProps {
  onClose: () => void
}

export function Comments({ onClose }: CommentsProps) {
  const { data: session } = useSession()
  const currentBoardId = useBoardStore((state) => state.currentBoardId)
  const isDark = useThemeStore((state) => state.isDark)

  // Local store as fallback for non-synced boards
  const localComments = useCommentStore((state) => state.comments)
  const addLocalComment = useCommentStore((state) => state.addComment)
  const deleteLocalComment = useCommentStore((state) => state.deleteComment)
  const setServerCommentCount = useCommentStore((state) => state.setServerCommentCount)

  // Is this a synced/shared board?
  const boardPermission = useBoardSyncStore(
    (s) => (currentBoardId ? s.boardPermissions[currentBoardId] : undefined) || 'owner'
  )
  // With Y.Doc as source of truth, boards are always synced when connected
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

  // Newest first — reverse chronological
  const sortedComments = [...comments].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  // Auto-scroll to top when new comments arrive
  const topRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (comments.length > prevCountRef.current) {
      topRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevCountRef.current = comments.length
  }, [comments.length])

  // Refetch comments (used after failed optimistic updates)
  const refetchComments = useCallback(async () => {
    if (!currentBoardId || !isSyncedBoard) return
    try {
      const res = await fetch(`/api/boards/${currentBoardId}/comments`)
      if (!res.ok) return
      const data = await res.json()
      if (data.comments) setServerComments(data.comments)
    } catch { /* silent */ }
  }, [currentBoardId, isSyncedBoard])

  // SSE connection for real-time updates
  useEffect(() => {
    if (!isSyncedBoard || !currentBoardId) return

    setIsLoading(true)
    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let closed = false

    const connect = () => {
      if (closed) return
      es = new EventSource(`/api/boards/${currentBoardId}/comments/stream`)

      es.addEventListener('comments', (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.comments) {
            setServerComments(data.comments)
            setServerCommentCount(currentBoardId, data.comments.length)
            setIsLoading(false)
          }
        } catch { /* ignore malformed data */ }
      })

      es.addEventListener('error', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data)
          if (data?.message) toast.error(data.message)
        } catch { /* not a data error, just a connection error */ }
      })

      es.onerror = () => {
        // Connection lost — close and reconnect after a delay
        es?.close()
        es = null
        setIsLoading(false)
        if (!closed) {
          reconnectTimer = setTimeout(connect, 5000)
        }
      }
    }

    connect()

    return () => {
      closed = true
      es?.close()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [isSyncedBoard, currentBoardId])

  // Submit comment
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newComment.trim() || !currentBoardId) return

    const text = newComment.trim()
    setNewComment('')

    if (isSyncedBoard) {
      // Post to API
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
        // Optimistically add to local state
        setServerComments(prev => [...prev, data.comment])
        setServerCommentCount(currentBoardId, serverComments.length + 1)
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
      // Optimistically remove
      setServerComments(prev => prev.filter(c => c.id !== commentId))
      if (currentBoardId) setServerCommentCount(currentBoardId, Math.max(0, serverComments.length - 1))
      try {
        const res = await fetch(`/api/boards/${currentBoardId}/comments`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commentId }),
        })
        if (!res.ok) {
          const err = await res.json()
          toast.error(err.error || 'Failed to delete comment')
          // Refetch to restore
          refetchComments()
        }
      } catch {
        toast.error('Failed to delete comment')
        refetchComments()
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
  const canDelete = (comment: { authorId?: string; authorEmail?: string }) => {
    if (canDeleteAny) return true
    const userId = session?.user?.id || session?.user?.email
    if (!userId) return false
    return comment.authorId === userId || comment.authorEmail === session?.user?.email
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
      className={`fixed top-0 right-0 h-full w-[360px] max-w-[90vw] z-[200] shadow-2xl flex flex-col ${
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
          <div className={`p-1.5 rounded-lg ${isDark ? 'bg-purple-500/15' : 'bg-purple-50'}`}>
            <MessageCircle size={18} className="text-purple-500" />
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
          <div className="px-4 py-3 space-y-1">
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
              <div ref={topRef} />
              {sortedComments.map((comment) => {
                const initials = getInitials(comment.authorName, comment.authorEmail)
                const avatarColor = getAvatarColor(comment.authorId || comment.authorEmail)
                const displayName = comment.authorName || comment.authorEmail || 'Anonymous'
                const isOwnComment = session?.user && (
                  comment.authorId === session.user.id ||
                  comment.authorId === session.user.email ||
                  comment.authorEmail === session.user.email
                )

                return (
                  <div
                    key={comment.id}
                    className={`group rounded-xl px-3 py-2.5 transition-colors ${
                      isDark ? 'hover:bg-zinc-800/60' : 'hover:bg-zinc-50'
                    }`}
                  >
                    <div className="flex gap-2.5">
                      {/* Avatar */}
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-white text-[10px] font-semibold mt-0.5 ${avatarColor}`}>
                        {initials}
                      </div>
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-xs font-semibold truncate ${
                            isDark ? 'text-zinc-200' : 'text-zinc-800'
                          }`}>
                            {displayName}
                            {isOwnComment && (
                              <span className={`ml-1.5 text-[10px] font-normal ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                (you)
                              </span>
                            )}
                          </span>
                          <span className={`text-[10px] flex-shrink-0 ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                            {format(new Date(comment.createdAt), 'MMM d, h:mm a')}
                          </span>
                          {/* Delete button */}
                          {canDelete(comment) && (
                            <button
                              onClick={() => handleDelete(comment.id)}
                              className={`opacity-0 group-hover:opacity-100 p-0.5 rounded transition-all ml-auto flex-shrink-0 ${
                                isDark ? 'hover:bg-red-500/20 text-zinc-500 hover:text-red-400' : 'hover:bg-red-50 text-zinc-400 hover:text-red-500'
                              }`}
                              title="Delete comment"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                        <p className={`text-sm leading-relaxed break-words ${
                          isDark ? 'text-zinc-300' : 'text-zinc-700'
                        }`}>
                          {comment.text}
                        </p>
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
            className={`flex-1 text-sm border rounded-xl px-3.5 py-2 focus:ring-2 focus:ring-purple-500/30 outline-none transition-colors ${
              isDark
                ? 'bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-purple-500/50'
                : 'bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400 focus:border-purple-400'
            } ${isSending ? 'opacity-50' : ''}`}
          />
          <button
            type="submit"
            disabled={!newComment.trim() || isSending}
            className="p-2 bg-purple-500 text-white rounded-xl hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </form>
      </div>
    </motion.div>
    </>
  )
}
