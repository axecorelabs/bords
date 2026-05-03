import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized } from '@/lib/api-helpers'
import { buildBoardFromPlanArtifact } from '@/lib/ai/plan-board-builder'

type Params = { params: Promise<{ id: string }> }

async function assertConversationMember(conversationId: string, userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
}

export async function POST(req: Request, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const body = await req.json().catch(() => null)
  const theme: 'dark' | 'light' = body?.theme === 'dark' ? 'dark' : 'light'

  const { id } = await params
  const { data: artifact, error: artifactErr } = await supabaseAdmin
    .from('ai_plan_artifacts')
    .select('id, conversation_id, user_id, organization_id, title, goal, content, status')
    .eq('id', id)
    .maybeSingle()

  if (artifactErr || !artifact) {
    return NextResponse.json({ error: 'Plan artifact not found' }, { status: 404 })
  }

  const isMember = await assertConversationMember(artifact.conversation_id, user.id)
  if (!isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Accept draft, approved, or applied — builder handles idempotency and auto-approve
  if (!['draft', 'approved', 'applied'].includes(artifact.status)) {
    return NextResponse.json({ error: 'Plan cannot be used for board creation in its current state' }, { status: 400 })
  }

  try {
    const result = await buildBoardFromPlanArtifact(artifact, user.id, theme)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create board from plan'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
