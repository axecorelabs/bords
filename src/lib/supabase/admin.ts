import { createClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS.
// Use for: cron jobs, webhooks, collab server, cross-user operations.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
