'use client'

import { useState, useEffect } from 'react'
import { X, Building2, Users, Mail, Trash2, Plus, Loader2 } from 'lucide-react'
import { useThemeStore } from '@/store/themeStore'
import { useOrganizationStore } from '@/store/organizationStore'
import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  isOpen: boolean
  onClose: () => void
}

export function OrgManager({ isOpen, onClose }: Props) {
  const isDark = useThemeStore((s) => s.isDark)
  const {
    organizations,
    currentOrgId,
    employees,
    pendingInvitations,
    isLoading,
    error,
    fetchOrganizations,
    createOrganization,
    setCurrentOrg,
    fetchEmployees,
    inviteEmployee,
    removeEmployee,
    revokeInvitation,
  } = useOrganizationStore()

  const [showNewOrg, setShowNewOrg] = useState(false)
  const [orgName, setOrgName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [isInviting, setIsInviting] = useState(false)
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    if (isOpen) {
      fetchOrganizations()
    }
  }, [isOpen])

  useEffect(() => {
    if (currentOrgId) {
      fetchEmployees(currentOrgId)
    }
  }, [currentOrgId])

  if (!isOpen) return null

  const handleCreateOrg = async () => {
    if (!orgName.trim()) return
    setLocalError('')
    const org = await createOrganization({ name: orgName.trim() })
    if (org) {
      setOrgName('')
      setShowNewOrg(false)
    }
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !currentOrgId) return
    setIsInviting(true)
    setLocalError('')
    const success = await inviteEmployee(currentOrgId, inviteEmail.trim())
    if (success) {
      setInviteEmail('')
    } else {
      setLocalError(error || 'Failed to invite employee')
    }
    setIsInviting(false)
  }

  const currentOrg = organizations.find((o) => o._id === currentOrgId)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        className={`w-full max-w-lg mx-4 rounded-2xl shadow-2xl border overflow-hidden max-h-[80vh] flex flex-col ${
          isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${
          isDark ? 'border-zinc-700' : 'border-zinc-200'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isDark ? 'bg-zinc-700' : 'bg-zinc-100'}`}>
              <Building2 size={18} className={isDark ? 'text-zinc-300' : 'text-zinc-600'} />
            </div>
            <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
              Organization & Team
            </h3>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-500'}`}>
            <X size={18} />
          </button>
        </div>

        <div className="overflow-auto flex-1 px-6 py-4 space-y-6">
          {/* Org Selector / Creator */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={`text-sm font-medium ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                Organization
              </label>
              <button
                onClick={() => setShowNewOrg(true)}
                className={`text-xs font-medium flex items-center gap-1 ${
                  isDark ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                <Plus size={12} /> New
              </button>
            </div>

            {organizations.length === 0 && !showNewOrg ? (
              <button
                onClick={() => setShowNewOrg(true)}
                className={`w-full p-4 rounded-xl border-2 border-dashed text-center text-sm transition-colors ${
                  isDark
                    ? 'border-zinc-600 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300'
                    : 'border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-600'
                }`}
              >
                Create your first organization to start delegating tasks
              </button>
            ) : (
              <div className="flex flex-wrap gap-2">
                {organizations.filter((o) => o.role === 'owner').map((org) => (
                  <button
                    key={org._id}
                    onClick={() => setCurrentOrg(org._id)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      currentOrgId === org._id
                        ? isDark
                          ? 'bg-white text-black'
                          : 'bg-black text-white'
                        : isDark
                          ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                          : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                    }`}
                  >
                    {org.name}
                  </button>
                ))}
              </div>
            )}

            {showNewOrg && (
              <div className={`mt-3 p-3 rounded-xl border ${isDark ? 'border-zinc-600 bg-zinc-900/50' : 'border-zinc-200 bg-zinc-50'}`}>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Organization name"
                  autoFocus
                  className={`w-full px-3 py-2 rounded-lg border text-sm mb-2 ${
                    isDark
                      ? 'bg-zinc-800 border-zinc-600 text-white placeholder:text-zinc-500'
                      : 'bg-white border-zinc-300 text-zinc-900 placeholder:text-zinc-400'
                  }`}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateOrg()}
                />
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => { setShowNewOrg(false); setOrgName('') }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                      isDark ? 'text-zinc-400 hover:bg-zinc-700' : 'text-zinc-500 hover:bg-zinc-200'
                    }`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateOrg}
                    disabled={!orgName.trim() || isLoading}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-black text-white dark:bg-white dark:text-black disabled:opacity-50"
                  >
                    Create
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Employees Section */}
          {currentOrg && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Users size={16} className={isDark ? 'text-zinc-400' : 'text-zinc-500'} />
                <h4 className={`text-sm font-semibold ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>
                  Employees
                </h4>
                <span className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  ({employees.length})
                </span>
              </div>

              {/* Invite Input */}
              <div className="flex gap-2 mb-4">
                <div className="relative flex-1">
                  <Mail size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`} />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="Invite by email..."
                    className={`w-full pl-9 pr-3 py-2.5 rounded-lg border text-sm ${
                      isDark
                        ? 'bg-zinc-900 border-zinc-600 text-white placeholder:text-zinc-500'
                        : 'bg-white border-zinc-300 text-zinc-900 placeholder:text-zinc-400'
                    }`}
                    onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                  />
                </div>
                <button
                  onClick={handleInvite}
                  disabled={isInviting || !inviteEmail.trim()}
                  className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-black text-white dark:bg-white dark:text-black disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isInviting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Invite
                </button>
              </div>

              {/* Employee List */}
              <div className="space-y-2">
                {employees.map((emp) => (
                  <div
                    key={emp._id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${
                      isDark ? 'bg-zinc-900/50' : 'bg-zinc-50'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                      isDark ? 'bg-zinc-700 text-white' : 'bg-zinc-200 text-zinc-700'
                    }`}>
                      {emp.user?.firstName?.charAt(0) || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${isDark ? 'text-zinc-200' : 'text-zinc-900'}`}>
                        {emp.user?.firstName} {emp.user?.lastName}
                      </p>
                      <p className={`text-xs truncate ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                        {emp.user?.email}
                      </p>
                    </div>
                    <button
                      onClick={() => removeEmployee(currentOrgId!, emp._id)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        isDark ? 'hover:bg-red-900/30 text-zinc-500 hover:text-red-400' : 'hover:bg-red-50 text-zinc-400 hover:text-red-600'
                      }`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}

                {pendingInvitations.length > 0 && (
                  <>
                    <p className={`text-xs font-medium mt-4 mb-2 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                      Pending Invitations
                    </p>
                    {pendingInvitations.map((inv) => (
                      <div
                        key={inv._id}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl opacity-60 ${
                          isDark ? 'bg-zinc-900/50' : 'bg-zinc-50'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                          isDark ? 'bg-zinc-700 text-zinc-400' : 'bg-zinc-200 text-zinc-500'
                        }`}>
                          <Mail size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm truncate ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                            {inv.email}
                          </p>
                          <p className={`text-xs ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                            Invitation pending
                          </p>
                        </div>
                        <button
                          onClick={() => revokeInvitation(currentOrgId!, inv._id)}
                          title="Revoke invitation"
                          className={`p-1.5 rounded-lg transition-colors opacity-100 ${
                            isDark ? 'hover:bg-red-900/30 text-zinc-500 hover:text-red-400' : 'hover:bg-red-50 text-zinc-400 hover:text-red-600'
                          }`}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </>
                )}

                {employees.length === 0 && pendingInvitations.length === 0 && (
                  <p className={`text-center text-sm py-6 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    No employees yet. Invite team members above.
                  </p>
                )}
              </div>

              {(localError || error) && (
                <p className="text-sm text-red-500 mt-3">{localError || error}</p>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}
