-- ═══════════════════════════════════════════════════════════════
-- Migration: „A/B varianty" → „dvě verze příspěvku na výběr"
-- ═══════════════════════════════════════════════════════════════
-- Jen text. Ceny, kredity ani `features` se nemění.
--
-- PROČ: `subscription_plans.description` tarifu Růst od `20260612_growth_tiers.sql`
-- slibuje „A/B varianty". Zákazník to četl jako dva příspěvky na výběr v ceně
-- jednoho a jako měření výkonu — ani jedno není pravda:
--   * `generatePostVariant` (app/actions/variant-actions.ts) vyrobí PLNÝ nový
--     příspěvek a účtuje ho podle média (obrázek 1 · story 2 · carousel 3 · reel 5),
--     takže dvě verze stojí dvojnásobek;
--   * nic se netestuje — vybranou verzi si zvolí člověk, zbylé jdou do `rejected`.
--     Skutečné měření (souboje verzí) běží až po publikaci a je to jiná funkce.
-- Text v aplikaci i na ceníku (`PLAN_COPY` v lib/pricing.ts) je přepsaný stejně;
-- `description` je jeho fallback v SubscriptionSection, takže se nesmí rozejít.
--
-- Popis se skládá ze současného stavu seedu `20260901_odemknuti_funkci.sql`
-- (70 kreditů vč. reels). Jediný tarif s „A/B" v popisu je Růst — ostatní ho
-- nikdy neměly.
--
-- Run: Supabase Management API / SQL editor. Bezpečné opakovaně: UPDATE je
-- idempotentní a sáhne jen na řádek, který ještě starý text má.
-- ═══════════════════════════════════════════════════════════════

UPDATE subscription_plans
SET description = 'Rosteme spolu — 70 kreditů/měs vč. reels, dvě verze příspěvku na výběr, růstový dashboard'
WHERE id = 'chrlit_rust';

-- Pojistka pro případ, že by „A/B" přežilo v jiném tarifu (starší seed, ruční
-- úprava v konzoli): nic nepřepisuje, jen to vypíše k ruční opravě.
DO $$
DECLARE zbytky text;
BEGIN
    SELECT string_agg(id, ', ') INTO zbytky
    FROM subscription_plans
    WHERE description ILIKE '%A/B%';

    IF zbytky IS NOT NULL THEN
        RAISE WARNING 'Popis tarifu pořád obsahuje „A/B": %', zbytky;
    END IF;
END $$;
