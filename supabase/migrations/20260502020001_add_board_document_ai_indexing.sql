-- Extend AI retrieval pipeline to index full board documents

ALTER TABLE ai_embedding_jobs
  DROP CONSTRAINT IF EXISTS ai_embedding_jobs_source_type_check;

ALTER TABLE ai_embedding_jobs
  ADD CONSTRAINT ai_embedding_jobs_source_type_check
  CHECK (source_type IN ('task_assignment', 'board_document'));

ALTER TABLE ai_retrieval_chunks
  DROP CONSTRAINT IF EXISTS ai_retrieval_chunks_source_type_check;

ALTER TABLE ai_retrieval_chunks
  ADD CONSTRAINT ai_retrieval_chunks_source_type_check
  CHECK (source_type IN ('task_assignment', 'board_document'));

CREATE OR REPLACE FUNCTION enqueue_board_document_embedding_job()
RETURNS TRIGGER AS $$
DECLARE
  resolved_bord_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT id INTO resolved_bord_id
    FROM bords
    WHERE owner_id = OLD.owner_id AND local_board_id = OLD.local_board_id
    LIMIT 1;

    INSERT INTO ai_embedding_jobs (source_type, source_id, operation, organization_id, bord_id)
    VALUES ('board_document', OLD.id, 'delete', OLD.organization_id, resolved_bord_id)
    ON CONFLICT DO NOTHING;
    RETURN OLD;
  END IF;

  SELECT id INTO resolved_bord_id
  FROM bords
  WHERE owner_id = NEW.owner_id AND local_board_id = NEW.local_board_id
  LIMIT 1;

  INSERT INTO ai_embedding_jobs (source_type, source_id, operation, organization_id, bord_id)
  VALUES ('board_document', NEW.id, 'upsert', NEW.organization_id, resolved_bord_id)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enqueue_board_document_embedding_job ON board_documents;
CREATE TRIGGER trg_enqueue_board_document_embedding_job
AFTER INSERT OR UPDATE OR DELETE ON board_documents
FOR EACH ROW EXECUTE FUNCTION enqueue_board_document_embedding_job();

INSERT INTO ai_embedding_jobs (source_type, source_id, operation, organization_id, bord_id)
SELECT
  'board_document',
  d.id,
  'upsert',
  d.organization_id,
  b.id
FROM board_documents d
LEFT JOIN bords b
  ON b.owner_id = d.owner_id AND b.local_board_id = d.local_board_id
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION ai_hybrid_board_retrieve(
  p_query_embedding vector(1536),
  p_query_text TEXT,
  p_org_id UUID,
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
  WHERE c.source_type = 'board_document'
    AND c.embedding IS NOT NULL
    AND (
      (p_org_id IS NULL AND c.organization_id IS NULL) OR
      (p_org_id IS NOT NULL AND c.organization_id = p_org_id)
    )
    AND (
      COALESCE(array_length(p_allowed_board_ids, 1), 0) = 0 OR
      c.bord_id = ANY(p_allowed_board_ids)
    )
  ORDER BY hybrid_score DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 8), 20));
$$;
