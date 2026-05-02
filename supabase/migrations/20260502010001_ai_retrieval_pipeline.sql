-- AI retrieval pipeline: queue, chunks, triggers, and hybrid retrieval function

CREATE EXTENSION IF NOT EXISTS vector;

-- Queue for async embedding work
CREATE TABLE IF NOT EXISTS ai_embedding_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL CHECK (source_type IN ('task_assignment')),
  source_id UUID NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  bord_id UUID REFERENCES bords(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_embedding_jobs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ai_embedding_jobs_status_available
  ON ai_embedding_jobs (status, available_at, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_embedding_jobs_source
  ON ai_embedding_jobs (source_type, source_id);

CREATE TRIGGER ai_embedding_jobs_updated_at
  BEFORE UPDATE ON ai_embedding_jobs
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- Dedup queue pressure by allowing only one queued/processing row per source tuple
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_embedding_jobs_active
  ON ai_embedding_jobs (source_type, source_id)
  WHERE status IN ('queued', 'processing');

-- Retrieval chunks with vector and lexical index
CREATE TABLE IF NOT EXISTS ai_retrieval_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL CHECK (source_type IN ('task_assignment')),
  source_id UUID NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  bord_id UUID REFERENCES bords(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED,
  embedding vector(1536),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_type, source_id, chunk_index)
);

ALTER TABLE ai_retrieval_chunks ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ai_chunks_org_bord
  ON ai_retrieval_chunks (organization_id, bord_id);

CREATE INDEX IF NOT EXISTS idx_ai_chunks_source
  ON ai_retrieval_chunks (source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_ai_chunks_fts
  ON ai_retrieval_chunks USING GIN (content_tsv);

CREATE INDEX IF NOT EXISTS idx_ai_chunks_embedding
  ON ai_retrieval_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE TRIGGER ai_retrieval_chunks_updated_at
  BEFORE UPDATE ON ai_retrieval_chunks
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- Enqueue embedding jobs when tasks change
CREATE OR REPLACE FUNCTION enqueue_task_embedding_job()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO ai_embedding_jobs (source_type, source_id, operation, organization_id, bord_id)
    VALUES ('task_assignment', OLD.id, 'delete', OLD.organization_id, OLD.bord_id)
    ON CONFLICT DO NOTHING;
    RETURN OLD;
  END IF;

  INSERT INTO ai_embedding_jobs (source_type, source_id, operation, organization_id, bord_id)
  VALUES ('task_assignment', NEW.id, 'upsert', NEW.organization_id, NEW.bord_id)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enqueue_task_embedding_job ON task_assignments;
CREATE TRIGGER trg_enqueue_task_embedding_job
AFTER INSERT OR UPDATE OR DELETE ON task_assignments
FOR EACH ROW EXECUTE FUNCTION enqueue_task_embedding_job();

-- Backfill existing task rows into queue once
INSERT INTO ai_embedding_jobs (source_type, source_id, operation, organization_id, bord_id)
SELECT 'task_assignment', t.id, 'upsert', t.organization_id, t.bord_id
FROM task_assignments t
ON CONFLICT DO NOTHING;

-- Hybrid retrieval SQL function: vector + lexical rank
CREATE OR REPLACE FUNCTION ai_hybrid_task_retrieve(
  p_query_embedding vector(1536),
  p_query_text TEXT,
  p_user_id UUID,
  p_org_id UUID,
  p_role TEXT,
  p_allowed_board_ids UUID[],
  p_limit INTEGER DEFAULT 8
)
RETURNS TABLE (
  chunk_id UUID,
  source_id UUID,
  bord_id UUID,
  organization_id UUID,
  content TEXT,
  vector_score DOUBLE PRECISION,
  lexical_score DOUBLE PRECISION,
  hybrid_score DOUBLE PRECISION
)
LANGUAGE sql
AS $$
  SELECT
    c.id AS chunk_id,
    c.source_id,
    c.bord_id,
    c.organization_id,
    c.content,
    GREATEST(0::double precision, 1 - (c.embedding <=> p_query_embedding)) AS vector_score,
    ts_rank_cd(c.content_tsv, plainto_tsquery('english', p_query_text))::double precision AS lexical_score,
    (
      0.75 * GREATEST(0::double precision, 1 - (c.embedding <=> p_query_embedding)) +
      0.25 * LEAST(1::double precision, ts_rank_cd(c.content_tsv, plainto_tsquery('english', p_query_text))::double precision)
    ) AS hybrid_score
  FROM ai_retrieval_chunks c
  JOIN task_assignments t ON t.id = c.source_id
  WHERE c.source_type = 'task_assignment'
    AND t.is_deleted = FALSE
    AND c.embedding IS NOT NULL
    AND (
      (p_org_id IS NULL AND c.organization_id IS NULL) OR
      (p_org_id IS NOT NULL AND c.organization_id = p_org_id)
    )
    AND (
      COALESCE(array_length(p_allowed_board_ids, 1), 0) = 0 OR
      c.bord_id = ANY(p_allowed_board_ids)
    )
    AND (
      p_role IN ('owner', 'admin') OR
      t.assigned_to = p_user_id OR
      t.assigned_by = p_user_id
    )
  ORDER BY hybrid_score DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 8), 20));
$$;
