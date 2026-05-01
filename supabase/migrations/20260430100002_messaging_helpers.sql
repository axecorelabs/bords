-- Helper function: find an existing DM conversation between two users
-- (optionally scoped to an org)
CREATE OR REPLACE FUNCTION find_dm_conversation(
  user_a UUID,
  user_b UUID,
  p_org_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT c.id
  FROM conversations c
  WHERE c.type = 'dm'
    AND (p_org_id IS NULL OR c.organization_id = p_org_id)
    AND EXISTS (
      SELECT 1 FROM conversation_members WHERE conversation_id = c.id AND user_id = user_a
    )
    AND EXISTS (
      SELECT 1 FROM conversation_members WHERE conversation_id = c.id AND user_id = user_b
    )
    AND (
      SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id
    ) = 2
  LIMIT 1
$$;
