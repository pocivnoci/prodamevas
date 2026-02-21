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

-- Default Policies (Allow everything for Service Role internally, but block anon by default)
-- (You can refine these later to specifically link to auth.uid() based on user_clients)
