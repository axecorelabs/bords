'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from '@/components/AuthProvider'
import { motion } from 'framer-motion'
import { Building2, Check, X, Clock, AlertTriangle, Loader2, Users, ArrowRight } from 'lucide-react'

interface InviteData {
  invitation: {
    _id: string
    organizationId: string
    email: string
    role: string
    status: 'pending' | 'accepted' | 'expired'
    expiresAt: string
    createdAt: string
  }
  organization: {
    _id: string
    name: string
  } | null
  inviter: {
    name: string
    email: string
    image: string | null
  } | null
}

export default function InvitePage() {
  const params = useParams()
  const router = useRouter()
  const { data: session, status: authStatus } = useSession()
  const token = params.token as string

  const [inviteData, setInviteData] = useState<InviteData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isAccepting, setIsAccepting] = useState(false)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [emailMismatch, setEmailMismatch] = useState(false)

  // Fetch invitation details
  useEffect(() => {
    if (!token) return

    const fetchInvite = async () => {
      try {
        const res = await fetch(`/api/invitations/by-token/${token}`)
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || 'Invitation not found')
          return
        }
        setInviteData(data)

        // Check email match
        const signedInEmail = session?.user?.email?.toLowerCase() || null
        setEmailMismatch(!!signedInEmail && data.invitation.email !== signedInEmail)
      } catch {
        setError('Failed to load invitation')
      } finally {
        setIsLoading(false)
      }
    }

    if (authStatus !== 'loading') {
      fetchInvite()
    }
  }, [token, authStatus, session])

  // Handle accept
  const handleAccept = async () => {
    if (!inviteData) return
    setIsAccepting(true)
    setError('')

    try {
      const res = await fetch(`/api/invitations/${inviteData.invitation._id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || data.message || 'Failed to accept invitation')
        setIsAccepting(false)
        return
      }
      setAccepted(true)
    } catch {
      setError('Something went wrong. Please try again.')
      setIsAccepting(false)
    }
  }

  // Loading auth state
  if (authStatus === 'loading' || isLoading) {
    return (
      <div className="fixed inset-0 bg-black">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-10"
          style={{ backgroundImage: 'url(/bord2.png)' }}
        />
        <div className="absolute inset-0 backdrop-blur-[2px] bg-black/50" />
        <div className="relative flex items-center justify-center min-h-screen">
          <div className="text-center">
            <Loader2 size={32} className="animate-spin text-white mx-auto mb-4" />
            <p className="text-zinc-400 text-sm">Loading invitation...</p>
          </div>
        </div>
      </div>
    )
  }

  const invitation = inviteData?.invitation
  const org = inviteData?.organization
  const inviter = inviteData?.inviter
  const isExpired =
    invitation?.status === 'expired' ||
    (invitation?.expiresAt && new Date(invitation.expiresAt) < new Date())
  const isAlreadyAccepted = invitation?.status === 'accepted'
  const orgDashboardPath = org?._id ? `/dashboard/${org._id}` : '/'

  return (
    <div className="fixed inset-0 bg-black">
      {/* Background */}
      <div
        className="absolute inset-0 bg-cover bg-center opacity-10"
        style={{ backgroundImage: 'url(/bord2.png)' }}
      />
      <div className="absolute inset-0 backdrop-blur-[2px] bg-black/50" />

      <div className="relative flex items-center justify-center min-h-screen p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-lg"
        >
          <div className="bg-white/20 backdrop-blur-xl rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-8 text-center border-b border-white/10">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                className="w-16 h-16 bg-black rounded-xl mx-auto mb-4 flex items-center justify-center p-3"
              >
                <img src="/bordclear.png" alt="BORDS" className="w-full h-full object-contain" />
              </motion.div>
              <h1 className="text-2xl font-semibold text-white mb-1 brand-font tracking-tight">
                Organization Invitation
              </h1>
              <p className="text-zinc-400 text-sm">
                You&apos;ve been invited to collaborate on BORDS
              </p>
            </div>

            {/* Content */}
            <div className="p-8">
              {/* Error state */}
              {error && !inviteData && (
                <div className="text-center">
                  <div className="w-14 h-14 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle size={28} className="text-red-400" />
                  </div>
                  <h2 className="text-lg font-semibold text-white mb-2">
                    Invitation Not Found
                  </h2>
                  <p className="text-zinc-400 text-sm mb-6">
                    {error}. The invitation may have been revoked or the link is invalid.
                  </p>
                  <button
                    onClick={() => router.push('/')}
                    className="px-6 py-3 bg-white text-black rounded-xl font-semibold hover:bg-zinc-100 transition-colors"
                  >
                    Go to Dashboard
                  </button>
                </div>
              )}

              {/* Expired state */}
              {inviteData && isExpired && !isAlreadyAccepted && (
                <div className="text-center">
                  <div className="w-14 h-14 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Clock size={28} className="text-amber-400" />
                  </div>
                  <h2 className="text-lg font-semibold text-white mb-2">
                    Invitation Expired
                  </h2>
                  <p className="text-zinc-400 text-sm mb-6">
                    This invitation to join <span className="text-white font-medium">{org?.name}</span> has expired. 
                    Please ask the organization owner to send a new invitation.
                  </p>
                  <button
                    onClick={() => router.push('/')}
                    className="px-6 py-3 bg-white text-black rounded-xl font-semibold hover:bg-zinc-100 transition-colors"
                  >
                    Go to Dashboard
                  </button>
                </div>
              )}

              {/* Already accepted state */}
              {inviteData && isAlreadyAccepted && !accepted && (
                <div className="text-center">
                  <div className="w-14 h-14 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Check size={28} className="text-emerald-400" />
                  </div>
                  <h2 className="text-lg font-semibold text-white mb-2">
                    Already Accepted
                  </h2>
                  <p className="text-zinc-400 text-sm mb-6">
                    You&apos;ve already accepted this invitation and are a member of{' '}
                    <span className="text-white font-medium">{org?.name}</span>.
                  </p>
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={() => router.push(orgDashboardPath)}
                      className="w-full px-6 py-3 bg-white text-black rounded-xl font-semibold hover:bg-zinc-100 transition-colors flex items-center justify-center gap-2"
                    >
                      Go to Organization <ArrowRight size={16} />
                    </button>
                    <button
                      onClick={() => router.push('/')}
                      className="w-full px-6 py-3 bg-white/10 text-white rounded-xl font-medium hover:bg-white/20 transition-colors"
                    >
                      Open Canvas
                    </button>
                  </div>
                </div>
              )}

              {/* Success state after accepting */}
              {accepted && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
                    className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4"
                  >
                    <Check size={32} className="text-emerald-400" />
                  </motion.div>
                  <h2 className="text-xl font-semibold text-white mb-2">
                    You&apos;re in!
                  </h2>
                  <p className="text-zinc-400 text-sm mb-6">
                    You&apos;ve joined <span className="text-white font-medium">{org?.name}</span>. 
                    You&apos;ll now receive task assignments from this organization.
                  </p>
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={() => router.push(orgDashboardPath)}
                      className="w-full px-6 py-3 bg-white text-black rounded-xl font-semibold hover:bg-zinc-100 transition-colors flex items-center justify-center gap-2"
                    >
                      Go to Organization <ArrowRight size={16} />
                    </button>
                    <button
                      onClick={() => router.push('/')}
                      className="w-full px-6 py-3 bg-white/10 text-white rounded-xl font-medium hover:bg-white/20 transition-colors"
                    >
                      Open Canvas
                    </button>
                  </div>
                </motion.div>
              )}

              {/* Pending invitation — main view */}
              {inviteData && !isExpired && !isAlreadyAccepted && !accepted && (
                <div>
                  {/* Organization card */}
                  <div className="bg-white/10 rounded-xl p-5 mb-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
                        <Building2 size={24} className="text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-lg font-semibold text-white truncate">
                          {org?.name || 'Organization'}
                        </h2>
                        <div className="flex items-center gap-1.5 text-zinc-400 text-sm">
                          <Users size={14} />
                          <span>
                            {invitation?.role === 'employee' ? 'Team member' : 'Collaborator'} role
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Inviter info */}
                  {inviter && (
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white text-sm font-semibold">
                        {inviter.image ? (
                          <img src={inviter.image} alt="" className="w-full h-full rounded-full object-cover" />
                        ) : (
                          inviter.name.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div>
                        <p className="text-sm text-white font-medium">{inviter.name}</p>
                        <p className="text-xs text-zinc-500">{inviter.email}</p>
                      </div>
                      <span className="text-xs text-zinc-500 ml-auto">invited you</span>
                    </div>
                  )}

                  {/* What you'll get */}
                  <div className="space-y-2.5 mb-6">
                    <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">
                      What you&apos;ll be able to do
                    </p>
                    {invitation?.role === 'employee' ? (
                      <>
                        <div className="flex items-center gap-3 text-sm text-zinc-300">
                          <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                            <Check size={12} className="text-blue-400" />
                          </div>
                          Receive and complete task assignments
                        </div>
                        <div className="flex items-center gap-3 text-sm text-zinc-300">
                          <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                            <Check size={12} className="text-blue-400" />
                          </div>
                          View tasks in your Execution Inbox
                        </div>
                        <div className="flex items-center gap-3 text-sm text-zinc-300">
                          <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                            <Check size={12} className="text-blue-400" />
                          </div>
                          Get notified when new tasks arrive
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-3 text-sm text-zinc-300">
                          <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                            <Check size={12} className="text-blue-400" />
                          </div>
                          View or edit boards shared with you
                        </div>
                        <div className="flex items-center gap-3 text-sm text-zinc-300">
                          <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                            <Check size={12} className="text-blue-400" />
                          </div>
                          Collaborate visually with the team
                        </div>
                      </>
                    )}
                  </div>

                  {/* Email mismatch warning */}
                  {emailMismatch && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6">
                      <div className="flex items-start gap-3">
                        <AlertTriangle size={18} className="text-amber-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm text-amber-300 font-medium">Email mismatch</p>
                          <p className="text-xs text-amber-400/80 mt-0.5">
                            This invitation was sent to <span className="font-medium">{invitation?.email}</span> but 
                            you&apos;re signed in as <span className="font-medium">{session?.user?.email}</span>. 
                            Please sign in with the correct account.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Inline error */}
                  {error && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6">
                      <p className="text-sm text-red-300">{error}</p>
                    </div>
                  )}

                  {/* Action buttons */}
                  {authStatus !== 'authenticated' ? (
                    <div className="space-y-3">
                      <p className="text-xs text-zinc-400 text-center">
                        Sign in or create an account with <span className="text-white font-medium">{invitation?.email}</span> to accept this invite.
                      </p>
                      <button
                        onClick={() => router.push(`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`)}
                        className="w-full px-5 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-semibold transition-colors"
                      >
                        Sign In to Accept
                      </button>
                      <button
                        onClick={() => router.push('/signup')}
                        className="w-full px-5 py-3 bg-white/10 text-white rounded-xl font-medium hover:bg-white/20 transition-colors"
                      >
                        Create Account
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <button
                        onClick={() => router.push('/')}
                        className="flex-1 px-5 py-3 bg-white/10 text-white rounded-xl font-medium hover:bg-white/20 transition-colors text-center"
                      >
                        Decline
                      </button>
                      <button
                        onClick={handleAccept}
                        disabled={isAccepting || emailMismatch}
                        className="flex-1 px-5 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isAccepting ? (
                          <>
                            <Loader2 size={16} className="animate-spin" />
                            Joining...
                          </>
                        ) : (
                          <>
                            <Check size={16} />
                            Accept Invitation
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Expiry note */}
                  {invitation?.expiresAt && (
                    <p className="text-center text-[11px] text-zinc-600 mt-4 flex items-center justify-center gap-1.5">
                      <Clock size={11} />
                      Expires {new Date(invitation.expiresAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric'
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
