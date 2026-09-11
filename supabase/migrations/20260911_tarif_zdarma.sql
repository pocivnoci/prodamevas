-- ═══════════════════════════════════════════════════════════════
-- Migration: tarif zdarma (`subscriptions.provider = 'gift'`)
-- ═══════════════════════════════════════════════════════════════
-- Obchod dává vybraným klientům placený tarif na vyzkoušení. Dosud to šlo jen
-- ručním zápisem do DB — a takový řádek by se tvářil jako ComGate předplatné:
-- billing-worker by klienta na konci období upomínal k „ruční obnově" platby,
-- kterou nikdy nesjednal, a aplikace by mu psala „předplatné jste zrušili".
--
-- Dárek je proto třetí druh předplatného vedle bran: nemá bránu ani platbu,
-- nevzniká k němu doklad a na konci období sám skončí. Zakládá ho jen super
-- admin přes `giftPlan()` v app/actions/admin-actions.ts.
--
-- Run: Supabase Management API / SQL editor. Bezpečné re-run.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_provider_chk;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_provider_chk
    CHECK (provider IN ('comgate', 'stripe', 'gift'));
