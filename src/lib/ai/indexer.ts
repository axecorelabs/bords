import { supabaseAdmin } from '@/lib/supabase/admin'
import { extractBoardDocumentChunks } from '@/lib/ai/board-chunks'
import { generateEmbeddings, pgVectorLiteral } from '@/lib/ai/embeddings'

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

async function markJobsDone(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return
  await supabaseAdmin
    .from('ai_embedding_jobs')
    .update({
      status: 'done',
      error_message: null,
      available_at: new Date().toISOString(),
    } as never)
    .in('id', jobIds)
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

async function failJob(jobId: string, error: string): Promise<void> {
  await supabaseAdmin
    .from('ai_embedding_jobs')
    .update({
      status: 'failed',
      error_message: error,
      available_at: new Date().toISOString(),
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

  await supabaseAdmin
    .from('ai_embedding_jobs')
    .update({ status: 'processing' } as never)
    .in('id', pickedJobs.map((j) => j.id))

  // ── 1. Split jobs by operation and source type ──
  const deleteJobs = pickedJobs.filter((j) => j.operation === 'delete')
  const boardDocJobs = pickedJobs.filter((j) => j.operation === 'upsert' && j.source_type === 'board_document')
  const taskJobs = pickedJobs.filter((j) => j.operation === 'upsert' && j.source_type === 'task_assignment')

  // ── 2. Bulk-fetch all source rows before processing ──
  const boardDocIds = boardDocJobs.map((j) => j.source_id)
  const taskIds = taskJobs.map((j) => j.source_id)

  const [boardDocsResult, tasksResult] = await Promise.all([
    boardDocIds.length > 0
      ? supabaseAdmin.from('board_documents').select('*').in('id', boardDocIds)
      : Promise.resolve({ data: [] as any[] }),
    taskIds.length > 0
      ? supabaseAdmin
          .from('task_assignments')
          .select('id, content, status, source_type, priority, due_date, assigned_to, assigned_by, organization_id, bord_id, is_deleted')
          .in('id', taskIds)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const boardDocMap = new Map<string, any>()
  for (const doc of boardDocsResult.data ?? []) boardDocMap.set(doc.id, doc)

  const taskMap = new Map<string, TaskRow>()
  for (const task of (tasksResult.data as TaskRow[] | null) ?? []) taskMap.set(task.id, task)

  // ── 3. Bulk-fetch bord_ids for all board document source rows ──
  // Keyed as `${owner_id}:${local_board_id}` → bord UUID
  const bordKeyMap = new Map<string, string>()
  const localBoardIds = [
    ...new Set([...boardDocMap.values()].map((d) => d.local_board_id).filter(Boolean)),
  ]
  if (localBoardIds.length > 0) {
    const { data: bords } = await supabaseAdmin
      .from('bords')
      .select('id, owner_id, local_board_id')
      .in('local_board_id', localBoardIds)
    for (const b of (bords as { id: string; owner_id: string; local_board_id: string }[] | null) ?? []) {
      bordKeyMap.set(`${b.owner_id}:${b.local_board_id}`, b.id)
    }
  }

  const doneJobIds: string[] = []
  let processed = 0
  let failed = 0

  // ── 4. Process delete jobs — grouped by source_type to minimise DELETE queries ──
  const deletesByType = new Map<string, EmbeddingJob[]>()
  for (const job of deleteJobs) {
    const bucket = deletesByType.get(job.source_type) ?? []
    bucket.push(job)
    deletesByType.set(job.source_type, bucket)
  }
  for (const [sourceType, bucket] of deletesByType) {
    try {
      await supabaseAdmin
        .from('ai_retrieval_chunks')
        .delete()
        .eq('source_type', sourceType)
        .in('source_id', bucket.map((j) => j.source_id))
      doneJobIds.push(...bucket.map((j) => j.id))
      processed += bucket.length
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown delete error'
      for (const job of bucket) {
        failed++
        if (job.attempts >= 5) await failJob(job.id, msg)
        else await retryJob(job.id, job.attempts, msg)
      }
    }
  }

  // ── 5. Process board_document upsert jobs ──
  for (const job of boardDocJobs) {
    try {
      const doc = boardDocMap.get(job.source_id)

      if (!doc) {
        await supabaseAdmin
          .from('ai_retrieval_chunks')
          .delete()
          .eq('source_type', 'board_document')
          .eq('source_id', job.source_id)
        doneJobIds.push(job.id)
        processed++
        continue
      }

      const chunks = extractBoardDocumentChunks(doc)

      // Clear stale chunks
      await supabaseAdmin
        .from('ai_retrieval_chunks')
        .delete()
        .eq('source_type', 'board_document')
        .eq('source_id', job.source_id)

      if (chunks.length > 0) {
        // Single API call for all chunks in this document
        const embeddings = await generateEmbeddings(chunks.map((c) => c.content))
        const bordId = bordKeyMap.get(`${doc.owner_id}:${doc.local_board_id}`) ?? null

        // Bulk insert all chunks in one query
        await supabaseAdmin
          .from('ai_retrieval_chunks')
          .insert(
            chunks.map((chunk, i) => ({
              source_type: 'board_document',
              source_id: job.source_id,
              chunk_index: chunk.chunkIndex,
              organization_id: doc.organization_id,
              bord_id: bordId,
              content: chunk.content,
              embedding: pgVectorLiteral(embeddings[i]),
              metadata: {
                ...(chunk.metadata ?? {}),
                title: doc.title,
                local_board_id: doc.local_board_id,
                owner_id: doc.owner_id,
              },
            })) as never[]
          )
      }

      doneJobIds.push(job.id)
      processed++
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : 'Unknown indexing error'
      if (job.attempts >= 5) await failJob(job.id, msg)
      else await retryJob(job.id, job.attempts, msg)
    }
  }

  // ── 6. Process task_assignment upsert jobs ──
  // Separate tasks that exist (need embedding) from deleted/missing ones (just cleanup)
  const tasksToEmbed: { job: EmbeddingJob; task: TaskRow; content: string }[] = []
  const cleanupTaskJobs: EmbeddingJob[] = []

  for (const job of taskJobs) {
    const task = taskMap.get(job.source_id)
    if (!task || task.is_deleted) {
      cleanupTaskJobs.push(job)
    } else {
      tasksToEmbed.push({ job, task, content: taskToChunkContent(task) })
    }
  }

  // Clean up chunks for deleted/missing tasks — wrapped in try/catch so a failure
  // here doesn't blow up the rest of the batch or leave other jobs stuck in 'processing'
  if (cleanupTaskJobs.length > 0) {
    try {
      await supabaseAdmin
        .from('ai_retrieval_chunks')
        .delete()
        .eq('source_type', 'task_assignment')
        .in('source_id', cleanupTaskJobs.map((j) => j.source_id))
      // Only mark done after the delete succeeds
      doneJobIds.push(...cleanupTaskJobs.map((j) => j.id))
      processed += cleanupTaskJobs.length
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Chunk cleanup delete failed'
      for (const job of cleanupTaskJobs) {
        failed++
        if (job.attempts >= 5) await failJob(job.id, msg)
        else await retryJob(job.id, job.attempts, msg)
      }
    }
  }

  // Single embedding API call for all live tasks in the batch
  if (tasksToEmbed.length > 0) {
    let taskEmbeddings: number[][]
    try {
      taskEmbeddings = await generateEmbeddings(tasksToEmbed.map((t) => t.content))
    } catch (err) {
      // If the batch call fails, mark all task jobs for retry
      const msg = err instanceof Error ? err.message : 'Batch embedding failed'
      for (const { job } of tasksToEmbed) {
        failed++
        if (job.attempts >= 5) await failJob(job.id, msg)
        else await retryJob(job.id, job.attempts, msg)
      }
      taskEmbeddings = []
    }

    for (let i = 0; i < tasksToEmbed.length; i++) {
      const { job, task, content } = tasksToEmbed[i]
      try {
        await supabaseAdmin
          .from('ai_retrieval_chunks')
          .upsert({
            source_type: 'task_assignment',
            source_id: task.id,
            chunk_index: 0,
            organization_id: task.organization_id,
            bord_id: task.bord_id,
            content,
            embedding: pgVectorLiteral(taskEmbeddings[i]),
            metadata: {
              status: task.status,
              priority: task.priority,
              due_date: task.due_date,
              assigned_to: task.assigned_to,
              assigned_by: task.assigned_by,
              source_type: task.source_type,
            },
          } as never, { onConflict: 'source_type,source_id,chunk_index' })
        doneJobIds.push(job.id)
        processed++
      } catch (err) {
        failed++
        const msg = err instanceof Error ? err.message : 'Unknown indexing error'
        if (job.attempts >= 5) await failJob(job.id, msg)
        else await retryJob(job.id, job.attempts, msg)
      }
    }
  }

  // ── 7. Batch-mark all successful jobs done in a single UPDATE ──
  await markJobsDone(doneJobIds)

  return { picked: pickedJobs.length, processed, failed }
}
