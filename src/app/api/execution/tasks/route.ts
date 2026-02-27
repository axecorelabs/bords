import { NextRequest, NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import TaskAssignment from '@/models/TaskAssignment'
import EmployeeMembership from '@/models/EmployeeMembership'
import Bord from '@/models/Bord'
import Organization from '@/models/Organization'
import { getAuthUser, unauthorized } from '@/lib/api-helpers'

// GET /api/execution/tasks — get all assigned tasks for the current (employee) user
export async function GET() {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  await connectDB()

  // Get all orgs the user is an employee of
  const memberships = await EmployeeMembership.find({ userId: user.id })
    .populate('organizationId')
    .lean()

  const orgMap = new Map<string, any>()
  for (const m of memberships) {
    const org = m.organizationId as any
    if (org) {
      orgMap.set(org._id.toString(), {
        _id: org._id.toString(),
        name: org.name,
      })
    }
  }

  // Get all active org assignments for this user
  const assignments = await TaskAssignment.find({
    assignedTo: user.id,
    contextType: 'organization',
    status: { $in: ['assigned', 'completed'] },
    isDeleted: false,
  })
    .populate('bordId', 'title organizationId')
    .populate('assignedBy', 'firstName lastName')
    .sort({ priority: -1, dueDate: 1, createdAt: -1 })
    .lean()

  // Group by organization
  const tasksByOrg: Record<string, {
    organization: { _id: string; name: string }
    tasks: any[]
  }> = {}

  for (const a of assignments) {
    const bord = a.bordId as any
    // Resolve orgId from populated bord, or fall back to the assignment's own organizationId
    // (reminder-created tasks may have bordId: null but still carry organizationId)
    const orgId = bord?.organizationId?.toString()
      || (a as any).organizationId?.toString()
    if (!orgId) continue

    const org = orgMap.get(orgId)
    if (!org) continue

    if (!tasksByOrg[orgId]) {
      tasksByOrg[orgId] = { organization: org, tasks: [] }
    }

    const priorityOrder: Record<string, number> = { high: 3, normal: 2, low: 1 }

    tasksByOrg[orgId].tasks.push({
      _id: a._id.toString(),
      bordId: bord?._id?.toString() || null,
      bordTitle: bord?.title || null,
      sourceType: a.sourceType,
      sourceId: a.sourceId,
      content: a.content,
      priority: a.priority,
      priorityOrder: priorityOrder[a.priority] || 2,
      dueDate: a.dueDate?.toISOString() || null,
      executionNote: a.executionNote,
      status: a.status,
      columnId: a.columnId || null,
      columnTitle: a.columnTitle || null,
      availableColumns: a.availableColumns || [],
      publishedAt: a.publishedAt?.toISOString() || null,
      completedAt: a.completedAt?.toISOString() || null,
      createdAt: a.createdAt?.toISOString(),
      assigner: a.assignedBy ? {
        firstName: (a.assignedBy as any).firstName,
        lastName: (a.assignedBy as any).lastName,
      } : undefined,
    })
  }

  // Sort tasks within each org by priority desc, then due date, then created
  for (const orgId of Object.keys(tasksByOrg)) {
    tasksByOrg[orgId].tasks.sort((a: any, b: any) => {
      if (a.status === 'completed' && b.status !== 'completed') return 1
      if (a.status !== 'completed' && b.status === 'completed') return -1
      if (b.priorityOrder !== a.priorityOrder) return b.priorityOrder - a.priorityOrder
      if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      if (a.dueDate && !b.dueDate) return -1
      if (!a.dueDate && b.dueDate) return 1
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })
  }

  // ── Personal tasks (reminders) ──
  const personalTasks = await TaskAssignment.find({
    assignedTo: user.id,
    contextType: 'personal',
    status: { $in: ['assigned', 'completed'] },
    isDeleted: false,
  })
    .populate('assignedBy', 'firstName lastName')
    .sort({ createdAt: -1 })
    .lean()

  const personalItems = personalTasks.map((a: any) => ({
    _id: a._id.toString(),
    bordId: null,
    bordTitle: null,
    sourceType: a.sourceType,
    sourceId: a.sourceId,
    content: a.content,
    priority: a.priority,
    priorityOrder: ({ high: 3, normal: 2, low: 1 } as Record<string, number>)[a.priority] || 2,
    dueDate: a.dueDate?.toISOString() || null,
    executionNote: a.executionNote,
    status: a.status,
    columnId: a.columnId || null,
    columnTitle: a.columnTitle || null,
    availableColumns: a.availableColumns || [],
    publishedAt: a.publishedAt?.toISOString() || null,
    completedAt: a.completedAt?.toISOString() || null,
    createdAt: a.createdAt?.toISOString(),
    contextType: 'personal',
    assigner: a.assignedBy ? {
      firstName: (a.assignedBy as any).firstName,
      lastName: (a.assignedBy as any).lastName,
    } : undefined,
  }))

  return NextResponse.json({
    tasksByOrganization: Object.values(tasksByOrg),
    organizations: Array.from(orgMap.values()),
    personalTasks: personalItems,
  })
}
