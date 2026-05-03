-- Canonicalize board_documents to one row per local_board_id.
-- Keep the freshest row and remove older duplicates.

WITH ranked AS (
  SELECT
    id,
    local_board_id,
    ROW_NUMBER() OVER (
      PARTITION BY local_board_id
      ORDER BY
        COALESCE(last_synced_at, updated_at, created_at) DESC,
        updated_at DESC,
        created_at DESC,
        id DESC
    ) AS rn
  FROM public.board_documents
)
DELETE FROM public.board_documents d
USING ranked r
WHERE d.id = r.id
  AND r.rn > 1;

-- Enforce canonical row shape moving forward.
CREATE UNIQUE INDEX IF NOT EXISTS ux_board_documents_local_board_id
  ON public.board_documents (local_board_id);
