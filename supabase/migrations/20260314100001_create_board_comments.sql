-- Create board_comments table (replaces JSONB comments column on board_documents)
CREATE TABLE board_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id    TEXT NOT NULL,                -- local_board_id from board_documents
  owner_id    UUID NOT NULL,                -- board owner (needed to locate the board_document)
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user_name   TEXT NOT NULL DEFAULT 'Anonymous',
  user_avatar TEXT,
  text        TEXT NOT NULL,
  item_id     TEXT,                          -- optional reference to a board element
  parent_id   UUID REFERENCES board_comments(id) ON DELETE SET NULL,
  mentions    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_board_comments_board ON board_comments(board_id, owner_id);
CREATE INDEX idx_board_comments_created ON board_comments(board_id, created_at DESC);

-- Enable RLS (mutations go through service role, Realtime needs SELECT policy)
ALTER TABLE board_comments ENABLE ROW LEVEL SECURITY;

-- SELECT: any authenticated user can receive Realtime events (access checked at API level)
CREATE POLICY "board_comments_select" ON board_comments
  FOR SELECT TO authenticated USING (true);

-- Enable Supabase Realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE board_comments;

-- Migrate existing JSONB comments into the new table
INSERT INTO board_comments (id, board_id, owner_id, user_id, user_name, user_avatar, text, item_id, parent_id, mentions, created_at)
SELECT
  -- Use existing UUID if valid, otherwise generate one
  CASE
    WHEN (c->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (c->>'id')::uuid
    ELSE gen_random_uuid()
  END AS id,
  bd.local_board_id AS board_id,
  bd.owner_id,
  CASE
    WHEN (c->>'userId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (c->>'userId')::uuid
    ELSE bd.owner_id
  END AS user_id,
  COALESCE(c->>'userName', 'Anonymous') AS user_name,
  c->>'userAvatar' AS user_avatar,
  COALESCE(c->>'text', '') AS text,
  c->>'itemId' AS item_id,
  CASE
    WHEN (c->>'parentId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (c->>'parentId')::uuid
    ELSE NULL
  END AS parent_id,
  COALESCE(c->'mentions', '[]'::jsonb) AS mentions,
  COALESCE((c->>'createdAt')::timestamptz, now()) AS created_at
FROM board_documents bd,
     jsonb_array_elements(bd.comments) AS c
WHERE bd.comments IS NOT NULL
  AND bd.comments != '[]'::jsonb
  AND jsonb_array_length(bd.comments) > 0;
