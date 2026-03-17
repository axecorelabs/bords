# Bords: MongoDB → Supabase Migration Plan

> Full step-by-step migration from MongoDB/Mongoose to Supabase (PostgreSQL + Auth + Storage + Realtime).

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Phase 0 — Setup & Tooling](#2-phase-0--setup--tooling)
3. [Phase 1 — Schema Design (PostgreSQL Tables)](#3-phase-1--schema-design-postgresql-tables)
4. [Phase 2 — Authentication Migration](#4-phase-2--authentication-migration)
5. [Phase 3 — Core Data Models Migration](#5-phase-3--core-data-models-migration)
6. [Phase 4 — Board Content & CRDT Storage](#6-phase-4--board-content--crdt-storage)
7. [Phase 5 — API Route Rewrites](#7-phase-5--api-route-rewrites)
8. [Phase 6 — Collab Server Migration](#8-phase-6--collab-server-migration)
9. [Phase 7 — File Storage Migration](#9-phase-7--file-storage-migration)
10. [Phase 8 — Cron Jobs & Background Tasks](#10-phase-8--cron-jobs--background-tasks)
11. [Phase 9 — Client-Side Store Updates](#11-phase-9--client-side-store-updates)
12. [Phase 10 — Data Migration Script](#12-phase-10--data-migration-script)
13. [Phase 11 — Testing & Validation](#13-phase-11--testing--validation)
14. [Phase 12 — Deployment & Cutover](#14-phase-12--deployment--cutover)
15. [Risk Register](#15-risk-register)
16. [Appendix: Full Route Inventory](#16-appendix-full-route-inventory)

---

## 1. Architecture Overview

### Current Stack
| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router) on Vercel |
| Auth | NextAuth v4 (JWT strategy, MongoDB user store) |
| Database | MongoDB Atlas (Mongoose ODM) |
| Collab Server | Fastify + Hocuspocus on Render (port 4444) |
| CRDT | Y.js + y-indexeddb + HocuspocusProvider |
| File Storage | Wasabi S3 (eu-central-1) |
| Email | ZeptoMail SMTP |
| Payments | Paystack (NGN) |
| Video Calls | LiveKit |
| State | Zustand (15 stores, persist to localStorage) |

### Target Stack
| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router) on Vercel — **unchanged** |
| Auth | **Supabase Auth** (replaces NextAuth) |
| Database | **Supabase PostgreSQL** (replaces MongoDB) |
| Collab Server | Fastify + Hocuspocus on Render — **keep, swap DB layer** |
| CRDT | Y.js + y-indexeddb + HocuspocusProvider — **unchanged** |
| File Storage | **Supabase Storage** (replaces Wasabi) — *or keep Wasabi* |
| Email | ZeptoMail SMTP — **unchanged** |
| Payments | Paystack — **unchanged** |
| Video Calls | LiveKit — **unchanged** |
| State | Zustand — **unchanged** |

### Key Decisions to Make Before Starting

| Decision | Options | Choice |
|----------|---------|--------|
| DB Access | Drizzle ORM vs Prisma vs `@supabase/supabase-js` | **`supabase-js`** — RLS enforces auth, HTTP = no connection pooling issues on Vercel, one client for Auth+DB+Storage |
| Schema Migrations | Drizzle-kit vs Supabase CLI | **Supabase CLI** (`supabase migration new` + `supabase db push`) |
| Transactions | ORM transactions vs PG functions | **PostgreSQL functions** via `supabase.rpc()` — for atomic multi-write operations (publish flow, invitation accept) |
| File Storage | Supabase Storage vs keep Wasabi | **Supabase Storage** — consolidate services |
| Auth Session | Supabase Auth vs keep NextAuth with Supabase adapter | **Supabase Auth** — native RLS, simpler |
| Collab Auth | Keep JWE tickets or switch to Supabase JWT | **Keep JWE tickets** — isolated collab auth is good |
| Migration Strategy | Big-bang cutover vs gradual (dual-write) | **Big-bang with maintenance window** — simpler for this scale |

### Client Usage Pattern

| Context | Client | Why |
|---------|--------|-----|
| API routes (Vercel) | `createClient()` (user's JWT, from `@supabase/ssr`) | RLS enforces access automatically |
| Cron jobs, webhooks | `supabaseAdmin` (service role key) | Cross-user access, bypasses RLS |
| Collab server (Render) | `supabaseAdmin` (service role key) | Server-to-server, needs full access |
| Atomic multi-writes | `supabase.rpc('function_name', params)` | Transactions inside PG functions |
| Auth pages (browser) | `createBrowserClient()` | Client-side auth flows |

---

## 2. Phase 0 — Setup & Tooling

### 0.1 Create Supabase Project
- [ ] Create project at [supabase.com](https://supabase.com)
- [ ] Note: Project URL, Anon Key, Service Role Key, DB connection string
- [ ] Enable required extensions in SQL editor:
  ```sql
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";
  CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- for text search
  ```

### 0.2 Install Dependencies (Frontend)

```bash
# Remove (after migration is complete)
npm uninstall mongoose @aws-sdk/client-s3

# Install
npm install @supabase/supabase-js @supabase/ssr
```

No ORM needed — `@supabase/supabase-js` handles all DB access via HTTP (PostgREST).

### 0.3 Install Dependencies (Collab Server)

```bash
# In /Bords server/server/
# Keep mongoose temporarily (for data migration), then remove
npm install @supabase/supabase-js
```

### 0.4 Project Structure — New Files

```
src/
├── lib/
│   ├── supabase/
│   │   ├── server.ts         # Server-side Supabase client (API routes)
│   │   ├── client.ts         # Browser-side Supabase client
│   │   └── admin.ts          # Service role client (cron, webhooks)
│   └── ...
supabase/
├── config.toml               # Supabase CLI config (already created)
├── migrations/               # SQL migration files (version controlled)
│   ├── 00001_extensions.sql
│   ├── 00002_profiles.sql
│   ├── 00003_workspaces.sql
│   ├── ...etc
├── seed.sql                  # Seed data (plans)
└── functions/                # PostgreSQL functions (for transactions)
```

### 0.5 Environment Variables

**Remove:**
```env
MONGODB_URI=...
WASABI_ENDPOINT=...
WASABI_REGION=...
WASABI_BUCKET_NAME=...
WASABI_ACCESS_KEY_ID=...
WASABI_SECRET_ACCESS_KEY=...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=...
```

**Add:**
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

No `DATABASE_URL` needed — `supabase-js` connects via HTTP, not a direct PG connection.

**Keep (unchanged):**
```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
COLLAB_SERVER_URL=...
COLLAB_ENCRYPTION_SECRET=...
ZEPTOMAIL_USER=...
ZEPTOMAIL_PASS=...
PAYSTACK_SECRET_KEY=...
PAYSTACK_PUBLIC_KEY=...
CRON_SECRET=...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
NEXT_PUBLIC_LIVEKIT_URL=...
```

### 0.6 Supabase CLI (Already Done)

```bash
supabase init          # ✅ Done — created supabase/ folder
supabase link          # ✅ Done — linked to project rjymxorfchikqdpysokh
```

Migrations are created with:
```bash
supabase migration new <migration_name>
# Edit the generated .sql file
supabase db push       # Push to remote Supabase
```

---

## 3. Phase 1 — Schema Design (PostgreSQL Tables)

### Overview: 22 Mongoose Models → ~20 PostgreSQL Tables

The schema below maps every existing MongoDB model to PostgreSQL, preserving all fields and relationships while adding proper constraints.

---

### 1.1 `profiles` (replaces User model)

> Supabase Auth manages `auth.users`. This table extends it with app-specific fields.

```sql
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT UNIQUE NOT NULL,
  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT NOT NULL DEFAULT '',
  image         TEXT,
  provider      TEXT NOT NULL DEFAULT 'credentials' CHECK (provider IN ('credentials', 'google')),
  provider_id   TEXT,
  mfa_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  login_attempts INTEGER NOT NULL DEFAULT 0,
  lock_until    TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  last_login_ip INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
```

**Migration Note:** `user._id` (ObjectId) → `profiles.id` (UUID from Supabase Auth). All foreign keys referencing users change from ObjectId to UUID. Need a mapping table during migration.

---

### 1.2 `workspaces`

```sql
CREATE TABLE workspaces (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT 'Personal Workspace',
  type       TEXT NOT NULL DEFAULT 'personal' CHECK (type IN ('personal', 'organization_container')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);
```

---

### 1.3 `organizations`

```sql
CREATE TABLE organizations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  owner_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_organizations_owner ON organizations(owner_id);
```

---

### 1.4 `employee_memberships`

```sql
CREATE TABLE employee_memberships (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, organization_id)
);
```

---

### 1.5 `bords` (board metadata)

```sql
CREATE TABLE bords (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
```

---

### 1.6 `bord_access_list` (extracted from embedded array)

```sql
CREATE TABLE bord_access_list (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bord_id    UUID NOT NULL REFERENCES bords(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('owner', 'edit', 'view')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(bord_id, user_id)
);

CREATE INDEX idx_bord_access_bord ON bord_access_list(bord_id);
CREATE INDEX idx_bord_access_user ON bord_access_list(user_id);
```

---

### 1.7 `board_documents` (board content — use JSONB for embedded arrays)

```sql
CREATE TABLE board_documents (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  local_board_id   TEXT NOT NULL,
  workspace_id     UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  title            TEXT NOT NULL DEFAULT 'Untitled Board',
  visibility       TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public', 'shared')),

  -- Board content - JSONB columns for flexible embedded data
  checklists       JSONB NOT NULL DEFAULT '[]',
  kanban_boards    JSONB NOT NULL DEFAULT '[]',
  sticky_notes     JSONB NOT NULL DEFAULT '[]',
  media_items      JSONB NOT NULL DEFAULT '[]',
  text_elements    JSONB NOT NULL DEFAULT '[]',
  drawings         JSONB NOT NULL DEFAULT '[]',
  comments         JSONB NOT NULL DEFAULT '[]',
  connections      JSONB NOT NULL DEFAULT '[]',
  reminders        JSONB NOT NULL DEFAULT '[]',
  tables           JSONB NOT NULL DEFAULT '[]',
  native_tldraw    JSONB,  -- opaque tldraw state blob

  -- Settings
  connection_line_settings JSONB NOT NULL DEFAULT '{}',
  grid_settings            JSONB NOT NULL DEFAULT '{}',
  theme_settings           JSONB NOT NULL DEFAULT '{}',
  z_index_data             JSONB NOT NULL DEFAULT '{}',

  -- Sharing
  shared_with      JSONB NOT NULL DEFAULT '[]',
  share_token      TEXT UNIQUE,
  public_url       TEXT,

  -- Background
  background_type  TEXT DEFAULT 'color',
  background_value TEXT DEFAULT '#1a1a2e',
  background_opacity FLOAT DEFAULT 1.0,
  custom_background_image TEXT,

  -- Context
  context_type     TEXT NOT NULL DEFAULT 'personal' CHECK (context_type IN ('personal', 'organization')),
  organization     UUID REFERENCES organizations(id) ON DELETE SET NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(owner_id, local_board_id)
);

CREATE INDEX idx_board_docs_owner ON board_documents(owner_id);
CREATE INDEX idx_board_docs_share_token ON board_documents(share_token) WHERE share_token IS NOT NULL;
CREATE INDEX idx_board_docs_visibility ON board_documents(visibility);
```

**Why JSONB for content arrays:** These arrays contain tldraw shapes, checklist items, kanban columns etc. Their schemas vary and are primarily read/written as whole blobs via Y.Doc sync. JSONB preserves the document flexibility without hitting the 16MB limit (PostgreSQL JSONB limit is 255 MB). Individual items can still be queried with JSONB operators when needed (e.g., cron job scanning for due dates).

---

### 1.8 `yjs_documents` (CRDT binary state)

```sql
CREATE TABLE yjs_documents (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id          TEXT UNIQUE NOT NULL,
  state             BYTEA,  -- Y.Doc binary state (no 16MB limit)
  state_vector      BYTEA,
  version           INTEGER NOT NULL DEFAULT 0,
  last_modified_by  TEXT,
  connected_clients INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### 1.9 `bord_members`

```sql
CREATE TABLE bord_members (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bord_id         UUID NOT NULL REFERENCES bords(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor')),
  can_publish     BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_employees BOOLEAN NOT NULL DEFAULT FALSE,
  added_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(bord_id, user_id)
);
```

---

### 1.10 `task_assignments`

```sql
CREATE TABLE task_assignments (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bord_id          UUID NOT NULL REFERENCES bords(id) ON DELETE CASCADE,
  board_doc_id     UUID NOT NULL REFERENCES board_documents(id) ON DELETE CASCADE,
  item_id          TEXT NOT NULL,   -- local ID of the checklist/kanban/reminder item
  source           TEXT NOT NULL CHECK (source IN ('note', 'checklist_item', 'kanban_task', 'reminder_item')),
  title            TEXT NOT NULL,
  description      TEXT,

  assigned_to      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_by      UUID NOT NULL REFERENCES profiles(id),
  organization_id  UUID REFERENCES organizations(id) ON DELETE SET NULL,

  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'assigned', 'completed')),
  published_at     TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,

  -- Kanban context
  kanban_board_id  TEXT,
  column_id        TEXT,
  available_columns JSONB,

  -- Employee updates
  employee_note    TEXT,
  employee_status  TEXT,

  -- Checklist context
  checklist_id     TEXT,
  parent_note_id   TEXT,

  -- Dates
  due_date         TIMESTAMPTZ,

  version          INTEGER NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_assignments_bord ON task_assignments(bord_id);
CREATE INDEX idx_assignments_assigned_to ON task_assignments(assigned_to);
CREATE INDEX idx_assignments_status ON task_assignments(status);
CREATE INDEX idx_assignments_item ON task_assignments(item_id, source);
```

---

### 1.11 `publish_snapshots`

```sql
CREATE TABLE publish_snapshots (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bord_id             UUID NOT NULL REFERENCES bords(id) ON DELETE CASCADE,
  published_by        UUID NOT NULL REFERENCES profiles(id),
  version             INTEGER NOT NULL DEFAULT 1,
  new_count           INTEGER NOT NULL DEFAULT 0,
  reassignment_count  INTEGER NOT NULL DEFAULT 0,
  unassignment_count  INTEGER NOT NULL DEFAULT 0,
  details             JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_publish_snapshots_bord ON publish_snapshots(bord_id);
```

---

### 1.12 `unpublished_change_tracker`

```sql
CREATE TABLE unpublished_change_tracker (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bord_id    UUID UNIQUE NOT NULL REFERENCES bords(id) ON DELETE CASCADE,
  changes    JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### 1.13 `friends`

```sql
CREATE TABLE friends (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(requester_id, addressee_id)
);

CREATE INDEX idx_friends_addressee ON friends(addressee_id);
```

---

### 1.14 `invitations`

```sql
CREATE TABLE invitations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_by      UUID NOT NULL REFERENCES profiles(id),
  email           TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'collaborator')),
  bord_id         UUID REFERENCES bords(id) ON DELETE CASCADE,
  token           TEXT UNIQUE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invitations_email ON invitations(email);
CREATE INDEX idx_invitations_org ON invitations(organization_id);
CREATE INDEX idx_invitations_token ON invitations(token);
```

---

### 1.15 `notifications`

```sql
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,  -- task_assigned, task_completed, org_invitation, friend_request, etc.
  title      TEXT NOT NULL,
  message    TEXT,
  metadata   JSONB NOT NULL DEFAULT '{}',
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE read = FALSE;
```

---

### 1.16 `plans`

```sql
CREATE TABLE plans (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  TEXT UNIQUE NOT NULL,
  slug                  TEXT UNIQUE NOT NULL,
  description           TEXT,
  price                 INTEGER NOT NULL DEFAULT 0,     -- in kobo (NGN)
  currency              TEXT NOT NULL DEFAULT 'NGN',
  interval              TEXT NOT NULL DEFAULT 'monthly' CHECK (interval IN ('monthly', 'yearly')),
  features              TEXT[] NOT NULL DEFAULT '{}',
  max_boards            INTEGER NOT NULL DEFAULT 3,     -- -1 = unlimited
  max_tasks_per_board   INTEGER NOT NULL DEFAULT 50,
  max_collaborators     INTEGER NOT NULL DEFAULT 0,
  max_organizations     INTEGER NOT NULL DEFAULT 0,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### 1.17 `subscriptions`

```sql
CREATE TABLE subscriptions (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id                UUID NOT NULL REFERENCES plans(id),
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'expired', 'past_due', 'trialing')),
  start_date             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date               TIMESTAMPTZ,
  trial_start            TIMESTAMPTZ,
  trial_end              TIMESTAMPTZ,
  canceled_at            TIMESTAMPTZ,
  cancellation_reason    TEXT,
  paystack_customer_code TEXT,
  paystack_subscription_code TEXT,
  paystack_email_token   TEXT,
  current_period_start   TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
```

---

### 1.18 `payments`

```sql
CREATE TABLE payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id         UUID REFERENCES plans(id),
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  amount          INTEGER NOT NULL,           -- in kobo
  currency        TEXT NOT NULL DEFAULT 'NGN',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'abandoned')),
  paystack_reference TEXT UNIQUE,
  paystack_access_code TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_user ON payments(user_id);
CREATE INDEX idx_payments_reference ON payments(paystack_reference);
```

---

### 1.19 `subscription_history`

```sql
CREATE TABLE subscription_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,  -- created, renewed, upgraded, downgraded, canceled, expired, payment_failed
  from_plan_id    UUID REFERENCES plans(id),
  to_plan_id      UUID REFERENCES plans(id),
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sub_history_user ON subscription_history(user_id);
```

---

### 1.20 `sent_reminders`

```sql
CREATE TABLE sent_reminders (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  composite_key  TEXT UNIQUE NOT NULL,  -- boardDocId::source::itemId::intervalLabel::recipientEmail
  board_doc_id   UUID REFERENCES board_documents(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-delete after 48 hours
-- Use pg_cron or Supabase cron: DELETE FROM sent_reminders WHERE created_at < NOW() - INTERVAL '48 hours';
```

---

### 1.21 Tables NOT Needed with Supabase Auth

These MongoDB models become **unnecessary** because Supabase Auth handles them natively:

| MongoDB Model | Supabase Equivalent |
|---|---|
| `Session` | Supabase manages sessions internally |
| `EmailVerificationToken` | Supabase Auth email confirmation flow |
| `PasswordResetToken` | Supabase Auth password reset flow |

---

### 1.22 Row Level Security (RLS) Policies

Enable RLS on ALL tables and write policies. Example for core tables:

```sql
-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE bords ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_documents ENABLE ROW LEVEL SECURITY;
-- ... (all tables)

-- Profiles: users can read any profile, update only their own
CREATE POLICY "Users can view all profiles" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Bords: owner or in access list
CREATE POLICY "Bord access" ON bords FOR SELECT USING (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM bord_access_list WHERE bord_id = bords.id AND user_id = auth.uid()
  )
);
CREATE POLICY "Bord owner can update" ON bords FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY "Bord owner can delete" ON bords FOR DELETE USING (owner_id = auth.uid());

-- Board Documents: same pattern
CREATE POLICY "Board doc access" ON board_documents FOR SELECT USING (
  owner_id = auth.uid()
  OR visibility = 'public'
  OR EXISTS (
    SELECT 1 FROM bord_access_list ba
    JOIN bords b ON ba.bord_id = b.id
    WHERE b.local_board_id = board_documents.local_board_id
      AND b.owner_id = board_documents.owner_id
      AND ba.user_id = auth.uid()
  )
);

-- Notifications: only own
CREATE POLICY "Own notifications" ON notifications FOR ALL USING (user_id = auth.uid());

-- Plans: public read
CREATE POLICY "Plans are public" ON plans FOR SELECT USING (true);
```

**Important:** API routes using the `service_role` key bypass RLS entirely, which is needed for cron jobs, webhooks, and cross-user operations.

---

## 4. Phase 2 — Authentication Migration

This is the **highest-impact change** — touches every API route and the entire session flow.

### 2.1 Remove NextAuth

**Delete:**
- `src/app/api/auth/[...nextauth]/route.ts`
- `src/app/api/auth/signup/route.ts`
- `src/app/api/auth/verify-email/route.ts`
- `src/app/api/auth/resend-verification/route.ts`
- `src/app/api/auth/forgot-password/route.ts`
- `src/app/api/auth/reset-password/route.ts`
- `src/components/AuthProvider.tsx` (NextAuth SessionProvider)
- All `next-auth` imports across the codebase

**Uninstall:**
```bash
npm uninstall next-auth
```

### 2.2 Create Supabase Client Utilities

**`src/lib/supabase/client.ts`** — Browser client:
```typescript
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

**`src/lib/supabase/server.ts`** — Server client (API routes, Server Components):
```typescript
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}
```

**`src/lib/supabase/admin.ts`** — Service role client (cron, webhooks):
```typescript
import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
```

### 2.3 Update Middleware

Replace `src/middleware.ts`:

```typescript
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const publicRoutes = ['/login', '/signup', '/forgot-password', '/reset-password',
  '/verify-email', '/pricing', '/shared'];
const publicApiRoutes = ['/api/cron/', '/api/subscription/plans',
  '/api/subscription/webhook', '/api/boards/public/'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip public routes
  if (publicRoutes.some(r => pathname.startsWith(r)) ||
      publicApiRoutes.some(r => pathname.startsWith(r)) ||
      pathname.startsWith('/_next') ||
      pathname.match(/\.(png|ico|svg)$/)) {
    return NextResponse.next();
  }

  // Refresh Supabase session
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user && !pathname.startsWith('/api/')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (!user && pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

### 2.4 Supabase Auth Configuration

In Supabase Dashboard → Authentication:
- [ ] Enable **Email** provider (with email confirmation)
- [ ] Enable **Google** OAuth provider (use existing Google Client ID/Secret)
- [ ] Set redirect URLs for OAuth
- [ ] Configure email templates (verification, password reset)
- [ ] Set password requirements (minimum 8 chars, etc.)

### 2.5 Rewrite Auth Pages

| Page | Old (NextAuth) | New (Supabase) |
|------|---------------|----------------|
| `src/app/login/page.tsx` | `signIn('credentials', ...)` | `supabase.auth.signInWithPassword(...)` + `supabase.auth.signInWithOAuth({ provider: 'google' })` |
| `src/app/signup/page.tsx` | POST to `/api/auth/signup` | `supabase.auth.signUp({ email, password, options: { data: { first_name, last_name } } })` |
| `src/app/forgot-password/page.tsx` | POST to `/api/auth/forgot-password` | `supabase.auth.resetPasswordForEmail(email)` |
| `src/app/reset-password/page.tsx` | POST to `/api/auth/reset-password` | `supabase.auth.updateUser({ password })` |
| `src/app/verify-email/page.tsx` | Token-based verification | Supabase handles via magic link/OTP |

### 2.6 Profile Auto-Creation via Database Trigger

When a user signs up through Supabase Auth, auto-create their profile and workspaces:

```sql
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Create profile
  INSERT INTO profiles (id, email, first_name, last_name, image, provider)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NULL),
    CASE WHEN NEW.raw_app_meta_data->>'provider' = 'google' THEN 'google' ELSE 'credentials' END
  );

  -- Create personal workspace
  INSERT INTO workspaces (owner_id, name, type)
  VALUES (NEW.id, 'Personal Workspace', 'personal');

  -- Create organization container workspace
  INSERT INTO workspaces (owner_id, name, type)
  VALUES (NEW.id, 'Organizations', 'organization_container');

  -- Create free subscription
  INSERT INTO subscriptions (user_id, plan_id, status)
  VALUES (NEW.id, (SELECT id FROM plans WHERE slug = 'free'), 'active');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

### 2.7 Account Locking

Supabase Auth doesn't natively support login attempt tracking. Two options:

**Option A (Recommended):** Use Supabase Auth hooks (Beta) to intercept login and check/increment `profiles.login_attempts`.

**Option B:** Handle in the login API route — after `signInWithPassword` fails, increment the counter; on success, reset it. Block login if `lock_until > NOW()`.

### 2.8 Session Access in API Routes

**Before (NextAuth):**
```typescript
import { getServerSession } from 'next-auth';
const session = await getServerSession(authOptions);
const userId = session?.user?.id;
```

**After (Supabase):**
```typescript
import { createClient } from '@/lib/supabase/server';
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
const userId = user?.id;
```

This pattern change affects **every single API route** (~62 files).

---

## 5. Phase 3 — Core Data Models Migration

No ORM schema files needed. Tables are defined in SQL migrations (Phase 1) and managed by the Supabase CLI. Type safety comes from auto-generated types.

### 3.1 Generate TypeScript Types

After pushing migrations, generate types from the database schema:

```bash
supabase gen types typescript --linked > src/types/supabase.ts
```

This gives you full type safety for all `supabase-js` queries:

```typescript
import { createClient } from '@/lib/supabase/server';

const supabase = await createClient();
const { data } = await supabase.from('bords').select('*').eq('owner_id', userId);
// data is fully typed: { id: string, local_board_id: string, title: string, ... }[]
```

Re-run `supabase gen types` whenever you add/change migrations.

### 3.2 Supabase Client Setup

Already created in Phase 2 (section 2.2):
- `src/lib/supabase/server.ts` — API routes (user JWT, RLS enforced)
- `src/lib/supabase/client.ts` — Browser (auth flows)
- `src/lib/supabase/admin.ts` — Cron/webhooks (service role, bypasses RLS)

### 3.3 Delete Mongoose Models (after API routes are rewritten)

Remove every file in `src/models/`:

- `User.ts` → replaced by `profiles` table + Supabase Auth
- `Session.ts` → handled by Supabase Auth
- `EmailVerificationToken.ts` → handled by Supabase Auth
- `PasswordResetToken.ts` → handled by Supabase Auth
- `Workspace.ts` → `src/db/schema/workspaces.ts`
- `Organization.ts` → `src/db/schema/workspaces.ts`
- `Bord.ts` → `src/db/schema/boards.ts`
- `BoardDocument.ts` → `src/db/schema/boards.ts`
- `YjsDocument.ts` → `src/db/schema/boards.ts`
- `BordMember.ts` → `src/db/schema/members.ts`
- `EmployeeMembership.ts` → `src/db/schema/members.ts`
- `TaskAssignment.ts` → `src/db/schema/tasks.ts`
- `PublishSnapshot.ts` → `src/db/schema/tasks.ts`
- `UnpublishedChangeTracker.ts` → `src/db/schema/tasks.ts`
- `Friend.ts` → `src/db/schema/social.ts`
- `Invitation.ts` → `src/db/schema/social.ts`
- `Notification.ts` → `src/db/schema/social.ts`
- `Plan.ts` → `src/db/schema/subscriptions.ts`
- `Subscription.ts` → `src/db/schema/subscriptions.ts`
- `Payment.ts` → `src/db/schema/subscriptions.ts`
- `SubscriptionHistory.ts` → `src/db/schema/subscriptions.ts`
- `SentReminder.ts` → `src/db/schema/reminders.ts`

Also delete:
- `src/lib/mongodb.ts` (Mongoose connection helper)

---

## 6. Phase 4 — Board Content & CRDT Storage

### 4.1 BoardDocument Content Strategy

The `board_documents` table stores 10 content arrays as JSONB columns. This preserves the current read/write pattern (save the whole blob) while enabling PostgreSQL queries.

**Reading board content:**
```typescript
const supabase = await createClient();
const { data: board } = await supabase
  .from('board_documents')
  .select('*')
  .eq('owner_id', userId)
  .eq('local_board_id', boardId)
  .single();
```

**Querying inside JSONB (for cron — use PG function or raw SQL via `supabase.rpc`):**
```sql
-- PG function for cron to find boards with upcoming deadlines
CREATE OR REPLACE FUNCTION find_boards_with_deadlines(window_start TIMESTAMPTZ, window_end TIMESTAMPTZ)
RETURNS TABLE(id UUID, owner_id UUID, checklists JSONB, kanban_boards JSONB, reminders JSONB) AS $$
BEGIN
  RETURN QUERY
  SELECT bd.id, bd.owner_id, bd.checklists, bd.kanban_boards, bd.reminders
  FROM board_documents bd
  WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(bd.checklists) c,
      jsonb_array_elements(c->'items') item
    WHERE (item->>'dueDate') IS NOT NULL
      AND (item->>'dueDate')::timestamptz BETWEEN window_start AND window_end
  )
  OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(bd.kanban_boards) kb,
      jsonb_array_elements(kb->'columns') col,
      jsonb_array_elements(col->'tasks') task
    WHERE (task->>'dueDate') IS NOT NULL
      AND (task->>'dueDate')::timestamptz BETWEEN window_start AND window_end
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Call from cron: `supabaseAdmin.rpc('find_boards_with_deadlines', { window_start, window_end })`

### 4.2 Y.Doc Binary State

The `yjs_documents` table stores Y.Doc state as `BYTEA`. Supabase returns BYTEA as base64 strings; decode in JS.

**Before (MongoDB):**
```typescript
const doc = await YjsDocument.findOne({ boardId });
const state = doc.state; // Buffer
```

**After (Supabase):**
```typescript
const { data: doc } = await supabaseAdmin
  .from('yjs_documents')
  .select('state')
  .eq('board_id', boardId)
  .single();

// Supabase returns BYTEA as base64 — decode it
const state = doc?.state ? Buffer.from(doc.state, 'base64') : null;
```

**Writing Y.Doc state:**
```typescript
const base64State = Buffer.from(yjsState).toString('base64');
await supabaseAdmin
  .from('yjs_documents')
  .upsert({
    board_id: boardId,
    state: base64State,
    version: newVersion,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'board_id' });
```

### 4.3 REST Save Endpoint Update

Update `src/app/api/boards/[boardId]/save-state/route.ts`:
- Replace Mongoose `YjsDocument.findOneAndUpdate()` → `supabase.from('yjs_documents').upsert()`
- Replace `Bord.findOne()` permission check → `supabase.from('bord_access_list').select()` (or rely on RLS)

---

## 7. Phase 5 — API Route Rewrites

### Strategy

Every API route follows the same transformation:
1. Replace `getServerSession(authOptions)` → `supabase.auth.getUser()`
2. Replace `connectToDatabase()` → remove (supabase-js connects via HTTP, no init needed)
3. Replace Mongoose queries → `supabase.from('table').select/insert/update/delete()`
4. Replace ObjectId references → UUID references
5. RLS handles authorization automatically — remove manual permission checks where possible
6. For multi-write operations → use `supabase.rpc()` with PG functions

### 5.1 Route-by-Route Rewrite Order

Rewrite in dependency order (referenced tables first):

**Batch 1 — Foundation (no dependencies):**
- [ ] `api/subscription/plans/route.ts` — Read plans
- [ ] `api/test-db/route.ts` — Health check
- [ ] `api/test-email/route.ts` — Email test (no DB change)

**Batch 2 — User & Workspace:**
- [ ] `api/user/plan/route.ts` — User plan lookup
- [ ] `api/workspaces/route.ts` — List/create workspaces
- [ ] `api/subscription/status/route.ts` — Subscription status
- [ ] `api/subscription/initialize-payment/route.ts`
- [ ] `api/subscription/verify-payment/route.ts`
- [ ] `api/subscription/webhook/route.ts` — Paystack webhook

**Batch 3 — Organizations & Social:**
- [ ] `api/organizations/route.ts` — CRUD organizations
- [ ] `api/organizations/[orgId]/route.ts`
- [ ] `api/organizations/[orgId]/employees/route.ts`
- [ ] `api/organizations/[orgId]/employees/[employeeId]/route.ts`
- [ ] `api/organizations/[orgId]/invitations/[invitationId]/route.ts`
- [ ] `api/invitations/[invitationId]/accept/route.ts`
- [ ] `api/invitations/by-token/[token]/route.ts`
- [ ] `api/workspaces/friends/route.ts`
- [ ] `api/workspaces/friends/[friendId]/route.ts`
- [ ] `api/workspaces/friends/[friendId]/accept/route.ts`
- [ ] `api/workspaces/friends/[friendId]/decline/route.ts`

**Batch 4 — Boards & Board Content:**
- [ ] `api/bords/route.ts` — List/create bords
- [ ] `api/bords/[bordId]/route.ts` — Get/update/delete bord
- [ ] `api/bords/[bordId]/access/route.ts` — Manage access list
- [ ] `api/boards/create/route.ts` — Legacy board creation
- [ ] `api/boards/sync/route.ts` — Board sync
- [ ] `api/boards/sync/check/route.ts`
- [ ] `api/boards/sync/[boardId]/route.ts`
- [ ] `api/boards/sync/[boardId]/share/route.ts`
- [ ] `api/boards/sync/all/route.ts`
- [ ] `api/boards/[boardId]/save-state/route.ts` — REST Y.Doc save
- [ ] `api/boards/[boardId]/comments/route.ts`
- [ ] `api/boards/[boardId]/comments/stream/route.ts` — SSE
- [ ] `api/boards/public/[token]/route.ts` — Public board viewer

**Batch 5 — Tasks & Assignments:**
- [ ] `api/bords/[bordId]/publish/route.ts` — Publish flow (use transactions!)
- [ ] `api/bords/[bordId]/assignments/route.ts`
- [ ] `api/bords/[bordId]/assignments/[assignmentId]/route.ts`
- [ ] `api/bords/[bordId]/assignments/owner-sync/route.ts`
- [ ] `api/assignments/personal/route.ts`
- [ ] `api/assignments/personal/[assignmentId]/route.ts`
- [ ] `api/personal/assignments/route.ts`
- [ ] `api/personal/assignments/[assignmentId]/route.ts`
- [ ] `api/personal/assignments/[assignmentId]/complete/route.ts`
- [ ] `api/personal/assignments/[assignmentId]/update/route.ts`
- [ ] `api/execution/tasks/route.ts`
- [ ] `api/execution/tasks/[taskId]/complete/route.ts`
- [ ] `api/execution/tasks/[taskId]/update/route.ts`

**Batch 6 — Notifications, Reminders, Media, Collab:**
- [ ] `api/notifications/route.ts`
- [ ] `api/reminders/send/route.ts`
- [ ] `api/send-reminder/route.ts`
- [ ] `api/send-board-reminder/route.ts`
- [ ] `api/media/upload/route.ts` — Update for Supabase Storage
- [ ] `api/media/delete/route.ts`
- [ ] `api/collab/ticket/route.ts` — Keep JWE, use Supabase `getUser()`
- [ ] `api/calls/token/route.ts` — LiveKit token generation
- [ ] `api/cron/check-reminders/route.ts` — Use service_role client
- [ ] `api/cron/check-subscriptions/route.ts`

### 5.2 Common Query Translation Patterns

**Find one document:**
```typescript
// Before (Mongoose)
const bord = await Bord.findById(bordId).populate('owner');

// After (Supabase) — embedded select replaces .populate()
const { data: bord } = await supabase
  .from('bords')
  .select('*, owner:profiles(*)')
  .eq('id', bordId)
  .single();
```

**Find with conditions:**
```typescript
// Before
const assignments = await TaskAssignment.find({
  assignedTo: userId,
  status: { $in: ['assigned', 'completed'] }
}).sort({ updatedAt: -1 });

// After
const { data: assignments } = await supabase
  .from('task_assignments')
  .select('*')
  .eq('assigned_to', userId)
  .in('status', ['assigned', 'completed'])
  .order('updated_at', { ascending: false });
```

**Create:**
```typescript
// Before
const bord = await Bord.create({ localBoardId, owner: userId, title });

// After
const { data: bord } = await supabase
  .from('bords')
  .insert({ local_board_id: localBoardId, owner_id: userId, title })
  .select()
  .single();
```

**Update:**
```typescript
// Before
await Bord.findByIdAndUpdate(bordId, { title: 'New Title' });

// After
await supabase
  .from('bords')
  .update({ title: 'New Title' })
  .eq('id', bordId);
```

**Delete:**
```typescript
// Before
await Bord.findByIdAndDelete(bordId);

// After
await supabase.from('bords').delete().eq('id', bordId);
// CASCADE handles bord_access_list, task_assignments, etc.
```

**Populate (JOIN) — embedded selects:**
```typescript
// Before
const invitations = await Invitation.find({ organizationId: orgId })
  .populate('invitedBy', 'firstName lastName email');

// After — PostgREST embedded select (foreign key auto-detected)
const { data: invitations } = await supabase
  .from('invitations')
  .select('*, invited_by:profiles(first_name, last_name, email)')
  .eq('organization_id', orgId);
```

**Transaction (NEW — PG function for atomic publish flow):**
```sql
-- In migration file: supabase/migrations/XXXXX_publish_function.sql
CREATE OR REPLACE FUNCTION publish_board(
  p_bord_id UUID,
  p_user_id UUID,
  p_version INT
) RETURNS void AS $$
BEGIN
  UPDATE bords SET last_published_at = NOW(), updated_at = NOW() WHERE id = p_bord_id;
  UPDATE task_assignments SET status = 'assigned', published_at = NOW(), updated_at = NOW()
    WHERE bord_id = p_bord_id AND status = 'draft';
  INSERT INTO publish_snapshots (bord_id, published_by, version)
    VALUES (p_bord_id, p_user_id, p_version);
  DELETE FROM unpublished_change_tracker WHERE bord_id = p_bord_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

```typescript
// Before: 6 separate writes, any can fail
const bord = await Bord.findByIdAndUpdate(bordId, { lastPublishedAt: now });
await TaskAssignment.updateMany({ bordId }, { status: 'assigned', publishedAt: now });
await PublishSnapshot.create({ bordId, version: v });

// After: single atomic call
await supabase.rpc('publish_board', {
  p_bord_id: bordId,
  p_user_id: userId,
  p_version: version,
});
```

---

## 8. Phase 6 — Collab Server Migration

The collab server at `/Bords server/server/` also uses MongoDB. It needs the same Mongoose → Drizzle swap.

### 6.1 Models to Migrate

| Server Model | Action |
|---|---|
| `YjsDocument` | → `supabaseAdmin.from('yjs_documents')` |
| `BoardMetadata` | → `supabaseAdmin.from('board_documents')` |
| `Call` | → Keep in memory (ephemeral) or add `calls` table |

### 6.2 Services to Update

**`src/services/yjs-persistence.ts`:**
- Replace `YjsDocument.findOne()` → `supabaseAdmin.from('yjs_documents').select().eq('board_id', id).single()`
- Replace `YjsDocument.findOneAndUpdate()` → `supabaseAdmin.from('yjs_documents').upsert()`
- BYTEA: encode to base64 before writing, decode from base64 after reading

**`src/services/permissions.ts`:**
- Replace `Bord.findOne()` → `supabaseAdmin.from('bords').select('*, bord_access_list(*)').eq('id', bordId)`
- Replace `BoardDocument.findOne()` fallback → `supabaseAdmin.from('board_documents').select()`
- Permission cache (in-memory TTL) stays as-is

**`src/services/hocuspocus.ts`:**
- Replace `connectToDatabase()` → initialize supabaseAdmin client
- Auth verification stays JWE-based (no change)

**`src/services/migration.ts`:**
- Legacy `BoardDocument` → Y.Doc migration
- Update to read from `supabaseAdmin.from('board_documents')`

**`src/plugins/mongodb.ts`:**
- Delete entirely, replace with:

**`src/plugins/supabase.ts`:**
```typescript
import { createClient } from '@supabase/supabase-js';
import fp from 'fastify-plugin';

export default fp(async (fastify) => {
  const supabase = createClient(
    fastify.config.SUPABASE_URL,
    fastify.config.SUPABASE_SERVICE_ROLE_KEY
  );
  fastify.decorate('supabase', supabase);
});
```

### 6.3 Environment Variable Changes (Collab Server)

**Replace:**
```env
MONGODB_URI=mongodb+srv://...
```

**With:**
```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### 6.4 Config Schema Update

Update `src/config.ts` Zod schema:
```typescript
// Remove
MONGODB_URI: z.string().url(),

// Add
SUPABASE_URL: z.string().url(),
SUPABASE_SERVICE_ROLE_KEY: z.string(),
```

---

## 9. Phase 7 — File Storage Migration

### Option A: Migrate to Supabase Storage (Recommended)

#### 7.1 Create Storage Bucket

In Supabase Dashboard → Storage:
- [ ] Create bucket `media` (public access for CDN)
- [ ] Set file size limit (50MB recommended)
- [ ] Set allowed MIME types

#### 7.2 Storage Policies

```sql
CREATE POLICY "Authenticated users can upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'media' AND auth.role() = 'authenticated');

CREATE POLICY "Anyone can view media" ON storage.objects
  FOR SELECT USING (bucket_id = 'media');

CREATE POLICY "Users can delete own uploads" ON storage.objects
  FOR DELETE USING (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);
```

#### 7.3 Replace Upload Logic

**Before (`src/lib/wasabi.ts`):**
```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
// Upload to Wasabi S3
```

**After (`src/lib/storage.ts`):**
```typescript
import { createClient } from '@/lib/supabase/server';

export async function uploadFile(file: Buffer, path: string, contentType: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from('media')
    .upload(path, file, { contentType, upsert: true });
  if (error) throw error;

  const { data: { publicUrl } } = supabase.storage
    .from('media')
    .getPublicUrl(data.path);
  return publicUrl;
}

export async function deleteFile(path: string) {
  const supabase = await createClient();
  await supabase.storage.from('media').remove([path]);
}
```

#### 7.4 Migrate Existing Files

Script to copy all files from Wasabi → Supabase Storage:

```typescript
// scripts/migrate-storage.ts
// 1. List all mediaItems from board_documents (JSONB query)
// 2. For each URL pointing to Wasabi:
//    a. Download from Wasabi
//    b. Upload to Supabase Storage
//    c. Update the URL in board_documents JSONB
```

### Option B: Keep Wasabi

If you prefer to keep Wasabi for storage, simply keep `src/lib/wasabi.ts` and the S3 SDK. Only the database references change.

---

## 10. Phase 8 — Cron Jobs & Background Tasks

### 8.1 Check Reminders Cron

**`src/app/api/cron/check-reminders/route.ts`:**

Use PG function + `supabase.rpc()` for complex JSONB deadline scanning (see Phase 4, section 4.1 for the `find_boards_with_deadlines` function).

```typescript
import { supabaseAdmin } from '@/lib/supabase/admin';

const { data: boardsWithDeadlines } = await supabaseAdmin.rpc(
  'find_boards_with_deadlines',
  { window_start: windowStart.toISOString(), window_end: windowEnd.toISOString() }
);

// Dedup check
const { data: existingReminders } = await supabaseAdmin
  .from('sent_reminders')
  .select('composite_key')
  .in('composite_key', compositeKeys);

// Insert new sent_reminders
await supabaseAdmin.from('sent_reminders').insert(newReminders);
```

### 8.2 Check Subscriptions Cron

Update to query `subscriptions` table via `supabaseAdmin`:

```typescript
const { data: expiredSubs } = await supabaseAdmin
  .from('subscriptions')
  .select('*')
  .eq('status', 'active')
  .lt('end_date', new Date().toISOString());

for (const sub of expiredSubs ?? []) {
  await supabaseAdmin
    .from('subscriptions')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('id', sub.id);
}
```

### 8.3 Sent Reminder Cleanup

Replace MongoDB TTL index with Supabase cron (pg_cron):

```sql
-- In Supabase SQL Editor → Extensions → Enable pg_cron
SELECT cron.schedule(
  'cleanup-sent-reminders',
  '0 * * * *',  -- every hour
  $$DELETE FROM sent_reminders WHERE created_at < NOW() - INTERVAL '48 hours'$$
);
```

---

## 11. Phase 9 — Client-Side Store Updates

### 9.1 Auth Store Changes

The `AuthProvider.tsx` currently wraps the app with NextAuth's `SessionProvider`. Replace:

**Before:**
```tsx
import { SessionProvider } from 'next-auth/react';
export default function AuthProvider({ children }) {
  return <SessionProvider>{children}</SessionProvider>;
}
```

**After:**
```tsx
'use client';
import { createClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { createContext, useContext } from 'react';

const AuthContext = createContext<{ session: Session | null }>({ session: null });
export const useAuth = () => useContext(AuthContext);

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => setSession(session)
    );
    return () => subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={{ session }}>{children}</AuthContext.Provider>;
}
```

### 9.2 Components Using `useSession()`

Every component that calls `useSession()` from `next-auth/react` must change:

**Before:**
```typescript
import { useSession } from 'next-auth/react';
const { data: session } = useSession();
const userId = session?.user?.id;
```

**After:**
```typescript
import { useAuth } from '@/components/AuthProvider';
const { session } = useAuth();
const userId = session?.user?.id;
```

### 9.3 Zustand Stores — No Schema Changes

The 15 Zustand stores manage **local UI state** and tldraw shapes. They persist to localStorage and sync via Y.Doc. **No changes needed** — the stores don't talk to MongoDB directly.

The only store affected is `boardSyncStore.ts` which stores `boardPermissions` — the permission values stay the same (`'owner' | 'edit' | 'view'`), so no changes.

### 9.4 API Call Changes

Any component making fetch calls to API routes needs URL/body updates only if the API route signatures change. Since we're keeping the same route paths and just changing the internal implementation, most component fetch calls remain unchanged.

**Exception:** Any component passing `session.user.id` where the ID format changes from MongoDB ObjectId (24-char hex) to UUID. Search for these patterns:
```bash
grep -r "session?.user?.id\|session.user.id\|userId" src/components/
```

---

## 12. Phase 10 — Data Migration Script

### 10.1 Overview

One-time script to move all data from MongoDB Atlas → Supabase PostgreSQL.

**Execution order matters** — tables with foreign keys must be populated after their dependencies.

### 10.2 Migration Order

```
1. plans                     (no dependencies)
2. auth.users + profiles     (users → Supabase Auth)
3. workspaces                (depends on: profiles)
4. organizations             (depends on: profiles, workspaces)
5. employee_memberships      (depends on: profiles, organizations)
6. bords                     (depends on: profiles, organizations)
7. bord_access_list          (depends on: bords, profiles)
8. board_documents           (depends on: profiles, organizations, workspaces)
9. yjs_documents             (depends on: nothing — text key)
10. bord_members             (depends on: bords, profiles)
11. task_assignments         (depends on: bords, board_documents, profiles, organizations)
12. publish_snapshots        (depends on: bords, profiles)
13. unpublished_change_tracker (depends on: bords)
14. subscriptions            (depends on: profiles, plans)
15. payments                 (depends on: profiles, plans, subscriptions)
16. subscription_history     (depends on: profiles, subscriptions, plans)
17. friends                  (depends on: profiles, workspaces)
18. invitations              (depends on: organizations, profiles, bords)
19. notifications            (depends on: profiles)
20. sent_reminders           (depends on: board_documents)
```

### 10.3 ID Mapping

MongoDB uses ObjectId (24-char hex). Supabase Auth uses UUID. We need a mapping table:

```typescript
// scripts/migrate-data.ts
const idMap = new Map<string, string>(); // oldMongoId → newUUID

// For users: Create in Supabase Auth first, get UUID back
const { data: authUser } = await supabaseAdmin.auth.admin.createUser({
  email: mongoUser.email,
  password: undefined,  // Set a temp password or use email confirmation
  email_confirm: !!mongoUser.emailVerifiedAt,
  user_metadata: {
    first_name: mongoUser.firstName,
    last_name: mongoUser.lastName,
  },
});
idMap.set(mongoUser._id.toString(), authUser.user.id);
```

### 10.4 Script Skeleton

```typescript
// scripts/migrate-data.ts
import mongoose from 'mongoose';
import { createClient } from '@supabase/supabase-js';

const MONGO_URI = process.env.MONGODB_URI!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function migrate() {
  // Connect to both databases
  await mongoose.connect(MONGO_URI);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const idMap = new Map<string, string>();

  // Step 1: Seed plans (or migrate existing)
  console.log('Migrating plans...');
  const mongoPlans = await Plan.find();
  for (const plan of mongoPlans) {
    const { data: inserted } = await supabase
      .from('plans')
      .insert({
        name: plan.name,
        slug: plan.slug,
        price: plan.price,
        // ... all fields
      })
      .select()
      .single();
    if (inserted) idMap.set(plan._id.toString(), inserted.id);
  }

  // Step 2: Create users in Supabase Auth + profiles
  console.log('Migrating users...');
  const mongoUsers = await User.find();
  for (const user of mongoUsers) {
    const { data } = await supabase.auth.admin.createUser({
      email: user.email,
      email_confirm: !!user.emailVerifiedAt,
      user_metadata: { first_name: user.firstName, last_name: user.lastName },
    });

    if (data.user) {
      idMap.set(user._id.toString(), data.user.id);
      // The database trigger will create profile + default workspaces
      // Update profile with additional fields
      await supabase
        .from('profiles')
        .update({
          image: user.image,
          provider: user.provider,
          provider_id: user.providerId,
          last_login_at: user.lastLoginAt?.toISOString(),
        })
        .eq('id', data.user.id);
    }
  }

  // Steps 3-20: Similar pattern for each collection
  // For each document with foreign keys, use idMap to convert ObjectId → UUID
  console.log('Migrating bords...');
  const mongoBords = await Bord.find();
  for (const bord of mongoBords) {
    const ownerId = idMap.get(bord.owner.toString());
    const orgId = bord.organizationId ? idMap.get(bord.organizationId.toString()) : null;
    const { data: inserted } = await supabase
      .from('bords')
      .insert({
        local_board_id: bord.localBoardId,
        owner_id: ownerId!,
        title: bord.title,
        context_type: bord.contextType,
        organization_id: orgId,
      })
      .select()
      .single();
    if (inserted) idMap.set(bord._id.toString(), inserted.id);
  }

  console.log('Migration complete!');
  process.exit(0);
}

migrate().catch(console.error);
```

### 10.5 Password Migration

**Problem:** MongoDB stores bcrypt hashes. Supabase Auth uses its own password hashing.

**Solution:** Use `supabase.auth.admin.createUser()` with the `password_hash` field (only available on self-hosted Supabase or via direct SQL). For Supabase Cloud:

1. Create users without passwords
2. Force a password reset email for all migrated users
3. OR: Use a custom login flow that checks the old bcrypt hash, then updates the Supabase password on first successful login

### 10.6 JSONB Data Mapping

Board document embedded arrays need type mapping:

```typescript
// MongoDB subdocuments → PostgreSQL JSONB
// ObjectId references within JSONB → UUID strings
function convertBoardDocument(mongoDoc: any) {
  return {
    checklists: mongoDoc.checklists,         // supabase-js accepts JS objects for JSONB
    kanban_boards: mongoDoc.kanbanBoards,     // note: snake_case column names
    sticky_notes: mongoDoc.stickyNotes,
    media_items: mongoDoc.mediaItems,
    text_elements: mongoDoc.textElements,
    drawings: mongoDoc.drawings,
    comments: mongoDoc.comments,
    connections: mongoDoc.connections,
    reminders: mongoDoc.reminders,
    tables: mongoDoc.tables,
    native_tldraw: mongoDoc.nativeTldraw,
    // ... settings, sharing, background fields
  };
}
// supabase-js auto-serializes JS objects to JSONB — no JSON.stringify needed
```

---

## 13. Phase 11 — Testing & Validation

### 11.1 Pre-Migration Testing

- [ ] Run full test suite against current MongoDB app (baseline)
- [ ] Document all board content for a set of test boards
- [ ] Create test user accounts covering all scenarios (Google OAuth, credentials, shared boards, org members)

### 11.2 Post-Migration Validation

**Auth flows:**
- [ ] Email signup → email verification → login
- [ ] Google OAuth signup → login
- [ ] Password reset flow
- [ ] Account lockout after 5 failed attempts
- [ ] Session persistence across page refreshes

**Board operations:**
- [ ] Create new board
- [ ] Add all content types (sticky notes, checklists, kanban, drawings, media, text, connections, reminders, tables)
- [ ] Save and reload — all content persists
- [ ] Public board sharing via token
- [ ] Board export

**Collaboration:**
- [ ] Share board with collaborator (edit permission)
- [ ] Share board with viewer
- [ ] Real-time sync: two users editing same board
- [ ] Y.Doc state persists across server restarts
- [ ] REST save fallback for personal boards

**Organizations:**
- [ ] Create organization
- [ ] Invite employee → accept invitation
- [ ] Assign task to employee (publish flow)
- [ ] Employee completes task
- [ ] Organization board access

**Subscriptions:**
- [ ] View pricing plans
- [ ] Subscribe (Paystack payment)
- [ ] Plan limits enforced (board count, task count, collaborator count)
- [ ] Subscription expiration handling
- [ ] Webhook processes renewal

**Cron/Background:**
- [ ] Reminder emails sent for upcoming deadlines
- [ ] Subscription status check runs correctly
- [ ] Sent reminder deduplication works

**Media:**
- [ ] Upload image/video to board
- [ ] Delete media from board
- [ ] All existing media URLs resolve correctly

### 11.3 Data Integrity Checks

```sql
-- Verify counts match MongoDB
SELECT 'profiles' AS table_name, COUNT(*) FROM profiles
UNION ALL SELECT 'bords', COUNT(*) FROM bords
UNION ALL SELECT 'board_documents', COUNT(*) FROM board_documents
UNION ALL SELECT 'task_assignments', COUNT(*) FROM task_assignments
UNION ALL SELECT 'subscriptions', COUNT(*) FROM subscriptions
UNION ALL SELECT 'organizations', COUNT(*) FROM organizations
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications;

-- Verify no orphan records
SELECT ba.* FROM bord_access_list ba
LEFT JOIN profiles p ON ba.user_id = p.id
WHERE p.id IS NULL;  -- Should return 0 rows

-- Verify all board content is valid JSON
SELECT id FROM board_documents
WHERE checklists IS NOT NULL AND NOT jsonb_typeof(checklists) = 'array';
```

---

## 14. Phase 12 — Deployment & Cutover

### 12.1 Pre-Cutover (1 week before)

- [ ] Supabase project created and schema deployed
- [ ] All API routes rewritten and passing tests
- [ ] Collab server updated and tested with PostgreSQL
- [ ] Storage migration script tested with subset of data
- [ ] Environment variables configured on Vercel and Render
- [ ] DNS/domain configuration for Supabase Auth redirect URLs

### 12.2 Cutover Day Checklist

```
1. [ ] Announce maintenance window to users
2. [ ] Enable "maintenance mode" (redirect all requests to a holding page)
3. [ ] Take final MongoDB snapshot
4. [ ] Run data migration script (10.4)
5. [ ] Run storage migration script (if using Supabase Storage)
6. [ ] Run data integrity checks (11.3)
7. [ ] Deploy updated frontend to Vercel
8. [ ] Deploy updated collab server to Render
9. [ ] Verify auth flows (signup, login, OAuth)
10. [ ] Verify board operations (create, edit, collaborate)
11. [ ] Disable maintenance mode
12. [ ] Monitor error logs for 24 hours
13. [ ] Send "password reset" emails to credentials users (if needed)
```

### 12.3 Rollback Plan

If critical issues arise:
1. Re-deploy previous frontend/server versions (Vercel + Render have instant rollback)
2. Switch environment variables back to MongoDB
3. Any data created during the Supabase window is lost (acceptable for short window)

### 12.4 Post-Cutover Cleanup

- [ ] Remove all Mongoose-related code (models/, lib/mongodb.ts)
- [ ] Remove `mongoose` and `@aws-sdk/client-s3` from dependencies
- [ ] Remove MongoDB Atlas cluster (after 30-day cooling period)
- [ ] Remove Wasabi bucket (after confirming all media migrated)
- [ ] Update README.md with new architecture
- [ ] Update `.env.example` files

---

## 15. Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Password hash incompatibility | Users can't login after migration | Force password reset for credentials users, or dual-hash check on first login |
| JSONB query performance for cron | Slow deadline scanning across all boards | Add GIN index on JSONB columns; consider extracting deadlines to separate table later |
| File storage URL breakage | All media on existing boards shows broken images | Run URL rewrite in board_documents JSONB during migration; keep Wasabi as read fallback for 30 days |
| ObjectId → UUID mapping errors | Foreign key violations, orphan data | Validate idMap completeness before migrations; run integrity checks |
| Y.Doc binary state corruption | Boards load empty after migration | Test BYTEA round-trip thoroughly; keep MongoDB backup |
| Supabase Auth email rate limiting | Too many password reset emails during migration | Batch migration emails; use Supabase's custom SMTP (ZeptoMail) |
| Collab server connection string leak | DB credentials exposed | Use Render environment variables; never commit DATABASE_URL |
| RLS policy gaps | Unauthorized data access | Audit every table's policies; test with non-owner users |
| Paystack webhook during migration | Missed payment events | Keep webhook endpoint live (it's stateless); process events after cutover |
| Large board_documents (approaching old 16MB limit) | Migration fails for dense boards | PostgreSQL JSONB supports 255MB; not a practical concern |

---

## 16. Appendix: Full Route Inventory

62 API routes that need rewriting:

### Auth (6 routes → DELETE, replaced by Supabase Auth)
| Route | Action |
|-------|--------|
| `api/auth/[...nextauth]/route.ts` | Delete |
| `api/auth/signup/route.ts` | Delete |
| `api/auth/verify-email/route.ts` | Delete |
| `api/auth/resend-verification/route.ts` | Delete |
| `api/auth/forgot-password/route.ts` | Delete |
| `api/auth/reset-password/route.ts` | Delete |

### Rewrite (56 routes)
| Route | Complexity | Notes |
|-------|-----------|-------|
| `api/subscription/plans/route.ts` | Low | Simple SELECT |
| `api/subscription/status/route.ts` | Low | SELECT with JOIN |
| `api/subscription/initialize-payment/route.ts` | Medium | Paystack + INSERT |
| `api/subscription/verify-payment/route.ts` | Medium | Paystack + UPDATE |
| `api/subscription/webhook/route.ts` | High | Paystack webhook, multi-table updates |
| `api/user/plan/route.ts` | Low | SELECT with JOIN |
| `api/workspaces/route.ts` | Low | CRUD |
| `api/workspaces/friends/route.ts` | Medium | SELECT + INSERT |
| `api/workspaces/friends/[friendId]/route.ts` | Low | DELETE |
| `api/workspaces/friends/[friendId]/accept/route.ts` | Medium | UPDATE + notification |
| `api/workspaces/friends/[friendId]/decline/route.ts` | Low | UPDATE |
| `api/organizations/route.ts` | Medium | CREATE org + workspace |
| `api/organizations/[orgId]/route.ts` | Low | CRUD |
| `api/organizations/[orgId]/employees/route.ts` | Medium | SELECT with JOINs |
| `api/organizations/[orgId]/employees/[employeeId]/route.ts` | Medium | DELETE + CASCADE |
| `api/organizations/[orgId]/invitations/[invitationId]/route.ts` | Medium | CRUD |
| `api/invitations/[invitationId]/accept/route.ts` | High | Multi-table (membership + notification + bord access) |
| `api/invitations/by-token/[token]/route.ts` | Low | SELECT |
| `api/bords/route.ts` | Medium | LIST with access control |
| `api/bords/[bordId]/route.ts` | Medium | CRUD with access check |
| `api/bords/[bordId]/access/route.ts` | Medium | Access list management |
| `api/bords/[bordId]/publish/route.ts` | **High** | 6+ writes → **use transaction** |
| `api/bords/[bordId]/assignments/route.ts` | Medium | CRUD |
| `api/bords/[bordId]/assignments/[assignmentId]/route.ts` | Medium | CRUD |
| `api/bords/[bordId]/assignments/owner-sync/route.ts` | Medium | Sync logic |
| `api/boards/create/route.ts` | Medium | Legacy + INSERT |
| `api/boards/sync/route.ts` | Medium | Sync logic |
| `api/boards/sync/check/route.ts` | Low | SELECT |
| `api/boards/sync/[boardId]/route.ts` | Medium | GET/PUT |
| `api/boards/sync/[boardId]/share/route.ts` | Medium | Share logic |
| `api/boards/sync/all/route.ts` | Medium | Batch SELECT |
| `api/boards/[boardId]/save-state/route.ts` | Medium | BYTEA upsert |
| `api/boards/[boardId]/comments/route.ts` | Medium | CRUD |
| `api/boards/[boardId]/comments/stream/route.ts` | Medium | SSE + polling |
| `api/boards/public/[token]/route.ts` | Low | Public SELECT |
| `api/assignments/personal/route.ts` | Medium | SELECT with JOINs |
| `api/assignments/personal/[assignmentId]/route.ts` | Low | CRUD |
| `api/personal/assignments/route.ts` | Medium | SELECT with JOINs |
| `api/personal/assignments/[assignmentId]/route.ts` | Low | CRUD |
| `api/personal/assignments/[assignmentId]/complete/route.ts` | Medium | UPDATE + notification |
| `api/personal/assignments/[assignmentId]/update/route.ts` | Medium | UPDATE |
| `api/execution/tasks/route.ts` | Medium | SELECT with JOINs |
| `api/execution/tasks/[taskId]/complete/route.ts` | Medium | UPDATE + notification |
| `api/execution/tasks/[taskId]/update/route.ts` | Medium | UPDATE |
| `api/notifications/route.ts` | Low | CRUD |
| `api/reminders/send/route.ts` | Medium | Dedup + email |
| `api/send-reminder/route.ts` | Medium | Dedup + email |
| `api/send-board-reminder/route.ts` | Medium | Multi-recipient |
| `api/media/upload/route.ts` | Medium | Supabase Storage |
| `api/media/delete/route.ts` | Low | Supabase Storage |
| `api/collab/ticket/route.ts` | Low | JWE generation (keep as-is, change session lookup) |
| `api/calls/token/route.ts` | Low | LiveKit token (change session lookup) |
| `api/cron/check-reminders/route.ts` | **High** | Complex JSONB queries |
| `api/cron/check-subscriptions/route.ts` | Medium | Batch query + update |
| `api/test-db/route.ts` | Low | Health check |
| `api/test-email/route.ts` | Low | No DB change |

---

## Summary: Migration at a Glance

| Metric | Count |
|--------|-------|
| MongoDB Models → PostgreSQL Tables | 22 → 20 (3 absorbed by Supabase Auth) |
| API Routes to Delete | 6 (auth routes) |
| API Routes to Rewrite | 56 |
| Client Components to Update (session) | ~15–20 (useSession → useAuth) |
| New Files to Create | ~5 (supabase clients, types, migration script) |
| SQL Migration Files | ~10 (in supabase/migrations/) |
| PG Functions | ~3 (publish_board, accept_invitation, find_boards_with_deadlines) |
| Files to Delete | ~25 (models/, mongodb.ts, wasabi.ts, NextAuth config, auth routes) |
| Zustand Stores to Change | 0 |
| Collab Server Files to Update | ~8 (models, services, plugins, config) |
| ORM/Schema Files Needed | 0 (supabase-js + generated types) |

---

*This plan should be executed phase by phase. Each phase is independently testable. Do not proceed to the next phase until the current one compiles and passes its validation checks.*
