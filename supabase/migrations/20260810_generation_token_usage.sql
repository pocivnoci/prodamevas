-- Telemetrie spotřeby modelů na ig_generation_log
-- ================================================
-- COGS tohohle produktu jsou tokeny, ale gemini-client.ts doteď nikde nečetl
-- usageMetadata. Cenový model (docs/pricing/cost-model.ts) proto stojí na jednom
-- blended údaji z Google faktury ($0,50/post) a per-media rozpad je označený [ODHAD].
-- Tyhle sloupce ho nahrazují měřením per příspěvek.
--
-- Sloupec tokens_used existoval už dřív, ale nikdy ho nikdo nenaplnil (jediné výskyty
-- byly definice typu a insert). Teď dostane hodnotu a zbytek ho rozpadá.

ALTER TABLE ig_generation_log ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER;
ALTER TABLE ig_generation_log ADD COLUMN IF NOT EXISTS output_tokens INTEGER;
-- Tokeny „přemýšlení" u modelů s thinking režimem — účtují se sazbou výstupu.
ALTER TABLE ig_generation_log ADD COLUMN IF NOT EXISTS thought_tokens INTEGER;
-- Část promptu obsloužená z cache (implicitní i explicitní) — levnější sazba.
ALTER TABLE ig_generation_log ADD COLUMN IF NOT EXISTS cached_tokens INTEGER;
-- Počet volání modelu na jeden příspěvek — odpovídá na „kolik kroků ten post stál".
ALTER TABLE ig_generation_log ADD COLUMN IF NOT EXISTS model_calls INTEGER;
-- NULL = pro některý použitý model chybí ověřená sazba. Záměrně NULL, ne 0:
-- vymyšlená nula vypadá jako „levné" a je k nerozeznání od skutečně levného postu.
-- Stejný důvod, proč critic_score loguje NULL místo ploché sedmičky.
ALTER TABLE ig_generation_log ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10, 6);
-- Rozpad po krocích (copywriter, kritik, designér, vision QA, video…) — kvůli otázce
-- „který krok je drahý". JSONB, protože kroky se s vývojem pipeline mění.
ALTER TABLE ig_generation_log ADD COLUMN IF NOT EXISTS usage_breakdown JSONB;

-- Dotaz „kolik nás stál tenhle klient minulý měsíc" nesmí projít celou tabulkou.
CREATE INDEX IF NOT EXISTS idx_ig_generation_log_cost
    ON ig_generation_log(client_id, created_at DESC)
    WHERE cost_usd IS NOT NULL;
