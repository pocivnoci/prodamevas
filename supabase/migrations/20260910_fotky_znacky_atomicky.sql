-- Přidání fotky značky jako JEDNA operace
-- ═══════════════════════════════════════════════════════════════════════════
-- PROBLÉM (hlášeno zákazníkem Olympia Fitness, 10. 9. 2026)
--
--   „nejdřív po 5ks a pak jen po 1…1 se nahrála…a další už se nenahrála“
--   „Jen tahle se nahrála a koukám že 2×“
--
-- Obojí je tentýž závod. `uploadBrandImage()` fotku zapisovala takhle:
--
--     SELECT config FROM clients …          -- přečti pole fotek
--     const updated = [...existing, nova]   -- přidej svoji
--     UPDATE clients SET config = …         -- zapiš CELÉ pole zpátky
--
-- Mezi čtením a zápisem je celý sharp, upload do storage a volání vision modelu,
-- tedy klidně minuta. Když v té době běží druhé nahrání (a běží — uživatelka
-- čekala u zaseknutého ukazatele a zkusila to znovu), přečte TÉŽ pole bez té
-- první fotky a přepíše ho svým. Podle pořadí zápisů z toho vyjde buď
-- **zmizelá fotka**, nebo **fotka dvakrát**. Zákaznice viděla obojí; v produkci
-- po ní zůstaly dva řádky `brand-1789020513164.jpg` a `brand-1789020575733.jpg`
-- s týmž popisem „posilovací stroj na nohy“ — jedna fotka, 62 sekund rozdíl.
--
-- ŘEŠENÍ
--
-- Přidání je jeden příkaz pod zámkem na klienta a je IDEMPOTENTNÍ: fotka se
-- stejným URL se nepřidá podruhé. Ve dvojici s obsahovým názvem souboru
-- (`brand-<sha256>.jpg` místo `brand-<Date.now()>.jpg`) tím opakované nahrání
-- téhož snímku přestává být nová položka — a to je přesně to, co člověk dělá,
-- když mu ukazatel připadá zaseknutý.
--
-- Legacy pole umí nést i holé URL jako řetězec (viz `getConfigBrandImageObjects`),
-- takže se kontrola duplicity dívá na obě podoby.
--
-- Spustit v SQL editoru Supabase / přes Management API. Bezpečné opakovaně.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION append_brand_image(
    p_client_id UUID,
    p_image     JSONB
)
-- `added=false, total>=0`  → fotka už tam byla (opakované nahrání)
-- `added=false, total=-1`  → klient neexistuje
RETURNS TABLE (added BOOLEAN, total INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
    v_config JSONB;
    v_list   JSONB;
    v_url    TEXT := p_image->>'url';
BEGIN
    IF v_url IS NULL OR v_url = '' THEN
        RETURN QUERY SELECT FALSE, -1;
        RETURN;
    END IF;

    -- Serializace nad jedním klientem. Jiný jmenný prostor než rezervace kreditů
    -- (42), ať se dvě nesouvisející operace navzájem nezdržují.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id::text, 77));

    SELECT config INTO v_config FROM clients WHERE id = p_client_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, -1;
        RETURN;
    END IF;

    v_list := COALESCE(v_config->'brandReferenceImages', '[]'::jsonb);
    IF jsonb_typeof(v_list) <> 'array' THEN
        v_list := '[]'::jsonb;
    END IF;

    -- Už tam je? Hotovo, ne chyba. `e` může být objekt {url,…} i holý řetězec.
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_list) e
        WHERE CASE jsonb_typeof(e)
                  WHEN 'object' THEN e->>'url'
                  WHEN 'string' THEN e #>> '{}'
                  ELSE NULL
              END = v_url
    ) THEN
        RETURN QUERY SELECT FALSE, jsonb_array_length(v_list);
        RETURN;
    END IF;

    v_list := v_list || jsonb_build_array(p_image);

    UPDATE clients
    SET config = jsonb_set(COALESCE(v_config, '{}'::jsonb), '{brandReferenceImages}', v_list)
    WHERE id = p_client_id;

    RETURN QUERY SELECT TRUE, jsonb_array_length(v_list);
END;
$$;

COMMENT ON FUNCTION append_brand_image IS
  'Idempotentní přidání fotky značky pod advisory zámkem na klienta. Nahrazuje read-modify-write v uploadBrandImage.';

-- Volá ji výhradně backend přes service role — zapisuje do konfigurace klienta.
REVOKE ALL ON FUNCTION append_brand_image FROM PUBLIC;
REVOKE ALL ON FUNCTION append_brand_image FROM anon;
REVOKE ALL ON FUNCTION append_brand_image FROM authenticated;
