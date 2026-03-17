-- Board documents: full board content (JSONB for flexible embedded data)
CREATE TABLE board_documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  local_board_id   TEXT NOT NULL,
  workspace_id     UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  title            TEXT NOT NULL DEFAULT 'Untitled Board',
  visibility       TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public', 'shared')),

  -- Board content arrays (JSONB — flexible, queryable, no 16MB limit)
  checklists       JSONB NOT NULL DEFAULT '[]',
  kanban_boards    JSONB NOT NULL DEFAULT '[]',
  sticky_notes     JSONB NOT NULL DEFAULT '[]',
  media_items      JSONB NOT NULL DEFAULT '[]',
  text_elements    JSONB NOT NULL DEFAULT '[]',
  drawings         JSONB NOT NULL DEFAULT '[]',
  comments         JSONB NOT NULL DEFAULT '[]',
  connections      JSONB NOT NULL DEFAULT '[]',
  reminders        JSONB NOT NULL DEFAULT '[]',
  tables           JSONB NOT NULL DEFAULT '[]',
  native_tldraw    JSONB,

  -- Settings
  connection_line_settings JSONB NOT NULL DEFAULT '{}',
  grid_settings            JSONB NOT NULL DEFAULT '{}',
  theme_settings           JSONB NOT NULL DEFAULT '{}',
  z_index_data             JSONB NOT NULL DEFAULT '{}',

  -- Sharing
  shared_with      JSONB NOT NULL DEFAULT '[]',
  share_token      TEXT UNIQUE,
  public_url       TEXT,

  -- Background
  background_type       TEXT DEFAULT 'color',
  background_value      TEXT DEFAULT '#1a1a2e',
  background_opacity    FLOAT DEFAULT 1.0,
  custom_background_image TEXT,

  -- Context
  context_type     TEXT NOT NULL DEFAULT 'personal' CHECK (context_type IN ('personal', 'organization')),
  organization_id  UUID REFERENCES organizations(id) ON DELETE SET NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(owner_id, local_board_id)
);

CREATE INDEX idx_board_docs_owner ON board_documents(owner_id);
CREATE INDEX idx_board_docs_share_token ON board_documents(share_token) WHERE share_token IS NOT NULL;
CREATE INDEX idx_board_docs_visibility ON board_documents(visibility);

CREATE TRIGGER board_documents_updated_at
  BEFORE UPDATE ON board_documents
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
