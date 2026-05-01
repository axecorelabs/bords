'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  X,
  UsersRound,
  LogOut,
  UserMinus,
  Loader2,
  UserPlus,
  ShieldCheck,
  ShieldOff,
  Camera,
  Save,
} from 'lucide-react'
import { useThemeStore } from '@/store/themeStore'
import { useMessagingStore } from '@/store/messagingStore'

type Member = {
  userId: string
  role: 'admin' | 'member'
  profile: { id: string; firstName: string; lastName: string; image: string | null; email: string } | null
}

type CandidateMember = {
  userId: string
  profile: { firstName: string; lastName: string; image: string | null; email: string } | null
}

type GroupDetails = {
  id: string
  name: string | null
  description: string | null
  avatar_url: string | null
  type: 'dm' | 'group'
  canManageGroup: boolean
  viewerRole: 'admin' | 'member'
  members: Member[]
}

interface Props {
  conversationId: string
  currentUserId: string
  candidateMembers?: CandidateMember[]
  onClose: () => void
  onUpdated?: () => void
  onLeft?: () => void
}

function displayName(member: { userId: string; profile: { firstName: string; lastName: string; email: string } | null }) {
  if (!member.profile) return member.userId
  const full = `${member.profile.firstName ?? ''} ${member.profile.lastName ?? ''}`.trim()
  return full || member.profile.email || member.userId
}

export default function GroupDetailsModal({
  conversationId,
  currentUserId,
  candidateMembers = [],
  onClose,
  onUpdated,
  onLeft,
}: Props) {
  const isDark = useThemeStore((s) => s.isDark)
  const leaveConversation = useMessagingStore((s) => s.leaveConversation)

  const [loading, setLoading] = useState(true)
  const [savingMeta, setSavingMeta] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<GroupDetails | null>(null)

  const [draftName, setDraftName] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [draftAvatarUrl, setDraftAvatarUrl] = useState('')

  const [addSearchTerm, setAddSearchTerm] = useState('')
  const [selectedToAddIds, setSelectedToAddIds] = useState<Set<string>>(new Set())
  const [addingMember, setAddingMember] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/messages/conversations/${conversationId}`)
      if (!res.ok) throw new Error('Failed to load group details')
      const data = await res.json()
      setDetails(data)
      setDraftName((data.name || '').trim())
      setDraftDescription((data.description || '').trim())
      setDraftAvatarUrl((data.avatar_url || '').trim())
    } catch (err: any) {
      setError(err?.message || 'Failed to load group details')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [conversationId])

  const sortedMembers = useMemo(() => {
    const list = details?.members || []
    return [...list].sort((a, b) => {
      if (a.role !== b.role) return a.role === 'admin' ? -1 : 1
      return displayName(a).localeCompare(displayName(b))
    })
  }, [details])

  const addableMembers = useMemo(() => {
    const existing = new Set((details?.members || []).map((m) => m.userId))
    return candidateMembers
      .filter((m) => !existing.has(m.userId))
      .sort((a, b) => displayName(a).localeCompare(displayName(b)))
  }, [candidateMembers, details])

  useEffect(() => {
    setSelectedToAddIds((prev) => {
      const allowed = new Set(addableMembers.map((m) => m.userId))
      const next = new Set<string>()
      for (const id of prev) {
        if (allowed.has(id)) next.add(id)
      }

      // Avoid unnecessary state updates; returning a new Set on every render
      // can cause update loops when candidate lists are re-created upstream.
      if (next.size === prev.size) {
        let equal = true
        for (const id of prev) {
          if (!next.has(id)) {
            equal = false
            break
          }
        }
        if (equal) return prev
      }

      return next
    })
  }, [addableMembers])

  const filteredAddableMembers = useMemo(() => {
    const q = addSearchTerm.trim().toLowerCase()
    if (!q) return addableMembers
    return addableMembers.filter((m) => {
      const name = displayName(m).toLowerCase()
      const email = (m.profile?.email || '').toLowerCase()
      return name.includes(q) || email.includes(q)
    })
  }, [addableMembers, addSearchTerm])

  const toggleSelectToAdd = (userId: string) => {
    setSelectedToAddIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  const handleSaveMeta = async () => {
    if (!details) return
    const name = draftName.trim()
    if (!name) {
      setError('Group name is required')
      return
    }

    setSavingMeta(true)
    setError(null)
    try {
      const res = await fetch(`/api/messages/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: draftDescription.trim() || null,
          avatarUrl: draftAvatarUrl.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to update group details')
      }
      await load()
      onUpdated?.()
    } catch (err: any) {
      setError(err?.message || 'Failed to update group details')
    } finally {
      setSavingMeta(false)
    }
  }

  const handleAddMembers = async () => {
    const memberIds = Array.from(selectedToAddIds)
    if (memberIds.length === 0) return

    setAddingMember(true)
    setError(null)
    try {
      const res = await fetch(`/api/messages/conversations/${conversationId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberIds }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to add member')
      }

      setAddSearchTerm('')
      setSelectedToAddIds(new Set())
      await load()
      onUpdated?.()
    } catch (err: any) {
      setError(err?.message || 'Failed to add member')
    } finally {
      setAddingMember(false)
    }
  }

  const handleRoleChange = async (memberUserId: string, role: 'admin' | 'member') => {
    setChangingRoleId(memberUserId)
    setError(null)
    try {
      const res = await fetch(`/api/messages/conversations/${conversationId}/members/${memberUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to update role')
      }
      await load()
      onUpdated?.()
    } catch (err: any) {
      setError(err?.message || 'Failed to update role')
    } finally {
      setChangingRoleId(null)
    }
  }

  const handleRemove = async (memberUserId: string) => {
    if (!confirm('Remove this member from the group?')) return

    setRemovingId(memberUserId)
    setError(null)
    try {
      const res = await fetch(`/api/messages/conversations/${conversationId}/members/${memberUserId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to remove member')
      }
      await load()
      onUpdated?.()
    } catch (err: any) {
      setError(err?.message || 'Failed to remove member')
    } finally {
      setRemovingId(null)
    }
  }

  const handleLeave = async () => {
    if (!confirm('Leave this group?')) return
    setLeaving(true)
    setError(null)
    try {
      await leaveConversation(conversationId)
      onUpdated?.()
      onLeft?.()
      onClose()
    } catch {
      setError('Failed to leave group')
    } finally {
      setLeaving(false)
    }
  }

  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const bg = isDark ? '#111216' : '#ffffff'
  const section = isDark ? '#17181e' : '#f8fafc'
  const text = isDark ? '#e4e4e7' : '#18181b'
  const muted = isDark ? '#a1a1aa' : '#6b7280'

  const avatarPreview = draftAvatarUrl.trim() || details?.avatar_url || ''
  const initials = (draftName || details?.name || 'GR').slice(0, 2).toUpperCase()

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 39 }}
      />
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(700px, calc(100% - 20px))',
          maxHeight: 'min(86vh, 820px)',
          overflowY: 'auto',
          border: `1px solid ${border}`,
          borderRadius: 18,
          background: bg,
          zIndex: 40,
          boxShadow: '0 26px 60px rgba(0,0,0,0.38)',
        }}
      >
        <div
          style={{
            padding: '14px 16px',
            borderBottom: `1px solid ${border}`,
            background: isDark
              ? 'linear-gradient(90deg, rgba(37,99,235,0.18), rgba(2,132,199,0.05))'
              : 'linear-gradient(90deg, rgba(59,130,246,0.12), rgba(14,165,233,0.04))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <UsersRound size={16} color="#3b82f6" />
            <div>
              <div style={{ color: text, fontSize: 14, fontWeight: 800 }}>Group Details</div>
              <div style={{ color: muted, fontSize: 11 }}>WhatsApp-style group controls</div>
            </div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: muted, cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 14 }}>
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: muted }} />
            </div>
          )}

          {!loading && error && (
            <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 10 }}>{error}</div>
          )}

          {!loading && details && (
            <>
              <div style={{ border: `1px solid ${border}`, borderRadius: 14, background: section, padding: 12, marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ position: 'relative', width: 62, height: 62, flexShrink: 0 }}>
                    <div
                      style={{
                        width: 62,
                        height: 62,
                        borderRadius: 14,
                        overflow: 'hidden',
                        background: isDark ? '#3f3f46' : '#e2e8f0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {avatarPreview ? (
                        <img src={avatarPreview} alt="Group avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ color: muted, fontSize: 18, fontWeight: 800 }}>{initials}</span>
                      )}
                    </div>
                    {details.canManageGroup && (
                      <div
                        style={{
                          position: 'absolute',
                          right: -4,
                          bottom: -4,
                          width: 23,
                          height: 23,
                          borderRadius: 8,
                          background: '#3b82f6',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Camera size={11} />
                      </div>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: muted, marginBottom: 5 }}>Group name</div>
                    <input
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      disabled={!details.canManageGroup}
                      maxLength={120}
                      style={{
                        width: '100%',
                        border: `1px solid ${border}`,
                        borderRadius: 9,
                        background: details.canManageGroup ? (isDark ? '#101116' : '#fff') : (isDark ? '#15161a' : '#f1f5f9'),
                        color: text,
                        fontSize: 13,
                        padding: '8px 9px',
                        outline: 'none',
                        marginBottom: 8,
                      }}
                    />

                    <div style={{ fontSize: 11, color: muted, marginBottom: 5 }}>Description</div>
                    <input
                      value={draftDescription}
                      onChange={(e) => setDraftDescription(e.target.value)}
                      disabled={!details.canManageGroup}
                      maxLength={240}
                      placeholder="Group description"
                      style={{
                        width: '100%',
                        border: `1px solid ${border}`,
                        borderRadius: 9,
                        background: details.canManageGroup ? (isDark ? '#101116' : '#fff') : (isDark ? '#15161a' : '#f1f5f9'),
                        color: text,
                        fontSize: 12,
                        padding: '8px 9px',
                        outline: 'none',
                        marginBottom: 8,
                      }}
                    />

                    <div style={{ fontSize: 11, color: muted, marginBottom: 5 }}>Avatar URL</div>
                    <input
                      value={draftAvatarUrl}
                      onChange={(e) => setDraftAvatarUrl(e.target.value)}
                      disabled={!details.canManageGroup}
                      placeholder="https://..."
                      style={{
                        width: '100%',
                        border: `1px solid ${border}`,
                        borderRadius: 9,
                        background: details.canManageGroup ? (isDark ? '#101116' : '#fff') : (isDark ? '#15161a' : '#f1f5f9'),
                        color: text,
                        fontSize: 12,
                        padding: '8px 9px',
                        outline: 'none',
                      }}
                    />
                  </div>
                </div>

                {details.canManageGroup && (
                  <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      onClick={handleSaveMeta}
                      disabled={savingMeta}
                      style={{
                        border: 'none',
                        borderRadius: 9,
                        background: '#3b82f6',
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 700,
                        padding: '8px 11px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      {savingMeta ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={12} />}
                      Save changes
                    </button>
                  </div>
                )}
              </div>

              {details.canManageGroup && (
                <div style={{ border: `1px solid ${border}`, borderRadius: 14, background: section, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: muted, marginBottom: 8 }}>Add members</div>
                  {addableMembers.length > 0 ? (
                    <div>
                      <input
                        value={addSearchTerm}
                        onChange={(e) => setAddSearchTerm(e.target.value)}
                        placeholder="Search members by name or email"
                        style={{
                          width: '100%',
                          border: `1px solid ${border}`,
                          borderRadius: 9,
                          background: isDark ? '#101116' : '#fff',
                          color: text,
                          fontSize: 12,
                          padding: '8px 9px',
                          outline: 'none',
                          marginBottom: 8,
                        }}
                      />

                      <div
                        style={{
                          border: `1px solid ${border}`,
                          borderRadius: 10,
                          maxHeight: 170,
                          overflowY: 'auto',
                          background: isDark ? '#101116' : '#ffffff',
                        }}
                      >
                        {filteredAddableMembers.length === 0 ? (
                          <div style={{ padding: 10, fontSize: 12, color: muted }}>No members match your search.</div>
                        ) : (
                          filteredAddableMembers.map((m) => {
                            const selected = selectedToAddIds.has(m.userId)
                            return (
                              <button
                                key={m.userId}
                                onClick={() => toggleSelectToAdd(m.userId)}
                                style={{
                                  width: '100%',
                                  border: 'none',
                                  borderBottom: `1px solid ${border}`,
                                  background: selected
                                    ? (isDark ? 'rgba(59,130,246,0.22)' : 'rgba(59,130,246,0.12)')
                                    : 'transparent',
                                  color: text,
                                  textAlign: 'left',
                                  padding: '8px 9px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                }}
                              >
                                <span
                                  style={{
                                    width: 14,
                                    height: 14,
                                    borderRadius: 4,
                                    border: `1px solid ${selected ? '#3b82f6' : muted}`,
                                    background: selected ? '#3b82f6' : 'transparent',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#fff',
                                    fontSize: 10,
                                    flexShrink: 0,
                                  }}
                                >
                                  {selected ? '✓' : ''}
                                </span>
                                <span style={{ fontSize: 12, fontWeight: 600 }}>{displayName(m)}</span>
                              </button>
                            )
                          })
                        )}
                      </div>

                      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontSize: 11, color: muted }}>{selectedToAddIds.size} selected</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            onClick={() => setSelectedToAddIds(new Set())}
                            disabled={selectedToAddIds.size === 0}
                            style={{
                              border: `1px solid ${border}`,
                              borderRadius: 9,
                              background: 'transparent',
                              color: muted,
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '8px 9px',
                              cursor: selectedToAddIds.size === 0 ? 'default' : 'pointer',
                              opacity: selectedToAddIds.size === 0 ? 0.55 : 1,
                            }}
                          >
                            Clear
                          </button>
                          <button
                            onClick={handleAddMembers}
                            disabled={selectedToAddIds.size === 0 || addingMember}
                            style={{
                              border: `1px solid ${border}`,
                              borderRadius: 9,
                              background: isDark ? '#1f2937' : '#eff6ff',
                              color: '#3b82f6',
                              fontSize: 12,
                              fontWeight: 700,
                              padding: '8px 10px',
                              cursor: selectedToAddIds.size === 0 ? 'default' : 'pointer',
                              opacity: selectedToAddIds.size === 0 ? 0.55 : 1,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                            }}
                          >
                            {addingMember ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <UserPlus size={12} />}
                            Add selected
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: muted }}>No available members to add.</div>
                  )}
                </div>
              )}

              <div style={{ border: `1px solid ${border}`, borderRadius: 14, background: section, padding: 12 }}>
                <div style={{ fontSize: 11, color: muted, marginBottom: 8 }}>
                  Members ({sortedMembers.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {sortedMembers.map((m) => {
                    const isSelf = m.userId === currentUserId
                    const roleBusy = changingRoleId === m.userId
                    const removeBusy = removingId === m.userId
                    return (
                      <div key={m.userId} style={{ border: `1px solid ${border}`, borderRadius: 11, padding: '8px 9px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: text, fontWeight: 700 }}>{displayName(m)} {isSelf ? '(You)' : ''}</div>
                          <div style={{ fontSize: 10, color: muted }}>{m.role === 'admin' ? 'Admin' : 'Member'}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {details.canManageGroup && !isSelf && (
                            <button
                              onClick={() => handleRoleChange(m.userId, m.role === 'admin' ? 'member' : 'admin')}
                              disabled={roleBusy}
                              style={{ border: `1px solid ${border}`, borderRadius: 8, background: 'transparent', color: '#f59e0b', fontSize: 11, padding: '6px 8px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                            >
                              {roleBusy
                                ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                                : m.role === 'admin' ? <ShieldOff size={11} /> : <ShieldCheck size={11} />}
                              {m.role === 'admin' ? 'Demote' : 'Promote'}
                            </button>
                          )}
                          {details.canManageGroup && !isSelf && (
                            <button
                              onClick={() => handleRemove(m.userId)}
                              disabled={removeBusy}
                              style={{ border: `1px solid ${border}`, borderRadius: 8, background: 'transparent', color: '#ef4444', fontSize: 11, padding: '6px 8px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                            >
                              {removeBusy ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <UserMinus size={11} />}
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 11, color: muted }}>
                  {details.canManageGroup ? 'You can manage group settings.' : 'Only group admin or org owner/admin can manage this group.'}
                </div>
                <button
                  onClick={handleLeave}
                  disabled={leaving}
                  style={{
                    border: 'none',
                    borderRadius: 9,
                    background: 'rgba(239,68,68,0.16)',
                    color: '#ef4444',
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '8px 11px',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {leaving ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <LogOut size={12} />}
                  Leave group
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
