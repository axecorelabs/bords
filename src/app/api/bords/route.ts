import { NextRequest, NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import Bord from '@/models/Bord'
import Organization from '@/models/Organization'
import EmployeeMembership from '@/models/EmployeeMembership'
import BordMember from '@/models/BordMember'
import { getAuthUser, unauthorized, badRequest } from '@/lib/api-helpers'

// GET /api/bords — list bords the user owns, is a BordMember of, or is on the accessList for
export async function GET() {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  await connectDB()

  const [owned, memberships, accessibleBords] = await Promise.all([
    Bord.find({ ownerId: user.id }).lean(),
    BordMember.find({ userId: user.id }).populate('bordId').lean(),
    // Bords in orgs where user is on the accessList (but not owner)
    Bord.find({
      ownerId: { $ne: user.id },
      'accessList.userId': user.id,
    }).lean(),
  ])

  const memberBords = memberships
    .map((m: any) => m.bordId)
    .filter(Boolean)

  // Deduplicate: owned > collaborator > accessible
  const seenIds = new Set<string>()

  const allBords = []

  for (const b of owned) {
    const id = b._id.toString()
    seenIds.add(id)
    allBords.push({
      ...b,
      _id: id,
      organizationId: b.organizationId?.toString() || '',
      ownerId: b.ownerId.toString(),
      contextType: b.contextType || 'personal',
      accessList: (b.accessList || []).map((a: any) => ({
        userId: a.userId?.toString() || a.toString(),
        permission: a.permission || 'view',
      })),
      lastPublishedAt: b.lastPublishedAt?.toISOString() || null,
      role: 'owner',
    })
  }

  for (const b of memberBords) {
    const id = b._id.toString()
    if (seenIds.has(id)) continue
    seenIds.add(id)
    allBords.push({
      ...b,
      _id: id,
      organizationId: b.organizationId?.toString() || '',
      ownerId: b.ownerId.toString(),
      contextType: b.contextType || 'personal',
      accessList: (b.accessList || []).map((a: any) => ({
        userId: a.userId?.toString() || a.toString(),
        permission: a.permission || 'view',
      })),
      lastPublishedAt: b.lastPublishedAt?.toISOString() || null,
      role: 'collaborator',
    })
  }

  for (const b of accessibleBords) {
    const id = b._id.toString()
    if (seenIds.has(id)) continue
    seenIds.add(id)
    allBords.push({
      ...b,
      _id: id,
      organizationId: b.organizationId?.toString() || '',
      ownerId: b.ownerId.toString(),
      contextType: b.contextType || 'personal',
      accessList: (b.accessList || []).map((a: any) => ({
        userId: a.userId?.toString() || a.toString(),
        permission: a.permission || 'view',
      })),
      lastPublishedAt: b.lastPublishedAt?.toISOString() || null,
      role: 'member',
    })
  }

  return NextResponse.json({ bords: allBords })
}

// POST /api/bords — link a local board to an org (creates server-side Bord reference)
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const { organizationId, localBoardId, title } = body

  if (!organizationId || !localBoardId || !title?.trim()) {
    return badRequest('organizationId, localBoardId, and title are required')
  }

  await connectDB()

  // Verify user is org owner or member
  const org = await Organization.findById(organizationId).lean()
  if (!org) {
    return badRequest('Invalid organization')
  }

  const isOwner = org.ownerId.toString() === user.id
  if (!isOwner) {
    const membership = await EmployeeMembership.findOne({
      organizationId,
      userId: user.id,
    }).lean()
    if (!membership) {
      return badRequest('Invalid organization')
    }
  }

  // Check if already linked
  const existing = await Bord.findOne({ organizationId, localBoardId }).lean()
  if (existing) {
    return NextResponse.json({
      bord: {
        _id: existing._id.toString(),
        organizationId: existing.organizationId?.toString() || '',
        localBoardId: existing.localBoardId,
        title: existing.title,
        ownerId: existing.ownerId.toString(),
        lastPublishedAt: existing.lastPublishedAt?.toISOString() || null,
      },
    })
  }

  const bord = await Bord.create({
    organizationId,
    localBoardId,
    title: title.trim(),
    ownerId: user.id,
  })

  return NextResponse.json({
    bord: {
      _id: bord._id.toString(),
      organizationId: bord.organizationId?.toString() || '',
      localBoardId: bord.localBoardId,
      title: bord.title,
      ownerId: bord.ownerId.toString(),
      lastPublishedAt: null,
    },
  }, { status: 201 })
}
