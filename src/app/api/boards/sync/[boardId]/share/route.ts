import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import connectDB from '@/lib/mongodb'
import BoardDocument from '@/models/BoardDocument'
import Bord from '@/models/Bord'
import User from '@/models/User'
import crypto from 'crypto'

/* ────────────── GET — Get share settings for a board ────────────── */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { boardId } = await params
    await connectDB()

    const doc = await BoardDocument.findOne({
      owner: session.user.id,
      localBoardId: boardId,
    }).select('visibility shareToken sharedWith name').lean()

    if (!doc) {
      return NextResponse.json({ error: 'Board not found or not owned by you' }, { status: 404 })
    }

    return NextResponse.json({
      visibility: doc.visibility,
      shareToken: doc.shareToken,
      sharedWith: doc.sharedWith || [],
      name: doc.name,
    })
  } catch (error: any) {
    console.error('Share settings error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/* ────────────── PUT — Update visibility & sharing ────────────── */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { boardId } = await params
    const body = await req.json()
    const { visibility, addEmail, removeUserId, updatePermission } = body

    await connectDB()

    const doc = await BoardDocument.findOne({
      owner: session.user.id,
      localBoardId: boardId,
    })

    if (!doc) {
      return NextResponse.json({ error: 'Board not found or not owned by you' }, { status: 404 })
    }

    // 1) Update visibility
    if (visibility && ['private', 'public', 'shared'].includes(visibility)) {
      doc.visibility = visibility

      // Generate share token when making public
      if (visibility === 'public' && !doc.shareToken) {
        doc.shareToken = crypto.randomBytes(24).toString('hex')
      }

      // Clear share token when making private
      if (visibility === 'private') {
        doc.shareToken = null
        doc.sharedWith = []
      }
    }

    // 2) Add a user by email
    if (addEmail) {
      const targetUser = await User.findOne({ email: addEmail.toLowerCase().trim() })
      if (!targetUser) {
        return NextResponse.json({ error: `No user found with email ${addEmail}` }, { status: 404 })
      }
      if (targetUser._id.toString() === session.user.id) {
        return NextResponse.json({ error: 'Cannot share with yourself' }, { status: 400 })
      }

      // Check if already shared
      const existing = doc.sharedWith.find(
        (s: any) => s.userId?.toString() === targetUser._id.toString()
      )
      if (!existing) {
        doc.sharedWith.push({
          userId: targetUser._id as any,
          email: targetUser.email,
          permission: body.permission || 'view',
          addedAt: new Date(),
        })
        // Auto-set visibility to shared if it's private
        if (doc.visibility === 'private') {
          doc.visibility = 'shared'
        }
      }
    }

    // 3) Remove a user
    if (removeUserId) {
      doc.sharedWith = doc.sharedWith.filter(
        (s: any) => s.userId?.toString() !== removeUserId
      )
    }

    // 4) Update permission for a specific user
    if (updatePermission) {
      const entry = doc.sharedWith.find(
        (s: any) => s.userId?.toString() === updatePermission.userId
      )
      if (entry) {
        ;(entry as any).permission = updatePermission.permission
      }
    }

    await doc.save()

    // Keep Bord.accessList in sync with BoardDocument.sharedWith
    const bord = await Bord.findOne({ ownerId: session.user.id, localBoardId: boardId })
    if (bord) {
      bord.accessList = (doc.sharedWith || []).map((s: any) => ({
        userId: s.userId,
        permission: s.permission || 'view',
      }))
      await bord.save()
    }

    return NextResponse.json({
      visibility: doc.visibility,
      shareToken: doc.shareToken,
      sharedWith: doc.sharedWith,
    })
  } catch (error: any) {
    console.error('Share update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
