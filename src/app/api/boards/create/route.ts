import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, unauthorized, badRequest } from '@/lib/api-helpers'
import connectDB from '@/lib/mongodb'
import BoardDocument from '@/models/BoardDocument'
import Bord from '@/models/Bord'
import Workspace from '@/models/Workspace'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const { localBoardId, name, contextType, organizationId } = body

  if (!localBoardId || !name?.trim()) {
    return badRequest('localBoardId and name are required')
  }

  await connectDB()

  // Resolve the user's personal workspace for BoardDocument
  const personalWs = await Workspace.findOne({
    ownerId: user.id,
    type: 'personal',
  }).lean()

  try {
    // Create Bord + BoardDocument in parallel
    await Promise.all([
      // Bord entry — for listing, sharing, and access control
      Bord.findOneAndUpdate(
        { ownerId: user.id, localBoardId },
        {
          $setOnInsert: {
            ownerId: user.id,
            localBoardId,
            title: name.trim(),
            contextType: contextType || 'personal',
            organizationId: organizationId || null,
            accessList: [],
          },
        },
        { upsert: true, new: true }
      ),
      // BoardDocument — stores full board content for cloud sync
      BoardDocument.findOneAndUpdate(
        { owner: user.id, localBoardId },
        {
          $setOnInsert: {
            owner: user.id,
            localBoardId,
            name: name.trim(),
            contextType: contextType || 'personal',
            organizationId: organizationId || null,
            workspaceId: personalWs?._id || null,
            visibility: 'private',
            sharedWith: [],
            version: 1,
          },
        },
        { upsert: true, new: true }
      ),
    ])
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (error: any) {
    console.error('Board create error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
