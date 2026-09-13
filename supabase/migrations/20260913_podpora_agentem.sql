-- Agent podpory: pole tarifu pro Dominance a Impérium.
--
-- KONTEXT:
-- Podpora byla do 13. 9. 2026 statický accordion v Nápovědě a e-mail v patičce.
-- Agent (ElevenLabs Agents Platform, `components/support/SupportAgent.tsx`)
-- odpovídá ze znalostní báze složené z vlastního ceníku a průvodců. Spouští se
-- jako test na dvou nejvyšších tarifech, ne pro všechny.
--
-- PROČ VLASTNÍ POLE A NE `human_support`:
-- `human_support` slibuje ČLOVĚKA — obsah kontroluje marketingový specialista a
-- dotazy se vyřizují přednostně — a má ho jedině Impérium. Kdyby agent jel na
-- něm, Dominance by se rozjela s lidskou podporou, kterou nedostane. Tenhle
-- tarif už dvakrát prodával slib bez implementace (`max_projects`, boolean
-- `priority`), potřetí ne.
--
-- PROČ TARIF NESTAČÍ:
-- Každá konverzace stojí u ElevenLabs minuty nebo zprávy, takže bránu tvoří
-- tarif A skutečná platba — `canUseSupportAgent()` v `lib/subscription.ts`
-- odmítá trial i tarif zdarma od správce. Dunning a odklad obnovy naopak
-- NEBLOKUJE: komu selhala karta, ten podporu potřebuje nejvíc.
--
-- CO TAHLE MIGRACE ZÁMĚRNĚ NEDĚLÁ:
-- Nemění `description` ani odrážky v ceníku. Dokud je to test, není to prodejní
-- slib — a aserce 13.16 a 13.17 (kopie ↔ seed ↔ obchodní podmínky) se tím
-- pádem netýkají. Až se agent začne inzerovat, je to samostatný krok: odrážka,
-- pole a věta v podmínkách zároveň.
--
-- Spustit v SQL Editoru. Idempotentní.

-- jsonb_set přepisuje JEN dotčený klíč — přepsat celý `features` by smazalo
-- cokoliv, co do něj mezitím přibylo.
UPDATE subscription_plans
SET features = jsonb_set(features, '{support_agent}', 'true'::jsonb, true)
WHERE id IN ('chrlit_dominance', 'chrlit_imperium');

-- Explicitní `false` u ostatních aktivních tarifů. Chybějící klíč a `false` se
-- v kódu čtou stejně, ale v datech je rozdíl mezi „neplatí" a „nikdo to neřešil".
UPDATE subscription_plans
SET features = jsonb_set(features, '{support_agent}', 'false'::jsonb, true)
WHERE id IN ('chrlit_start', 'chrlit_rust', 'trial_v2');

-- Legacy tarify (`pro`, `agency`, `business`, `chrlit`…) se schválně NEMĚNÍ:
-- jsou neaktivní a chybějící klíč se čte jako `false`.

-- Kontrola po spuštění:
--   SELECT id, features->'support_agent' AS agent, features->'human_support' AS clovek
--   FROM subscription_plans WHERE is_active ORDER BY price_czk;
