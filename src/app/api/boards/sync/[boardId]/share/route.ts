import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-helpers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import crypto from 'crypto'

/* ────────────── GET — Get share settings for a board ────────────── */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const user = await getAuthUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { boardId } = await params

    const { data: doc } = await supabaseAdmin
      .from('board_documents')
      .select('visibility, share_token, shared_with, title')
      .eq('owner_id', user.id)
      .eq('local_board_id', boardId)
      .maybeSingle()

    if (!doc) {
      return NextResponse.json({ error: 'Board not found or not owned by you' }, { status: 404 })
    }

    return NextResponse.json({
      visibility: doc.visibility,
      shareToken: doc.share_token,
      sharedWith: doc.shared_with || [],
      name: doc.title,
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
    const user = await getAuthUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { boardId } = await params
    const body = await req.json()
    const { visibility, addEmail, removeUserId, updatePermission } = body

    const { data: doc } = await supabaseAdmin
      .from('board_documents')
      .select('id, visibility, share_token, shared_with')
      .eq('owner_id', user.id)
      .eq('local_board_id', boardId)
      .maybeSingle()

    if (!doc) {
      return NextResponse.json({ error: 'Board not found or not owned by you' }, { status: 404 })
    }

    let updatedVisibility = doc.visibility
    let updatedShareToken = doc.share_token
    let updatedSharedWith: any[] = [...((doc.shared_with as any[]) || [])]

    // 1) Update visibility
    if (visibility && ['private', 'public', 'shared'].includes(visibility)) {
      updatedVisibility = visibility

      if (visibility === 'public' && !updatedShareToken) {
        updatedShareToken = crypto.randomBytes(24).toString('hex')
      }

      if (visibility === 'private') {
        updatedShareToken = null
        updatedSharedWith = []
      }
    }

    // 2) Add a user by email
    if (addEmail) {
      const { data: targetUser } = await supabaseAdmin
        .from('profiles')
        .select('id, email')
        .eq('email', addEmail.toLowerCase().trim())
        .maybeSingle()

      if (!targetUser) {
        return NextResponse.json({ error: `No user found with email ${addEmail}` }, { status: 404 })
      }
      if (targetUser.id === user.id) {
        return NextResponse.json({ error: 'Cannot share with yourself' }, { status: 400 })
      }

      const existing = updatedSharedWith.find((s: any) => s.userId === targetUser.id)
      if (!existing) {
        updatedSharedWith.push({
          userId: targetUser.id,
          email: targetUser.email,
          permission: body.permission || 'view',
          addedAt: new Date().toISOString(),
        })
        if (updatedVisibility === 'private') {
          updatedVisibility = 'shared'
        }
      }
    }

    // 3) Remove a user
    if (removeUserId) {
      updatedSharedWith = updatedSharedWith.filter((s: any) => s.userId !== removeUserId)
    }

    // 4) Update permission for a specific user
    if (updatePermission) {
      const entry = updatedSharedWith.find((s: any) => s.userId === updatePermission.userId)
      if (entry) {
        entry.permission = updatePermission.permission
      }
    }

    // Save changes
    const { error: updateError } = await supabaseAdmin
      .from('board_documents')
      .update({
        visibility: updatedVisibility,
        share_token: updatedShareToken,
        shared_with: updatedSharedWith,
      })
      .eq('id', doc.id)

    if (updateError) throw updateError

    // Keep bord_access_list in sync with shared_with
    const { data: bord } = await supabaseAdmin
      .from('bords')
      .select('id')
      .eq('owner_id', user.id)
      .eq('local_board_id', boardId)
      .maybeSingle()

    if (bord) {
      // Remove old access entries and insert new ones
      await supabaseAdmin
        .from('bord_access_list')
        .delete()
        .eq('bord_id', bord.id)

      if (updatedSharedWith.length > 0) {
        await supabaseAdmin
          .from('bord_access_list')
          .insert(
            updatedSharedWith.map((s: any) => ({
              bord_id: bord.id,
              user_id: s.userId,
              permission: s.permission || 'view',
            }))
          )
      }
    }

    return NextResponse.json({
      visibility: updatedVisibility,
      shareToken: updatedShareToken,
      sharedWith: updatedSharedWith,
    })
  } catch (error: any) {
    console.error('Share update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
