-- Performance indexes for most common query patterns in admin-actions.ts
-- These match the WHERE + ORDER BY patterns used throughout the app.

-- ig_posts: most queries filter by client_id + order by created_at
CREATE INDEX IF NOT EXISTS idx_ig_posts_client_created 
    ON ig_posts(client_id, created_at DESC);

-- ig_posts: PostsTab filters by client_id + status
CREATE INDEX IF NOT EXISTS idx_ig_posts_client_status 
    ON ig_posts(client_id, status);

-- ig_post_ideas: InspirationTab queries by client_id + is_active
CREATE INDEX IF NOT EXISTS idx_ig_post_ideas_client 
    ON ig_post_ideas(client_id);

-- ig_reviews: InspirationTab queries by client_id
CREATE INDEX IF NOT EXISTS idx_ig_reviews_client 
    ON ig_reviews(client_id);

-- ig_jobs: job status polling by client_id + status
CREATE INDEX IF NOT EXISTS idx_ig_jobs_client_status 
    ON ig_jobs(client_id, status);

-- ig_brand_memory: BrainTab queries by client_id + confidence
CREATE INDEX IF NOT EXISTS idx_ig_brand_memory_client 
    ON ig_brand_memory(client_id, confidence DESC);

-- user_clients: auth guard lookups by user_id (critical for requireProjectAccess)
CREATE INDEX IF NOT EXISTS idx_user_clients_user 
    ON user_clients(user_id);

-- ig_products: product listing by client_id
CREATE INDEX IF NOT EXISTS idx_ig_products_client 
    ON ig_products(client_id);

-- ig_generation_log: log listing by client_id + created_at
CREATE INDEX IF NOT EXISTS idx_ig_gen_log_client 
    ON ig_generation_log(client_id, created_at DESC);
