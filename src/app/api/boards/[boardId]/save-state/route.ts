import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import connectDB from '@/lib/mongodb'
import YjsDocument from '@/models/YjsDocument'
import Bord from '@/models/Bord'
import BoardDocument from '@/models/BoardDocument'

export const dynamic = 'force-dynamic'

/**
 * POST /api/boards/[boardId]/save-state
 *
 * Persists Y.Doc state for a board via REST (used for personal/non-shared
 * boards that don't maintain a WebSocket connection).
 *
 * Body: { state: string } — base64-encoded Y.Doc state (Y.encodeStateAsUpdate)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { boardId } = await params
    if (!boardId) {
      return NextResponse.json({ error: 'Missing boardId' }, { status: 400 })
    }

    const body = await req.json()
    const { state, stateVector } = body

    if (!state || typeof state !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid state' }, { status: 400 })
    }

    await connectDB()

    // Permission check: user must own the board or have edit access
    const bord = await Bord.findOne({ localBoardId: boardId }).lean()
    if (bord) {
      const isOwner = bord.ownerId.toString() === session.user.id
      if (!isOwner) {
        const entry = bord.accessList?.find(
          (a) => a.userId.toString() === session.user.id
        )
        if (!entry || entry.permission !== 'edit') {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      }
    } else {
      // No Bord record yet — check BoardDocument ownership as fallback
      const doc = await BoardDocument.findOne({
        localBoardId: boardId,
        owner: session.user.id,
      }).lean()
      if (!doc) {
        // Board doesn't exist in cloud at all — allow creation (user owns it locally)
        // This handles first-time cloud save for personal boards
      }
    }

    const stateBuffer = Buffer.from(state, 'base64')
    const stateVectorBuffer = stateVector
      ? Buffer.from(stateVector, 'base64')
      : null

    await YjsDocument.findOneAndUpdate(
      { boardId },
      {
        $set: {
          state: stateBuffer,
          stateVector: stateVectorBuffer,
          lastModifiedBy: session.user.id,
          updatedAt: new Date(),
        },
        $inc: { version: 1 },
      },
      { upsert: true }
    )

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('[save-state] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
