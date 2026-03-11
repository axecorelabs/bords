import { NextRequest, NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import Bord from '@/models/Bord'
import BoardDocument from '@/models/BoardDocument'
import { getAuthUser, unauthorized, notFound, forbidden } from '@/lib/api-helpers'

/**
 * DELETE /api/bords/[bordId]
 * Deletes a Bord and its associated BoardDocument.
 * Only the owner can delete.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ bordId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { bordId } = await params
  await connectDB()

  const bord = await Bord.findById(bordId)
  if (!bord) return notFound('Bord')
  if (bord.ownerId.toString() !== user.id) return forbidden()

  // Delete both Bord and BoardDocument in parallel
  await Promise.all([
    Bord.deleteOne({ _id: bordId }),
    BoardDocument.deleteOne({ owner: user.id, localBoardId: bord.localBoardId }),
  ])

  return NextResponse.json({ ok: true })
}
