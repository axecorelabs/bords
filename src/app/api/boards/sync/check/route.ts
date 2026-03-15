import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-helpers'
import { supabaseAdmin } from '@/lib/supabase/admin'

/* ─── GET — Ultra-lightweight: return only boardId + contentHash ─── */
/* This endpoint exists solely for change detection.                   */
/* Payload is ~50 bytes per board vs megabytes for full board data.    */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const selectFields = 'local_board_id, content_hash, title, context_type, organization_id, owner_id, shared_with'

    const [ownedRes, sharedRes] = await Promise.all([
      supabaseAdmin
        .from('board_documents')
        .select(selectFields)
        .eq('owner_id', user.id),
      supabaseAdmin
        .from('board_documents')
        .select(selectFields)
        .contains('shared_with', [{ userId: user.id }]),
    ])

    const owned = ownedRes.data || []
    const shared = sharedRes.data || []

    // Resolve permission + owner info for shared personal boards
    const sharedPermissions: Record<string, string> = {}
    const sharedByMap: Record<string, { name: string; email: string }> = {}
    if (shared.length > 0) {
      for (const doc of shared) {
        const entry = (doc.shared_with as any[])?.find(
          (s: any) => s.userId === user.id
        )
        sharedPermissions[doc.local_board_id] = entry?.permission || 'view'
      }

      // Batch-lookup owner names
      const ownerIds = [...new Set(shared.map((d: any) => d.owner_id).filter(Boolean))]
      if (ownerIds.length > 0) {
        const { data: owners } = await supabaseAdmin
          .from('profiles')
          .select('id, first_name, last_name, email')
          .in('id', ownerIds)
        for (const owner of owners || []) {
          for (const doc of shared) {
            if (doc.owner_id === owner.id) {
              sharedByMap[doc.local_board_id] = {
                name: [owner.first_name, owner.last_name].filter(Boolean).join(' ').trim() || owner.email,
                email: owner.email,
              }
            }
          }
        }
      }
    }

    // Also find boards accessible via bord_access_list
    const { data: accessEntries } = await supabaseAdmin
      .from('bord_access_list')
      .select('permission, user_id, bords!inner(id, owner_id, local_board_id, title)')
      .eq('user_id', user.id)
      .neq('bords.owner_id', user.id)

    const seenLocalIds = new Set([
      ...owned.map((b: any) => b.local_board_id),
      ...shared.map((b: any) => b.local_board_id),
    ])

    let accessListBoards: any[] = []
    if (accessEntries && accessEntries.length > 0) {
      const accessListPermissions: Record<string, string> = {}
      const unseenEntries = accessEntries.filter((ae: any) => {
        const localId = ae.bords.local_board_id
        if (seenLocalIds.has(localId)) return false
        accessListPermissions[localId] = ae.permission || 'view'
        return true
      })

      for (const ae of unseenEntries) {
        const bord = (ae as any).bords
        const { data: accessDoc } = await supabaseAdmin
          .from('board_documents')
          .select('local_board_id, content_hash, title, context_type, organization_id')
          .eq('owner_id', bord.owner_id)
          .eq('local_board_id', bord.local_board_id)
          .maybeSingle()

        if (accessDoc) {
          accessListBoards.push({
            localBoardId: accessDoc.local_board_id,
            contentHash: accessDoc.content_hash || '',
            name: accessDoc.title,
            contextType: accessDoc.context_type || undefined,
            organizationId: accessDoc.organization_id || undefined,
            accessList: true,
            permission: accessListPermissions[accessDoc.local_board_id] || 'view',
          })
        }
      }
    }

    const boards = [
      ...owned.map((b: any) => ({
        localBoardId: b.local_board_id,
        contentHash:  b.content_hash || '',
        name:         b.title,
        contextType:  b.context_type || undefined,
        organizationId: b.organization_id || undefined,
        permission:   'owner',
      })),
      ...shared.map((b: any) => ({
        localBoardId: b.local_board_id,
        contentHash:  b.content_hash || '',
        name:         b.title,
        contextType:  b.context_type || undefined,
        organizationId: b.organization_id || undefined,
        shared:       true,
        permission:   sharedPermissions[b.local_board_id] || 'view',
        sharedBy:     sharedByMap[b.local_board_id] || null,
      })),
      ...accessListBoards,
    ]

    return NextResponse.json({ boards })
  } catch (error: any) {
    console.error('Board sync check error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
