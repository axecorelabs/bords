'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/components/AuthProvider'
import { useThemeStore } from '@/store/themeStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useBoardStore } from '@/store/boardStore'
import { useBoardSyncStore } from '@/store/boardSyncStore'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  Bell,
  ArrowLeft,
  Loader2,
  Inbox,
  Settings,
} from 'lucide-react'
import { PersonalTabId, PersonalDashboardData } from './components/types'
import OverviewTab from './components/OverviewTab'
import PersonalInboxTab from './components/InboxTab'
import FriendsTab from './components/FriendsTab'
import BoardsTab from './components/BoardsTab'
import ActivityTab from './components/ActivityTab'
import SettingsTab from './components/SettingsTab'
import DashboardSwitcher from '../components/DashboardSwitcher'

const TABS: { id: PersonalTabId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'friends', label: 'Friends', icon: Users },
  { id: 'boards', label: 'Boards', icon: FolderKanban },
  { id: 'activity', label: 'Activity', icon: Bell },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export default function PersonalDashboardPage() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const isDark = useThemeStore((s) => s.isDark)
  const { switchToPersonal } = useWorkspaceStore()
  const { setCurrentBoard } = useBoardStore()

  const [activeTab, setActiveTab] = useState<PersonalTabId>('overview')
  const [data, setData] = useState<PersonalDashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDashboard = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/dashboard/personal')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load dashboard')
      }
      const json = await res.json()
      setData(json)
    } catch (err: any) {
      if (!silent) setError(err.message)
    } finally {
      if (!silent) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
      return
    }
    if (status === 'authenticated') {
      fetchDashboard()

      // Poll every 60 seconds
      const interval = setInterval(() => fetchDashboard(true), 60_000)

      // Refresh when tab becomes visible
      const onVisibility = () => {
        if (document.visibilityState === 'visible') fetchDashboard(true)
      }
      document.addEventListener('visibilitychange', onVisibility)

      return () => {
        clearInterval(interval)
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
  }, [status, fetchDashboard, router])

  const handleBackToBoard = () => {
    switchToPersonal()
    router.push('/')
  }

  const handleOpenBoard = (localBoardId: string) => {
    switchToPersonal()

    // Ensure a local board entry exists — if not, create a shell.
    // YJS sync will populate real content on board open.
    const currentUserId = useBoardStore.getState().currentUserId
    const existsLocally = useBoardStore.getState().boards.some((b) => b.id === localBoardId)
    if (!existsLocally) {
      const boardInfo = data?.boards.find((b) => b.localBoardId === localBoardId)
      useBoardSyncStore.getState().setBoardPermission(localBoardId, 'owner')
      useBoardStore.setState((state) => ({
        boards: [...state.boards, {
          id: localBoardId,
          userId: currentUserId || '',
          name: boardInfo?.title || 'Board',
          createdAt: new Date(boardInfo?.createdAt || Date.now()),
          lastModified: new Date(),
          notes: [], checklists: [], texts: [], connections: [],
          drawings: [], kanbans: [], medias: [], reminders: [], tables: [],
          contextType: 'personal' as const,
        }],
      }))
    }

    setCurrentBoard(localBoardId)
    router.push('/')
  }

  if (status === 'loading' || isLoading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-zinc-900' : 'bg-zinc-50'}`}>
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={32} className="animate-spin text-blue-500" />
          <p className={`text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>Loading dashboard...</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-zinc-900' : 'bg-zinc-50'}`}>
        <div className="text-center">
          <p className="text-red-500 mb-4">{error || 'Something went wrong'}</p>
          <button onClick={() => router.push('/')} className="text-blue-500 hover:underline text-sm">
            Back to workspace
          </button>
        </div>
      </div>
    )
  }

  const displayName = data.profile.firstName
    ? `${data.profile.firstName} ${data.profile.lastName}`.trim()
    : data.profile.email

  return (
    <div className={`min-h-screen flex ${isDark ? 'bg-zinc-900' : 'bg-zinc-50'}`}>
      {/* Sidebar */}
      <aside className={`w-64 fixed inset-y-0 left-0 z-30 border-r flex flex-col ${
        isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
      }`}>
        {/* Personal header */}
        <div className={`px-5 py-5 border-b ${isDark ? 'border-zinc-700/50' : 'border-zinc-200'}`}>
          <button
            onClick={handleBackToBoard}
            className={`flex items-center gap-2 text-xs mb-4 transition-colors ${
              isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-600'
            }`}
          >
            <ArrowLeft size={14} />
            Back to workspace
          </button>
          <DashboardSwitcher isDark={isDark} currentId="personal" />
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? isDark
                      ? 'bg-blue-500/15 text-blue-400'
                      : 'bg-blue-50 text-blue-600'
                    : isDark
                      ? 'text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200'
                      : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                }`}
              >
                <tab.icon size={18} />
                {tab.label}
                {tab.id === 'activity' && data.recentActivity.filter(a => !a.isRead).length > 0 && (
                  <span className="ml-auto w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold bg-blue-500 text-white">
                    {data.recentActivity.filter(a => !a.isRead).length}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* Footer */}
        {data.createdAt && (
          <div className={`px-5 py-4 border-t text-xs ${
            isDark ? 'border-zinc-700/50 text-zinc-600' : 'border-zinc-200 text-zinc-400'
          }`}>
            Member since {new Date(data.createdAt).toLocaleDateString()}
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 ml-64 overflow-y-auto min-h-screen">
        <div className={`mx-auto px-8 py-8 ${
          activeTab === 'overview' || activeTab === 'inbox' ? 'max-w-6xl' : 'max-w-5xl'
        }`}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
            >
              {activeTab === 'overview' && <OverviewTab data={data} isDark={isDark} onOpenBoard={handleOpenBoard} />}
              {activeTab === 'inbox' && <PersonalInboxTab isDark={isDark} />}
              {activeTab === 'friends' && <FriendsTab data={data} isDark={isDark} onRefresh={fetchDashboard} />}
              {activeTab === 'boards' && <BoardsTab data={data} isDark={isDark} onOpenBoard={handleOpenBoard} />}
              {activeTab === 'activity' && <ActivityTab data={data} isDark={isDark} />}
              {activeTab === 'settings' && <SettingsTab data={data} isDark={isDark} onProfileUpdated={fetchDashboard} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  )
}
