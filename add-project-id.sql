ALTER TABLE public.ig_post_ideas ADD COLUMN IF NOT EXISTS project_id text DEFAULT 'mobilnamiru';
ALTER TABLE public.ig_reviews ADD COLUMN IF NOT EXISTS project_id text DEFAULT 'mobilnamiru';
