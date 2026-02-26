import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import connectDB from '@/lib/mongodb'
import BoardDocument from '@/models/BoardDocument'
import Workspace from '@/models/Workspace'
import Bord from '@/models/Bord'
import crypto from 'crypto'

/* ── Fast content hash for change detection ── */
function computeContentHash(board: any): string {
  // Hash only the content fields that matter for change detection
  // Comments are managed server-side via the comments API — excluded from content hash
  const payload = JSON.stringify({
    checklists:   board.checklists   || [],
    kanbanBoards: board.kanbanBoards || [],
    stickyNotes:  board.stickyNotes  || [],
    mediaItems:   board.mediaItems   || [],
    textElements: board.textElements || [],
    drawings:     board.drawings     || [],
    connections:  board.connections  || [],
    reminders:    board.reminders    || [],
    itemIds:      board.itemIds      || {},
    bg:           [board.backgroundImage, board.backgroundColor, board.backgroundOverlay, board.backgroundOverlayColor, board.backgroundBlurLevel],
    settings:     [board.connectionLineSettings, board.gridSettings, board.themeSettings],
    zIndex:       board.zIndexData   || {},
  })
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16)
}

/* ────────────── GET — List all boards for current user ────────────── */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await connectDB()

    // Boards owned by user + boards shared with user
    const [owned, shared] = await Promise.all([
      BoardDocument.find({ owner: session.user.id })
        .select('localBoardId name visibility contentHash lastSyncedAt createdAt updatedAt')
        .sort({ updatedAt: -1 })
        .lean(),
      BoardDocument.find({ 'sharedWith.userId': session.user.id })
        .select('localBoardId name visibility contentHash owner lastSyncedAt createdAt updatedAt sharedWith')
        .sort({ updatedAt: -1 })
        .lean(),
    ])

    return NextResponse.json({ owned, shared })
  } catch (error: any) {
    console.error('Board sync list error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/* ────────────── POST — Sync (save) a board to cloud ────────────── */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await connectDB()

    const body = await req.json()
    const { localBoardId, name, board, workspaceId, organizationId, contextType, baseHash } = body

    if (!localBoardId || !name || !board) {
      return NextResponse.json({ error: 'Missing localBoardId, name, or board data' }, { status: 400 })
    }

    const contentHash = computeContentHash(board)

    // Resolve workspace if not provided (auto-assign to personal workspace)
    let resolvedWorkspaceId = workspaceId || null
    let resolvedContextType = contextType || 'personal'
    if (!resolvedWorkspaceId) {
      const personalWs = await Workspace.findOne({
        ownerId: session.user.id,
        type: 'personal',
      })
      if (personalWs) resolvedWorkspaceId = personalWs._id
    }

    // Build the $set payload (shared between owner and editor paths)
    const $setPayload: Record<string, any> = {
      name,
      // Background
      backgroundImage:        board.backgroundImage || null,
      backgroundColor:        board.backgroundColor || null,
      backgroundOverlay:      board.backgroundOverlay || false,
      backgroundOverlayColor: board.backgroundOverlayColor || null,
      backgroundBlurLevel:    board.backgroundBlurLevel || null,
      // Content
      checklists:   board.checklists   || [],
      kanbanBoards: board.kanbanBoards || [],
      stickyNotes:  board.stickyNotes  || [],
      mediaItems:   board.mediaItems   || [],
      textElements: board.textElements || [],
      drawings:     board.drawings     || [],
      // comments excluded — managed server-side via comments API
      connections:  board.connections  || [],
      reminders:    board.reminders    || [],
      // Settings
      connectionLineSettings: board.connectionLineSettings || {},
      gridSettings:           board.gridSettings           || {},
      themeSettings:          board.themeSettings           || {},
      zIndexData:             board.zIndexData              || { counter: 0, entries: [] },
      // ID arrays
      itemIds: board.itemIds || {},
      contentHash,
      lastSyncedAt: new Date(),
    }

    // Check if a doc already exists for this board — scoped to current user
    // (owner OR shared collaborator). Without owner scope, findOne could return
    // a different user's doc with the same localBoardId, routing the real owner
    // into the non-owner branch and triggering a false 403.
    let doc = await BoardDocument.findOne({
      localBoardId,
      $or: [
        { owner: session.user.id },
        { 'sharedWith.userId': session.user.id },
      ],
    })

    // Fallback: check Bord accessList (org-level sharing) if no direct match
    if (!doc) {
      const bord = await Bord.findOne({
        localBoardId,
        'accessList.userId': session.user.id,
      }).lean() as any
      if (bord) {
        doc = await BoardDocument.findOne({ localBoardId, owner: bord.ownerId })
      }
    }

    // ── Optimistic locking (Git-style): reject if cloud moved ahead ──
    // If the client provides a baseHash and it doesn't match the current
    // cloud hash, a concurrent edit happened. Return 409 so the client
    // can perform a three-way merge before retrying.
    if (doc && baseHash && doc.contentHash && doc.contentHash !== baseHash) {
      // Strip comments from the 409 payload — they're managed via the comments API
      const { comments: _comments, ...cloudObj } = doc.toObject()
      return NextResponse.json(
        {
          error: 'Board has been modified by another editor since your last sync',
          code: 'MERGE_REQUIRED',
          cloudBoard: cloudObj,
          cloudHash: doc.contentHash,
          cloudVersion: doc.version || 1,
        },
        { status: 409 }
      )
    }

    if (!doc || doc.owner.toString() === session.user.id) {
      // Owner path — upsert (handles both new boards and existing ones)
      doc = await BoardDocument.findOneAndUpdate(
        { owner: session.user.id, localBoardId },
        {
          $set: {
            ...$setPayload,
            workspaceId:    resolvedWorkspaceId,
            organizationId: organizationId || null,
            contextType:    resolvedContextType,
          },
          $setOnInsert: {
            owner: session.user.id,
            localBoardId,
            visibility: 'private',
            sharedWith: [],
          },
          $inc: { version: 1 },
        },
        { upsert: true, new: true }
      )
    } else {
      // Not the owner — check edit access via sharedWith OR Bord accessList

      // 1) Check BoardDocument.sharedWith first (personal board sharing / friends)
      const sharedEntry = doc.sharedWith?.find(
        (s: any) => s.userId?.toString() === session.user.id
      )
      if (sharedEntry) {
        if (sharedEntry.permission !== 'edit') {
          return NextResponse.json({ error: 'View-only access — cannot sync changes' }, { status: 403 })
        }
        // Editor via sharedWith — update the owner's BoardDocument
        doc = await BoardDocument.findOneAndUpdate(
          { _id: doc._id },
          { $set: $setPayload, $inc: { version: 1 } },
          { new: true }
        )
        if (!doc) {
          return NextResponse.json({ error: 'Board document not found' }, { status: 404 })
        }
      } else {
        // 2) Fallback: check Bord accessList (org-level sharing)
        const bord = await Bord.findOne({
          localBoardId,
          'accessList.userId': session.user.id,
        }).lean()

        if (!bord) {
          return NextResponse.json({ error: 'Not authorized to sync this board' }, { status: 403 })
        }

        const entry = (bord.accessList as any[]).find(
          (a: any) => (a.userId?.toString() || a.toString()) === session.user.id
        )
        if (entry?.permission !== 'edit') {
          return NextResponse.json({ error: 'View-only access — cannot sync changes' }, { status: 403 })
        }

        // Editor path — update the owner's BoardDocument (don't change workspace/org metadata)
        doc = await BoardDocument.findOneAndUpdate(
          { owner: bord.ownerId, localBoardId },
          { $set: $setPayload, $inc: { version: 1 } },
          { new: true }
        )

        if (!doc) {
          return NextResponse.json({ error: 'Board document not found' }, { status: 404 })
        }
      }
    }

    return NextResponse.json({
      message: 'Board synced to cloud',
      boardDocId: doc!._id.toString(),
      contentHash: doc!.contentHash,
      lastSyncedAt: doc!.lastSyncedAt,
      version: doc!.version || 1,
    })
  } catch (error: any) {
    console.error('Board sync save error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
