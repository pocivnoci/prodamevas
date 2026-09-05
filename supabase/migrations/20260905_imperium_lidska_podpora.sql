-- Impérium: lidská podpora jako pole tarifu, ne jako věta na kartě.
--
-- KONTEXT:
-- Impérium stojí 8 999 Kč a od Dominance ho dělil jen objem kreditů a přednost
-- ve frontě. Přidává se to, co stroj nedodá: obsah pravidelně prochází
-- marketingový specialista a dotazy se vyřizují přednostně.
--
-- PROČ TO NENÍ JEN ODRÁŽKA. Tenhle tarif už jednou prodával „plný objem pro
-- agentury a e-shopy" přes `max_projects`, který nečetl žádný kód — zákazník
-- kupoval něco, co nedostal. A „prioritní generování" bylo do 8/2026 totéž.
-- Aby se historie neopakovala potřetí, je podpora POLE v `features`:
--   • seznam funkcí v aplikaci (`SubscriptionSection`) ho čte z DB, ne z kopie,
--   • aserce 13.16 nepustí odrážku o podpoře na tarif, který pole nemá,
--   • aserce 13.17 nepustí slib, který není v obchodních podmínkách.
-- Plnění je lidské, takže ho kód nevynutí — ale nikdo ho nemůže slíbit omylem
-- na tarifu, kde neplatí.
--
-- Spustit v SQL Editoru. Idempotentní.

-- jsonb_set přepisuje JEN dotčený klíč — přepsat celý `features` by smazalo
-- cokoliv, co do něj mezitím přibylo.
UPDATE subscription_plans
SET features = jsonb_set(features, '{human_support}', 'true'::jsonb, true),
    description = 'Postav impérium — 260 kreditů/měs pro jednu značku, product studio, kontrola obsahu marketingovým specialistou'
WHERE id = 'chrlit_imperium';

-- Explicitní `false` u ostatních aktivních tarifů. Chybějící klíč a `false` se
-- v kódu čtou stejně, ale v datech je rozdíl mezi „neplatí" a „nikdo to neřešil"
-- — a tenhle slib se nesmí nikam rozlézt tichým defaultem.
UPDATE subscription_plans
SET features = jsonb_set(features, '{human_support}', 'false'::jsonb, true)
WHERE id IN ('chrlit_start', 'chrlit_rust', 'chrlit_dominance', 'trial_v2');

-- Legacy tarify (`pro`, `agency`, `business`, `chrlit`…) se schválně NEMĚNÍ:
-- jsou neaktivní a chybějící klíč se čte jako `false`.
