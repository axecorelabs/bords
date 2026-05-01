'use client'

import { useEffect, useMemo, useState } from 'react'
import { X, ClipboardList, CalendarClock, CircleCheck, CircleDashed } from 'lucide-react'
import { useThemeStore } from '@/store/themeStore'
import CustomDropdown from '@/components/CustomDropdown'

interface MemberOption {
  userId: string
  profile: { firstName: string; lastName: string; image: string | null; email: string } | null
}

interface AssignedTaskItem {
  id: string
  content: string
  status: 'draft' | 'assigned' | 'completed'
  priority: 'low' | 'normal' | 'high' | null
  sourceType: string
  sourceLabel: string
  boardTitle: string | null
  dueDate: string | null
  createdAt: string
  completedAt: string | null
}

interface Props {
  orgId: string
  members: MemberOption[]
  initialSelectedUserId?: string
  onClose: () => void
}

function memberName(m: MemberOption) {
  if (!m.profile) return m.userId
  const full = `${m.profile.firstName ?? ''} ${m.profile.lastName ?? ''}`.trim()
  return full || m.profile.email || m.userId
}

export default function AssignedTasksPanel({ orgId, members, initialSelectedUserId, onClose }: Props) {
  const isDark = useThemeStore((s) => s.isDark)
  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => memberName(a).localeCompare(memberName(b))),
    [members]
  )
  const resolvedInitialUserId = useMemo(() => {
    if (initialSelectedUserId && sortedMembers.some((m) => m.userId === initialSelectedUserId)) {
      return initialSelectedUserId
    }
    return sortedMembers[0]?.userId ?? ''
  }, [initialSelectedUserId, sortedMembers])

  const [selectedUserId, setSelectedUserId] = useState(resolvedInitialUserId)
  const [loading, setLoading] = useState(false)
  const [tasks, setTasks] = useState<AssignedTaskItem[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSelectedUserId(resolvedInitialUserId)
  }, [resolvedInitialUserId])

  const memberOptions = useMemo(
    () => sortedMembers.map((m) => ({ value: m.userId, label: memberName(m) })),
    [sortedMembers]
  )

  useEffect(() => {
    if (!selectedUserId) return
    let active = true
    setLoading(true)
    setError(null)

    fetch(`/api/organizations/${orgId}/assigned-tasks?userId=${encodeURIComponent(selectedUserId)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to load assigned tasks')
        }
        return res.json()
      })
      .then((json) => {
        if (!active) return
        setTasks(json.tasks || [])
      })
      .catch((err: any) => {
        if (!active) return
        setError(err?.message || 'Failed to load assigned tasks')
        setTasks([])
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

    return () => { active = false }
  }, [orgId, selectedUserId])

  const panelBg = isDark ? '#0f0f12' : '#ffffff'
  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const text = isDark ? '#e4e4e7' : '#18181b'
  const muted = isDark ? '#a1a1aa' : '#6b7280'
  const skeletonBase = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)'
  const skeletonHi = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.14)'

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.36)',
          zIndex: 31,
        }}
      />
      <aside
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          height: '100%',
          width: 'min(460px, 100%)',
          background: panelBg,
          borderLeft: `1px solid ${border}`,
          zIndex: 32,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClipboardList size={16} color="#3b82f6" />
            <div style={{ fontSize: 14, fontWeight: 700, color: text }}>Assigned Tasks</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: muted }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 12, borderBottom: `1px solid ${border}` }}>
          <label style={{ display: 'block', fontSize: 11, color: muted, marginBottom: 6 }}>Select member</label>
          <CustomDropdown
            options={memberOptions}
            value={selectedUserId}
            onChange={setSelectedUserId}
            placeholder="Select member"
            className="w-full"
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[0, 1, 2, 3].map((idx) => (
                <div key={idx} style={{ border: `1px solid ${border}`, borderRadius: 10, padding: '10px 11px' }}>
                  <div
                    style={{
                      height: 13,
                      width: idx % 2 === 0 ? '78%' : '62%',
                      borderRadius: 6,
                      background: `linear-gradient(90deg, ${skeletonBase}, ${skeletonHi}, ${skeletonBase})`,
                      backgroundSize: '200% 100%',
                      animation: 'assigned-task-skeleton 1.2s ease-in-out infinite',
                    }}
                  />
                  <div style={{ marginTop: 8, display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                    {[0, 1, 2].map((m) => (
                      <span
                        key={m}
                        style={{
                          height: 10,
                          width: m === 0 ? 52 : m === 1 ? 74 : 62,
                          borderRadius: 999,
                          background: `linear-gradient(90deg, ${skeletonBase}, ${skeletonHi}, ${skeletonBase})`,
                          backgroundSize: '200% 100%',
                          animation: 'assigned-task-skeleton 1.2s ease-in-out infinite',
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && error && (
            <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>
          )}

          {!loading && !error && tasks.length === 0 && (
            <div style={{ color: muted, fontSize: 12, textAlign: 'center', paddingTop: 26 }}>
              No tasks assigned to this member.
            </div>
          )}

          {!loading && !error && tasks.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {tasks.map((task) => {
                const statusColor = task.status === 'completed' ? '#22c55e' : task.status === 'draft' ? '#f59e0b' : '#3b82f6'
                const statusIcon = task.status === 'completed'
                  ? <CircleCheck size={12} color={statusColor} />
                  : <CircleDashed size={12} color={statusColor} />

                return (
                  <div key={task.id} style={{ border: `1px solid ${border}`, borderRadius: 10, padding: '10px 11px' }}>
                    <div style={{ fontSize: 13, color: text, fontWeight: 600, lineHeight: 1.45 }}>{task.content}</div>
                    <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                      <span style={{ fontSize: 10, color: statusColor, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {statusIcon}
                        {task.status}
                      </span>
                      <span style={{ fontSize: 10, color: muted }}>{task.sourceLabel}</span>
                      {task.boardTitle && <span style={{ fontSize: 10, color: muted }}>Board: {task.boardTitle}</span>}
                      {task.priority && <span style={{ fontSize: 10, color: muted }}>Priority: {task.priority}</span>}
                      {task.dueDate && (
                        <span style={{ fontSize: 10, color: muted, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <CalendarClock size={10} />
                          Due {new Date(task.dueDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <style>{`
          @keyframes assigned-task-skeleton {
            0% { background-position: 180% 0; }
            100% { background-position: -20% 0; }
          }
        `}</style>
      </aside>
    </>
  )
}
