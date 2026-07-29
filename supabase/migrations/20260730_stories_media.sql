-- ═══════════════════════════════════════════════════════════════
-- Migration: Instagram Stories — otevřít médium "story" všem plánům
-- ═══════════════════════════════════════════════════════════════
-- Story = sada 1–3 svislých 9:16 snímků, 2 kredity za sadu (lib/credits.ts).
--
-- `allowed_media` je WHITELIST a všechny placené plány ho mají explicitně
-- vyplněný (20260716_pricing_v5.sql), takže bez tohohle UPDATE by
-- canUseMedium() vrátilo false a /api/ig-create-job by odpovědělo 403 —
-- žádný platící zákazník by story nevygeneroval. Plány bez `allowed_media`
-- (trial_v2, legacy) povolují všechno a nepotřebují nic.
--
-- Story dostávají VŠECHNY tiery včetně Startu: za 2 kredity je levnější než
-- carousel (3), který Start už má, takže není ekonomický důvod ji držet zpět.
--
-- Pozor: 20260716_pricing_v5.sql je deklarativní seed s ON CONFLICT DO UPDATE
-- SET features = EXCLUDED.features — je URČENÝ k opakovanému spuštění. Proto
-- byly ve stejném commitu upraveny i jeho čtyři literály `allowed_media`;
-- kdyby zůstaly zastaralé, příští běh seedu by "story" ze všech plánů zase
-- odstranil.
--
-- Run: Supabase Management API query endpoint (NIKDY `supabase db push` —
-- historie migrací v CLI je rozejitá). Bezpečné re-run: idempotentní.
-- ═══════════════════════════════════════════════════════════════

UPDATE subscription_plans
SET features = jsonb_set(
        features,
        '{allowed_media}',
        (features->'allowed_media') || '["story"]'::jsonb
    )
WHERE features ? 'allowed_media'
  AND NOT (features->'allowed_media' @> '["story"]'::jsonb);

-- Kontrola: každý plán s whitelistem musí mít story.
DO $$
DECLARE
    missing INTEGER;
BEGIN
    SELECT COUNT(*) INTO missing
    FROM subscription_plans
    WHERE features ? 'allowed_media'
      AND NOT (features->'allowed_media' @> '["story"]'::jsonb);
    IF missing > 0 THEN
        RAISE EXCEPTION 'Stories migration failed: % plánů stále bez "story" v allowed_media', missing;
    END IF;
END $$;
