-- Ensure authenticated users can execute the membership helper
-- used by realtime.messages RLS policy.
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) TO service_role;
