-- Atomická rezervace kreditů
-- ═══════════════════════════════════════════════════════════════════════════
-- PROBLÉM, KTERÝ TO ŘEŠÍ
--
-- Dosud platilo `check-then-act`: `canPerformAction()` zůstatek jen PŘEČETL
-- a `deductCredits()` zapisoval až PO dokončení AI operace. Mezi čtením
-- a zápisem nebyl žádný zámek, takže N souběžných požadavků přečetlo týž
-- zůstatek a všechny prošly. Zákazník s jedním kreditem uměl spustit padesát
-- paralelních generování a zaplatit za jedno.
--
-- Strop tempa (12/min, 400/den) nasazený 2. 9. 2026 zmírňuje vytrvalý skript,
-- ale souběžný náraz nezastaví — dva požadavky ve stejné milisekundě napočítají
-- totéž. Zavřít se to dá jedině tím, že kontrola a zápis jsou JEDNA operace.
--
-- JAK TO FUNGUJE
--
-- `pg_advisory_xact_lock` serializuje transakce nad JEDNÍM klientem (ne nad
-- celou tabulkou), takže souběh různých tenantů se nezdržuje. Uvnitř zámku se
-- zůstatek přepočítá ZNOVU z knihy — tím se čte stav, který už zahrnuje
-- rezervace ostatních běhů — a teprve pak se zapisuje.
--
-- Zámek je `xact`, tedy se uvolní commitem nebo rollbackem sám. Funkce nesmí
-- nic dlouhého dělat: jen počítá a zapisuje.
--
-- CO SE SEM ZÁMĚRNĚ NEPŘESUNULO
--
-- Výpočet měsíčního přídělu z tarifu (`features.credits_per_month`) zůstává
-- v aplikaci a předává se parametrem. Replikovat výběr tarifu, fallbacky
-- a legacy plány v SQL by znamenalo dvě pravdy o tom, kolik kdo má — a ta
-- v SQL by tiše zastarala. Naopak SPOTŘEBA a DOBITÍ se počítají tady, protože
-- právě ty se mění souběžně a jen tady jsou pod zámkem.
--
-- Sémantika je 1:1 s `getCreditLedger()` v `lib/subscription.ts`:
--   used      = součet kladných `credits` mimo dobití, ořezaný na nule
--   purchased = součet záporných `credits` u dobití, ořezaný na nule
--   remaining = max(0, (monthly + purchased) - used)
--
-- Spustit v SQL editoru Supabase / přes Management API. Bezpečné opakovaně.
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
-- `reservation_id` vrací id vloženého řádku, aby ho volající uměl adresně
-- SMAZAT, když se práce nepovede. Vracet se přes záporný protiřádek by šlo taky,
-- ale kniha kreditů by pak u každého selhání nesla dva řádky místo žádného —
-- a nevyčerpaná rezervace není obchodní událost, kterou by měla evidovat.
RETURNS TABLE (reserved BOOLEAN, remaining INTEGER, reservation_id UUID)
LANGUAGE plpgsql
AS $$
DECLARE
    v_used      INTEGER := 0;
    v_purchased INTEGER := 0;
    v_remaining INTEGER := 0;
    v_id        UUID;
BEGIN
    -- Nezáporný odpočet: nula nebo záporné číslo by přes tuhle cestu vyrobilo
    -- dobití, které má vlastní akci a vlastní idempotenci.
    IF p_credits IS NULL OR p_credits <= 0 THEN
        RETURN QUERY SELECT FALSE, 0, NULL::UUID;
        RETURN;
    END IF;

    -- Serializace nad jedním tenantem. `hashtextextended` kvůli UUID; druhý
    -- argument je jmenný prostor, ať se zámek nesrazí s jiným advisory zámkem.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id::text, 42));

    -- Idempotence: stejný (action, reference_id) už rezervovaný = hotovo, ne chyba.
    -- Odpovídá indexu `ux_credit_transactions_action_ref`. Bez téhle větve by
    -- opakované doručení téhož úkolu spotřebovalo kredity dvakrát.
    IF p_reference_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM credit_transactions
        WHERE action = p_action AND reference_id = p_reference_id
    ) THEN
        -- -1 = „zůstatek nepočítán", NULL id = „není co vracet, nic jsem nevložil"
        RETURN QUERY SELECT TRUE, -1, NULL::UUID;
        RETURN;
    END IF;

    SELECT
        COALESCE(SUM(CASE WHEN action <> 'credit_topup' AND credits > 0 THEN credits ELSE 0 END), 0),
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
  'Atomická rezervace kreditů pod advisory zámkem na klienta. Nahrazuje check-then-act v canPerformAction/deductCredits.';

-- Volá ji výhradně backend přes service role (`supabase/admin.ts`). Odebrání
-- práv rolím prohlížeče je tu ze stejného důvodu jako RLS deny-all jinde:
-- funkce zapisuje do knihy kreditů, takže nesmí být dosažitelná anon klíčem.
REVOKE ALL ON FUNCTION reserve_credits FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_credits FROM anon;
REVOKE ALL ON FUNCTION reserve_credits FROM authenticated;
