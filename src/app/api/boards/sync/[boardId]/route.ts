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

    const { data: deleted } = await supabaseAdmin
      .from('board_documents')
      .delete()
      .eq('owner_id', user.id)
      .eq('local_board_id', boardId)
      .select('id')
      .maybeSingle()

    if (!deleted) {
      return NextResponse.json({ error: 'Board not found or not owned by you' }, { status: 404 })
    }

    // Also delete the Bord record (CASCADE handles bord_access_list entries)
    await supabaseAdmin
      .from('bords')
      .delete()
      .eq('owner_id', user.id)
      .eq('local_board_id', boardId)

    return NextResponse.json({ message: 'Board removed from cloud' })
  } catch (error: any) {
    console.error('Board sync delete error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
