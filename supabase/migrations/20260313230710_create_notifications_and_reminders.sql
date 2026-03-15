-- Notifications & sent reminders

-- Notifications (user notification feed)
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN (
    'task_assigned', 'task_unassigned', 'task_reassigned', 'task_completed', 'task_updated',
    'org_invitation', 'invitation_accepted',
    'friend_request', 'friend_accepted', 'friend_removed',
    'reminder_due', 'reminder_overdue'
  )),
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  metadata   JSONB DEFAULT '{}'::jsonb,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_read ON notifications(user_id, is_read, created_at DESC);

-- Sent reminders (deduplication for email reminders)
CREATE TABLE sent_reminders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key             TEXT NOT NULL,
  board_doc_id    TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('checklist', 'kanban', 'reminder')),
  item_id         TEXT NOT NULL,
  interval_label  TEXT NOT NULL CHECK (interval_label IN ('30 minutes', '10 minutes', '5 minutes', 'overdue', 'manual')),
  recipient_email TEXT NOT NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_by         TEXT NOT NULL CHECK (sent_by IN ('client', 'cron'))
);

CREATE INDEX idx_sent_reminders_key ON sent_reminders(key, sent_at DESC);
CREATE INDEX idx_sent_reminders_board ON sent_reminders(board_doc_id);

-- Auto-delete sent reminders after 48 hours (requires pg_cron or app-level cleanup)
-- Note: PostgreSQL doesn't have native TTL like MongoDB.
-- Use a cron job or Supabase pg_cron extension to periodically clean up:
--   DELETE FROM sent_reminders WHERE sent_at < NOW() - INTERVAL '48 hours';

-- Board metadata (denormalized store used by collab server for search/deadlines/mentions)
CREATE TABLE board_metadata (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id          TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL DEFAULT 'Untitled Board',
  owner_id          TEXT NOT NULL,
  item_counts       JSONB DEFAULT '{}'::jsonb,
  deadlines         JSONB DEFAULT '[]'::jsonb,
  mentions          JSONB DEFAULT '[]'::jsonb,
  searchable_text   JSONB DEFAULT '{}'::jsonb,
  background_image  TEXT,
  background_color  TEXT,
  last_modified_at  TIMESTAMPTZ DEFAULT NOW(),
  last_modified_by  TEXT,
  schema_version    INTEGER DEFAULT 1,
  fingerprints      JSONB DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_board_metadata_owner ON board_metadata(owner_id, last_modified_at DESC);

-- Calls (video call sessions per board)
CREATE TABLE calls (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id               TEXT NOT NULL,
  room_name              TEXT NOT NULL UNIQUE,
  started_by             JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at               TIMESTAMPTZ,
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  participants           JSONB DEFAULT '[]'::jsonb,
  peak_participant_count INTEGER NOT NULL DEFAULT 1,
  metadata               JSONB DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER calls_updated_at
  BEFORE UPDATE ON calls
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE INDEX idx_calls_board_status ON calls(board_id, status);
