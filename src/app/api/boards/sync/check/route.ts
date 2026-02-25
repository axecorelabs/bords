import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import connectDB from '@/lib/mongodb'
import BoardDocument from '@/models/BoardDocument'
import Bord from '@/models/Bord'
import User from '@/models/User'

/* ─── GET — Ultra-lightweight: return only boardId + contentHash ─── */
/* This endpoint exists solely for change detection.                   */
/* Payload is ~50 bytes per board vs megabytes for full board data.    */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await connectDB()

    // Only select the 3 fields we need – indexed, fast, tiny payload
    const [owned, shared] = await Promise.all([
      BoardDocument.find({ owner: session.user.id })
        .select('localBoardId contentHash name contextType organizationId')
        .lean(),
      BoardDocument.find({ 'sharedWith.userId': session.user.id })
        .select('localBoardId contentHash name contextType organizationId')
        .lean(),
    ])

    // Resolve permission + owner info for shared personal boards
    const sharedPermissions: Record<string, string> = {}
    const sharedByMap: Record<string, { name: string; email: string }> = {}
    if (shared.length > 0) {
      // Re-query with sharedWith + owner to extract per-user permission and owner identity
      const sharedFull = await BoardDocument.find({ 'sharedWith.userId': session.user.id })
        .select('localBoardId sharedWith owner')
        .lean()

      // Collect unique owner IDs to batch-lookup names
      const ownerIds = [...new Set(sharedFull.map((d: any) => d.owner?.toString()).filter(Boolean))]
      const owners = ownerIds.length > 0
        ? await User.find({ _id: { $in: ownerIds } }).select('firstName lastName email').lean()
        : []
      const ownerMap = new Map(owners.map((u: any) => [u._id.toString(), u]))

      for (const doc of sharedFull) {
        const entry = (doc as any).sharedWith?.find(
          (s: any) => s.userId?.toString() === session.user.id
        )
        sharedPermissions[(doc as any).localBoardId] = entry?.permission || 'view'

        // Attach owner name/email
        const owner = ownerMap.get((doc as any).owner?.toString())
        if (owner) {
          sharedByMap[(doc as any).localBoardId] = {
            name: `${(owner as any).firstName || ''} ${(owner as any).lastName || ''}`.trim() || (owner as any).email,
            email: (owner as any).email,
          }
        }
      }
    }

    // Also find boards accessible via Bord accessList
    const accessibleBords = await Bord.find({
      'accessList.userId': session.user.id,
      ownerId: { $ne: session.user.id },
    }).select('localBoardId ownerId title accessList').lean()

    // Build permission map for accessList boards
    const accessListPermissions: Record<string, string> = {}
    for (const bord of accessibleBords) {
      const entry = (bord.accessList as any[]).find(
        (a: any) => (a.userId?.toString() || a.toString()) === session.user.id
      )
      accessListPermissions[(bord as any).localBoardId] = entry?.permission || 'view'
    }

    // Fetch the corresponding BoardDocuments for accessible bords
    const seenLocalIds = new Set([
      ...owned.map((b: any) => b.localBoardId),
      ...shared.map((b: any) => b.localBoardId),
    ])

    let accessListBoards: any[] = []
    if (accessibleBords.length > 0) {
      const accessQueries = accessibleBords
        .filter((ab: any) => !seenLocalIds.has(ab.localBoardId))
        .map((ab: any) => ({
          localBoardId: ab.localBoardId,
          owner: ab.ownerId,
        }))

      if (accessQueries.length > 0) {
        const accessDocs = await BoardDocument.find({
          $or: accessQueries,
        }).select('localBoardId contentHash name contextType organizationId').lean()

        accessListBoards = accessDocs.map((b: any) => ({
          localBoardId: b.localBoardId,
          contentHash: b.contentHash || '',
          name: b.name,
          contextType: b.contextType || undefined,
          organizationId: b.organizationId || undefined,
          accessList: true,
          permission: accessListPermissions[b.localBoardId] || 'view',
        }))
      }
    }

    const boards = [
      ...owned.map((b: any) => ({
        localBoardId: b.localBoardId,
        contentHash:  b.contentHash || '',
        name:         b.name,
        contextType:  b.contextType || undefined,
        organizationId: b.organizationId || undefined,
        permission:   'owner',
      })),
      ...shared.map((b: any) => ({
        localBoardId: b.localBoardId,
        contentHash:  b.contentHash || '',
        name:         b.name,
        contextType:  b.contextType || undefined,
        organizationId: b.organizationId || undefined,
        shared:       true,
        permission:   sharedPermissions[b.localBoardId] || 'view',
        sharedBy:     sharedByMap[b.localBoardId] || null,
      })),
      ...accessListBoards,
    ]

    return NextResponse.json({ boards })
  } catch (error: any) {
    console.error('Board sync check error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
