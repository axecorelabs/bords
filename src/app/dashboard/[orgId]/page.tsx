'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
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
  Settings,
  ArrowLeft,
  Loader2,
  BarChart3,
  Inbox,
  CalendarDays,
  ListTodo,
  MessageCircle,
  Menu,
  X,
  RefreshCw,
  ArrowRight,
} from 'lucide-react'
import { TabId, DashboardData } from './components/types'
import OverviewTab from './components/OverviewTab'
import MembersTab from './components/MembersTab'
import BoardsTab from './components/BoardsTab'
import ActivityTab from './components/ActivityTab'
import SettingsTab from './components/SettingsTab'
import MetricsTab from './components/MetricsTab'
import MemberDetailView from './components/MemberDetailView'
import InboxTab from './components/InboxTab'
import CalendarTab from '../components/CalendarTab'
import MyTasksTab from '../personal/components/MyTasksTab'
import DashboardSwitcher from '../components/DashboardSwitcher'
import MessagingPanel from '@/components/messaging/MessagingPanel'
import { useMessagingStore } from '@/store/messagingStore'
import { useShallow } from 'zustand/react/shallow'

const TABS: { id: TabId; label: string; icon: typeof LayoutDashboard }[] = [
  // Daily flow first, then team/management, then admin controls.
  { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  // { id: 'inbox', label: 'Inbox', icon: Inbox }, // temporarily disabled — duplicates My Tasks
  { id: 'my-tasks', label: 'Tasks', icon: ListTodo },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'messages', label: 'Chats', icon: MessageCircle },
  { id: 'boards', label: 'Boards', icon: FolderKanban },
  { id: 'members', label: 'People', icon: Users },
  { id: 'metrics', label: 'Insights', icon: BarChart3 },
  { id: 'activity', label: 'Activity', icon: Bell },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export default function OrgDashboardPage() {
  const params = useParams()
  const router = useRouter()
  const orgId = params.orgId as string
  const { data: session, status } = useSession()
  const isDark = useThemeStore((s) => s.isDark)
  const { switchToOrganization } = useWorkspaceStore()
  const { setCurrentBoard } = useBoardStore()

  const validTabIds = TABS.map((t) => t.id)
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (typeof window === 'undefined') return 'overview'
    const hash = window.location.hash.replace('#', '') as TabId
    return validTabIds.includes(hash) ? hash : 'overview'
  })

  const setTab = useCallback((tab: TabId) => {
    setActiveTab(tab)
    window.location.hash = tab
  }, [])
  const [data, setData] = useState<DashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewingMemberId, setViewingMemberId] = useState<string | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const totalUnread = useMessagingStore((s) => s.totalUnread)

  const fetchDashboard = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/organizations/${orgId}/dashboard`)
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
  }, [orgId])

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
      return
    }
    if (status === 'authenticated' && orgId) {
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
  }, [status, orgId, fetchDashboard, router])

  const handleBackToBoard = () => {
    if (data) {
      switchToOrganization(orgId, data.organization.name)
    }
    router.push('/')
  }

  const handleOpenBoard = (localBoardId: string) => {
    if (data) {
      switchToOrganization(orgId, data.organization.name)
    }

    const currentUserId = useBoardStore.getState().currentUserId
    const boardInfo = data?.boards.find((b) => b.localBoardId === localBoardId)
    const userId = (session?.user as any)?.id
    const isOwner = boardInfo?.ownerId === userId

    // Set permission so collab system knows how to connect
    useBoardSyncStore.getState().setBoardPermission(
      localBoardId,
      isOwner ? 'owner' : 'edit'
    )

    // Ensure a local board entry exists — if not, create a shell.
    // YJS sync (WebSocket for shared / IndexedDB for owned) will populate the real content.
    const existsLocally = useBoardStore.getState().boards.some((b) => b.id === localBoardId)
    if (!existsLocally) {
      useBoardStore.setState((state) => ({
        boards: [...state.boards, {
          id: localBoardId,
          userId: currentUserId || '',
          name: boardInfo?.title || 'Board',
          createdAt: new Date(boardInfo?.createdAt || Date.now()),
          lastModified: new Date(),
          notes: [], checklists: [], texts: [], connections: [],
          drawings: [], kanbans: [], medias: [], reminders: [], tables: [], richTexts: [],
          contextType: 'organization' as const,
          organizationId: orgId,
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

  const { organization, isOwner } = data
  const currentUserId = (session?.user as any)?.id ?? ''
  const currentMember = data.members.find((m) => m._id === currentUserId)
  const canViewAssignedTasksPanel = isOwner || currentMember?.role === 'admin'
  const viewingMember = viewingMemberId
    ? data.memberMetrics.find((m) => m.userId === viewingMemberId) || null
    : null

  return (
    <div className={`min-h-screen flex ${isDark ? 'bg-zinc-900' : 'bg-zinc-50'}`}>
      {isSidebarOpen && (
        <button
          type="button"
          aria-label="Close dashboard navigation"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`w-64 fixed inset-y-0 left-0 z-40 border-r flex flex-col transition-transform duration-200 ease-out ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      } ${
        isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
      }`}>
        {/* Org header */}
        <div className={`px-5 py-5 border-b ${isDark ? 'border-zinc-700/50' : 'border-zinc-200'}`}>
          <div className="flex items-center justify-between gap-3 lg:block">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className={`lg:hidden inline-flex items-center justify-center rounded-lg p-2 ${isDark ? 'text-zinc-400 hover:bg-zinc-700/50' : 'text-zinc-500 hover:bg-zinc-100'}`}
              aria-label="Close dashboard navigation"
            >
              <X size={16} />
            </button>
          </div>
          <button
            onClick={handleBackToBoard}
            className={`flex items-center gap-2 text-xs mb-4 transition-colors ${
              isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-600'
            }`}
          >
            <ArrowLeft size={14} />
            Back to workspace
          </button>
          <DashboardSwitcher isDark={isDark} currentId={orgId} />
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id
            if (tab.id === 'settings' && !isOwner) return null
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setTab(tab.id)
                  setViewingMemberId(null)
                  setIsSidebarOpen(false)
                }}
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
                {tab.id === 'messages' && totalUnread > 0 && (
                  <span className="ml-auto min-w-5 h-5 px-1 flex items-center justify-center rounded-full text-[10px] font-bold bg-red-500 text-white">
                    {totalUnread > 99 ? '99+' : totalUnread}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* Footer */}
        <div className={`px-5 py-4 border-t text-xs ${
          isDark ? 'border-zinc-700/50 text-zinc-600' : 'border-zinc-200 text-zinc-400'
        }`}>
          Created {new Date(organization.createdAt).toLocaleDateString()}
        </div>
      </aside>

      {/* Main content */}
      <main className={activeTab === 'messages' ? 'flex-1 lg:ml-64 h-screen overflow-hidden flex flex-col' : 'flex-1 lg:ml-64 overflow-y-auto min-h-screen'}>
        <div className={`lg:hidden sticky top-0 z-20 flex items-center justify-between gap-3 px-4 py-3 border-b ${isDark ? 'bg-zinc-900/95 border-zinc-800 text-white' : 'bg-zinc-50/95 border-zinc-200 text-zinc-900'} backdrop-blur`}>
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className={`inline-flex items-center justify-center rounded-lg p-2 ${isDark ? 'text-zinc-300 hover:bg-zinc-800' : 'text-zinc-700 hover:bg-zinc-100'}`}
            aria-label="Open dashboard navigation"
          >
            <Menu size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold truncate ${isDark ? 'text-white' : 'text-zinc-900'}`}>{organization.name}</p>
            <p className={`text-[11px] truncate ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>Dashboard</p>
          </div>
          <div className="shrink-0 scale-90 origin-right">
            <DashboardSwitcher isDark={isDark} currentId={orgId} />
          </div>
        </div>

        {/* Full-width overview page header */}
        {activeTab === 'overview' && (
          <div className={`border-b px-4 py-5 sm:px-6 lg:px-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between ${isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'}`}>
            <div className="min-w-0">
              <p className={`text-xs font-semibold uppercase tracking-widest mb-1.5 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                {isOwner ? organization.name : 'Organization'}
              </p>
              <h1 className={`text-2xl font-bold leading-tight ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                Dashboard
              </h1>
              <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                <span>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
                {isOwner ? (
                  <>
                    <span className={isDark ? 'text-zinc-700' : 'text-zinc-300'}>·</span>
                    <span>{data.members.length} member{data.members.length !== 1 ? 's' : ''}</span>
                    <span className={isDark ? 'text-zinc-700' : 'text-zinc-300'}>·</span>
                    <span>{data.boards.length} board{data.boards.length !== 1 ? 's' : ''}</span>
                    <span className={isDark ? 'text-zinc-700' : 'text-zinc-300'}>·</span>
                    <span>{data.kpis.completionRate}% complete</span>
                    {data.kpis.overdueTasks > 0 && (
                      <>
                        <span className={isDark ? 'text-zinc-700' : 'text-zinc-300'}>·</span>
                        <span className="text-red-500 font-medium">{data.kpis.overdueTasks} overdue</span>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <span className={isDark ? 'text-zinc-700' : 'text-zinc-300'}>·</span>
                    <span>{data.personalStats.assigned} in progress</span>
                    <span className={isDark ? 'text-zinc-700' : 'text-zinc-300'}>·</span>
                    <span>{data.personalStats.completed} completed</span>
                    {data.personalStats.overdue > 0 && (
                      <>
                        <span className={isDark ? 'text-zinc-700' : 'text-zinc-300'}>·</span>
                        <span className="text-red-500 font-medium">{data.personalStats.overdue} overdue</span>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:pt-1">
              <button
                type="button"
                onClick={() => fetchDashboard()}
                title="Refresh dashboard"
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${isDark ? 'text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700'}`}
              >
                <RefreshCw size={14} />
                Refresh
              </button>
              <div className={`h-4 w-px ${isDark ? 'bg-zinc-700/60' : 'bg-zinc-200'}`} />
              <button
                type="button"
                onClick={() => { setTab('boards'); setViewingMemberId(null) }}
                className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${isDark ? 'bg-zinc-700/60 text-zinc-200 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'}`}
              >
                Boards
                <ArrowRight size={13} />
              </button>
              <button
                type="button"
                onClick={() => { setTab(isOwner ? 'members' : 'my-tasks'); setViewingMemberId(null) }}
                className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${isDark ? 'bg-blue-500 text-white hover:bg-blue-400' : 'bg-blue-600 text-white hover:bg-blue-500'}`}
              >
                {isOwner ? 'People' : 'My Tasks'}
                <ArrowRight size={13} />
              </button>
            </div>
          </div>
        )}

        <div className={activeTab === 'messages' ? 'flex-1 flex flex-col min-h-0' : `mx-auto px-4 py-6 sm:px-6 lg:px-8 lg:py-8 ${activeTab === 'overview' || activeTab === 'metrics' || activeTab === 'inbox' || activeTab === 'calendar' || activeTab === 'my-tasks' ? 'max-w-6xl' : 'max-w-5xl'}`}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className={activeTab === 'messages' ? 'flex-1 flex flex-col min-h-0 h-full' : ''}
            >
              {activeTab === 'overview' && !viewingMember && (
                <OverviewTab
                  data={data}
                  isDark={isDark}
                  onNavigateTab={(tab) => {
                    setTab(tab)
                    setViewingMemberId(null)
                  }}
                  onRefresh={() => fetchDashboard()}
                />
              )}
              {activeTab === 'inbox' && !viewingMember && <InboxTab isDark={isDark} orgId={orgId} />}
              {activeTab === 'my-tasks' && !viewingMember && (
                <MyTasksTab
                  isDark={isDark}
                  onOpenBoard={handleOpenBoard}
                  orgId={orgId}
                  canViewOrgScope={canViewAssignedTasksPanel}
                  orgMembers={data.members.map((m) => ({
                    userId: m._id,
                    name: `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.email,
                    email: m.email,
                  }))}
                />
              )}
              {activeTab === 'calendar' && !viewingMember && <CalendarTab isDark={isDark} orgId={orgId} />}
              {activeTab === 'metrics' && !viewingMember && <MetricsTab data={data} isDark={isDark} />}
              {activeTab === 'members' && !viewingMember && (
                <MembersTab
                  data={data}
                  isDark={isDark}
                  orgId={orgId}
                  currentUserId={session?.user?.id}
                  onRefresh={fetchDashboard}
                  onViewMemberMetrics={(id) => setViewingMemberId(id)}
                />
              )}
              {activeTab === 'boards' && !viewingMember && <BoardsTab data={data} isDark={isDark} onOpenBoard={handleOpenBoard} isOwner={isOwner} currentUserId={currentUserId} />}
              {activeTab === 'messages' && !viewingMember && (
                <MessagingPanel
                  currentUserId={currentUserId}
                  context="org"
                  orgId={orgId}
                  canViewAssignedTasksPanel={canViewAssignedTasksPanel}
                  layout="full"
                  availableMembers={data.members.map((m) => ({
                    userId: m._id,
                    profile: { firstName: m.firstName, lastName: m.lastName, image: m.image ?? null, email: m.email },
                  }))}
                />
              )}
              {activeTab === 'activity' && !viewingMember && <ActivityTab data={data} isDark={isDark} />}
              {activeTab === 'settings' && !viewingMember && <SettingsTab data={data} isDark={isDark} orgId={orgId} onRefresh={fetchDashboard} router={router} />}
              {viewingMember && (
                <MemberDetailView
                  member={viewingMember}
                  isDark={isDark}
                  onBack={() => setViewingMemberId(null)}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  )
}
