import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { boardDocToClient } from '@/lib/board-helpers'

/* ────────────── GET — Load a public board via share token ────────────── */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    const { data: doc } = await supabaseAdmin
      .from('board_documents')
      .select('*')
      .eq('share_token', token)
      .eq('visibility', 'public')
      .maybeSingle()

    if (!doc) {
      return NextResponse.json({ error: 'Board not found or not public' }, { status: 404 })
    }

    const board = boardDocToClient(doc)
    // Strip owner/sharing info from public view
    delete (board as any).owner
    delete (board as any).sharedWith

    return NextResponse.json({ board, permission: 'view' })
  } catch (error: any) {
    console.error('Public board load error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
