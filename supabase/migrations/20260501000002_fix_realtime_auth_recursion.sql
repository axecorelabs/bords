-- Fix recursive RLS deadlock in Realtime channel authorization.
--
-- The conv_channel_read policy on realtime.messages queried
-- public.conversation_members directly, which triggered its own self-referential
-- RLS policy (conv_members_select). Postgres's recursion guard silently returns
-- empty, so every channel subscription was denied.
--
-- Solution: wrap the membership check in a SECURITY DEFINER function so it runs
-- as the function owner and skips RLS on conversation_members entirely.

CREATE OR REPLACE FUNCTION public.is_conversation_member(conv_id uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = conv_id
      AND user_id = uid
  );
$$;

-- Re-create the conversation channel policy to use the helper
DROP POLICY IF EXISTS "conv_channel_read" ON realtime.messages;

CREATE POLICY "conv_channel_read" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    extension = 'broadcast'
    AND topic LIKE 'conversation:%'
    AND public.is_conversation_member(
      SPLIT_PART(topic, ':', 2)::uuid,
      auth.uid()
    )
  );
