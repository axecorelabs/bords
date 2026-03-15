import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-helpers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { boardDocToClient } from '@/lib/board-helpers'

/* ────────────── GET — Load ALL user boards with full data ────────────── */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch all boards owned by user
    const { data: owned } = await supabaseAdmin
      .from('board_documents')
      .select('*')
      .eq('owner_id', user.id)
      .order('updated_at', { ascending: false })

    // Fetch boards shared with the user
    const { data: shared } = await supabaseAdmin
      .from('board_documents')
      .select('*')
      .contains('shared_with', [{ userId: user.id }])
      .order('updated_at', { ascending: false })

    // Map to client format with permission info (exclude comments — managed via comments API)
    const ownedBoards = (owned || []).map((row: any) => {
      const doc = boardDocToClient(row)
      const { comments: _c, ...rest } = doc
      return { ...rest, permission: 'owner' as const }
    })

    const sharedBoards = (shared || []).map((row: any) => {
      const doc = boardDocToClient(row)
      const { comments: _c, ...rest } = doc
      const entry = (row.shared_with as any[])?.find(
        (s: any) => s.userId === user.id
      )
      return {
        ...rest,
        permission: (entry?.permission as 'view' | 'edit') || 'view',
      }
    })

    return NextResponse.json({
      boards: [...ownedBoards, ...sharedBoards],
      count: ownedBoards.length + sharedBoards.length,
    })
  } catch (error: any) {
    console.error('Board sync load-all error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
