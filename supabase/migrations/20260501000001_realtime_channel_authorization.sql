-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime Channel Authorization
--
-- Supabase Broadcast channels are public by default — any authenticated user
-- who knows a channel name can subscribe and receive events.
--
-- Enabling RLS on realtime.messages and adding policies makes channels "private":
--   • conversation:{uuid} → only members of that conversation can subscribe
--   • user:{uuid}         → only the owner of that user ID can subscribe
--
-- The server-side service role bypasses RLS entirely, so it can still broadcast
-- via the REST API. Clients with the anon key are restricted by these policies.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable RLS on the Realtime messages table (controls channel subscriptions)
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- ── Receive policies (who can subscribe / receive from a channel) ──────────

-- conversation:{uuid}: only members of that conversation
CREATE POLICY "conv_channel_read" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    extension = 'broadcast'
    AND topic LIKE 'conversation:%'
    AND EXISTS (
      SELECT 1
      FROM public.conversation_members
      WHERE conversation_id = SPLIT_PART(topic, ':', 2)::uuid
        AND user_id = auth.uid()
    )
  );

-- user:{uuid}: only the owner of that user ID
CREATE POLICY "user_channel_read" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    extension = 'broadcast'
    AND topic = 'user:' || auth.uid()::text
  );

-- ── Insert policy: block clients from broadcasting directly ───────────────
-- Without an INSERT policy, RLS denies all inserts for the authenticated role.
-- The server uses the service role (which bypasses RLS) — so this is correct.
-- No INSERT policy needed; the default-deny covers it.
