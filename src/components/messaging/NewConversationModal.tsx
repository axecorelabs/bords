'use client'
import { useState, useRef, useEffect } from 'react'
import { X, Search, UsersRound, MessageCircle, Check, Info } from 'lucide-react'
import { useThemeStore } from '@/store/themeStore'

interface Member {
  userId: string
  profile: { firstName: string; lastName: string; image: string | null; email: string } | null
}

interface Props {
  members: Member[]
  currentUserId: string
  context: 'org' | 'personal'
  orgId?: string
  workspaceId?: string
  onClose: () => void
  onCreated: (conversationId: string) => void
  createConversation: (params: {
    type: 'dm' | 'group'
    memberIds: string[]
    name?: string
    description?: string
    organizationId?: string
    workspaceId?: string
  }) => Promise<string | null>
}

function getInitials(firstName?: string, lastName?: string) {
  return `${(firstName ?? '')[0] ?? ''}${(lastName ?? '')[0] ?? ''}`.toUpperCase() || '?'
}

const AVATAR_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444']
function avatarColor(userId: string) {
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export default function NewConversationModal({
  members,
  currentUserId,
  context,
  orgId,
  workspaceId,
  onClose,
  onCreated,
  createConversation,
}: Props) {
  const isDark = useThemeStore((s) => s.isDark)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [groupName, setGroupName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const groupNameRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const bg = isDark ? '#1c1c1e' : '#ffffff'
  const surfaceBg = isDark ? '#27272a' : '#f9fafb'
  const inputBg = isDark ? '#3f3f46' : '#f3f4f6'
  const text = isDark ? '#e4e4e7' : '#18181b'
  const subtext = isDark ? '#a1a1aa' : '#52525b'
  const muted = isDark ? '#71717a' : '#a1a1aa'
  const hoverBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'
  const selectedBg = isDark ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.07)'

  const isGroup = selected.length > 1
  const allExceptSelf = members.filter((m) => m.userId !== currentUserId)
  const filtered = allExceptSelf.filter((m) => {
    if (!search) return true
    const name = `${m.profile?.firstName ?? ''} ${m.profile?.lastName ?? ''} ${m.profile?.email ?? ''}`.toLowerCase()
    return name.includes(search.toLowerCase())
  })

  // Auto-focus group name when it appears
  useEffect(() => {
    if (isGroup) groupNameRef.current?.focus()
  }, [isGroup])

  // Auto-focus search on mount
  useEffect(() => { searchRef.current?.focus() }, [])

  const toggle = (userId: string) => {
    setError(null)
    setSelected((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    )
  }

  const handleCreate = async () => {
    if (selected.length === 0) return
    if (isGroup && !groupName.trim()) {
      setError('Please enter a group name')
      groupNameRef.current?.focus()
      return
    }
    setLoading(true)
    setError(null)
    try {
      const id = await createConversation({
        type: isGroup ? 'group' : 'dm',
        memberIds: [currentUserId, ...selected],
        name: isGroup ? groupName.trim() : undefined,
        organizationId: orgId,
        workspaceId,
      })
      if (id) onCreated(id)
      else setError('Failed to create conversation')
    } finally {
      setLoading(false)
    }
  }

  const canCreate = selected.length > 0 && (!isGroup || groupName.trim().length > 0)

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440, maxHeight: '82vh', borderRadius: 18,
          background: bg, border: `1px solid ${border}`,
          boxShadow: isDark ? '0 32px 64px rgba(0,0,0,0.6)' : '0 32px 64px rgba(15,23,42,0.18)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 20px 16px',
          borderBottom: `1px solid ${border}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            background: isGroup ? 'rgba(139,92,246,0.15)' : 'rgba(59,130,246,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.2s',
          }}>
            {isGroup
              ? <UsersRound size={16} color="#8b5cf6" />
              : <MessageCircle size={16} color="#3b82f6" />
            }
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: text, lineHeight: 1.2 }}>
              {isGroup ? 'New Group' : 'New Message'}
            </div>
            <div style={{ fontSize: 11, color: muted, marginTop: 1 }}>
              {selected.length === 0
                ? 'Choose who to message'
                : selected.length === 1
                  ? '1 person selected'
                  : `${selected.length} people selected`
              }
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, borderRadius: 8, border: 'none',
              background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <X size={14} color={muted} />
          </button>
        </div>

        {/* Group name field — slides in when isGroup */}
        {isGroup && (
          <div style={{ padding: '14px 20px 0', animation: 'fadeSlideDown 0.15s ease' }}>
            <style>{`@keyframes fadeSlideDown { from { opacity:0; transform:translateY(-6px) } to { opacity:1; transform:translateY(0) } }`}</style>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: subtext, marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Group name
            </label>
            <input
              ref={groupNameRef}
              value={groupName}
              onChange={(e) => { setGroupName(e.target.value); setError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && canCreate) handleCreate() }}
              placeholder="e.g. Design Team, Sprint Planning…"
              maxLength={60}
              style={{
                width: '100%', padding: '9px 12px', fontSize: 13, borderRadius: 10,
                background: inputBg,
                border: `1.5px solid ${error ? '#ef4444' : isGroup && groupName ? '#3b82f6' : border}`,
                color: text, outline: 'none', boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
            />
          </div>
        )}

        {/* Search + selected pills */}
        <div style={{ padding: isGroup ? '12px 20px 8px' : '14px 20px 8px' }}>
          <div style={{ position: 'relative' }}>
            <Search size={13} color={muted} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              style={{
                width: '100%', padding: '8px 10px 8px 32px', fontSize: 13, borderRadius: 10,
                background: inputBg, border: `1.5px solid ${border}`,
                color: text, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Selected pills */}
          {selected.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
              {selected.map((uid) => {
                const m = members.find((x) => x.userId === uid)
                const first = m?.profile?.firstName ?? ''
                const last = m?.profile?.lastName ?? ''
                const name = m?.profile ? `${first} ${last}`.trim() : uid
                return (
                  <button
                    key={uid}
                    onClick={() => toggle(uid)}
                    style={{
                      fontSize: 12, padding: '3px 8px 3px 6px', borderRadius: 99,
                      background: isDark ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.1)',
                      border: '1px solid rgba(59,130,246,0.3)',
                      color: '#3b82f6', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 5,
                      fontWeight: 500,
                    }}
                  >
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                      background: avatarColor(uid),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 8, fontWeight: 700, color: 'white', overflow: 'hidden',
                    }}>
                      {m?.profile?.image
                        ? <img src={m.profile.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : getInitials(first, last)
                      }
                    </div>
                    {first || name}
                    <X size={10} style={{ opacity: 0.7 }} />
                  </button>
                )
              })}
            </div>
          )}

          {/* Tip — shown only when nothing selected yet */}
          {selected.length === 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, marginTop: 8,
              padding: '6px 10px', borderRadius: 8,
              background: isDark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.06)',
              border: `1px solid ${isDark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.15)'}`,
            }}>
              <Info size={12} color="#6366f1" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, color: isDark ? '#a5b4fc' : '#6366f1' }}>
                Select multiple people to create a group chat
              </span>
            </div>
          )}
        </div>

        {/* People list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length > 0 && (
            <div style={{ padding: '4px 20px 4px', fontSize: 11, fontWeight: 600, color: muted, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              {search ? 'Results' : 'People'}
            </div>
          )}
          {filtered.map((m) => {
            const first = m.profile?.firstName ?? ''
            const last = m.profile?.lastName ?? ''
            const name = m.profile ? `${first} ${last}`.trim() : m.userId
            const isSelected = selected.includes(m.userId)
            return (
              <div
                key={m.userId}
                onClick={() => toggle(m.userId)}
                style={{
                  padding: '7px 20px', display: 'flex', alignItems: 'center', gap: 10,
                  cursor: 'pointer',
                  background: isSelected ? selectedBg : 'transparent',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = hoverBg }}
                onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                {/* Avatar */}
                <div style={{
                  width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                  background: avatarColor(m.userId),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden', fontSize: 13, fontWeight: 700, color: 'white',
                  outline: isSelected ? '2px solid #3b82f6' : '2px solid transparent',
                  outlineOffset: 1, transition: 'outline-color 0.15s',
                }}>
                  {m.profile?.image
                    ? <img src={m.profile.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : getInitials(first, last)
                  }
                </div>

                {/* Name + email */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: text, lineHeight: 1.3 }}>{name}</div>
                  <div style={{ fontSize: 11, color: muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.profile?.email}</div>
                </div>

                {/* Checkbox */}
                <div style={{
                  width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                  background: isSelected ? '#3b82f6' : 'transparent',
                  border: `2px solid ${isSelected ? '#3b82f6' : border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s',
                }}>
                  {isSelected && <Check size={11} color="white" strokeWidth={3} />}
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div style={{ padding: '32px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div>
              <div style={{ fontSize: 13, color: subtext, fontWeight: 500 }}>No people found</div>
              <div style={{ fontSize: 11, color: muted, marginTop: 2 }}>Try a different name or email</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: `1px solid ${border}`,
          background: isDark ? 'rgba(255,255,255,0.02)' : surfaceBg,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {error && (
            <span style={{ fontSize: 12, color: '#ef4444', flex: 1 }}>{error}</span>
          )}
          {!error && (
            <span style={{ flex: 1, fontSize: 12, color: muted }}>
              {isGroup
                ? `${selected.length} members · group chat`
                : selected.length === 1
                  ? 'Direct message'
                  : 'Select someone to start'
              }
            </span>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '8px 14px', borderRadius: 10,
              border: `1px solid ${border}`, background: 'transparent',
              fontSize: 13, color: subtext, cursor: 'pointer', fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate || loading}
            style={{
              padding: '8px 18px', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 600,
              background: canCreate ? (isGroup ? '#8b5cf6' : '#3b82f6') : (isDark ? '#3f3f46' : '#e4e4e7'),
              color: canCreate ? 'white' : muted,
              cursor: canCreate ? 'pointer' : 'default',
              transition: 'background 0.15s',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.6s linear infinite', display: 'inline-block' }} />
                Creating…
                <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
              </span>
            ) : isGroup ? (
              <><UsersRound size={13} />Create Group</>
            ) : (
              <><MessageCircle size={13} />Open Chat</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
