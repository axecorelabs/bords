import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/api-helpers'
import { computeContentHash, boardDocToClient, boardContentToRow } from '@/lib/board-helpers'

/* ────────────── GET — List all boards for current user ────────────── */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [ownedRes, sharedRes] = await Promise.all([
      supabaseAdmin
        .from('board_documents')
        .select('id, local_board_id, title, visibility, content_hash, last_synced_at, created_at, updated_at')
        .eq('owner_id', user.id)
        .order('updated_at', { ascending: false }),
      supabaseAdmin
        .from('board_documents')
        .select('id, local_board_id, title, visibility, content_hash, owner_id, last_synced_at, created_at, updated_at, shared_with')
        .contains('shared_with', JSON.stringify([{ userId: user.id }]))
        .order('updated_at', { ascending: false }),
    ])

    const owned = (ownedRes.data || []).map(r => ({
      _id: r.id,
      localBoardId: r.local_board_id,
      name: r.title,
      visibility: r.visibility,
      contentHash: r.content_hash,
      lastSyncedAt: r.last_synced_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))

    const shared = (sharedRes.data || []).map(r => ({
      _id: r.id,
      localBoardId: r.local_board_id,
      name: r.title,
      visibility: r.visibility,
      contentHash: r.content_hash,
      owner: r.owner_id,
      lastSyncedAt: r.last_synced_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      sharedWith: r.shared_with,
    }))

    return NextResponse.json({ owned, shared })
  } catch (error: any) {
    console.error('Board sync list error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/* ────────────── POST — Sync (save) a board to cloud ────────────── */
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
      const { data: personalWs } = await supabaseAdmin
        .from('workspaces')
        .select('id')
        .eq('owner_id', user.id)
        .eq('type', 'personal')
        .maybeSingle()
      if (personalWs) resolvedWorkspaceId = personalWs.id
    }

    // Build the update payload
    const contentPayload = boardContentToRow(board)
    const updatePayload: Record<string, any> = {
      ...contentPayload,
      title: name,
      content_hash: contentHash,
      last_synced_at: new Date().toISOString(),
    }

    // Check if a doc already exists for this board — scoped to current user
    // (owner OR shared collaborator)
    const { data: existingOwned } = await supabaseAdmin
      .from('board_documents')
      .select('*')
      .eq('local_board_id', localBoardId)
      .eq('owner_id', user.id)
      .maybeSingle()

    let doc = existingOwned

    if (!doc) {
      // Check shared_with
      const { data: sharedDoc } = await supabaseAdmin
        .from('board_documents')
        .select('*')
        .eq('local_board_id', localBoardId)
        .contains('shared_with', JSON.stringify([{ userId: user.id }]))
        .maybeSingle()
      doc = sharedDoc
    }

    // Fallback: check bord_access_list (org-level sharing)
    if (!doc) {
      const { data: bordAccess } = await supabaseAdmin
        .from('bord_access_list')
        .select('bord_id, bords!inner(local_board_id, owner_id)')
        .eq('user_id', user.id)
        .limit(100)

      if (bordAccess && bordAccess.length > 0) {
        const match = bordAccess.find((ba: any) => ba.bords?.local_board_id === localBoardId)
        if (match) {
          const ownerId = (match as any).bords?.owner_id
          if (ownerId) {
            const { data: ownerDoc } = await supabaseAdmin
              .from('board_documents')
              .select('*')
              .eq('local_board_id', localBoardId)
              .eq('owner_id', ownerId)
              .maybeSingle()
            doc = ownerDoc
          }
        }
      }
    }

    // Fallback: org membership (owner/admin/member can access org boards)
    if (!doc) {
      // First try boards with organization_id set
      let bord: any = null
      const { data: orgBord } = await supabaseAdmin
        .from('bords')
        .select('id, owner_id, organization_id, context_type')
        .eq('local_board_id', localBoardId)
        .not('organization_id', 'is', null)
        .maybeSingle()
      bord = orgBord

      // If no org board found, try any board with this local_board_id
      // and check if the owner shares an org with the requester
      if (!bord) {
        const { data: anyBord } = await supabaseAdmin
          .from('bords')
          .select('id, owner_id, organization_id, context_type')
          .eq('local_board_id', localBoardId)
          .maybeSingle()
        if (anyBord && anyBord.owner_id !== user.id) {
          bord = anyBord
        }
      }

      if (bord) {
        let hasAccess = false

        if (bord.organization_id) {
          // Board has org context — check org membership directly
          const { data: org } = await supabaseAdmin
            .from('organizations')
            .select('owner_id')
            .eq('id', bord.organization_id)
            .maybeSingle()

          const isOrgOwner = org?.owner_id === user.id
          let isOrgMember = false
          if (!isOrgOwner) {
            const { data: membership } = await supabaseAdmin
              .from('employee_memberships')
              .select('id')
              .eq('organization_id', bord.organization_id)
              .eq('user_id', user.id)
              .maybeSingle()
            isOrgMember = !!membership
          }
          hasAccess = isOrgOwner || isOrgMember
        } else {
          // Board missing org context — check if owner and requester share an org
          const { data: ownerMemberships } = await supabaseAdmin
            .from('employee_memberships')
            .select('organization_id')
            .eq('user_id', bord.owner_id)

          if (ownerMemberships && ownerMemberships.length > 0) {
            const ownerOrgIds = ownerMemberships.map((m: any) => m.organization_id)
            // Check if requester owns any of those orgs
            const { data: ownedOrgs } = await supabaseAdmin
              .from('organizations')
              .select('id')
              .in('id', ownerOrgIds)
              .eq('owner_id', user.id)
            if (ownedOrgs && ownedOrgs.length > 0) {
              hasAccess = true
            } else {
              // Check if requester is a member of any of those orgs
              const { data: requesterMembership } = await supabaseAdmin
                .from('employee_memberships')
                .select('id')
                .in('organization_id', ownerOrgIds)
                .eq('user_id', user.id)
                .limit(1)
                .maybeSingle()
              hasAccess = !!requesterMembership
            }
          }
        }

        if (hasAccess) {
          const { data: ownerDoc } = await supabaseAdmin
            .from('board_documents')
            .select('*')
            .eq('local_board_id', localBoardId)
            .eq('owner_id', bord.owner_id)
            .maybeSingle()
          doc = ownerDoc
        }
      }
    }

    // ── Optimistic locking (Git-style): reject if cloud moved ahead ──
    if (doc && baseHash && doc.content_hash && doc.content_hash !== baseHash) {
      const clientDoc = boardDocToClient(doc)
      return NextResponse.json(
        {
          error: 'Board has been modified by another editor since your last sync',
          code: 'MERGE_REQUIRED',
          cloudBoard: clientDoc,
          cloudHash: doc.content_hash,
          cloudVersion: doc.version || 1,
        },
        { status: 409 }
      )
    }

    if (!doc || doc.owner_id === user.id) {
      // Owner path — upsert
      if (doc) {
        const { data: updated } = await supabaseAdmin
          .from('board_documents')
          .update({
            ...updatePayload,
            workspace_id: resolvedWorkspaceId,
            organization_id: organizationId || null,
            context_type: resolvedContextType,
            version: (doc.version || 0) + 1,
          })
          .eq('id', doc.id)
          .select()
          .single()
        doc = updated
      } else {
        const { data: inserted } = await supabaseAdmin
          .from('board_documents')
          .insert({
            ...updatePayload,
            owner_id: user.id,
            local_board_id: localBoardId,
            workspace_id: resolvedWorkspaceId,
            organization_id: organizationId || null,
            context_type: resolvedContextType,
            visibility: 'private',
            shared_with: [],
            version: 1,
          })
          .select()
          .single()
        doc = inserted
      }
    } else {
      // Not the owner — check edit access via shared_with OR bord_access_list
      const sharedWith: any[] = doc.shared_with || []
      const sharedEntry = sharedWith.find(
        (s: any) => s.userId === user.id
      )

      if (sharedEntry) {
        if (sharedEntry.permission !== 'edit') {
          return NextResponse.json({ error: 'View-only access — cannot sync changes' }, { status: 403 })
        }
        const { data: updated } = await supabaseAdmin
          .from('board_documents')
          .update({
            ...updatePayload,
            version: (doc.version || 0) + 1,
          })
          .eq('id', doc.id)
          .select()
          .single()
        if (!updated) {
          return NextResponse.json({ error: 'Board document not found' }, { status: 404 })
        }
        doc = updated
      } else {
        // Fallback: check bord_access_list
        const { data: accessEntry } = await supabaseAdmin
          .from('bord_access_list')
          .select('permission, bords!inner(local_board_id, owner_id)')
          .eq('user_id', user.id)
          .limit(100)

        const entry = accessEntry?.find((a: any) => a.bords?.local_board_id === localBoardId)

        // Final fallback: org membership (owner/admin get edit, member gets view)
        let orgPermission: string | null = null
        if (!entry) {
          const { data: bord } = await supabaseAdmin
            .from('bords')
            .select('organization_id, context_type')
            .eq('local_board_id', localBoardId)
            .eq('context_type', 'organization')
            .maybeSingle()

          if (bord?.organization_id) {
            const { data: org } = await supabaseAdmin
              .from('organizations')
              .select('owner_id')
              .eq('id', bord.organization_id)
              .maybeSingle()

            if (org?.owner_id === user.id) {
              orgPermission = 'edit'
            } else {
              const { data: membership } = await supabaseAdmin
                .from('employee_memberships')
                .select('role')
                .eq('organization_id', bord.organization_id)
                .eq('user_id', user.id)
                .maybeSingle()

              if (membership) {
                orgPermission = membership.role === 'admin' ? 'edit' : 'view'
              }
            }
          }
        }

        const resolvedPermission = entry?.permission || orgPermission

        if (!resolvedPermission) {
          return NextResponse.json({ error: 'Not authorized to sync this board' }, { status: 403 })
        }
        if (resolvedPermission !== 'edit') {
          return NextResponse.json({ error: 'View-only access — cannot sync changes' }, { status: 403 })
        }

        const { data: updated } = await supabaseAdmin
          .from('board_documents')
          .update({
            ...updatePayload,
            version: (doc.version || 0) + 1,
          })
          .eq('id', doc.id)
          .select()
          .single()
        if (!updated) {
          return NextResponse.json({ error: 'Board document not found' }, { status: 404 })
        }
        doc = updated
      }
    }

    return NextResponse.json({
      message: 'Board synced to cloud',
      boardDocId: doc!.id,
      contentHash: doc!.content_hash,
      lastSyncedAt: doc!.last_synced_at,
      version: doc!.version || 1,
    })
  } catch (error: any) {
    console.error('Board sync save error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
