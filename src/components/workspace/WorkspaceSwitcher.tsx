'use client'

import { useState, useRef, useEffect } from 'react'
import {
  User as UserIcon,
  Building2,
  ChevronDown,
  Check,
  Plus,
  Loader2,
  LayoutDashboard,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useThemeStore } from '../../store/themeStore'
import { useWorkspaceStore, type ActiveContext } from '../../store/workspaceStore'
import { useAuth } from '../AuthProvider'

/**
 * WorkspaceSwitcher — top-level navigation dropdown.
 *
 * Shows:
 *   Personal
 *   ─── Organizations ───
 *   Org A
 *   Org B
 *   + Create Organization
 */
export function WorkspaceSwitcher({
  onCreateOrg,
}: {
  onCreateOrg?: () => void
}) {
  const router = useRouter()
  const isDark = useThemeStore(s => s.isDark)
  const {
    personalWorkspace,
    orgContainerWorkspace,
    activeContext,
    switchToPersonal,
    switchToOrganization,
    fetchWorkspaces,
    isLoaded,
    isLoading,
  } = useWorkspaceStore()

  const { status } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Only fetch after auth is confirmed — avoids racing the session on initial load
  useEffect(() => {
    if (status === 'authenticated' && !isLoaded && !isLoading) fetchWorkspaces()
  }, [status, isLoaded, isLoading, fetchWorkspaces])

  const orgs = orgContainerWorkspace?.organizations || []

  // Determine display label
  let label = 'Personal'
  let icon = <UserIcon size={14} />
  if (activeContext?.type === 'organization') {
    label = activeContext.organizationName || 'Organization'
    icon = <Building2 size={14} />
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen(prev => !prev)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          isDark
            ? 'hover:bg-zinc-700/60 text-zinc-200'
            : 'hover:bg-zinc-200/60 text-zinc-700'
        }`}
      >
        {icon}
        <span className="max-w-[140px] truncate">{label}</span>
        <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className={`absolute left-0 top-full mt-1.5 z-[100] w-64 rounded-xl border shadow-xl overflow-hidden ${
            isDark
              ? 'bg-zinc-800 border-zinc-700/60'
              : 'bg-white border-zinc-200'
          }`}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={18} className="animate-spin text-zinc-400" />
            </div>
          ) : (
            <>
              {/* Personal workspace */}
              <button
                onClick={() => {
                  switchToPersonal()
                  setOpen(false)
                }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  activeContext?.type === 'personal'
                    ? isDark
                      ? 'bg-blue-500/10 text-blue-400'
                      : 'bg-blue-50 text-blue-600'
                    : isDark
                      ? 'text-zinc-300 hover:bg-zinc-700/60'
                      : 'text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                <UserIcon size={16} />
                <span className="flex-1 text-left font-medium">
                  {personalWorkspace?.name || 'Personal'}
                </span>
                <div
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    router.push('/dashboard/personal')
                    setOpen(false)
                  }}
                  className={`p-1 rounded-md transition-colors cursor-pointer ${
                    isDark
                      ? 'text-zinc-500 hover:bg-zinc-600/50 hover:text-zinc-300'
                      : 'text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600'
                  }`}
                  title="Personal Dashboard"
                >
                  <LayoutDashboard size={13} />
                </div>
                {activeContext?.type === 'personal' && (
                  <Check size={14} className="text-blue-500" />
                )}
              </button>

              {/* Divider */}
              <div
                className={`mx-4 border-t ${
                  isDark ? 'border-zinc-700/50' : 'border-zinc-200'
                }`}
              />

              {/* Section header */}
              <div
                className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider ${
                  isDark ? 'text-zinc-500' : 'text-zinc-400'
                }`}
              >
                Organizations
              </div>

              {/* Organization list */}
              {orgs.length === 0 ? (
                <p
                  className={`px-4 py-2 text-xs ${
                    isDark ? 'text-zinc-500' : 'text-zinc-400'
                  }`}
                >
                  No organizations yet
                </p>
              ) : (
                orgs.map(org => {
                  const isActive =
                    activeContext?.type === 'organization' &&
                    activeContext.organizationId === org._id
                  return (
                    <button
                      key={org._id}
                      onClick={() => {
                        switchToOrganization(org._id, org.name)
                        setOpen(false)
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                        isActive
                          ? isDark
                            ? 'bg-blue-500/10 text-blue-400'
                            : 'bg-blue-50 text-blue-600'
                          : isDark
                            ? 'text-zinc-300 hover:bg-zinc-700/60'
                            : 'text-zinc-700 hover:bg-zinc-100'
                      }`}
                    >
                      <Building2 size={16} />
                      <span className="flex-1 text-left font-medium truncate">
                        {org.name}
                      </span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                          org.isOwner
                            ? isDark
                              ? 'bg-blue-500/15 text-blue-400'
                              : 'bg-blue-50 text-blue-600'
                            : org.role === 'admin'
                              ? isDark
                                ? 'bg-purple-500/15 text-purple-400'
                                : 'bg-purple-50 text-purple-600'
                              : isDark
                                ? 'bg-zinc-700 text-zinc-400'
                                : 'bg-zinc-100 text-zinc-500'
                        }`}
                      >
                        {org.isOwner ? 'Owner' : org.role === 'admin' ? 'Admin' : 'Member'}
                      </span>
                      <div
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          router.push(`/dashboard/${org._id}`)
                          setOpen(false)
                        }}
                        className={`p-1 rounded-md transition-colors cursor-pointer ${
                          isDark
                            ? 'text-zinc-500 hover:bg-zinc-600/50 hover:text-zinc-300'
                            : 'text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600'
                        }`}
                        title="Organization Dashboard"
                      >
                        <LayoutDashboard size={13} />
                      </div>
                      {isActive && <Check size={14} className="text-blue-500" />}
                    </button>
                  )
                })
              )}

              {/* Create organization — always visible */}
              <div
                className={`mx-4 border-t ${
                  isDark ? 'border-zinc-700/50' : 'border-zinc-200'
                }`}
              />
              <button
                onClick={() => {
                  if (onCreateOrg) onCreateOrg()
                  setOpen(false)
                }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  isDark
                    ? 'text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-200'
                    : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700'
                }`}
              >
                <Plus size={16} />
                <span className="font-medium">Create New Organization</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
