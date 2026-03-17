-- Workspaces: container for boards (personal or organization)
CREATE TABLE workspaces (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT 'Personal Workspace',
  type       TEXT NOT NULL DEFAULT 'personal' CHECK (type IN ('personal', 'organization_container')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);

CREATE TRIGGER workspaces_updated_at
  BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
