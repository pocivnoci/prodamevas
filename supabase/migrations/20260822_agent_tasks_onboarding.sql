-- agent_tasks: sloupce pro durable onboarding.
--
-- Onboarding je poslední místo, kde víceminutová AI práce visela na otevřeném
-- spojení s prohlížečem. Když se spojení rozpadlo (idle timeout proxy, mobilní síť,
-- uspaný tab), hotový config se zahodil — zaplacený a nedoručený. Práce se proto
-- stěhuje do agent_tasks; tyhle tři sloupce k tomu chybí.
--
-- requested_by  Onboarding běží DŘÍV, než existuje řádek v `clients`, takže
--               client_id (záměrně nullable, viz 20260620_agent_tasks.sql) nemá
--               pollovací routu čím autorizovat. Typovaný sloupec, ne klíč v
--               payloadu: `payload` napříč všemi handlery znamená „vstup pro
--               handler" a autorizace do něj nepatří; navíc je sloupec
--               indexovatelný, grepnutelný a překlep v něm je chyba Postgresu,
--               kdežto překlep v payload.userId je neviditelný.
--               Bez FK na auth.users — repo nemá FK do auth schématu nikde.
-- progress      \
-- agent_message / Zrcadlí ig_jobs, aby UI mohlo ukázat, co se právě děje. Dnes
--               onboarding vykresluje čtyři NEPRAVDIVÉ kroky po pevném timeru.
--
-- RLS zůstává deny-all (service-role only). Spustit v SQL Editoru.

ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS requested_by UUID;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS progress INTEGER;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS agent_message TEXT;

COMMENT ON COLUMN agent_tasks.requested_by IS
  'Auth user, který si task vyžádal. NULL = systémový task (cron, webhook) — poll route pak MUSÍ odmítnout (fail closed).';

-- Poll route se ptá „patří tenhle task tomuhle uživateli"; systémových tasků je
-- drtivá většina a ty index nezajímá.
CREATE INDEX IF NOT EXISTS idx_agent_tasks_requested_by
  ON agent_tasks(requested_by) WHERE requested_by IS NOT NULL;
