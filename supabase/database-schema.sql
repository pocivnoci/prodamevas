-- 1. Clients (Tenants)
CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL, -- e.g., 'mobilnamiru'
  name text NOT NULL, -- e.g., 'Mobil na míru'
  website text,
  instagram text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Join table for Users <-> Clients (RBAC)
CREATE TABLE user_clients (
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  role text DEFAULT 'member', -- 'owner', 'admin', 'member'
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  PRIMARY KEY (user_id, client_id)
);

-- 3. Post Types
CREATE TABLE ig_post_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  display_name text NOT NULL,
  description text,
  template text,
  emoji text,
  frequency text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Post Ideas
CREATE TABLE ig_post_ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  category text NOT NULL,
  subcategory text,
  title text NOT NULL,
  content text NOT NULL,
  keywords text[],
  used_count integer DEFAULT 0,
  last_used_at timestamp with time zone,
  cooldown_days integer DEFAULT 14,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Reviews
CREATE TABLE ig_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  customer_name text,
  customer_initials text,
  quote text NOT NULL,
  rating integer,
  time_saved text,
  transformation text,
  source text,
  used_at timestamp with time zone,
  is_approved boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Products (Extracted from JSON config for better scalability)
CREATE TABLE ig_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text,
  slug text NOT NULL,
  variants integer,
  price text,
  description text,
  image_urls text[], -- Array of CDN URLs
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(client_id, slug) -- Ensure slugs are unique per client
);

-- 7. Posts
CREATE TABLE ig_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  post_type_id uuid REFERENCES ig_post_types(id) ON DELETE SET NULL,
  idea_id uuid REFERENCES ig_post_ideas(id) ON DELETE SET NULL,
  review_id uuid REFERENCES ig_reviews(id) ON DELETE SET NULL,
  product_id uuid REFERENCES ig_products(id) ON DELETE SET NULL, -- Explicit link to product
  caption text NOT NULL,
  hashtags text[],
  call_to_action text,
  image_prompt text,
  image_url text,
  image_style text,
  scheduled_for timestamp with time zone,
  time_slot text,
  status text,
  posted_at timestamp with time zone,
  likes integer,
  comments integer,
  saves integer,
  reach integer,
  shares integer,
  profile_visits integer,
  link_clicks integer,
  content_pillar text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Content Calendar
CREATE TABLE ig_content_calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  date date NOT NULL,
  post_id uuid REFERENCES ig_posts(id) ON DELETE SET NULL,
  post_type_id uuid REFERENCES ig_post_types(id) ON DELETE SET NULL,
  time_slot text,
  notes text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 9. Generation Log
CREATE TABLE ig_generation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  post_id uuid REFERENCES ig_posts(id) ON DELETE CASCADE,
  prompt_used text,
  model_used text,
  tokens_used integer,
  generation_time_ms integer,
  error text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 10. Brand Memory (Self-learning feedback loop)
CREATE TABLE ig_brand_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  memory_type text NOT NULL, -- 'pattern', 'preference', 'avoid', 'visual'
  content text NOT NULL,
  confidence numeric DEFAULT 0.5,
  source_post_ids uuid[],
  times_confirmed integer DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

-- 11. Jobs (Async generation queue)
CREATE TABLE ig_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  status text DEFAULT 'pending', -- 'pending', 'running', 'done', 'error'
  job_type text DEFAULT 'generate',
  params jsonb DEFAULT '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 12. Product Ideas (AI-generated product concepts)
CREATE TABLE ig_product_ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text,
  tagline text,
  description text,
  material text,
  dimensions text,
  manufacturing_method text,
  price_range text,
  viral_angle text,
  why_it_works text,
  production_notes text,
  design_prompt text,
  branding_names text[],
  variants text[],
  supplier_message text,
  design_url text,
  status text DEFAULT 'review', -- 'review', 'saved', 'rejected'
  created_at timestamptz DEFAULT now()
);

-- 13. Product Categories (Dynamic per-client product types with AI instructions)
CREATE TABLE ig_product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE, -- NULL = global default
  slug text NOT NULL,
  label text NOT NULL,
  icon text DEFAULT '📦',
  design_guide text NOT NULL,
  mockup_prompt text,
  material_hint text,
  manufacturing_hint text,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- SECURITY: Enable Row Level Security (RLS)
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_post_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_post_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_content_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_generation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_brand_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_product_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_product_categories ENABLE ROW LEVEL SECURITY;

-- 14. Subscription Plans
CREATE TABLE subscription_plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  price_czk integer NOT NULL,
  price_eur integer,
  interval text NOT NULL DEFAULT 'month',
  features jsonb DEFAULT '[]'::jsonb,
  post_limit integer,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 15. Client Subscriptions
CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  plan_id text REFERENCES subscription_plans(id) NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 16. Payment Records (Comgate)
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  comgate_trans_id text UNIQUE,
  ref_id text NOT NULL,
  amount integer NOT NULL,
  currency text NOT NULL DEFAULT 'CZK',
  status text NOT NULL DEFAULT 'PENDING',
  payment_method text,
  label text,
  payer_email text,
  comgate_response jsonb,
  paid_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Default Policies (Allow everything for Service Role internally, but block anon by default)
-- (You can refine these later to specifically link to auth.uid() based on user_clients)
