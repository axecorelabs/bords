import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized } from '@/lib/api-helpers'

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

// PATCH /api/ai/plans/[id]/update — save manual edits to a draft plan
export async function PATCH(req: Request, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('ai_plan_artifacts')
    .select('id, conversation_id, status, content')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Plan artifact not found' }, { status: 404 })
  }

  const isMember = await assertConversationMember(existing.conversation_id, user.id)
  if (!isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Only allow editing draft or approved plans (not applied)
  if (existing.status === 'applied') {
    return NextResponse.json({ error: 'Cannot edit a plan that has already been applied to a board' }, { status: 400 })
  }

  const prevContent = (existing.content ?? {}) as Record<string, unknown>

  // Merge only the editable fields — preserve materializedBoard etc.
  const nextContent: Record<string, unknown> = { ...prevContent }
  if (typeof body.summary === 'string') nextContent.summary = body.summary.trim()
  if (Array.isArray(body.outcomes)) nextContent.outcomes = body.outcomes.map((o: unknown) => String(o).trim()).filter(Boolean)
  if (Array.isArray(body.workstreams)) {
    nextContent.workstreams = body.workstreams.map((w: Record<string, unknown>) => ({
      title: typeof w.title === 'string' ? w.title.trim() : '',
      checklist: Array.isArray(w.checklist)
        ? w.checklist.map((c: unknown) => String(c).trim()).filter(Boolean)
        : [],
    })).filter((w: { title: string; checklist: string[] }) => w.title || w.checklist.length > 0)
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('ai_plan_artifacts')
    .update({ content: nextContent, status: 'draft' } as never)
    .eq('id', id)
    .select('id, status, content, updated_at')
    .single()

  if (updateErr || !updated) {
    return NextResponse.json({ error: 'Failed to save plan edits' }, { status: 500 })
  }

  return NextResponse.json({ id: updated.id, status: updated.status, content: updated.content })
}
