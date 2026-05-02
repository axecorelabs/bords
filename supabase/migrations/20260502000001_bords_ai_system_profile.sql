-- ─── Bords AI system profile ──────────────────────────────────────────────────
-- Creates a deterministic virtual profile for the Bords AI agent.
-- This profile is not a real auth user; it is referenced only in the
-- profiles table so it can be surfaced as a conversation participant.
--
-- The UUID is fixed so the application can reference it as a constant.
-- 00000000-0000-0000-0000-000000000001

-- Insert a synthetic auth.users row so the FK constraint is satisfied.
-- The account has no password and cannot be used to log in.
INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  role,
  aud
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'ai@bords.app',
  '',                          -- no password — account cannot authenticate
  now(),
  now(),
  now(),
  'authenticated',
  'authenticated'
)
ON CONFLICT (id) DO NOTHING;

-- Insert the AI system profile if it does not already exist.
INSERT INTO profiles (id, first_name, last_name, email, image)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Bords',
  'AI',
  'ai@bords.app',
  NULL
)
ON CONFLICT (id) DO NOTHING;

-- ─── is_ai_conversation flag on conversations ──────────────────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_ai_conversation BOOLEAN NOT NULL DEFAULT FALSE;

-- Index so the app can quickly find the AI conversation for a given user+org combo.
CREATE INDEX IF NOT EXISTS idx_conversations_ai
  ON conversations (is_ai_conversation, organization_id)
  WHERE is_ai_conversation = TRUE;

-- ─── is_ai_message flag on messages ───────────────────────────────────────────
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS is_ai_message BOOLEAN NOT NULL DEFAULT FALSE;
