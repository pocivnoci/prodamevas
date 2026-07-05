-- ═══════════════════════════════════════════════════════════════
-- Migration: Angle commit (prodejní prompt pipeline)
-- ig_generation_log.angle — úhel deklarovaný copywriterem před psaním
-- (1 česká věta); kritik proti němu hodnotí Originalitu. Nullable, additive.
-- Run: Supabase Management API / SQL editor
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE ig_generation_log ADD COLUMN IF NOT EXISTS angle text;
