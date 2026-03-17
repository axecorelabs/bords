-- Bords: lightweight board metadata
CREATE TABLE bords (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_board_id    TEXT NOT NULL,
  owner_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title             TEXT NOT NULL DEFAULT 'Untitled',
  context_type      TEXT NOT NULL DEFAULT 'personal' CHECK (context_type IN ('personal', 'organization')),
  organization_id   UUID REFERENCES organizations(id) ON DELETE SET NULL,
  last_published_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(owner_id, local_board_id)
);

CREATE INDEX idx_bords_owner ON bords(owner_id);
CREATE INDEX idx_bords_org ON bords(organization_id);

CREATE TRIGGER bords_updated_at
  BEFORE UPDATE ON bords
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- Bord access list: who can access each board and at what level
CREATE TABLE bord_access_list (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bord_id    UUID NOT NULL REFERENCES bords(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('owner', 'edit', 'view')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(bord_id, user_id)
);

CREATE INDEX idx_bord_access_bord ON bord_access_list(bord_id);
CREATE INDEX idx_bord_access_user ON bord_access_list(user_id);
