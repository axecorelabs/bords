'use client'

import { useState, useEffect } from 'react'
import {
  X,
  UserPlus,
  Calendar,
  Flag,
  MessageSquare,
  ChevronDown,
  Trash2,
  UserCheck,
  Clock,
  CheckCircle2,
} from 'lucide-react'
import { useThemeStore } from '@/store/themeStore'
import { useDelegationStore } from '@/store/delegationStore'
import { useOrganizationStore } from '@/store/organizationStore'
import { useBoardStore } from '@/store/boardStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import type { TaskPriority, BordDTO, TaskAssignmentDTO } from '@/types/delegation'

const PRIORITY_OPTIONS: { value: TaskPriority; label: string; color: string; darkColor: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-blue-100 text-blue-700', darkColor: 'bg-blue-900/30 text-blue-400' },
  { value: 'normal', label: 'Normal', color: 'bg-zinc-100 text-zinc-700', darkColor: 'bg-zinc-700/50 text-zinc-300' },
  { value: 'high', label: 'High', color: 'bg-red-100 text-red-700', darkColor: 'bg-red-900/30 text-red-400' },
]

const STATUS_STYLES: Record<string, { label: string; color: string; darkColor: string; icon: typeof CheckCircle2 }> = {
  draft: { label: 'Draft', color: 'bg-amber-100 text-amber-700', darkColor: 'bg-amber-900/30 text-amber-400', icon: Clock },
  assigned: { label: 'Assigned', color: 'bg-blue-100 text-blue-700', darkColor: 'bg-blue-900/30 text-blue-400', icon: UserCheck },
  backlog: { label: 'Backlog', color: 'bg-zinc-100 text-zinc-600', darkColor: 'bg-zinc-700/50 text-zinc-400', icon: Clock },
  pending: { label: 'Pending', color: 'bg-zinc-100 text-zinc-600', darkColor: 'bg-zinc-700/50 text-zinc-400', icon: Clock },
  in_progress: { label: 'In Progress', color: 'bg-blue-100 text-blue-700', darkColor: 'bg-blue-900/30 text-blue-400', icon: UserCheck },
  review: { label: 'In Review', color: 'bg-violet-100 text-violet-700', darkColor: 'bg-violet-900/30 text-violet-400', icon: CheckCircle2 },
  completed: { label: 'Completed', color: 'bg-emerald-100 text-emerald-700', darkColor: 'bg-emerald-900/30 text-emerald-400', icon: CheckCircle2 },
}

export function AssignTaskModal() {
  const isDark = useThemeStore((s) => s.isDark)
  const {
    isAssignModalOpen,
    assignModalContext,
    closeAssignModal,
    createAssignment,
    deleteAssignment,
    getAssignmentsForSource,
    getBordForLocalBoard,
    linkBoardToOrg,
    fetchBords,
    fetchAssignments,
    createPersonalAssignment,
    deletePersonalAssignment,
    fetchPersonalAssignments,
    getPersonalAssignmentsForSource,
  } = useDelegationStore()
  const {
    organizations,
    employees,
    currentOrgId,
    fetchOrganizations,
    fetchEmployees,
  } = useOrganizationStore()
  const isPersonal = useWorkspaceStore((s) => s.isPersonalContext())
  const friends = useWorkspaceStore((s) => s.friends)
  const fetchFriends = useWorkspaceStore((s) => s.fetchFriends)
  const currentBoardId = useBoardStore((s) => s.currentBoardId)
  const currentBoard = useBoardStore((s) =>
    s.boards.find((b) => b.id === s.currentBoardId)
  )

  const [selectedEmployee, setSelectedEmployee] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [dueDate, setDueDate] = useState('')
  const [executionNote, setExecutionNote] = useState('')
  const [showEmployeeDropdown, setShowEmployeeDropdown] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [skipReview, setSkipReview] = useState(false)
  const [updatingSkipReview, setUpdatingSkipReview] = useState(false)

  // Get existing assignments for this source (context-aware)
  const existingAssignments = assignModalContext
    ? isPersonal
      ? getPersonalAssignmentsForSource(assignModalContext.sourceType, assignModalContext.sourceId)
      : getAssignmentsForSource(assignModalContext.sourceType, assignModalContext.sourceId)
    : []
  const activeAssignments = existingAssignments.filter((a) => a.status !== 'completed')
  const completedAssignments = existingAssignments.filter((a) => a.status === 'completed')
  const hasExisting = existingAssignments.length > 0

  // Kanban tasks: single assignee only
  const isKanban = assignModalContext?.sourceType === 'kanban_task'
  const canAddMore = !isKanban // Only checklist items support multi-assign

  // Partial completion tracking (checklist items only)
  const totalAssigned = existingAssignments.length
  const completedCount = completedAssignments.length
  const isPartiallyCompleted = totalAssigned > 1 && completedCount > 0 && completedCount < totalAssigned
  const isFullyCompleted = totalAssigned > 0 && completedCount === totalAssigned

  // IDs of people already assigned (active only)
  const alreadyAssignedIds = activeAssignments.map((a) => a.assignedTo)

  useEffect(() => {
    if (isAssignModalOpen) {
      if (isPersonal) {
        fetchFriends()
        fetchPersonalAssignments()
      } else {
        fetchOrganizations()
        fetchBords()
      }
      setSelectedEmployee('')
      setPriority('normal')
      setDueDate('')
      setExecutionNote('')
      setError('')
      setShowAddForm(false)
      setRemovingId(null)
      // Init skip_review from the existing kanban assignment if one exists
      if (assignModalContext?.sourceType === 'kanban_task') {
        const existing = isPersonal
          ? getPersonalAssignmentsForSource(assignModalContext.sourceType, assignModalContext.sourceId)
          : getAssignmentsForSource(assignModalContext.sourceType, assignModalContext.sourceId)
        const active = existing.find((a) => a.status !== 'completed')
        setSkipReview(active?.skipReview ?? false)
      } else {
        setSkipReview(false)
      }
    }
  }, [isAssignModalOpen])

  useEffect(() => {
    if (currentOrgId) {
      fetchEmployees(currentOrgId)
    }
  }, [currentOrgId])

  if (!isAssignModalOpen || !assignModalContext) return null

  // Build the people list based on context
  const acceptedFriends = friends.filter((f) => f.status === 'accepted')
  // Filter out already-assigned people from the dropdown
  const availableEmployees = isPersonal
    ? [] // not used in personal
    : employees.filter((emp) => !alreadyAssignedIds.includes(emp.userId))
  const availableFriends = isPersonal
    ? acceptedFriends.filter((f) => !alreadyAssignedIds.includes(f.userId))
    : []

  const handleAssign = async () => {
    if (!selectedEmployee) {
      setError(isPersonal ? 'Please select a friend' : 'Please select a team member')
      return
    }
    if (!currentBoardId) {
      setError('No board selected')
      return
    }

    setIsSubmitting(true)
    setError('')

    try {
      if (isPersonal) {
        // Personal friend assignment — no bord needed
        const result = await createPersonalAssignment({
          sourceType: assignModalContext.sourceType,
          sourceId: assignModalContext.sourceId,
          content: assignModalContext.content,
          assignedTo: selectedEmployee,
          priority,
          dueDate: dueDate || undefined,
          executionNote: executionNote || undefined,
          columnId: assignModalContext.columnId,
          columnTitle: assignModalContext.columnTitle,
          availableColumns: assignModalContext.availableColumns,
          skipReview: isKanban ? skipReview : undefined,
        })
        if (result) {
          setSelectedEmployee('')
          setPriority('normal')
          setDueDate('')
          setExecutionNote('')
          setShowAddForm(false)
          setError('')
          if (!hasExisting) closeAssignModal()
        } else {
          setError('Failed to create assignment')
        }
      } else {
        // Org team member assignment — needs bord
        if (!currentOrgId) {
          setError('Please set up an organization first')
          setIsSubmitting(false)
          return
        }
        let bord: BordDTO | undefined = getBordForLocalBoard(currentBoardId) ?? undefined
        if (!bord) {
          const linked = await linkBoardToOrg(
            currentOrgId,
            currentBoardId,
            currentBoard?.name || 'Untitled Board'
          )
          if (!linked) throw new Error('Failed to link board to organization')
          bord = linked
        }

        const result = await createAssignment(bord._id, {
          sourceType: assignModalContext.sourceType,
          sourceId: assignModalContext.sourceId,
          content: assignModalContext.content,
          assignedTo: selectedEmployee,
          priority,
          dueDate: dueDate || undefined,
          executionNote: executionNote || undefined,
          columnId: assignModalContext.columnId,
          columnTitle: assignModalContext.columnTitle,
          availableColumns: assignModalContext.availableColumns,
          skipReview: isKanban ? skipReview : undefined,
        })

        if (result) {
          setSelectedEmployee('')
          setPriority('normal')
          setDueDate('')
          setExecutionNote('')
          setShowAddForm(false)
          setError('')
          if (!hasExisting) closeAssignModal()
        } else {
          setError('Failed to create assignment')
        }
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleToggleSkipReview = async (next: boolean) => {
    setSkipReview(next)
    // If an active assignment already exists, persist the change immediately
    const activeAssignment = activeAssignments[0]
    if (hasExisting && activeAssignment) {
      setUpdatingSkipReview(true)
      try {
        await fetch(`/api/execution/tasks/${activeAssignment._id}/update`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skipReview: next }),
        })
      } catch { /* silent */ } finally {
        setUpdatingSkipReview(false)
      }
    }
  }

  const handleRemoveAssignment = async (assignment: TaskAssignmentDTO) => {
    setRemovingId(assignment._id)
    try {
      if (isPersonal) {
        await deletePersonalAssignment(assignment._id)
      } else {
        if (!assignment.bordId) return
        await deleteAssignment(assignment.bordId, assignment._id)
      }
    } catch {
      // silent
    } finally {
      setRemovingId(null)
    }
  }

  const selectedEmp = isPersonal
    ? undefined
    : employees.find((e) => e.userId === selectedEmployee)
  const selectedFriend = isPersonal
    ? acceptedFriends.find((f) => f.userId === selectedEmployee)
    : undefined

  // Helper to find assignee info from assignment
  const getAssigneeInfo = (assignment: TaskAssignmentDTO) => {
    if (assignment.assignee) return assignment.assignee
    if (isPersonal) {
      const friend = acceptedFriends.find((f) => f.userId === assignment.assignedTo)
      if (friend) return { _id: friend.userId, email: friend.email, firstName: friend.firstName, lastName: friend.lastName, image: friend.image }
    }
    const emp = employees.find((e) => e.userId === assignment.assignedTo)
    return emp?.user
  }

  const showForm = (!hasExisting || showAddForm) && (canAddMore || !hasExisting)

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]"
      onClick={closeAssignModal}
    >
      <div
        className={`w-full max-w-md mx-4 rounded-2xl shadow-2xl border overflow-hidden max-h-[90vh] flex flex-col ${
          isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-b flex-shrink-0 ${
            isDark ? 'border-zinc-700' : 'border-zinc-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isDark ? 'bg-zinc-700' : 'bg-zinc-100'}`}>
              <UserPlus size={18} className={isDark ? 'text-zinc-300' : 'text-zinc-600'} />
            </div>
            <div>
              <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                {hasExisting ? 'Task Assignments' : 'Assign Task'}
              </h3>
              <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                {hasExisting
                  ? isPartiallyCompleted
                    ? `${completedCount}/${totalAssigned} completed`
                    : isFullyCompleted
                      ? `All ${totalAssigned} completed`
                      : `${activeAssignments.length} active${completedAssignments.length > 0 ? `, ${completedAssignments.length} completed` : ''}`
                  : isPersonal ? 'Assign to a friend' : 'Draft — publishes on next deploy (Assign to a team member)'}
              </p>
            </div>
          </div>
          <button
            onClick={closeAssignModal}
            className={`p-1.5 rounded-lg transition-colors ${
              isDark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-500'
            }`}
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* Task Content Preview */}
          <div className={`mx-6 mt-4 p-3 rounded-lg border text-sm ${
            isDark ? 'bg-zinc-900/50 border-zinc-700 text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-700'
          }`}>
            <p className="line-clamp-2">{assignModalContext.content}</p>
            <span className={`text-xs mt-1 inline-block ${
              isDark ? 'text-zinc-500' : 'text-zinc-400'
            }`}>
              {assignModalContext.sourceType === 'note' && 'Sticky Note'}
              {assignModalContext.sourceType === 'checklist_item' && 'Checklist Item'}
              {assignModalContext.sourceType === 'kanban_task' && 'Kanban Task'}
            </span>
          </div>

          {/* Existing Assignments List */}
          {hasExisting && (
            <div className="px-6 mt-4">
              {/* Partial Completion Progress Bar (checklist multi-assign) */}
              {totalAssigned > 1 && (
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-xs font-medium ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                      Completion Progress
                    </span>
                    <span className={`text-xs font-bold ${
                      isFullyCompleted
                        ? 'text-emerald-500'
                        : isPartiallyCompleted
                          ? 'text-amber-500'
                          : isDark ? 'text-zinc-500' : 'text-zinc-400'
                    }`}>
                      {completedCount}/{totalAssigned}
                    </span>
                  </div>
                  <div className={`h-2 rounded-full overflow-hidden ${
                    isDark ? 'bg-zinc-700' : 'bg-zinc-200'
                  }`}>
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isFullyCompleted
                          ? 'bg-emerald-500'
                          : isPartiallyCompleted
                            ? 'bg-amber-500'
                            : 'bg-zinc-400'
                      }`}
                      style={{ width: `${totalAssigned > 0 ? (completedCount / totalAssigned) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              <h4 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
                isDark ? 'text-zinc-500' : 'text-zinc-400'
              }`}>
                {isKanban ? 'Assigned To' : 'Assignees'}
              </h4>
              <div className="space-y-2">
                {existingAssignments.map((assignment) => {
                  const assignee = getAssigneeInfo(assignment)
                  const statusStyle = STATUS_STYLES[assignment.status] || STATUS_STYLES.draft
                  const StatusIcon = statusStyle.icon
                  const isRemoving = removingId === assignment._id
                  const isCompleted = assignment.status === 'completed'

                  return (
                    <div
                      key={assignment._id}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                        isCompleted
                          ? isDark
                            ? 'bg-zinc-800/50 border-zinc-700/50 opacity-60'
                            : 'bg-zinc-50/50 border-zinc-200/50 opacity-60'
                          : isDark
                            ? 'bg-zinc-900/50 border-zinc-700 hover:border-zinc-600'
                            : 'bg-white border-zinc-200 hover:border-zinc-300'
                      }`}
                    >
                      {/* Avatar */}
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${
                        isDark ? 'bg-zinc-700 text-white' : 'bg-zinc-200 text-zinc-700'
                      }`}>
                        {assignee?.firstName?.charAt(0) || assignee?.email?.charAt(0) || '?'}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${
                          isDark ? 'text-zinc-200' : 'text-zinc-900'
                        }`}>
                          {assignee ? `${assignee.firstName} ${assignee.lastName}` : 'Unknown'}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                            isDark ? statusStyle.darkColor : statusStyle.color
                          }`}>
                            <StatusIcon size={10} />
                            {statusStyle.label}
                          </span>
                          {assignment.priority !== 'normal' && (
                            <span className={`text-[10px] font-medium ${
                              assignment.priority === 'high'
                                ? 'text-red-500'
                                : 'text-blue-500'
                            }`}>
                              <Flag size={10} className="inline mr-0.5" />
                              {assignment.priority === 'high' ? 'High' : 'Low'}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Remove button (only for non-completed) */}
                      {!isCompleted && (
                        <button
                          onClick={() => handleRemoveAssignment(assignment)}
                          disabled={isRemoving}
                          className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${
                            isRemoving
                              ? 'opacity-50 cursor-not-allowed'
                              : isDark
                                ? 'text-zinc-600 hover:text-red-400 hover:bg-red-900/20'
                                : 'text-zinc-300 hover:text-red-500 hover:bg-red-50'
                          }`}
                          title="Remove assignment"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Add another person button (only for checklist items) */}
              {canAddMore && !showAddForm && (
                <button
                  onClick={() => setShowAddForm(true)}
                  className={`w-full mt-3 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed text-sm font-medium transition-all ${
                    isDark
                      ? 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300'
                      : 'border-zinc-200 text-zinc-400 hover:border-zinc-300 hover:text-zinc-600'
                  }`}
                >
                  <UserPlus size={16} />
                  {isPersonal ? 'Assign to another friend' : 'Assign to another team member'}
                </button>
              )}
            </div>
          )}

          {/* Skip review toggle — always visible for kanban tasks */}
          {isKanban && (
            <div className={`mx-6 mt-4 flex items-center justify-between p-3 rounded-xl border ${
              isDark ? 'bg-zinc-900/50 border-zinc-700' : 'bg-zinc-50 border-zinc-200'
            }`}>
              <div className="flex-1 min-w-0 pr-3">
                <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>
                  Skip review
                </p>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  {skipReview
                    ? 'Assignee can complete tasks directly'
                    : 'Completed tasks go to review for your approval'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleToggleSkipReview(!skipReview)}
                disabled={updatingSkipReview}
                className={`relative flex-shrink-0 w-10 h-6 rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
                  skipReview
                    ? 'bg-emerald-500'
                    : isDark ? 'bg-zinc-600' : 'bg-zinc-300'
                }`}
                role="switch"
                aria-checked={skipReview}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  skipReview ? 'translate-x-4' : 'translate-x-0'
                }`} />
              </button>
            </div>
          )}

          {/* Add / Assign Form */}
          {showForm && (
            <div className="px-6 py-4 space-y-4">
              {hasExisting && (
                <div className="flex items-center justify-between">
                  <h4 className={`text-xs font-semibold uppercase tracking-wider ${
                    isDark ? 'text-zinc-500' : 'text-zinc-400'
                  }`}>
                    Add Assignee
                  </h4>
                  {showAddForm && (
                    <button
                      onClick={() => setShowAddForm(false)}
                      className={`text-xs transition-colors ${isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-600'}`}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )}

              {/* Person Selector */}
              <div>
                <label className={`block text-sm font-medium mb-1.5 ${
                  isDark ? 'text-zinc-300' : 'text-zinc-700'
                }`}>
                  Assign to
                </label>
                {isPersonal ? (
                  /* ── Friend selector ── */
                  availableFriends.length === 0 ? (
                    <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                      {acceptedFriends.length === 0
                        ? 'No friends yet. Add friends from your personal workspace.'
                        : 'All friends are already assigned to this task.'}
                    </p>
                  ) : (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowEmployeeDropdown(!showEmployeeDropdown)}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                          isDark
                            ? 'bg-zinc-900 border-zinc-600 text-zinc-200 hover:border-zinc-500'
                            : 'bg-white border-zinc-300 text-zinc-900 hover:border-zinc-400'
                        }`}
                      >
                        {selectedFriend ? (
                          <span>
                            {selectedFriend.firstName} {selectedFriend.lastName}
                            <span className={`ml-2 text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                              {selectedFriend.email}
                            </span>
                          </span>
                        ) : (
                          <span className={isDark ? 'text-zinc-500' : 'text-zinc-400'}>
                            Select friend...
                          </span>
                        )}
                        <ChevronDown size={16} />
                      </button>

                      {showEmployeeDropdown && (
                        <div className={`absolute top-full left-0 right-0 mt-1 rounded-lg border shadow-xl z-10 max-h-48 overflow-auto ${
                          isDark ? 'bg-zinc-800 border-zinc-600' : 'bg-white border-zinc-200'
                        }`}>
                          {availableFriends.map((friend) => (
                            <button
                              key={friend._id}
                              type="button"
                              onClick={() => {
                                setSelectedEmployee(friend.userId)
                                setShowEmployeeDropdown(false)
                              }}
                              className={`w-full text-left px-3 py-2.5 text-sm transition-colors flex items-center gap-3 ${
                                selectedEmployee === friend.userId
                                  ? isDark ? 'bg-zinc-700' : 'bg-zinc-100'
                                  : isDark ? 'hover:bg-zinc-700/50' : 'hover:bg-zinc-50'
                              }`}
                            >
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                                isDark ? 'bg-zinc-600 text-white' : 'bg-zinc-200 text-zinc-700'
                              }`}>
                                {friend.firstName?.charAt(0) || friend.email?.charAt(0) || '?'}
                              </div>
                              <div>
                                <p className={isDark ? 'text-zinc-200' : 'text-zinc-900'}>
                                  {friend.nickname || `${friend.firstName} ${friend.lastName}`}
                                </p>
                                <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                  {friend.email}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  /* ── Employee selector (org context) ── */
                  availableEmployees.length === 0 ? (
                    <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                      {employees.length === 0
                        ? 'No team members yet. Invite members from Organization settings.'
                        : 'All team members are already assigned to this task.'}
                    </p>
                  ) : (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowEmployeeDropdown(!showEmployeeDropdown)}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                          isDark
                            ? 'bg-zinc-900 border-zinc-600 text-zinc-200 hover:border-zinc-500'
                            : 'bg-white border-zinc-300 text-zinc-900 hover:border-zinc-400'
                        }`}
                      >
                        {selectedEmp ? (
                          <span>
                            {selectedEmp.user?.firstName} {selectedEmp.user?.lastName}
                            <span className={`ml-2 text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                              {selectedEmp.user?.email}
                            </span>
                          </span>
                        ) : (
                          <span className={isDark ? 'text-zinc-500' : 'text-zinc-400'}>
                            Select team member...
                          </span>
                        )}
                        <ChevronDown size={16} />
                      </button>

                      {showEmployeeDropdown && (
                        <div className={`absolute top-full left-0 right-0 mt-1 rounded-lg border shadow-xl z-10 max-h-48 overflow-auto ${
                          isDark ? 'bg-zinc-800 border-zinc-600' : 'bg-white border-zinc-200'
                        }`}>
                          {availableEmployees.map((emp) => (
                            <button
                              key={emp._id}
                              type="button"
                              onClick={() => {
                                setSelectedEmployee(emp.userId)
                                setShowEmployeeDropdown(false)
                              }}
                              className={`w-full text-left px-3 py-2.5 text-sm transition-colors flex items-center gap-3 ${
                                selectedEmployee === emp.userId
                                  ? isDark ? 'bg-zinc-700' : 'bg-zinc-100'
                                  : isDark ? 'hover:bg-zinc-700/50' : 'hover:bg-zinc-50'
                              }`}
                            >
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                                isDark ? 'bg-zinc-600 text-white' : 'bg-zinc-200 text-zinc-700'
                              }`}>
                                {emp.user?.firstName?.charAt(0) || emp.user?.email?.charAt(0) || '?'}
                              </div>
                              <div>
                                <p className={isDark ? 'text-zinc-200' : 'text-zinc-900'}>
                                  {emp.user?.firstName} {emp.user?.lastName}
                                </p>
                                <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                  {emp.user?.email}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>

              {/* Priority */}
              <div>
                <label className={`block text-sm font-medium mb-1.5 ${
                  isDark ? 'text-zinc-300' : 'text-zinc-700'
                }`}>
                  Priority
                </label>
                <div className="flex gap-2">
                  {PRIORITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPriority(opt.value)}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        priority === opt.value
                          ? `${isDark ? opt.darkColor : opt.color} ring-2 ring-offset-1 ${isDark ? 'ring-zinc-500 ring-offset-zinc-800' : 'ring-zinc-300 ring-offset-white'}`
                          : isDark ? 'bg-zinc-900 text-zinc-400 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Due Date */}
              <div>
                <label className={`flex items-center gap-1.5 text-sm font-medium mb-1.5 ${
                  isDark ? 'text-zinc-300' : 'text-zinc-700'
                }`}>
                  <Calendar size={14} />
                  Due Date
                  <span className={`text-xs font-normal ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>(optional)</span>
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={`w-full px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                    isDark
                      ? 'bg-zinc-900 border-zinc-600 text-zinc-200'
                      : 'bg-white border-zinc-300 text-zinc-900'
                  }`}
                />
              </div>

              {/* Execution Note */}
              <div>
                <label className={`flex items-center gap-1.5 text-sm font-medium mb-1.5 ${
                  isDark ? 'text-zinc-300' : 'text-zinc-700'
                }`}>
                  <MessageSquare size={14} />
                  Execution Note
                  <span className={`text-xs font-normal ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>(optional)</span>
                </label>
                <textarea
                  value={executionNote}
                  onChange={(e) => setExecutionNote(e.target.value)}
                  placeholder={isPersonal ? 'Add context or instructions for your friend...' : 'Add context or instructions for the team member...'}
                  rows={2}
                  className={`w-full px-3 py-2.5 rounded-lg border text-sm resize-none transition-colors ${
                    isDark
                      ? 'bg-zinc-900 border-zinc-600 text-zinc-200 placeholder:text-zinc-600'
                      : 'bg-white border-zinc-300 text-zinc-900 placeholder:text-zinc-400'
                  }`}
                />
              </div>

              {error && (
                <p className="text-sm text-red-500">{error}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-end gap-3 px-6 py-4 border-t flex-shrink-0 ${
          isDark ? 'border-zinc-700' : 'border-zinc-200'
        }`}>
          <button
            onClick={closeAssignModal}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isDark ? 'text-zinc-400 hover:bg-zinc-700' : 'text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            {hasExisting && !showAddForm ? 'Done' : 'Cancel'}
          </button>
          {showForm && (isPersonal ? availableFriends.length > 0 : availableEmployees.length > 0) && (
            <button
              onClick={handleAssign}
              disabled={isSubmitting || !selectedEmployee}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                isSubmitting || !selectedEmployee
                  ? 'bg-zinc-300 text-zinc-500 cursor-not-allowed'
                  : 'bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200'
              }`}
            >
              {isSubmitting ? 'Assigning...' : hasExisting ? 'Add Assignee' : isPersonal ? 'Assign' : 'Assign (Draft)'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
