import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-helpers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { boardDocToClient, resolveBoardAccess } from '@/lib/board-helpers'

/* ────────────── GET — Load a single board from cloud ────────────── */
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

    const result = await resolveBoardAccess(boardId, user.id)
    if (!result) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    const board = boardDocToClient(result.doc)
    // Strip comments — managed via comments API
    const { comments: _c, ...rest } = board

    return NextResponse.json({ board: rest, permission: result.permission })
  } catch (error: any) {
    console.error('Board sync load error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/* ────────────── DELETE — Remove a board from cloud ────────────── */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const user = await getAuthUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { boardId } = await params

    // Look up the bord to check ownership and org context
    const { data: bord } = await supabaseAdmin
      .from('bords')
      .select('id, owner_id, organization_id, local_board_id')
      .eq('local_board_id', boardId)
      .maybeSingle()

    let canDelete = false

    if (bord) {
      canDelete = bord.owner_id === user.id

      // Org owner/admin can also delete
      if (!canDelete && bord.organization_id) {
        const { data: org } = await supabaseAdmin
          .from('organizations')
          .select('owner_id')
          .eq('id', bord.organization_id)
          .maybeSingle()

        if (org?.owner_id === user.id) {
          canDelete = true
        } else {
          const { data: membership } = await supabaseAdmin
            .from('employee_memberships')
            .select('role')
            .eq('organization_id', bord.organization_id)
            .eq('user_id', user.id)
            .maybeSingle()
          canDelete = membership?.role === 'admin'
        }
      }
    }

    if (!canDelete) {
      return NextResponse.json({ error: 'Board not found or no permission to delete' }, { status: 404 })
    }

    // Delete board_documents, bords (CASCADE), and yjs_documents in parallel
    await Promise.all([
      supabaseAdmin
        .from('board_documents')
        .delete()
        .eq('local_board_id', boardId),
      supabaseAdmin
        .from('bords')
        .delete()
        .eq('local_board_id', boardId),
      supabaseAdmin
        .from('yjs_documents')
        .delete()
        .eq('board_id', boardId),
    ])

    return NextResponse.json({ message: 'Board removed from cloud' })
  } catch (error: any) {
    console.error('Board sync delete error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
