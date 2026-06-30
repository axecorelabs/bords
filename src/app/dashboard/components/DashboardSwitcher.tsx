'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/components/AuthProvider'
import { useOrganizationStore } from '@/store/organizationStore'
import { ChevronDown, Check } from 'lucide-react'

interface DashboardSwitcherProps {
  isDark: boolean
  /** 'personal' or the orgId currently being viewed */
  currentId: string
}

export default function DashboardSwitcher({ isDark, currentId }: DashboardSwitcherProps) {
  const router = useRouter()
  const { data: session } = useSession()
  const { organizations, fetchOrganizations, isLoading } = useOrganizationStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchOrganizations()
  }, [fetchOrganizations])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [open])

  const isPersonal = currentId === 'personal'

  const items: { id: string; label: string; sublabel?: string; icon: 'personal' | 'org'; logoUrl?: string }[] = [
    {
      id: 'personal',
      label: session?.user?.name || 'Personal',
      sublabel: 'Personal workspace',
      icon: 'personal',
    },
    ...organizations.map((org) => ({
      id: org._id,
      label: org.name,
      sublabel: org.role === 'owner' ? 'Owner' : org.role === 'admin' ? 'Admin' : 'Member',
      icon: 'org' as const,
      logoUrl: org.logoUrl,
    })),
  ]

  const current = items.find((i) => i.id === currentId)

  // Show skeleton while orgs are loading and we haven't resolved the current org yet
  const showSkeleton = isLoading && !isPersonal && !current

  const handleSelect = (id: string) => {
    setOpen(false)
    if (id === currentId) return
    if (id === 'personal') {
      router.push('/dashboard/personal')
    } else {
      router.push(`/dashboard/${id}`)
    }
  }

  if (showSkeleton) {
    return (
      <div className="flex items-center gap-3 p-2 animate-pulse">
        <div className={`w-10 h-10 rounded-xl ${isDark ? 'bg-zinc-700' : 'bg-zinc-200'}`} />
        <div className="flex-1 space-y-2">
          <div className={`h-3 w-24 rounded ${isDark ? 'bg-zinc-700' : 'bg-zinc-200'}`} />
          <div className={`h-2.5 w-16 rounded ${isDark ? 'bg-zinc-700/60' : 'bg-zinc-200/60'}`} />
        </div>
      </div>
    )
  }

  // After loading completes, fall back to personal only if the org truly can't be found
  const displayCurrent = current || items[0]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-3 p-2 -m-2 rounded-xl transition-colors ${
          isDark ? 'hover:bg-zinc-700/40' : 'hover:bg-zinc-100'
        }`}
      >
        {/* Avatar / Logo */}
        {displayCurrent.icon === 'personal' ? (
          session?.user?.image ? (
            <img src={session.user.image} alt="" className="w-10 h-10 rounded-xl object-cover" />
          ) : (
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${
              isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'
            }`}>
              {(displayCurrent.label || '?').charAt(0).toUpperCase()}
            </div>
          )
        ) : displayCurrent.logoUrl ? (
          <img src={displayCurrent.logoUrl} alt="" className="w-10 h-10 rounded-xl object-cover" />
        ) : (
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${
            isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'
          }`}>
            {(displayCurrent.label || '?').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1 text-left">
          <h2 className={`font-semibold text-sm truncate ${isDark ? 'text-white' : 'text-zinc-900'}`}>
            {displayCurrent.label}
          </h2>
          <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
            {displayCurrent.sublabel}
          </p>
        </div>
        <ChevronDown size={14} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${
          isDark ? 'text-zinc-500' : 'text-zinc-400'
        }`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className={`absolute left-0 right-0 top-full mt-2 rounded-xl border shadow-xl z-50 overflow-hidden ${
          isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
        }`}>
          <div className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-wider ${
            isDark ? 'text-zinc-500' : 'text-zinc-400'
          }`}>
            Switch dashboard
          </div>
          {items.map((item) => {
            const isActive = item.id === currentId
            return (
              <button
                key={item.id}
                onClick={() => handleSelect(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                  isActive
                    ? isDark ? 'bg-blue-500/10' : 'bg-blue-50'
                    : isDark ? 'hover:bg-zinc-700/50' : 'hover:bg-zinc-50'
                }`}
              >
                {item.icon === 'personal' ? (
                  session?.user?.image ? (
                    <img src={session.user.image} alt="" className="w-8 h-8 rounded-lg object-cover" />
                  ) : (
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                      isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'
                    }`}>
                      {(session?.user?.name || '?').charAt(0).toUpperCase()}
                    </div>
                  )
                ) : item.logoUrl ? (
                  <img src={item.logoUrl} alt="" className="w-8 h-8 rounded-lg object-cover" />
                ) : (
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                    isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'
                  }`}>
                    {(item.label || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium truncate ${
                    isActive
                      ? isDark ? 'text-blue-400' : 'text-blue-600'
                      : isDark ? 'text-zinc-200' : 'text-zinc-800'
                  }`}>{item.label}</p>
                  <p className={`text-[11px] ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>{item.sublabel}</p>
                </div>
                {isActive && <Check size={14} className={isDark ? 'text-blue-400' : 'text-blue-500'} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
