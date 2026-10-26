-- Change log for collaborative boards.
--
-- The realtime Worker used to rewrite the board's ENTIRE Yjs state to yjs_documents every few
-- seconds while people edited. Now each save appends only what changed (a small Yjs update) here,
-- and the log is folded into yjs_documents.state ("compaction") every couple of minutes, after a
-- batch of changes, and when the last person leaves. So yjs_documents.state is still a complete,
-- usable snapshot for every existing reader (AI indexing, summaries), at most a few minutes behind
-- while people are actively editing, and exact once a board is idle.
--
-- Load = yjs_documents.state + all rows here for the board (in id order). Applying updates is
-- idempotent, so a retried or duplicated row is harmless.
CREATE TABLE public.yjs_updates (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id   TEXT NOT NULL,
  update     BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX yjs_updates_board_idx ON public.yjs_updates (board_id, id);

-- Service role only (the realtime Worker). Browsers never read this directly.
ALTER TABLE public.yjs_updates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.yjs_updates FROM anon, authenticated;
