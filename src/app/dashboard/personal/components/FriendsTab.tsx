'use client'

import { useState } from 'react'
import {
  Loader2,
  Mail,
  Trash2,
  UserPlus,
  Clock,
} from 'lucide-react'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { PersonalDashboardData, formatRelativeTime } from './types'

export default function FriendsTab({
  data,
  isDark,
  onRefresh,
}: {
  data: PersonalDashboardData
  isDark: boolean
  onRefresh: () => void
}) {
  const [friendEmail, setFriendEmail] = useState('')
  const [nickname, setNickname] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [addMessage, setAddMessage] = useState('')
  const [removingId, setRemovingId] = useState<string | null>(null)
  const { addFriend, removeFriend } = useWorkspaceStore()

  const handleAddFriend = async () => {
    if (!friendEmail.trim()) return
    setIsAdding(true)
    setAddError('')
    setAddMessage('')
    const result = await addFriend(friendEmail.trim(), nickname.trim() || undefined)
    if (result.success) {
      setFriendEmail('')
      setNickname('')
      if (result.invited) {
        setAddMessage(result.message || 'We\'ve sent them an invitation to join BORDS!')
      } else {
        onRefresh()
      }
    } else {
      setAddError(result.error || 'Failed to add friend')
    }
    setIsAdding(false)
  }

  const handleRemove = async (friendId: string) => {
    setRemovingId(friendId)
    await removeFriend(friendId)
    onRefresh()
    setRemovingId(null)
  }

  const acceptedFriends = data.friends.filter(f => f.status === 'accepted')
  const pendingFriends = data.friends.filter(f => f.status === 'pending')

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className={`text-2xl font-bold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>Friends</h1>
          <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
            {acceptedFriends.length} friend{acceptedFriends.length !== 1 ? 's' : ''}
            {pendingFriends.length > 0 && ` · ${pendingFriends.length} pending`}
          </p>
        </div>
      </div>

      {/* Add friend */}
      <div className={`rounded-2xl border p-5 mb-6 ${
        isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
      }`}>
        <h3 className={`font-semibold text-sm mb-3 ${isDark ? 'text-white' : 'text-zinc-900'}`}>Add a Friend</h3>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Mail size={16} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`} />
            <input
              type="email"
              value={friendEmail}
              onChange={(e) => setFriendEmail(e.target.value)}
              placeholder="friend@email.com"
              className={`w-full pl-10 pr-4 py-3 rounded-xl border text-sm ${
                isDark
                  ? 'bg-zinc-900 border-zinc-600 text-white placeholder:text-zinc-500'
                  : 'bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400'
              } focus:outline-none focus:ring-2 focus:ring-blue-500/30`}
              onKeyDown={(e) => e.key === 'Enter' && handleAddFriend()}
            />
          </div>
          <button
            onClick={handleAddFriend}
            disabled={isAdding || !friendEmail.trim()}
            className="px-6 py-3 rounded-xl text-sm font-semibold bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 transition-colors flex items-center gap-2"
          >
            {isAdding ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
            Add Friend
          </button>
        </div>
        {addError && <p className="text-xs text-red-500 mt-2">{addError}</p>}
        {addMessage && <p className="text-xs text-blue-500 mt-2">{addMessage}</p>}
      </div>

      {/* Pending friends */}
      {pendingFriends.length > 0 && (
        <div className={`rounded-2xl border p-5 mb-6 ${
          isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
        }`}>
          <h3 className={`font-semibold text-sm mb-4 flex items-center gap-2 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
            <Clock size={16} className={isDark ? 'text-amber-400' : 'text-amber-500'} />
            Pending
          </h3>
          <div className="space-y-2">
            {pendingFriends.map((friend) => (
              <div key={friend._id} className={`flex items-center justify-between p-3 rounded-xl ${isDark ? 'bg-zinc-700/30' : 'bg-zinc-50'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center ${isDark ? 'bg-amber-500/15 text-amber-400' : 'bg-amber-100 text-amber-600'}`}>
                    <Mail size={16} />
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>{friend.email}</p>
                    <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                      Added {formatRelativeTime(friend.createdAt)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Accepted friends */}
      <div className={`rounded-2xl border p-5 ${isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'}`}>
        <h3 className={`font-semibold text-sm mb-4 ${isDark ? 'text-white' : 'text-zinc-900'}`}>Friends</h3>
        {acceptedFriends.length === 0 ? (
          <p className={`text-sm py-8 text-center ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
            No friends yet. Add someone to get started.
          </p>
        ) : (
          <div className="space-y-2">
            {acceptedFriends.map((friend) => (
              <div key={friend._id} className={`flex items-center justify-between p-3 rounded-xl ${
                isDark ? 'hover:bg-zinc-700/30' : 'hover:bg-zinc-50'
              } transition-colors`}>
                <div className="flex items-center gap-3">
                  {friend.image ? (
                    <img src={friend.image} alt="" className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${
                      isDark ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-200 text-zinc-600'
                    }`}>
                      {(friend.firstName?.[0] || friend.email[0]).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>
                      {friend.firstName} {friend.lastName}
                      {friend.nickname && (
                        <span className={`ml-1.5 text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>({friend.nickname})</span>
                      )}
                    </p>
                    <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>{friend.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-lg ${isDark ? 'bg-zinc-700/50 text-zinc-400' : 'bg-zinc-100 text-zinc-500'}`}>
                    Added {new Date(friend.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => handleRemove(friend._id)}
                    disabled={removingId === friend._id}
                    className={`p-2 rounded-lg transition-colors ${
                      isDark ? 'hover:bg-red-500/20 text-zinc-600 hover:text-red-400' : 'hover:bg-red-50 text-zinc-300 hover:text-red-500'
                    }`}
                    title="Remove friend"
                  >
                    {removingId === friend._id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
