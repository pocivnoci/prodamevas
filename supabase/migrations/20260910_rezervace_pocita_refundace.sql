-- Rezervace kreditů musí počítat refundace
-- ═══════════════════════════════════════════════════════════════════════════
-- PROBLÉM
--
-- `reserve_credits` (migrace 20260902) o sobě tvrdí, že je „1:1 s
-- getCreditLedger()", ale spotřebu počítá jinak:
--
--   SQL:  SUM(... WHEN action <> 'credit_topup' AND credits > 0 THEN credits)
--   TS:   for (row) if (action !== TOPUP) used += row.credits
--
-- Rozdíl je v ZÁPORNÝCH řádcích, které nejsou dobití — `post_refund`
-- (`refundJobCharge`, generování selhalo) a `post_adjust` (`reconcileJobCharge`,
-- účtoval se karusel, doručil se obrázek). TypeScript je odečítá od spotřeby,
-- SQL je zahazuje.
--
-- Důsledek vidí zákazník: aplikace mu ukáže zůstatek VČETNĚ vrácených kreditů,
-- `canPerformAction` ho pustí dál — a `reserve_credits` ho pak odmítne větou
-- „Nedostatek kreditů, zbývá 0", zatímco ukazatel v postranním panelu svítí
-- třeba deset. Každé selhané generování tak trvale ubere jeden kredit ze
-- zůstatku, který engine vidí, a refundace je jen na oko.
--
-- Dvě pravdy o zůstatku jsou tady horší než pomalejší cesta: ta v SQL rozhoduje
-- o tom, jestli práce proběhne, ta v TS o tom, co si zákazník myslí, že má.
--
-- OPRAVA
--
-- Sečíst VŠECHNY řádky mimo dobití, včetně záporných, a teprve výsledek oříznout
-- na nule — přesně to, co dělá `getCreditLedger`. Ořez zůstává: refundace, která
-- přeteče do dalšího okna, nesmí vyrobit zápornou spotřebu (a tím kredity navíc).
--
-- Zbytek funkce se nemění. Spustit v SQL editoru Supabase / přes Management API.
-- Bezpečné opakovaně.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION reserve_credits(
    p_client_id       UUID,
    p_action          TEXT,
    p_credits         INTEGER,
    p_monthly         INTEGER,      -- příděl z tarifu (features.credits_per_month)
    p_window_start    TIMESTAMPTZ,
    p_window_end      TIMESTAMPTZ,
    p_description     TEXT DEFAULT NULL,
    p_reference_id    TEXT DEFAULT NULL
)
RETURNS TABLE (reserved BOOLEAN, remaining INTEGER, reservation_id UUID)
LANGUAGE plpgsql
AS $$
DECLARE
    v_used      INTEGER := 0;
    v_purchased INTEGER := 0;
    v_remaining INTEGER := 0;
    v_id        UUID;
BEGIN
    IF p_credits IS NULL OR p_credits <= 0 THEN
        RETURN QUERY SELECT FALSE, 0, NULL::UUID;
        RETURN;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id::text, 42));

    IF p_reference_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM credit_transactions
        WHERE action = p_action AND reference_id = p_reference_id
    ) THEN
        RETURN QUERY SELECT TRUE, -1, NULL::UUID;
        RETURN;
    END IF;

    -- `credits > 0` tu ZÁMĚRNĚ není: záporné řádky mimo dobití jsou refundace
    -- a dorovnání, a ty spotřebu snižují. Viz hlavička migrace.
    SELECT
        COALESCE(SUM(CASE WHEN action <> 'credit_topup' THEN credits ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN action =  'credit_topup' THEN -credits ELSE 0 END), 0)
    INTO v_used, v_purchased
    FROM credit_transactions
    WHERE client_id = p_client_id
      AND created_at >= p_window_start
      AND created_at <  p_window_end;

    v_used      := GREATEST(0, v_used);
    v_purchased := GREATEST(0, v_purchased);
    v_remaining := GREATEST(0, (COALESCE(p_monthly, 0) + v_purchased) - v_used);

    IF v_remaining < p_credits THEN
        RETURN QUERY SELECT FALSE, v_remaining, NULL::UUID;
        RETURN;
    END IF;

    INSERT INTO credit_transactions (client_id, action, credits, description, reference_id)
    VALUES (p_client_id, p_action, p_credits, p_description, p_reference_id)
    RETURNING id INTO v_id;

    RETURN QUERY SELECT TRUE, (v_remaining - p_credits), v_id;
END;
$$;

COMMENT ON FUNCTION reserve_credits IS
  'Atomická rezervace kreditů pod advisory zámkem na klienta. Spotřeba se počítá stejně jako v getCreditLedger() — refundace ji snižují.';

REVOKE ALL ON FUNCTION reserve_credits FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_credits FROM anon;
REVOKE ALL ON FUNCTION reserve_credits FROM authenticated;
