-- Plans: subscription tiers (Free, Pro, Team, etc.)
CREATE TABLE plans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT UNIQUE NOT NULL,
  slug                TEXT UNIQUE NOT NULL,
  description         TEXT,
  price               INTEGER NOT NULL DEFAULT 0,           -- in kobo (NGN)
  currency            TEXT NOT NULL DEFAULT 'NGN',
  interval            TEXT NOT NULL DEFAULT 'monthly' CHECK (interval IN ('monthly', 'yearly')),
  features            TEXT[] NOT NULL DEFAULT '{}',
  max_boards          INTEGER NOT NULL DEFAULT 3,           -- -1 = unlimited
  max_tasks_per_board INTEGER NOT NULL DEFAULT 50,
  max_collaborators   INTEGER NOT NULL DEFAULT 0,
  max_organizations   INTEGER NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- Subscriptions: user <-> plan binding
CREATE TABLE subscriptions (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id                    UUID NOT NULL REFERENCES plans(id),
  status                     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'expired', 'past_due', 'trialing')),
  start_date                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date                   TIMESTAMPTZ,
  trial_start                TIMESTAMPTZ,
  trial_end                  TIMESTAMPTZ,
  canceled_at                TIMESTAMPTZ,
  cancellation_reason        TEXT,
  paystack_customer_code     TEXT,
  paystack_subscription_code TEXT,
  paystack_email_token       TEXT,
  current_period_start       TIMESTAMPTZ,
  current_period_end         TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- Payments: transaction records
CREATE TABLE payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id              UUID REFERENCES plans(id),
  subscription_id      UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  amount               INTEGER NOT NULL,                     -- in kobo
  currency             TEXT NOT NULL DEFAULT 'NGN',
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'abandoned')),
  paystack_reference   TEXT UNIQUE,
  paystack_access_code TEXT,
  metadata             JSONB NOT NULL DEFAULT '{}',
  paid_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_user ON payments(user_id);
CREATE INDEX idx_payments_reference ON payments(paystack_reference);

CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- Subscription history: audit trail
CREATE TABLE subscription_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  from_plan_id    UUID REFERENCES plans(id),
  to_plan_id      UUID REFERENCES plans(id),
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sub_history_user ON subscription_history(user_id);
