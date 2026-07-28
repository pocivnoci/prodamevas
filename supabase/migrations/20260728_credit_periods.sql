-- ═══════════════════════════════════════════════════════════════
-- Migration: Credit period (kreditové okno) oddělené od zaplaceného období
-- ═══════════════════════════════════════════════════════════════
-- Kredity se počítaly proti KALENDÁŘNÍMU měsíci (`new Date(y, m, 1)`), zatímco
-- fakturační období běží od data platby. Kdo zaplatil 25., dostal 1. plnou novou
-- dávku kreditů — u Impéria 220 kreditů (≈ 66 USD API nákladu) rozdaných za šest
-- dní. U ročního plánu úplně rozbité: platba jednou, reset dvanáctkrát.
--
-- Nově jsou to dva různé pojmy a nikdy se nesmí zase slít do jednoho:
--   current_period_start/end = ZAPLACENÉ období (měsíc NEBO rok) → řídí obnovu
--   credit_period_start/end  = KREDITOVÉ okno (vždy měsíční)     → řídí reset
--
-- Run: Supabase Management API / SQL editor. Bezpečné re-run (IF NOT EXISTS +
-- backfill jen tam, kde je NULL).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS credit_period_start timestamptz,
    ADD COLUMN IF NOT EXISTS credit_period_end timestamptz;

COMMENT ON COLUMN subscriptions.credit_period_start IS
    'Začátek aktuálního kreditového okna (kotva = datum aktivace/obnovy, ne 1. v měsíci). Kredity se sčítají z credit_transactions v intervalu [start, end).';

COMMENT ON COLUMN subscriptions.credit_period_end IS
    'Konec kreditového okna — VŽDY start + 1 měsíc, i u ročního plánu (roční plán se platí jednou, ale kredity resetuje 12×). Nevyčerpané kredity PROPADAJÍ, nekumulují se do dalšího okna: zbytek se nikam nepřenáší, okno se jen posune. Posouvá ho billing-worker při každém běhu (rollLapsedCreditWindows), nezávisle na tom, jestli je splatná obnova.';

-- Backfill: kotva = začátek zaplaceného období, jinak vznik řádku. Okno se rovnou
-- posune na to, které obsahuje now() (jinak by ho worker musel dohánět po měsíci
-- na běh). `age()` počítá celé kalendářní měsíce; `+ interval '1 month'` v Postgresu
-- clampuje konec měsíce stejně jako addMonths() v lib/billing-period.ts.
UPDATE subscriptions AS s
SET credit_period_start = anchor + make_interval(months => months_done),
    credit_period_end   = anchor + make_interval(months => months_done + 1),
    updated_at          = now()
FROM (
    SELECT
        id,
        COALESCE(current_period_start, created_at, now()) AS anchor,
        GREATEST(
            0,
            (DATE_PART('year',  age(now(), COALESCE(current_period_start, created_at, now())))::int * 12)
          + (DATE_PART('month', age(now(), COALESCE(current_period_start, created_at, now())))::int)
        ) AS months_done
    FROM subscriptions
    WHERE credit_period_start IS NULL OR credit_period_end IS NULL
) AS calc
WHERE s.id = calc.id;

-- Billing worker skenuje propadlá kreditová okna při každém běhu.
CREATE INDEX IF NOT EXISTS idx_subscriptions_credit_period
    ON subscriptions(status, credit_period_end);
