-- Předplatné na 3 / 6 / 12 měsíců
-- ================================
-- Období je vlastnost PŘEDPLATNÉHO, ne tarifu. `subscription_plans` proto zůstává
-- na čtyřech řádcích a `price_czk` dál drží MĚSÍČNÍ cenu; kolik měsíců je
-- zaplaceno, říká `subscriptions.term_months`, a cenu za období počítá
-- `termPrice()` v `lib/pricing.ts`.
--
-- Kdyby se období naseedovalo jako další tarify, rozpadne se identita tarifu při
-- změně období (upgrade z „Růst ročně" na „Dominance ročně" by byl přechod mezi
-- čtyřmi různými plan_id), `features` by se zduplikovaly 4× a /api/plans by
-- vracelo 16 karet.

-- ─── Délka zaplaceného období ───────────────────────────────────────────────
-- DEFAULT 1 je správný backfill: všechna dosavadní předplatná jsou měsíční.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS term_months INTEGER NOT NULL DEFAULT 1;

DO $$ BEGIN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_term_months_chk CHECK (term_months IN (1, 3, 6, 12));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Co koupila TATO platba. Na předplatném se `term_months` přepíše při změně
-- období, takže bez sloupce na platbě by zpětně nešlo zjistit, za co zákazník
-- tenkrát zaplatil — a to je přesně údaj, který musí sedět s dokladem.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS term_months INTEGER;

-- ─── Brána, která předplatné pohání ─────────────────────────────────────────
-- ComGate: obnovu iniciuje NÁŠ cron uloženým tokenem (`recurring_trans_id`).
-- Stripe: obnovu iniciuje Stripe sám (Billing) a přijde jako `invoice.paid`.
-- Bez téhle informace by cron zkoušel strhnout ComGatem něco, co si Stripe
-- účtuje sám — tedy dvojí platba za jedno období.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'comgate';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_ref TEXT;

DO $$ BEGIN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_provider_chk CHECK (provider IN ('comgate', 'stripe'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Webhook hledá předplatné podle id Stripe subscription. Částečný UNIQUE index:
-- jeden Stripe objekt smí patřit právě jednomu našemu předplatnému.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_ref_uniq
    ON subscriptions (provider, provider_ref)
    WHERE provider_ref IS NOT NULL;

-- ─── Garance vrácení peněz (30 dní) ─────────────────────────────────────────
-- Vrácení peněz se pohybuje ručně (portál brány + dobropis ve Fakturoidu), ale
-- STAV musí být v naší DB pravdivý: jinak by pozdní callback vrácenou platbu
-- znovu zabral a plán aktivoval. Claim v `lib/payments/on-paid.ts` proto stav
-- 'REFUNDED' vylučuje stejně jako 'PAID'.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_refunded
    ON payments (refunded_at DESC)
    WHERE refunded_at IS NOT NULL;

-- ─── Zájem z ceníku na landingu ─────────────────────────────────────────────
-- Kdo se hlásí do waitlistu z konkrétní karty ceníku, přichází s rozhodnutím.
-- Ztratit ho znamená posílat pozvánku naslepo a ptát se znovu na to, co už řekl.
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS plan_interest TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS term_interest INTEGER;
