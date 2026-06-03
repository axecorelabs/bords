'use client'

import { useState, useRef, useEffect } from 'react'
import {
  Loader2,
  Clock,
  Mail,
  Trash2,
  UserPlus,
  X,
  BarChart3,
  Shield,
  ShieldCheck,
  ChevronDown,
  Users,
} from 'lucide-react'
import { useOrganizationStore } from '@/store/organizationStore'
import { DashboardData, formatRelativeTime } from './types'
import { DeleteConfirmModal } from '@/components/DeleteConfirmModal'

export default function MembersTab({
  data,
  isDark,
  orgId,
  currentUserId,
  onRefresh,
  onViewMemberMetrics,
}: {
  data: DashboardData
  isDark: boolean
  orgId: string
  currentUserId?: string
  onRefresh: () => void
  onViewMemberMetrics?: (memberId: string) => void
}) {
  const [inviteEmail, setInviteEmail] = useState('')
  const [isInviting, setIsInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteMessage, setInviteMessage] = useState('')
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null)
  const [roleMenuId, setRoleMenuId] = useState<string | null>(null)
  const [memberPendingDelete, setMemberPendingDelete] = useState<{ membershipId: string; name: string } | null>(null)
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member')
  const [inviteRoleOpen, setInviteRoleOpen] = useState(false)
  const inviteRoleRef = useRef<HTMLDivElement>(null)
  const { inviteEmployee, removeEmployee, revokeInvitation, updateEmployeeRole } = useOrganizationStore()

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (inviteRoleRef.current && !inviteRoleRef.current.contains(e.target as Node)) {
        setInviteRoleOpen(false)
      }
    }
    if (inviteRoleOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [inviteRoleOpen])

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return
    setIsInviting(true)
    setInviteError('')
    setInviteMessage('')
    const result = await inviteEmployee(orgId, inviteEmail.trim(), inviteRole)
    if (result.success) {
      setInviteEmail('')
      setInviteRole('member')
      onRefresh()
      if (result.message) {
        setInviteMessage(result.message)
      }
    } else {
      setInviteError(useOrganizationStore.getState().error || 'Failed to invite')
    }
    setIsInviting(false)
  }

  const handleRoleChange = async (membershipId: string, newRole: 'admin' | 'member') => {
    setUpdatingRoleId(membershipId)
    setRoleMenuId(null)
    await updateEmployeeRole(orgId, membershipId, newRole)
    onRefresh()
    setUpdatingRoleId(null)
  }

  const handleRemove = async (membershipId: string) => {
    setRemovingId(membershipId)
    await removeEmployee(orgId, membershipId)
    onRefresh()
    setRemovingId(null)
    setMemberPendingDelete(null)
  }

  const handleRevoke = async (invitationId: string) => {
    setRevokingId(invitationId)
    await revokeInvitation(orgId, invitationId)
    onRefresh()
    setRevokingId(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className={`text-2xl font-bold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
            Members
          </h1>
          <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
            {data.members.length} member{data.members.length !== 1 ? 's' : ''}
            {data.isOwner && data.pendingInvitations.length > 0 && ` · ${data.pendingInvitations.length} pending`}
          </p>
        </div>
      </div>

      {/* Invite */}
      {data.isOwner && (
        <div className={`rounded-2xl border p-5 mb-6 ${
          isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
        }`}>
          <h3 className={`font-semibold text-sm mb-3 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
            Invite Team Member
          </h3>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Mail size={16} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${
                isDark ? 'text-zinc-500' : 'text-zinc-400'
              }`} />
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                className={`w-full pl-10 pr-4 py-3 rounded-xl border text-sm ${
                  isDark
                    ? 'bg-zinc-900 border-zinc-600 text-white placeholder:text-zinc-500'
                    : 'bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400'
                } focus:outline-none focus:ring-2 focus:ring-blue-500/30`}
                onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
              />
            </div>
            <div className="relative" ref={inviteRoleRef}>
              <button
                type="button"
                onClick={() => setInviteRoleOpen(!inviteRoleOpen)}
                className={`flex items-center gap-2 px-3.5 py-3 rounded-xl border text-sm font-medium transition-colors ${
                  isDark
                    ? 'bg-zinc-900 border-zinc-600 text-white hover:bg-zinc-800'
                    : 'bg-zinc-50 border-zinc-200 text-zinc-900 hover:bg-zinc-100'
                } focus:outline-none focus:ring-2 focus:ring-blue-500/30`}
              >
                {inviteRole === 'admin' ? (
                  <ShieldCheck size={14} className={isDark ? 'text-purple-400' : 'text-purple-500'} />
                ) : (
                  <Users size={14} className={isDark ? 'text-zinc-400' : 'text-zinc-500'} />
                )}
                {inviteRole === 'admin' ? 'Admin' : 'Member'}
                <ChevronDown size={12} className={`transition-transform ${inviteRoleOpen ? 'rotate-180' : ''}`} />
              </button>
              {inviteRoleOpen && (
                <div className={`absolute left-0 top-full mt-1.5 z-20 rounded-xl border shadow-xl overflow-hidden w-[220px] ${
                  isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
                }`}>
                  <button
                    type="button"
                    onClick={() => { setInviteRole('member'); setInviteRoleOpen(false) }}
                    className={`w-full text-left px-3.5 py-2.5 flex items-start gap-3 transition-colors ${
                      inviteRole === 'member'
                        ? isDark ? 'bg-zinc-700/60' : 'bg-blue-50/60'
                        : isDark ? 'hover:bg-zinc-700/40' : 'hover:bg-zinc-50'
                    }`}
                  >
                    <Users size={15} className={`mt-0.5 shrink-0 ${
                      inviteRole === 'member'
                        ? isDark ? 'text-blue-400' : 'text-blue-500'
                        : isDark ? 'text-zinc-400' : 'text-zinc-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>Member</span>
                        {inviteRole === 'member' && <span className="text-blue-500 text-xs">✓</span>}
                      </div>
                      <p className={`text-[11px] mt-0.5 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>Can view boards and complete tasks</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setInviteRole('admin'); setInviteRoleOpen(false) }}
                    className={`w-full text-left px-3.5 py-2.5 flex items-start gap-3 transition-colors ${
                      inviteRole === 'admin'
                        ? isDark ? 'bg-zinc-700/60' : 'bg-blue-50/60'
                        : isDark ? 'hover:bg-zinc-700/40' : 'hover:bg-zinc-50'
                    }`}
                  >
                    <ShieldCheck size={15} className={`mt-0.5 shrink-0 ${
                      inviteRole === 'admin'
                        ? isDark ? 'text-purple-400' : 'text-purple-500'
                        : isDark ? 'text-zinc-400' : 'text-zinc-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>Admin</span>
                        {inviteRole === 'admin' && <span className="text-blue-500 text-xs">✓</span>}
                      </div>
                      <p className={`text-[11px] mt-0.5 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>Can edit all boards and manage members</p>
                    </div>
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={handleInvite}
              disabled={isInviting || !inviteEmail.trim()}
              className="px-6 py-3 rounded-xl text-sm font-semibold bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 transition-colors flex items-center gap-2"
            >
              {isInviting ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
              Send Invite
            </button>
          </div>
          {inviteError && <p className="text-xs text-red-500 mt-2">{inviteError}</p>}
          {inviteMessage && <p className="text-xs text-blue-500 mt-2">{inviteMessage}</p>}
        </div>
      )}

      {/* Pending invitations — owner only */}
      {data.isOwner && data.pendingInvitations.length > 0 && (
        <div className={`rounded-2xl border p-5 mb-6 ${
          isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
        }`}>
          <h3 className={`font-semibold text-sm mb-4 flex items-center gap-2 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
            <Clock size={16} className={isDark ? 'text-amber-400' : 'text-amber-500'} />
            Pending Invitations
          </h3>
          <div className="space-y-2">
            {data.pendingInvitations.map((inv) => (
              <div key={inv._id} className={`flex items-center justify-between p-3 rounded-xl ${
                isDark ? 'bg-zinc-700/30' : 'bg-zinc-50'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center ${
                    isDark ? 'bg-amber-500/15 text-amber-400' : 'bg-amber-100 text-amber-600'
                  }`}>
                    <Mail size={16} />
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>
                      {inv.email}
                    </p>
                    <div className="flex items-center gap-2">
                      <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                        Invited {formatRelativeTime(inv.createdAt)}
                      </p>
                      {inv.orgRole === 'admin' && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
                          isDark ? 'bg-purple-500/15 text-purple-400' : 'bg-purple-100 text-purple-600'
                        }`}>
                          Admin
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {data.isOwner && (
                  <button
                    onClick={() => handleRevoke(inv._id)}
                    disabled={revokingId === inv._id}
                    className={`p-2 rounded-lg transition-colors ${
                      isDark ? 'hover:bg-red-500/20 text-zinc-500 hover:text-red-400' : 'hover:bg-red-50 text-zinc-400 hover:text-red-500'
                    }`}
                    title="Revoke invitation"
                  >
                    {revokingId === inv._id ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active members */}
      <div className={`rounded-2xl border p-5 ${
        isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
      }`}>
        <h3 className={`font-semibold text-sm mb-4 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
          Active Members
        </h3>
        {data.members.length === 0 ? (
          <p className={`text-sm py-8 text-center ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
            No team members yet. Invite someone to get started.
          </p>
        ) : (
          <div className="space-y-2">
            {data.members.map((member) => (
              <div key={member._id} className={`flex items-center justify-between p-3 rounded-xl ${
                isDark ? 'hover:bg-zinc-700/30' : 'hover:bg-zinc-50'
              } transition-colors`}>
                <div className="flex items-center gap-3">
                  {member.image ? (
                    <img src={member.image} alt="" className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${
                      isDark ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-200 text-zinc-600'
                    }`}>
                      {(member.firstName?.[0] || member.email[0]).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>
                        {member.firstName} {member.lastName}
                      </p>
                      {member._id === data.organization.ownerId && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
                          isDark ? 'bg-amber-500/15 text-amber-400' : 'bg-amber-100 text-amber-600'
                        }`}>
                          Owner
                        </span>
                      )}
                      {member._id !== data.organization.ownerId && member.role === 'admin' && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md flex items-center gap-0.5 ${
                          isDark ? 'bg-purple-500/15 text-purple-400' : 'bg-purple-100 text-purple-600'
                        }`}>
                          <ShieldCheck size={10} />
                          Admin
                        </span>
                      )}
                      {currentUserId && member._id === currentUserId && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
                          isDark ? 'bg-blue-500/15 text-blue-400' : 'bg-blue-100 text-blue-600'
                        }`}>
                          You
                        </span>
                      )}
                    </div>
                    <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                      {member.email}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-lg ${
                    isDark ? 'bg-zinc-700/50 text-zinc-400' : 'bg-zinc-100 text-zinc-500'
                  }`}>
                    {member._id === data.organization.ownerId
                      ? `Created ${new Date(data.organization.createdAt).toLocaleDateString()}`
                      : `Joined ${new Date(member.joinedAt).toLocaleDateString()}`
                    }
                  </span>
                  {data.isOwner && onViewMemberMetrics && (
                    <button
                      onClick={() => onViewMemberMetrics(member._id)}
                      className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors ${
                        isDark
                          ? 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
                          : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                      }`}
                      title="View metrics"
                    >
                      <BarChart3 size={13} />
                      Metrics
                    </button>
                  )}
                  {data.isOwner && member._id !== data.organization.ownerId && member.membershipId && (
                    <div className="relative">
                      <button
                        onClick={() => setRoleMenuId(roleMenuId === member._id ? null : member._id)}
                        disabled={updatingRoleId === member.membershipId}
                        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors ${
                          isDark
                            ? 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-700'
                            : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                        }`}
                        title="Change role"
                      >
                        {updatingRoleId === member.membershipId ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Shield size={13} />
                        )}
                        {member.role === 'admin' ? 'Admin' : 'Member'}
                        <ChevronDown size={11} />
                      </button>
                      {roleMenuId === member._id && (
                        <div className={`absolute right-0 top-full mt-1 z-10 rounded-xl border shadow-lg overflow-hidden min-w-[140px] ${
                          isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
                        }`}>
                          <button
                            onClick={() => handleRoleChange(member.membershipId!, 'member')}
                            className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors ${
                              member.role === 'member'
                                ? isDark ? 'bg-zinc-700/50 text-white' : 'bg-zinc-100 text-zinc-900'
                                : isDark ? 'text-zinc-300 hover:bg-zinc-700/50' : 'text-zinc-700 hover:bg-zinc-50'
                            }`}
                          >
                            <Shield size={12} />
                            Member
                            {member.role === 'member' && <span className="ml-auto text-blue-500">✓</span>}
                          </button>
                          <button
                            onClick={() => handleRoleChange(member.membershipId!, 'admin')}
                            className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors ${
                              member.role === 'admin'
                                ? isDark ? 'bg-zinc-700/50 text-white' : 'bg-zinc-100 text-zinc-900'
                                : isDark ? 'text-zinc-300 hover:bg-zinc-700/50' : 'text-zinc-700 hover:bg-zinc-50'
                            }`}
                          >
                            <ShieldCheck size={12} />
                            Admin
                            {member.role === 'admin' && <span className="ml-auto text-blue-500">✓</span>}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {data.isOwner && member.membershipId && (
                    <button
                      onClick={() => {
                        const name = `${member.firstName || ''} ${member.lastName || ''}`.trim() || member.email
                        setMemberPendingDelete({ membershipId: member.membershipId!, name })
                      }}
                      disabled={removingId === member.membershipId}
                      className={`p-2 rounded-lg transition-colors ${
                        isDark ? 'hover:bg-red-500/20 text-zinc-600 hover:text-red-400' : 'hover:bg-red-50 text-zinc-300 hover:text-red-500'
                      }`}
                      title="Remove member"
                    >
                      {removingId === member.membershipId ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <DeleteConfirmModal
        isOpen={!!memberPendingDelete}
        itemType="member"
        itemName={memberPendingDelete?.name}
        onCancel={() => {
          if (!removingId) setMemberPendingDelete(null)
        }}
        onConfirm={() => {
          if (!memberPendingDelete) return
          handleRemove(memberPendingDelete.membershipId)
        }}
      />
    </div>
  )
}
