-- Vytvoření tabulky pro Waitlist
CREATE TABLE waitlist (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text UNIQUE NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- Vytvoření tabulky pro Invite kódy
CREATE TABLE invite_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text UNIQUE NOT NULL,
    max_uses integer DEFAULT 1,
    used_count integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
);

-- RLS (Row Level Security) - skrytí před anonymy, vše řešíme přes Service Role v actions
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;

-- Vytvoření trial plánu s 10 kredity
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, post_limit, is_active)
VALUES (
    'trial',
    'Beta Trial',
    '7denní zkušební verze pro beta testery.',
    0,
    'week',
    '{"credits_per_month": 10, "max_projects": 1, "extra_credit_price": 0, "allowed_actions": ["post", "post_variant", "idea_generate", "product_ideas", "product_visual", "product_design", "product_mockup", "product_brief"], "analytics": "basic", "priority": false, "label": "Trial", "highlight": false}'::jsonb,
    10,
    true
) ON CONFLICT (id) DO UPDATE SET features = EXCLUDED.features;

-- Vložení testovacího kódu pro tebe
INSERT INTO invite_codes (code, max_uses) VALUES ('BETA-VIP', 100);
