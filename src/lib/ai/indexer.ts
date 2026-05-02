import { supabaseAdmin } from '@/lib/supabase/admin'
import { extractBoardDocumentChunks } from '@/lib/ai/board-chunks'
import { generateEmbedding, pgVectorLiteral } from '@/lib/ai/embeddings'

type EmbeddingJob = {
  id: string
  source_type: 'task_assignment' | 'board_document'
  source_id: string
  operation: 'upsert' | 'delete'
  attempts: number
}

type TaskRow = {
  id: string
  content: string
  status: string
  source_type: string
  priority: string
  due_date: string | null
  assigned_to: string
  assigned_by: string
  organization_id: string | null
  bord_id: string | null
  is_deleted: boolean
}

function taskToChunkContent(task: TaskRow): string {
  const due = task.due_date ? `Due: ${task.due_date}` : 'Due: none'
  return [
    `Task: ${task.content}`,
    `Status: ${task.status}`,
    `Priority: ${task.priority}`,
    `Type: ${task.source_type}`,
    due,
  ].join('\n')
}

async function markJob(jobId: string, status: 'done' | 'failed', error?: string): Promise<void> {
  await supabaseAdmin
    .from('ai_embedding_jobs')
    .update({
      status,
      error_message: error ?? null,
      available_at: new Date().toISOString(),
    } as never)
    .eq('id', jobId)
}

async function retryJob(jobId: string, attempts: number, error: string): Promise<void> {
  const delaySeconds = Math.min(300, Math.pow(2, attempts) * 5)
  const availableAt = new Date(Date.now() + delaySeconds * 1000).toISOString()
  await supabaseAdmin
    .from('ai_embedding_jobs')
    .update({
      status: 'queued',
      attempts: attempts + 1,
      error_message: error,
      available_at: availableAt,
    } as never)
    .eq('id', jobId)
}

export async function processEmbeddingJobs(batchSize = 20): Promise<{
  picked: number
  processed: number
  failed: number
}> {
  const nowIso = new Date().toISOString()

  const { data: jobs, error } = await supabaseAdmin
    .from('ai_embedding_jobs')
    .select('id, source_type, source_id, operation, attempts')
    .eq('status', 'queued')
    .lte('available_at', nowIso)
    .order('created_at', { ascending: true })
    .limit(batchSize)

  if (error || !jobs?.length) {
    return { picked: 0, processed: 0, failed: 0 }
  }

  const pickedJobs = jobs as EmbeddingJob[]

  // Mark picked jobs as processing
  await supabaseAdmin
    .from('ai_embedding_jobs')
    .update({ status: 'processing' } as never)
    .in('id', pickedJobs.map((j) => j.id))

  let processed = 0
  let failed = 0

  for (const job of pickedJobs) {
    try {
      if (job.operation === 'delete') {
        await supabaseAdmin
          .from('ai_retrieval_chunks')
          .delete()
          .eq('source_type', job.source_type)
          .eq('source_id', job.source_id)

        await markJob(job.id, 'done')
        processed++
        continue
      }

      if (job.source_type === 'board_document') {
        const { data: doc } = await supabaseAdmin
          .from('board_documents')
          .select('*')
          .eq('id', job.source_id)
          .maybeSingle()

        if (!doc) {
          await supabaseAdmin
            .from('ai_retrieval_chunks')
            .delete()
            .eq('source_type', 'board_document')
            .eq('source_id', job.source_id)
          await markJob(job.id, 'done')
          processed++
          continue
        }

        const chunks = extractBoardDocumentChunks(doc as never)

        await supabaseAdmin
          .from('ai_retrieval_chunks')
          .delete()
          .eq('source_type', 'board_document')
          .eq('source_id', job.source_id)

        for (const chunk of chunks) {
          const embedding = await generateEmbedding(chunk.content)
          const embeddingLiteral = pgVectorLiteral(embedding)

          await supabaseAdmin
            .from('ai_retrieval_chunks')
            .insert({
              source_type: 'board_document',
              source_id: job.source_id,
              chunk_index: chunk.chunkIndex,
              organization_id: (doc as any).organization_id,
              bord_id: null,
              content: chunk.content,
              embedding: embeddingLiteral,
              metadata: {
                ...(chunk.metadata ?? {}),
                title: (doc as any).title,
                local_board_id: (doc as any).local_board_id,
                owner_id: (doc as any).owner_id,
              },
            } as never)
        }

        // Best-effort backfill of bord_id after insert using local_board_id + owner_id relation.
        const { data: bord } = await supabaseAdmin
          .from('bords')
          .select('id')
          .eq('owner_id', (doc as any).owner_id)
          .eq('local_board_id', (doc as any).local_board_id)
          .maybeSingle()

        if (bord?.id) {
          await supabaseAdmin
            .from('ai_retrieval_chunks')
            .update({ bord_id: bord.id } as never)
            .eq('source_type', 'board_document')
            .eq('source_id', job.source_id)
        }

        await markJob(job.id, 'done')
        processed++
        continue
      }

      const { data: task } = await supabaseAdmin
        .from('task_assignments')
        .select('id, content, status, source_type, priority, due_date, assigned_to, assigned_by, organization_id, bord_id, is_deleted')
        .eq('id', job.source_id)
        .maybeSingle()

      if (!task || task.is_deleted) {
        await supabaseAdmin
          .from('ai_retrieval_chunks')
          .delete()
          .eq('source_type', 'task_assignment')
          .eq('source_id', job.source_id)
        await markJob(job.id, 'done')
        processed++
        continue
      }

      const taskRow = task as TaskRow
      const chunk = taskToChunkContent(taskRow)
      const embedding = await generateEmbedding(chunk)
      const embeddingLiteral = pgVectorLiteral(embedding)

      const metadata = {
        status: taskRow.status,
        priority: taskRow.priority,
        due_date: taskRow.due_date,
        assigned_to: taskRow.assigned_to,
        assigned_by: taskRow.assigned_by,
        source_type: taskRow.source_type,
      }

      await supabaseAdmin
        .from('ai_retrieval_chunks')
        .upsert({
          source_type: 'task_assignment',
          source_id: taskRow.id,
          chunk_index: 0,
          organization_id: taskRow.organization_id,
          bord_id: taskRow.bord_id,
          content: chunk,
          embedding: embeddingLiteral,
          metadata,
        } as never, { onConflict: 'source_type,source_id,chunk_index' })

      await markJob(job.id, 'done')
      processed++
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : 'Unknown indexing error'
      if (job.attempts >= 5) {
        await markJob(job.id, 'failed', msg)
      } else {
        await retryJob(job.id, job.attempts, msg)
      }
    }
  }

  return { picked: pickedJobs.length, processed, failed }
}
