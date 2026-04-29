import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-helpers'
import { supabaseAdmin } from '@/lib/supabase/admin'

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
    const user = await getAuthUser()
    if (!user) {
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

    // Permission check: user must own the board or have edit access
    const { data: bord } = await supabaseAdmin
      .from('bords')
      .select('id, owner_id, local_board_id, organization_id, context_type')
      .eq('local_board_id', boardId)
      .maybeSingle()

    if (bord) {
      const isOwner = bord.owner_id === user.id
      if (!isOwner) {
        // Check bord_access_list
        const { data: access } = await supabaseAdmin
          .from('bord_access_list')
          .select('permission')
          .eq('bord_id', bord.id)
          .eq('user_id', user.id)
          .maybeSingle()

        if (access) {
          if (access.permission !== 'edit') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
          }
        } else if (bord.context_type === 'organization' && bord.organization_id) {
          // Org membership fallback: owner/admin can edit, member is view-only
          const { data: org } = await supabaseAdmin
            .from('organizations')
            .select('owner_id')
            .eq('id', bord.organization_id)
            .maybeSingle()

          if (org?.owner_id === user.id) {
            // Org owner — allowed
          } else {
            const { data: membership } = await supabaseAdmin
              .from('employee_memberships')
              .select('role')
              .eq('organization_id', bord.organization_id)
              .eq('user_id', user.id)
              .maybeSingle()

            if (!membership || membership.role !== 'admin') {
              return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
          }
        } else {
          // Board has no org context — check if owner and requester share an org
          let sharedOrgAccess = false
          const { data: ownerMemberships } = await supabaseAdmin
            .from('employee_memberships')
            .select('organization_id')
            .eq('user_id', bord.owner_id)

          if (ownerMemberships && ownerMemberships.length > 0) {
            const ownerOrgIds = ownerMemberships.map((m: any) => m.organization_id)
            const { data: ownedOrgs } = await supabaseAdmin
              .from('organizations')
              .select('id')
              .in('id', ownerOrgIds)
              .eq('owner_id', user.id)

            if (ownedOrgs && ownedOrgs.length > 0) {
              sharedOrgAccess = true
            } else {
              const { data: reqMembership } = await supabaseAdmin
                .from('employee_memberships')
                .select('role')
                .in('organization_id', ownerOrgIds)
                .eq('user_id', user.id)
                .limit(1)
                .maybeSingle()
              if (reqMembership?.role === 'admin') {
                sharedOrgAccess = true
              }
            }
          }

          if (!sharedOrgAccess) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
          }
        }
      }
    } else {
      // No Bord record — check BoardDocument ownership as fallback
      const { data: doc } = await supabaseAdmin
        .from('board_documents')
        .select('id')
        .eq('local_board_id', boardId)
        .eq('owner_id', user.id)
        .maybeSingle()
      if (!doc) {
        // Board doesn't exist in cloud at all — allow creation (user owns it locally)
      }
    }

    // Convert base64 state to PostgreSQL BYTEA hex format (\x...)
    // This matches how the collab server stores Y.js state, ensuring
    // both REST save and WebSocket persist use the same encoding.
    const stateHex = '\\x' + Buffer.from(state, 'base64').toString('hex')
    const stateVectorHex = stateVector
      ? '\\x' + Buffer.from(stateVector, 'base64').toString('hex')
      : null

    const { data: existing } = await supabaseAdmin
      .from('yjs_documents')
      .select('id, version')
      .eq('board_id', boardId)
      .maybeSingle()

    if (existing) {
      await supabaseAdmin
        .from('yjs_documents')
        .update({
          state: stateHex,
          state_vector: stateVectorHex,
          last_modified_by: user.id,
          version: (existing.version || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
    } else {
      await supabaseAdmin
        .from('yjs_documents')
        .insert({
          board_id: boardId,
          state: stateHex,
          state_vector: stateVectorHex,
          last_modified_by: user.id,
          version: 1,
        })
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('[save-state] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
