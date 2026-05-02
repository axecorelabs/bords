import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized } from '@/lib/api-helpers'

type Params = { params: Promise<{ id: string }> }

function scoreMatch(roleHint: string, fullName: string): number {
  const hint = roleHint.toLowerCase()
  const name = fullName.toLowerCase()
  const hintTokens = hint.split(/\s+/).filter(Boolean)
  const nameTokens = name.split(/\s+/).filter(Boolean)
  let score = 0
  for (const ht of hintTokens) {
    if (name.includes(ht)) score += 2
    for (const nt of nameTokens) {
      if (nt.startsWith(ht.slice(0, 3))) score += 1
    }
  }
  return score
}

export async function GET(_req: Request, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { id } = await params

  const { data: artifact, error: artifactErr } = await supabaseAdmin
    .from('ai_plan_artifacts')
    .select('id, conversation_id, user_id, organization_id, content, status')
    .eq('id', id)
    .maybeSingle()

  if (artifactErr || !artifact) {
    return NextResponse.json({ error: 'Plan artifact not found' }, { status: 404 })
  }

  // Verify the caller is a member of the conversation
  const { data: membership } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', artifact.conversation_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const content = (artifact.content ?? {}) as Record<string, any>
  const rawProposals: Array<{ roleHint?: string; responsibility?: string; confidence?: number }> =
    Array.isArray(content?.assignmentProposals) ? content.assignmentProposals : []

  if (rawProposals.length === 0) {
    return NextResponse.json({ proposals: [] })
  }

  // Load org members if this is an org plan
  let members: Array<{ id: string; firstName: string; lastName: string; image: string | null }> = []

  if (artifact.organization_id) {
    const { data: empRows } = await supabaseAdmin
      .from('employee_memberships')
      .select('user_id')
      .eq('organization_id', artifact.organization_id)

    const userIds = (empRows ?? []).map((r: any) => r.user_id as string)

    if (userIds.length > 0) {
      const { data: profileRows } = await supabaseAdmin
        .from('profiles')
        .select('id, first_name, last_name, image')
        .in('id', userIds)

      members = (profileRows ?? []).map((p: any) => ({
        id: p.id as string,
        firstName: (p.first_name as string) || '',
        lastName: (p.last_name as string) || '',
        image: (p.image as string | null) ?? null,
      }))
    }
  }

  const proposals = rawProposals.map((p, index) => {
    const roleHint = p.roleHint ?? ''
    let suggestedUser: { id: string; name: string; avatarUrl: string | null } | null = null

    if (members.length > 0 && roleHint) {
      let bestScore = 0
      let best: (typeof members)[number] | null = null
      for (const m of members) {
        const fullName = `${m.firstName} ${m.lastName}`.trim()
        const s = scoreMatch(roleHint, fullName)
        if (s > bestScore) {
          bestScore = s
          best = m
        }
      }
      if (best && bestScore > 0) {
        suggestedUser = {
          id: best.id,
          name: `${best.firstName} ${best.lastName}`.trim(),
          avatarUrl: best.image,
        }
      }
    }

    return {
      index,
      roleHint: p.roleHint ?? null,
      responsibility: p.responsibility ?? null,
      confidence: typeof p.confidence === 'number' ? p.confidence : null,
      suggestedUser,
    }
  })

  return NextResponse.json({ proposals, members: members.map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}`.trim(), avatarUrl: m.image })) })
}
