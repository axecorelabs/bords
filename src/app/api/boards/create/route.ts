import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, unauthorized, badRequest } from '@/lib/api-helpers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { actionLimiter, checkRateLimit, getRateLimitKey } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const rateLimitRes = await checkRateLimit(actionLimiter, getRateLimitKey(req, user.id))
  if (rateLimitRes) return rateLimitRes

  const body = await req.json()
  const { localBoardId, name, contextType, organizationId } = body

  if (!localBoardId || !name?.trim()) {
    return badRequest('localBoardId and name are required')
  }

  // Resolve the user's personal workspace
  const { data: personalWs } = await supabaseAdmin
    .from('workspaces')
    .select('id')
    .eq('owner_id', user.id)
    .eq('type', 'personal')
    .maybeSingle()

  try {
    // Create Bord + BoardDocument in parallel (upsert to avoid duplicates)
    await Promise.all([
      // Bord entry — for listing, sharing, and access control
      supabaseAdmin
        .from('bords')
        .upsert(
          {
            owner_id: user.id,
            local_board_id: localBoardId,
            title: name.trim(),
            context_type: contextType || 'personal',
            organization_id: organizationId || null,
          },
          { onConflict: 'owner_id,local_board_id' }
        ),
      // BoardDocument — stores full board content for cloud sync
      supabaseAdmin
        .from('board_documents')
        .upsert(
          {
            owner_id: user.id,
            local_board_id: localBoardId,
            title: name.trim(),
            context_type: contextType || 'personal',
            organization_id: organizationId || null,
            workspace_id: personalWs?.id || null,
            visibility: 'private',
            shared_with: [],
            version: 1,
          },
          { onConflict: 'owner_id,local_board_id' }
        ),
    ])
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (error: any) {
    console.error('Board create error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
