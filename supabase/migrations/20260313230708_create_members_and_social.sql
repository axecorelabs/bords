-- Members, Friends, Invitations (social/collaboration tables)

-- Board members (role-based access within a bord)
CREATE TABLE bord_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bord_id     UUID NOT NULL REFERENCES bords(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor')),
  can_publish BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_employees BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bord_id, user_id)
);

CREATE INDEX idx_bord_members_bord ON bord_members(bord_id);
CREATE INDEX idx_bord_members_user ON bord_members(user_id);

-- Friends (per-workspace friend list)
CREATE TABLE friends (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  friend_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  email          TEXT,
  nickname       TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, friend_user_id)
);

CREATE INDEX idx_friends_workspace ON friends(workspace_id);
CREATE INDEX idx_friends_owner ON friends(owner_id);

-- Invitations (organization employee or board collaborator invitations)
CREATE TABLE invitations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email             TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('employee', 'collaborator')),
  bord_id           UUID REFERENCES bords(id) ON DELETE SET NULL,
  collaborator_role TEXT CHECK (collaborator_role IN ('viewer', 'editor')),
  invited_by        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  token             TEXT NOT NULL UNIQUE,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invitations_org ON invitations(organization_id);
CREATE INDEX idx_invitations_email_status ON invitations(email, organization_id, status);
CREATE INDEX idx_invitations_expires ON invitations(expires_at);
