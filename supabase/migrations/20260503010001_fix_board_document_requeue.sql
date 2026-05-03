-- Fix: board document sync jobs were silently dropped when a job was already
-- queued/processing for the same board_document id.
-- Now re-syncing a board resets any stuck/existing queued job back to queued
-- so the next cron run picks it up.

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
    ON CONFLICT (source_type, source_id) WHERE status IN ('queued', 'processing')
    DO UPDATE SET
      status = 'queued',
      operation = 'delete',
      attempts = 0,
      error_message = NULL,
      available_at = NOW();
    RETURN OLD;
  END IF;

  SELECT id INTO resolved_bord_id
  FROM bords
  WHERE owner_id = NEW.owner_id AND local_board_id = NEW.local_board_id
  LIMIT 1;

  INSERT INTO ai_embedding_jobs (source_type, source_id, operation, organization_id, bord_id)
  VALUES ('board_document', NEW.id, 'upsert', NEW.organization_id, resolved_bord_id)
  ON CONFLICT (source_type, source_id) WHERE status IN ('queued', 'processing')
  DO UPDATE SET
    status = 'queued',
    operation = 'upsert',
    attempts = 0,
    error_message = NULL,
    available_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
