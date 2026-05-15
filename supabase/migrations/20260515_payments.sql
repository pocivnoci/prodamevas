-- Subscriptions & Payments for ProdámeVás
-- Comgate.eu payment gateway integration

-- 1. Subscription Plans (predefined, seeded)
CREATE TABLE subscription_plans (
  id text PRIMARY KEY, -- 'starter', 'pro', 'enterprise'
  name text NOT NULL,
  description text,
  price_czk integer NOT NULL, -- price in haléře (e.g. 149900 = 1499 CZK)
  price_eur integer, -- price in cents (optional)
  interval text NOT NULL DEFAULT 'month', -- 'month', 'year'
  features jsonb DEFAULT '[]'::jsonb, -- ["AI posty", "Brand knihovna", ...]
  post_limit integer, -- NULL = unlimited
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 2. Client Subscriptions
CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  plan_id text REFERENCES subscription_plans(id) NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'active', 'cancelled', 'expired', 'past_due'
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 3. Payment Records (linked to Comgate transactions)
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  comgate_trans_id text UNIQUE, -- Comgate transaction ID
  ref_id text NOT NULL, -- our internal reference (e.g. "sub-{clientSlug}-{timestamp}")
  amount integer NOT NULL, -- in haléře (CZK) or cents (EUR)
  currency text NOT NULL DEFAULT 'CZK',
  status text NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'PAID', 'CANCELLED', 'AUTHORIZED'
  payment_method text, -- 'CARD_CZ_CSOB', 'BANK_CZ_KB', etc.
  label text, -- "ProdámeVás Pro — květen 2026"
  payer_email text,
  comgate_response jsonb, -- raw response from Comgate for debugging
  paid_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_subscriptions_client ON subscriptions(client_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_payments_client ON payments(client_id);
CREATE INDEX idx_payments_comgate_trans ON payments(comgate_trans_id);
CREATE INDEX idx_payments_ref ON payments(ref_id);
CREATE INDEX idx_payments_status ON payments(status);

-- RLS
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Seed plans
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, post_limit) VALUES
  ('starter', 'Starter', 'Pro začínající značky', 99900, 'month',
   '["5 AI příspěvků/měsíc", "Brand knihovna", "Základní analytika"]'::jsonb, 5),
  ('pro', 'Pro', 'Pro aktivní značky', 249900, 'month',
   '["30 AI příspěvků/měsíc", "Brand knihovna", "Pokročilá analytika", "Priority podpora", "Re-scan webu"]'::jsonb, 30),
  ('enterprise', 'Enterprise', 'Neomezený přístup', 499900, 'month',
   '["Neomezené příspěvky", "Brand knihovna", "Plná analytika", "Dedikovaný account manager", "API přístup"]'::jsonb, NULL)
ON CONFLICT (id) DO NOTHING;
