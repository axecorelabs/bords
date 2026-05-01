-- ─────────────────────────────────────────────────────────────
--  Messaging system
--  Supports: org group channels, personal group chats, 1:1 DMs
-- ─────────────────────────────────────────────────────────────

-- Conversations (group channels OR direct messages)
CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            TEXT NOT NULL CHECK (type IN ('dm', 'group')),
  -- For org group channels
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  -- For personal group chats (scoped to workspace)
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name            TEXT,           -- group name (null for DMs)
  description     TEXT,
  avatar_url      TEXT,
  created_by      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_org   ON conversations(organization_id);
CREATE INDEX idx_conversations_ws    ON conversations(workspace_id);
CREATE INDEX idx_conversations_type  ON conversations(type);

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- Conversation members
CREATE TABLE conversation_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, user_id)
);

CREATE INDEX idx_conv_members_conv ON conversation_members(conversation_id);
CREATE INDEX idx_conv_members_user ON conversation_members(user_id);

-- Messages
CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content         TEXT,           -- null if message is attachment-only
  reply_to_id     UUID REFERENCES messages(id) ON DELETE SET NULL,
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_conv      ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender    ON messages(sender_id);
CREATE INDEX idx_messages_reply     ON messages(reply_to_id);

-- Message attachments (files/images via Supabase Storage)
CREATE TABLE message_attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_name       TEXT NOT NULL,
  file_size       INTEGER,
  mime_type       TEXT,
  storage_path    TEXT NOT NULL,  -- path in supabase storage bucket
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_msg_attachments_msg ON message_attachments(message_id);

-- Message reactions
CREATE TABLE message_reactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emoji           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX idx_msg_reactions_msg  ON message_reactions(message_id);
CREATE INDEX idx_msg_reactions_user ON message_reactions(user_id);

-- Read receipts (per-user last-read position in a conversation)
CREATE TABLE conversation_reads (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX idx_conv_reads_user ON conversation_reads(user_id);

-- ─────────────────────────────────────────────────────────────
--  RLS Policies
-- ─────────────────────────────────────────────────────────────

ALTER TABLE conversations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages                ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_attachments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_reads      ENABLE ROW LEVEL SECURITY;

-- Conversations: visible to members
CREATE POLICY "conv_select" ON conversations FOR SELECT
  USING (
    id IN (
      SELECT conversation_id FROM conversation_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "conv_insert" ON conversations FOR INSERT
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "conv_update" ON conversations FOR UPDATE
  USING (
    created_by = auth.uid() OR
    id IN (
      SELECT conversation_id FROM conversation_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Conversation members: visible to fellow members
CREATE POLICY "conv_members_select" ON conversation_members FOR SELECT
  USING (
    conversation_id IN (
      SELECT conversation_id FROM conversation_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "conv_members_insert" ON conversation_members FOR INSERT
  WITH CHECK (
    conversation_id IN (
      SELECT conversation_id FROM conversation_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
    OR user_id = auth.uid()
  );

CREATE POLICY "conv_members_delete" ON conversation_members FOR DELETE
  USING (user_id = auth.uid());

-- Messages: visible to conversation members
CREATE POLICY "messages_select" ON messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT conversation_id FROM conversation_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "messages_insert" ON messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid() AND
    conversation_id IN (
      SELECT conversation_id FROM conversation_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "messages_update" ON messages FOR UPDATE
  USING (sender_id = auth.uid());

-- Attachments: follow message visibility
CREATE POLICY "attachments_select" ON message_attachments FOR SELECT
  USING (
    message_id IN (
      SELECT id FROM messages WHERE conversation_id IN (
        SELECT conversation_id FROM conversation_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "attachments_insert" ON message_attachments FOR INSERT
  WITH CHECK (
    message_id IN (
      SELECT id FROM messages WHERE sender_id = auth.uid()
    )
  );

-- Reactions: visible to conversation members
CREATE POLICY "reactions_select" ON message_reactions FOR SELECT
  USING (
    message_id IN (
      SELECT id FROM messages WHERE conversation_id IN (
        SELECT conversation_id FROM conversation_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "reactions_insert" ON message_reactions FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "reactions_delete" ON message_reactions FOR DELETE
  USING (user_id = auth.uid());

-- Reads: own rows only
CREATE POLICY "reads_select" ON conversation_reads FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "reads_upsert" ON conversation_reads FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "reads_update" ON conversation_reads FOR UPDATE
  USING (user_id = auth.uid());
