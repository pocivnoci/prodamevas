-- Odložený job: „radši zítra, ale v top kvalitě"
-- ================================================
-- Když je Pro model na obraz nedostupný, engine SMÍ počkat, ale NESMÍ degradovat
-- na flash (CLAUDE.md: „Pro tiery mají fallback na druhé Pro, nikdy na flash").
-- Doteď takový job selhal, vrátil kredit a čekal, až na něj uživatel klikne znovu.
--
-- Nově se zaparkuje: zůstane `failed` (stav má pevný CHECK a nový stav by rozbil
-- UI i resume cestu, která na `failed` + caption checkpoint spoléhá), ale dostane
-- termín návratu. `retry_after IS NOT NULL` = „tenhle job není mrtvý, jen čeká".
--
-- Kredit se u zaparkovaného jobu ZÁMĚRNĚ nevrací — práce se dokončí, jen později.
-- Vrací se teprve tehdy, když dojdou pokusy (viz /api/cron/job-resume).

ALTER TABLE ig_jobs ADD COLUMN IF NOT EXISTS retry_after TIMESTAMPTZ;
ALTER TABLE ig_jobs ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN ig_jobs.retry_after IS
  'Kdy smí sweep job znovu zvednout. NULL = job není zaparkovaný (běžné selhání).';
COMMENT ON COLUMN ig_jobs.retry_count IS
  'Kolikrát už byl job odložen — vstup do exponenciálního backoffu a strop pokusů.';

-- Sweep hledá jen splatné zaparkované joby; částečný index drží dotaz levný
-- i s desítkami tisíc hotových jobů v tabulce.
CREATE INDEX IF NOT EXISTS idx_ig_jobs_parked
  ON ig_jobs(retry_after)
  WHERE retry_after IS NOT NULL AND status = 'failed';
