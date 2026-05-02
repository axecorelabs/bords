-- AI plan artifacts: draft/review lifecycle for human-approved execution

CREATE TABLE IF NOT EXISTS ai_plan_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected', 'applied')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_plan_artifacts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ai_plan_artifacts_conversation
  ON ai_plan_artifacts (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_plan_artifacts_user
  ON ai_plan_artifacts (user_id, created_at DESC);

CREATE TRIGGER ai_plan_artifacts_updated_at
  BEFORE UPDATE ON ai_plan_artifacts
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
