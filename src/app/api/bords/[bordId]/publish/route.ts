import { NextRequest, NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import Bord from '@/models/Bord'
import TaskAssignment from '@/models/TaskAssignment'
import PublishSnapshot from '@/models/PublishSnapshot'
import UnpublishedChangeTracker from '@/models/UnpublishedChangeTracker'
import Notification from '@/models/Notification'
import Organization from '@/models/Organization'
import { getAuthUser, unauthorized, notFound, forbidden, badRequest } from '@/lib/api-helpers'

// POST /api/bords/[bordId]/publish — publish all draft assignments
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bordId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { bordId } = await params
  await connectDB()

  const bord = await Bord.findById(bordId)
  if (!bord) return notFound('Bord')
  if (bord.ownerId.toString() !== user.id) return forbidden()

  // Fetch organization name for notification context
  const org = bord.organizationId ? await Organization.findById(bord.organizationId).lean() as any : null
  const orgId = bord.organizationId?.toString() || ''
  const orgName = org?.name || ''

  // Get all draft assignments for this bord
  const draftAssignments = await TaskAssignment.find({
    bordId,
    status: 'draft',
    isDeleted: false,
  })

  // Get soft-deleted assignments that were previously published (unassignments)
  const unassigned = await TaskAssignment.find({
    bordId,
    isDeleted: true,
    publishedAt: { $ne: null },
  })

  if (draftAssignments.length === 0 && unassigned.length === 0) {
    return badRequest('No unpublished changes to publish')
  }

  // Warn if > 30 at once
  const totalTasks = draftAssignments.length + unassigned.length
  if (totalTasks > 30) {
    const { force } = await req.json().catch(() => ({ force: false }))
    if (!force) {
      return NextResponse.json({
        warning: `Publishing ${totalTasks} tasks at once. Send with force: true to proceed.`,
        count: totalTasks,
      }, { status: 422 })
    }
  }

  // Determine counts
  let newAssignments = 0
  let reassignments = 0

  const now = new Date()
  const notifications: any[] = []

  for (const assignment of draftAssignments) {
    // Was previously published? → reassignment. Otherwise → new
    if (assignment.publishedAt) {
      reassignments++
      notifications.push({
        userId: assignment.assignedTo,
        type: 'task_reassigned',
        title: 'Task Updated',
        message: `A task in "${bord.title}" has been updated: "${assignment.content.substring(0, 80)}"`,
        metadata: {
          bordId: bord._id.toString(),
          taskAssignmentId: assignment._id.toString(),
          bordTitle: bord.title,
          organizationId: orgId,
          organizationName: orgName,
        },
      })
    } else {
      newAssignments++
      notifications.push({
        userId: assignment.assignedTo,
        type: 'task_assigned',
        title: 'New Task Assigned',
        message: `You've been assigned a task in "${bord.title}": "${assignment.content.substring(0, 80)}"`,
        metadata: {
          bordId: bord._id.toString(),
          taskAssignmentId: assignment._id.toString(),
          bordTitle: bord.title,
          organizationId: orgId,
          organizationName: orgName,
        },
      })
    }

    assignment.status = 'assigned'
    assignment.publishedAt = now
    await assignment.save()
  }

  // Handle unassignments
  for (const assignment of unassigned) {
    notifications.push({
      userId: assignment.assignedTo,
      type: 'task_unassigned',
      title: 'Task Removed',
      message: `A task in "${bord.title}" has been removed: "${assignment.content.substring(0, 80)}"`,
      metadata: {
        bordId: bord._id.toString(),
        taskAssignmentId: assignment._id.toString(),
        bordTitle: bord.title,
        organizationId: orgId,
        organizationName: orgName,
      },
    })
    // Permanently delete soft-deleted ones after publishing
    await assignment.deleteOne()
  }

  // Create notifications
  if (notifications.length > 0) {
    await Notification.insertMany(notifications)
  }

  // Get latest snapshot version
  const lastSnapshot = await PublishSnapshot.findOne({ bordId })
    .sort({ versionNumber: -1 })
    .lean()
  const nextVersion = (lastSnapshot?.versionNumber || 0) + 1

  // Create snapshot
  const snapshot = await PublishSnapshot.create({
    bordId,
    versionNumber: nextVersion,
    publishedBy: user.id,
    newAssignments,
    reassignments,
    unassignments: unassigned.length,
    publishedAt: now,
  })

  // Update bord
  bord.lastPublishedAt = now
  await bord.save()

  // Reset change tracker
  await UnpublishedChangeTracker.findOneAndUpdate(
    { bordId },
    { changeCount: 0, lastModifiedAt: now },
    { upsert: true }
  )

  return NextResponse.json({
    publish: {
      snapshotId: snapshot._id.toString(),
      versionNumber: nextVersion,
      newAssignments,
      reassignments,
      unassignments: unassigned.length,
      totalDeployed: newAssignments + reassignments,
    },
  })
}
