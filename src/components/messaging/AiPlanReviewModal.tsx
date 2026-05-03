'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, ChevronDown, Edit2, Loader2, MessageSquare, UserCheck, X, XCircle } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useThemeStore } from '@/store/themeStore'
import { useBoardStore } from '@/store/boardStore'
import { useBoardSyncStore } from '@/store/boardSyncStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { hydrateLocalBoardFromCloud } from '@/lib/cloud-board-hydration'
import { useDelegationStore } from '@/store/delegationStore'

type OrgMember = { id: string; name: string; avatarUrl: string | null }

type EnrichedProposal = {
  index: number
  roleHint: string | null
  responsibility: string | null
  confidence: number | null
  suggestedUser: OrgMember | null
}

type PlanContent = {
  summary?: string
  outcomes?: string[]
  workstreams?: Array<{ title?: string; checklist?: string[] }>
  stickyNotes?: Array<{ lane?: string; text?: string }>
  shapeHints?: Array<{ type?: string; label?: string }>
  assignmentProposals?: Array<{ roleHint?: string; responsibility?: string; confidence?: number }>
  materializedBoard?: {
    localBoardId: string
    title: string
    createdAt: string
  }
  appliedAssignments?: Array<{ proposalIndex: number; userId: string; responsibility: string }>
}

type PlanArtifact = {
  id: string
  title: string
  goal: string
  organizationId?: string | null
  status: 'draft' | 'approved' | 'rejected' | 'applied'
  content: PlanContent
}

interface Props {
  planId: string
  onClose: () => void
  onApproved?: () => void
}

export default function AiPlanReviewModal({ planId, onClose, onApproved }: Props) {
  const router = useRouter()
  const isDark = useThemeStore((s) => s.isDark)
  const setCurrentBoard = useBoardStore((s) => s.setCurrentBoard)
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(false)
  const [materializing, setMaterializing] = useState(false)
  const [artifact, setArtifact] = useState<PlanArtifact | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Inline editing
  const [isEditing, setIsEditing] = useState(false)
  const [editDraft, setEditDraft] = useState<PlanContent | null>(null)
  const [saving, setSaving] = useState(false)

  // AI feedback / revise
  const [aiFeedback, setAiFeedback] = useState('')
  const [revising, setRevising] = useState(false)
  const feedbackRef = useRef<HTMLTextAreaElement>(null)

  // Phase 3: assignment proposals
  const [proposals, setProposals] = useState<EnrichedProposal[]>([])
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([])
  const [proposalsLoading, setProposalsLoading] = useState(false)
  const [approvedMap, setApprovedMap] = useState<Record<number, string>>({}) // proposalIndex → userId
  const [rejectedSet, setRejectedSet] = useState<Set<number>>(new Set())
  const [applyingAssignments, setApplyingAssignments] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadArtifact() {
      setLoading(true)
      setError(null)

      try {
        const res = await fetch(`/api/ai/plans/${planId}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (!cancelled) setError(data?.error || 'Failed to load plan')
          return
        }
        if (!cancelled) setArtifact(data)
      } catch {
        if (!cancelled) setError('Failed to load plan')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadArtifact()
    return () => {
      cancelled = true
    }
  }, [planId])

  function startEditing() {
    if (!artifact) return
    setEditDraft({
      summary: artifact.content.summary ?? '',
      outcomes: [...(artifact.content.outcomes ?? [])],
      workstreams: (artifact.content.workstreams ?? []).map((w) => ({
        title: w.title ?? '',
        checklist: [...(w.checklist ?? [])],
      })),
    })
    setIsEditing(true)
  }

  async function saveEdits() {
    if (!artifact || !editDraft) return
    setSaving(true)
    try {
      const res = await fetch(`/api/ai/plans/${planId}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editDraft),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data?.error || 'Failed to save edits')
        return
      }
      setArtifact((prev) => prev ? { ...prev, status: data.status, content: { ...prev.content, ...data.content } } : prev)
      setIsEditing(false)
      setEditDraft(null)
      toast.success('Plan updated')
    } catch {
      toast.error('Failed to save edits')
    } finally {
      setSaving(false)
    }
  }

  async function submitAiFeedback() {
    if (!aiFeedback.trim()) return
    setRevising(true)
    try {
      const res = await fetch(`/api/ai/plans/${planId}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: aiFeedback.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data?.error || 'AI could not revise the plan')
        return
      }
      setArtifact((prev) => prev ? { ...prev, status: data.status, content: { ...prev.content, ...data.content } } : prev)
      setAiFeedback('')
      toast.success('Plan revised by AI')
    } catch {
      toast.error('Failed to revise plan')
    } finally {
      setRevising(false)
    }
  }

  async function loadProposals(pid: string) {
    setProposalsLoading(true)
    try {
      const res = await fetch(`/api/ai/plans/${pid}/propose-assignments`)
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        const fetched: EnrichedProposal[] = data.proposals ?? []
        setProposals(fetched)
        setOrgMembers(data.members ?? [])
        // Pre-approve suggestions
        const preApproved: Record<number, string> = {}
        fetched.forEach((p) => {
          if (p.suggestedUser) preApproved[p.index] = p.suggestedUser.id
        })
        setApprovedMap(preApproved)
      }
    } catch {
      // proposals are optional — silently ignore
    } finally {
      setProposalsLoading(false)
    }
  }

  async function applyAssignments() {
    const approvals = Object.entries(approvedMap)
      .filter(([idx]) => !rejectedSet.has(Number(idx)))
      .map(([idx, userId]) => {
        const p = proposals.find((ep) => ep.index === Number(idx))
        return { proposalIndex: Number(idx), userId, responsibility: p?.responsibility ?? '' }
      })
      .filter((a) => a.responsibility)

    if (approvals.length === 0) {
      toast.error('No assignments approved')
      return
    }

    setApplyingAssignments(true)
    try {
      const res = await fetch(`/api/ai/plans/${planId}/apply-assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvals }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data?.error || 'Failed to apply assignments')
        return
      }
      toast.success(`${data.created} assignment${data.created === 1 ? '' : 's'} created`)
      const refreshRes = await fetch(`/api/ai/plans/${planId}`)
      const refreshed = await refreshRes.json().catch(() => null)
      if (refreshed) setArtifact(refreshed)
    } catch {
      toast.error('Failed to apply assignments')
    } finally {
      setApplyingAssignments(false)
    }
  }

  async function approvePlan() {
    setApproving(true)
    try {
      const res = await fetch(`/api/ai/plans/${planId}/approve`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Failed to approve plan')
        return
      }
      setArtifact((prev) => (prev ? { ...prev, status: 'approved' } : prev))
      onApproved?.()
    } catch {
      setError('Failed to approve plan')
    } finally {
      setApproving(false)
    }
  }

  async function openBoard(boardLocalId: string, boardTitle: string, organizationId: string | null) {
    const workspace = useWorkspaceStore.getState()
    const boardStore = useBoardStore.getState()
    const boardSync = useBoardSyncStore.getState()
    const localBoard = boardStore.boards.find((board) => board.id === boardLocalId)

    const openLocalBoard = () => {
      const effectiveOrgId = localBoard?.organizationId ?? organizationId
      const localPermission = localBoard?.userId && boardStore.currentUserId && localBoard.userId === boardStore.currentUserId
        ? 'owner'
        : (boardSync.boardPermissions[boardLocalId] || 'view')

      if (effectiveOrgId && workspace.orgContainerWorkspace) {
        const org = workspace.orgContainerWorkspace.organizations.find((o) => o._id === effectiveOrgId)
        workspace.switchToOrganization(effectiveOrgId, org?.name || 'Organization')
      } else {
        workspace.switchToPersonal()
      }

      boardSync.setBoardPermission(boardLocalId, localPermission)
      setCurrentBoard(boardLocalId)
      onClose()
      router.push('/')
    }

    let fetchedBoard: any = null
    let fetchedPermission: 'owner' | 'view' | 'edit' = 'view'

    try {
      const accessRes = await fetch(`/api/boards/sync/${encodeURIComponent(boardLocalId)}`)
      if (!accessRes.ok) {
        if (localBoard) {
          openLocalBoard()
          return
        }
        toast.error('You do not have access to this board')
        return
      }
      const json = await accessRes.json().catch(() => ({}))
      fetchedBoard = json?.board ?? null
      if (json?.permission === 'owner' || json?.permission === 'edit' || json?.permission === 'view') {
        fetchedPermission = json.permission
      }
    } catch {
      toast.error('Unable to verify board access right now')
      return
    }

    const effectiveOrgId = fetchedBoard?.organizationId ?? organizationId

    if (effectiveOrgId && workspace.orgContainerWorkspace) {
      const org = workspace.orgContainerWorkspace.organizations.find((o) => o._id === effectiveOrgId)
      workspace.switchToOrganization(effectiveOrgId, org?.name || 'Organization')
    } else {
      workspace.switchToPersonal()
    }

    boardSync.setBoardPermission(boardLocalId, fetchedPermission)

    if (fetchedBoard) {
      hydrateLocalBoardFromCloud({
        boardId: boardLocalId,
        userId: boardStore.currentUserId || '',
        fallbackTitle: boardTitle || 'Board',
        organizationId: effectiveOrgId,
        boardPayload: fetchedBoard,
      })
    }

    setCurrentBoard(boardLocalId)
    onClose()
    router.push('/')
  }

  async function materializeBoardFromPlan() {
    if (!artifact || (artifact.status !== 'approved' && artifact.status !== 'applied')) {
      setError('Approve the plan before creating a board')
      return
    }

    setMaterializing(true)
    setError(null)

    try {
      const res = await fetch(`/api/ai/plans/${planId}/materialize-board`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: isDark ? 'dark' : 'light' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.boardLocalId) {
        setError(data?.error || 'Failed to create board from plan')
        return
      }

      setArtifact((prev) => prev ? {
        ...prev,
        status: 'applied',
        content: {
          ...(prev.content ?? {}),
          materializedBoard: {
            localBoardId: data.boardLocalId,
            title: data.boardTitle ?? prev.title,
            createdAt: new Date().toISOString(),
          },
        },
      } : prev)

      toast.success(data.reused ? 'Using existing plan board' : 'Board created from approved plan')
      // Refresh delegation store so the new server-created board is known locally.
      void useDelegationStore.getState().fetchBords()

      // Load assignment proposals after board is materialized
      loadProposals(planId)

      await openBoard(
        data.boardLocalId,
        data.boardTitle ?? artifact.title,
        data.organizationId ?? artifact.organizationId ?? null,
      )
    } catch {
      setError('Failed to create board from plan')
    } finally {
      setMaterializing(false)
    }
  }

  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const panel = isDark ? '#18181b' : '#ffffff'
  const text = isDark ? '#e4e4e7' : '#18181b'
  const muted = isDark ? '#a1a1aa' : '#71717a'
  const soft = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.03)'
  const sectionBorder = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.08)'
  const sectionCard = {
    border: `1px solid ${sectionBorder}`,
    borderRadius: 12,
    background: soft,
    padding: 12,
  } as const

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: isDark
          ? 'radial-gradient(circle at top, rgba(99,102,241,0.2), rgba(0,0,0,0.75) 42%)'
          : 'radial-gradient(circle at top, rgba(148,163,184,0.26), rgba(0,0,0,0.45) 48%)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        backdropFilter: 'blur(6px)',
      }}
    >
      <div
        style={{
          width: 'min(980px, 100%)',
          maxHeight: '88vh',
          overflow: 'auto',
          borderRadius: 18,
          border: `1px solid ${sectionBorder}`,
          background: panel,
          color: text,
          boxShadow: isDark
            ? '0 28px 80px rgba(0,0,0,0.45)'
            : '0 24px 70px rgba(15,23,42,0.2)',
        }}
      >
        <div style={{ position: 'sticky', top: 0, zIndex: 2, padding: '14px 18px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: isDark ? 'rgba(24,24,27,0.9)' : 'rgba(255,255,255,0.9)', backdropFilter: 'blur(6px)' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Plan Review</div>
            <div style={{ fontSize: 11, color: muted }}>Review, refine, and approve before board generation</div>
          </div>
          <button onClick={onClose} style={{ border: `1px solid ${border}`, background: soft, cursor: 'pointer', color: muted, borderRadius: 10, width: 28, height: 28, display: 'grid', placeItems: 'center' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 18 }}>
          {loading && (
            <div style={{ ...sectionCard, display: 'flex', alignItems: 'center', gap: 8, color: muted }}>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading plan...
            </div>
          )}

          {!loading && error && (
            <div style={{ ...sectionCard, color: '#ef4444', fontSize: 13 }}>{error}</div>
          )}

          {!loading && artifact && (
            <div style={{ display: 'grid', gap: 16 }}>
              <div style={{ ...sectionCard, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.015em' }}>{artifact.title}</div>
                  <div style={{ marginTop: 4, fontSize: 12, color: muted }}>Goal: {artifact.goal}</div>
                  <div style={{ marginTop: 8 }}>
                    <span style={{ fontSize: 11, color: artifact.status === 'approved' || artifact.status === 'applied' ? '#22c55e' : '#f59e0b', fontWeight: 700, border: `1px solid ${artifact.status === 'approved' || artifact.status === 'applied' ? 'rgba(34,197,94,0.35)' : 'rgba(245,158,11,0.35)'}`, borderRadius: 999, padding: '3px 8px', background: artifact.status === 'approved' || artifact.status === 'applied' ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)' }}>
                      {artifact.status.toUpperCase()}
                    </span>
                  </div>
                </div>
                {artifact.status !== 'applied' && !isEditing && (
                  <button
                    onClick={startEditing}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, border: `1px solid ${border}`, background: isDark ? '#27272a' : '#f8fafc', color: text, borderRadius: 10, padding: '6px 10px', fontSize: 11, cursor: 'pointer', flexShrink: 0, fontWeight: 600 }}
                  >
                    <Edit2 size={11} /> Edit plan
                  </button>
                )}
                {isEditing && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => { setIsEditing(false); setEditDraft(null) }}
                      style={{ border: `1px solid ${border}`, background: soft, color: muted, borderRadius: 10, padding: '6px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveEdits}
                      disabled={saving}
                      style={{ border: 'none', background: '#2563eb', color: 'white', borderRadius: 10, padding: '6px 10px', fontSize: 11, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      {saving ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : 'Save changes'}
                    </button>
                  </div>
                )}
              </div>

              {/* Inline edit form */}
              {isEditing && editDraft && (
                <div style={{ ...sectionCard, display: 'grid', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: muted, marginBottom: 4 }}>Summary</label>
                    <textarea
                      value={editDraft.summary ?? ''}
                      onChange={(e) => setEditDraft((prev) => prev ? { ...prev, summary: e.target.value } : prev)}
                      rows={3}
                      style={{ width: '100%', fontSize: 12, color: text, background: isDark ? '#27272a' : '#f4f4f5', border: `1px solid ${border}`, borderRadius: 8, padding: '6px 8px', resize: 'vertical', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: muted, marginBottom: 4 }}>Outcomes <span style={{ fontWeight: 400 }}>(one per line)</span></label>
                    <textarea
                      value={(editDraft.outcomes ?? []).join('\n')}
                      onChange={(e) => setEditDraft((prev) => prev ? { ...prev, outcomes: e.target.value.split('\n') } : prev)}
                      rows={5}
                      style={{ width: '100%', fontSize: 12, color: text, background: isDark ? '#27272a' : '#f4f4f5', border: `1px solid ${border}`, borderRadius: 8, padding: '6px 8px', resize: 'vertical', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: muted, marginBottom: 6 }}>Workstreams</label>
                    {(editDraft.workstreams ?? []).map((ws, wIdx) => (
                      <div key={wIdx} style={{ border: `1px solid ${border}`, borderRadius: 8, padding: 10, marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <input
                            value={ws.title ?? ''}
                            onChange={(e) => setEditDraft((prev) => {
                              if (!prev) return prev
                              const ws2 = [...(prev.workstreams ?? [])]
                              ws2[wIdx] = { ...ws2[wIdx], title: e.target.value }
                              return { ...prev, workstreams: ws2 }
                            })}
                            placeholder={`Workstream ${wIdx + 1} title`}
                            style={{ flex: 1, fontSize: 12, fontWeight: 600, color: text, background: isDark ? '#27272a' : '#f4f4f5', border: `1px solid ${border}`, borderRadius: 6, padding: '4px 8px' }}
                          />
                          <button
                            onClick={() => setEditDraft((prev) => {
                              if (!prev) return prev
                              const ws2 = (prev.workstreams ?? []).filter((_, i) => i !== wIdx)
                              return { ...prev, workstreams: ws2 }
                            })}
                            style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', padding: 2 }}
                            title='Remove workstream'
                          >
                            <XCircle size={14} />
                          </button>
                        </div>
                        <textarea
                          value={(ws.checklist ?? []).join('\n')}
                          onChange={(e) => setEditDraft((prev) => {
                            if (!prev) return prev
                            const ws2 = [...(prev.workstreams ?? [])]
                            ws2[wIdx] = { ...ws2[wIdx], checklist: e.target.value.split('\n') }
                            return { ...prev, workstreams: ws2 }
                          })}
                          rows={4}
                          placeholder='Tasks (one per line)'
                          style={{ width: '100%', fontSize: 11, color: text, background: isDark ? '#27272a' : '#f4f4f5', border: `1px solid ${border}`, borderRadius: 6, padding: '5px 7px', resize: 'vertical', boxSizing: 'border-box' }}
                        />
                      </div>
                    ))}
                    <button
                      onClick={() => setEditDraft((prev) => prev ? { ...prev, workstreams: [...(prev.workstreams ?? []), { title: '', checklist: [] }] } : prev)}
                      style={{ fontSize: 11, border: `1px solid ${border}`, background: 'transparent', color: muted, borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}
                    >
                      + Add workstream
                    </button>
                  </div>
                </div>
              )}

              {/* Read view */}
              {!isEditing && artifact.content?.summary && (
                <section style={sectionCard}>
                  <h4 style={{ margin: '0 0 6px', fontSize: 13 }}>Summary</h4>
                  <p style={{ margin: 0, fontSize: 13, color: text, lineHeight: 1.65 }}>{artifact.content.summary}</p>
                </section>
              )}

              {!isEditing && Array.isArray(artifact.content?.outcomes) && artifact.content.outcomes.length > 0 && (
                <section style={sectionCard}>
                  <h4 style={{ margin: '0 0 6px', fontSize: 13 }}>Outcomes</h4>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: 'grid', gap: 4 }}>
                    {artifact.content.outcomes.map((o, idx) => (
                      <li key={`${o}-${idx}`}>{o}</li>
                    ))}
                  </ul>
                </section>
              )}

              {!isEditing && Array.isArray(artifact.content?.workstreams) && artifact.content.workstreams.length > 0 && (
                <section style={sectionCard}>
                  <h4 style={{ margin: '0 0 6px', fontSize: 13 }}>Workstreams</h4>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {artifact.content.workstreams.map((w, idx) => (
                      <div key={`${w.title ?? 'workstream'}-${idx}`} style={{ border: `1px solid ${sectionBorder}`, borderRadius: 10, padding: 10, background: isDark ? 'rgba(255,255,255,0.02)' : '#ffffff' }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{w.title ?? `Workstream ${idx + 1}`}</div>
                        {Array.isArray(w.checklist) && w.checklist.length > 0 && (
                          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, display: 'grid', gap: 3 }}>
                            {w.checklist.map((item, itemIdx) => (
                              <li key={`${item}-${itemIdx}`}>{item}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* AI feedback bar — visible when plan is in draft/approved and not being manually edited */}
              {!isEditing && artifact.status !== 'applied' && (
                <section style={{ ...sectionCard, border: `1px solid ${isDark ? 'rgba(59,130,246,0.35)' : 'rgba(59,130,246,0.22)'}`, background: isDark ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
                    <MessageSquare size={12} color={isDark ? '#93c5fd' : '#1d4ed8'} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: isDark ? '#93c5fd' : '#1d4ed8' }}>Ask AI to revise this plan</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <textarea
                      ref={feedbackRef}
                      value={aiFeedback}
                      onChange={(e) => setAiFeedback(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitAiFeedback() } }}
                      placeholder='e.g. "Add a social media launch workstream" or "Make the outcomes more specific to book sales"'
                      rows={2}
                      disabled={revising}
                      style={{ flex: 1, fontSize: 12, color: text, background: isDark ? '#27272a' : '#f4f4f5', border: `1px solid ${border}`, borderRadius: 8, padding: '6px 8px', resize: 'none', opacity: revising ? 0.6 : 1 }}
                    />
                    <button
                      onClick={submitAiFeedback}
                      disabled={revising || !aiFeedback.trim()}
                      style={{ border: 'none', background: '#2563eb', color: 'white', borderRadius: 10, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: revising || !aiFeedback.trim() ? 'default' : 'pointer', opacity: revising || !aiFeedback.trim() ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 4, alignSelf: 'flex-end' }}
                    >
                      {revising ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Revising…</> : 'Revise'}
                    </button>
                  </div>
                  <div style={{ fontSize: 10, color: muted, marginTop: 4 }}>⌘↵ to submit</div>
                </section>
              )}

              {Array.isArray(artifact.content?.assignmentProposals) && artifact.content.assignmentProposals.length > 0 && (
                <section style={sectionCard}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <h4 style={{ margin: 0, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <UserCheck size={14} /> Team assignment proposals
                    </h4>
                    {artifact.status === 'applied' && proposals.length === 0 && !proposalsLoading && (
                      <button
                        onClick={() => loadProposals(planId)}
                        style={{ fontSize: 11, border: `1px solid ${border}`, background: soft, color: text, borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }}
                      >
                        Load suggestions
                      </button>
                    )}
                  </div>

                  {proposalsLoading && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: muted, fontSize: 12 }}>
                      <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Loading member suggestions…
                    </div>
                  )}

                  {!proposalsLoading && artifact.status !== 'applied' && (
                    <div style={{ fontSize: 12, color: muted, fontStyle: 'italic' }}>
                      Create the board first to unlock assignment approval.
                    </div>
                  )}

                  {!proposalsLoading && artifact.status === 'applied' && artifact.content.assignmentProposals.map((p, idx) => {
                    const isApproved = approvedMap[idx] !== undefined
                    const isRejected = rejectedSet.has(idx)
                    const appliedAssignments = artifact.content?.appliedAssignments ?? []
                    const alreadyApplied = appliedAssignments.some((a) => a.proposalIndex === idx)

                    return (
                      <div
                        key={`proposal-${idx}`}
                        style={{
                          border: `1px solid ${alreadyApplied ? '#22c55e66' : isApproved && !isRejected ? '#22c55e44' : isRejected ? '#ef444444' : border}`,
                          borderRadius: 10,
                          padding: 10,
                          fontSize: 12,
                          marginBottom: 6,
                          opacity: alreadyApplied ? 0.7 : 1,
                          background: isDark ? 'rgba(255,255,255,0.02)' : '#ffffff',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, color: text }}>{p.roleHint ?? 'Unspecified role'}</div>
                            <div style={{ color: muted, marginTop: 2 }}>{p.responsibility ?? 'No responsibility specified'}</div>
                            {typeof p.confidence === 'number' && (
                              <div style={{ marginTop: 3, fontSize: 11, color: p.confidence >= 0.75 ? '#22c55e' : p.confidence >= 0.5 ? '#f59e0b' : muted }}>
                                Confidence: {Math.round(p.confidence * 100)}%
                              </div>
                            )}
                            {alreadyApplied && (
                              <div style={{ marginTop: 4, fontSize: 11, color: '#22c55e', fontWeight: 600 }}>✓ Applied</div>
                            )}
                          </div>

                          {!alreadyApplied && orgMembers.length > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                                <select
                                  value={approvedMap[idx] ?? ''}
                                  onChange={(e) => {
                                    const val = e.target.value
                                    if (val) {
                                      setApprovedMap((prev) => ({ ...prev, [idx]: val }))
                                      setRejectedSet((prev) => { const s = new Set(prev); s.delete(idx); return s })
                                    } else {
                                      setApprovedMap((prev) => { const m = { ...prev }; delete m[idx]; return m })
                                    }
                                  }}
                                  style={{
                                    fontSize: 11,
                                    border: `1px solid ${border}`,
                                    background: isDark ? '#27272a' : '#f4f4f5',
                                    color: text,
                                    borderRadius: 6,
                                    padding: '3px 22px 3px 6px',
                                    cursor: 'pointer',
                                    appearance: 'none',
                                  }}
                                >
                                  <option value=''>— assign to —</option>
                                  {orgMembers.map((m) => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                  ))}
                                </select>
                                <ChevronDown size={10} style={{ position: 'absolute', right: 5, pointerEvents: 'none', color: muted }} />
                              </div>
                              <button
                                title='Approve'
                                onClick={() => {
                                  setRejectedSet((prev) => { const s = new Set(prev); s.delete(idx); return s })
                                }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: isApproved && !isRejected ? '#22c55e' : muted, padding: 0 }}
                              >
                                <CheckCircle size={16} />
                              </button>
                              <button
                                title='Reject'
                                onClick={() => setRejectedSet((prev) => new Set([...prev, idx]))}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: isRejected ? '#ef4444' : muted, padding: 0 }}
                              >
                                <XCircle size={16} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {artifact.status === 'applied' && proposals.length > 0 && !proposalsLoading && (
                    <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        onClick={applyAssignments}
                        disabled={applyingAssignments || Object.keys(approvedMap).filter((k) => !rejectedSet.has(Number(k))).length === 0}
                        style={{
                          border: 'none',
                          background: '#2563eb',
                          color: 'white',
                          borderRadius: 10,
                          padding: '7px 12px',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: applyingAssignments ? 'default' : 'pointer',
                          opacity: applyingAssignments || Object.keys(approvedMap).filter((k) => !rejectedSet.has(Number(k))).length === 0 ? 0.5 : 1,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                        }}
                      >
                        {applyingAssignments
                          ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Applying…</>
                          : <><UserCheck size={12} /> Apply approved assignments</>}
                      </button>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>

        <div style={{ position: 'sticky', bottom: 0, padding: '12px 18px', borderTop: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', gap: 8, background: isDark ? 'rgba(24,24,27,0.92)' : 'rgba(255,255,255,0.92)', backdropFilter: 'blur(6px)' }}>
          <div style={{ fontSize: 11, color: muted, alignSelf: 'center' }}>
            Keep it lean: approve when this feels executable.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              border: `1px solid ${border}`,
              background: soft,
              color: text,
              borderRadius: 10,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
          <button
            onClick={approvePlan}
            disabled={loading || approving || artifact?.status === 'approved' || artifact?.status === 'applied'}
            style={{
              border: 'none',
              background: '#2563eb',
              color: 'white',
              borderRadius: 10,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 700,
              cursor: loading || approving || artifact?.status === 'approved' || artifact?.status === 'applied' ? 'default' : 'pointer',
              opacity: loading || approving || artifact?.status === 'approved' || artifact?.status === 'applied' ? 0.6 : 1,
            }}
          >
            {approving ? 'Approving...' : artifact?.status === 'approved' || artifact?.status === 'applied' ? 'Approved' : 'Approve plan'}
          </button>
          <button
            onClick={materializeBoardFromPlan}
            disabled={loading || materializing || !(artifact?.status === 'approved' || artifact?.status === 'applied')}
            style={{
              border: 'none',
              background: '#16a34a',
              color: 'white',
              borderRadius: 10,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 700,
              cursor: loading || materializing || !(artifact?.status === 'approved' || artifact?.status === 'applied') ? 'default' : 'pointer',
              opacity: loading || materializing || !(artifact?.status === 'approved' || artifact?.status === 'applied') ? 0.6 : 1,
            }}
          >
            {materializing ? 'Building board...' : 'Create board from plan'}
          </button>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
