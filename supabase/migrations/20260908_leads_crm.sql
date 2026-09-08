-- Evidence klientů — obchod se přestěhuje z tabulky do systému
-- ============================================================
-- Luděk vedl obchod v `Evidence_klientu.xlsx` ve svém soukromém Drive: seznam
-- firem, telefony, stav jednání, termíny schůzek. Dvě věci na tom nešly nechat.
-- Seznam klientů je nejpřenosnější aktivum, které firma má, a v cizím Drive
-- odchází s majitelem účtu. A most do Sheets, který tu už je (`lib/tasks/
-- sheet-parse.ts`), čte přes API klíč — a ten funguje JEN na tabulce sdílené
-- „kdokoli s odkazem". Na úkoly to stačí, na telefonní čísla firem ne.
--
-- Model už existoval: `leads` + `lead_events` plní obchodní agent od 11. 8. 2026.
-- Chyběly mu sloupce, které si člověk u jednání píše, a chyběla obrazovka.
-- Tahle migrace dodává první; druhou dodává `LeadsTab`.
--
-- **Stav zůstává jeden.** Agent zapisuje `qualified`/`rejected`/`contacted`,
-- člověk `negotiating`/`offer`/`active`/`inactive`. Dva sloupce (jeden pro
-- robota, jeden pro člověka) by znamenaly dvě pravdy o tomtéž leadu a nikdo by
-- nevěděl, která platí. Fronta agenta se ptá výhradně na `status = 'qualified'`
-- (`leads_queue_idx`), takže lidské stavy do ní nikdy nespadnou.

-- ─── Lidské sloupce ──────────────────────────────────────────

ALTER TABLE leads
    -- „K0001" z tabulky. Člověk se na lead odkazuje jménem, ne UUID.
    ADD COLUMN IF NOT EXISTS ref              TEXT,
    ADD COLUMN IF NOT EXISTS contact_person   TEXT,
    ADD COLUMN IF NOT EXISTS phone            TEXT,
    ADD COLUMN IF NOT EXISTS client_type      TEXT
        CHECK (client_type IS NULL OR client_type IN ('firma','osvc','jednotlivec','partner','jine')),
    ADD COLUMN IF NOT EXISTS priority         TEXT
        CHECK (priority IS NULL OR priority IN ('vysoka','stredni','nizka')),
    ADD COLUMN IF NOT EXISTS meeting_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS next_contact_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS notes            TEXT,
    ADD COLUMN IF NOT EXISTS requirements     TEXT,
    ADD COLUMN IF NOT EXISTS offered          TEXT,
    -- Text, ne číslo: „Růst — zdarma / referenční klient" je taky rozpočet.
    ADD COLUMN IF NOT EXISTS budget           TEXT,
    ADD COLUMN IF NOT EXISTS next_step        TEXT,
    -- Stejná konvence jako `tasks.owner_email` — člověk, ne role.
    ADD COLUMN IF NOT EXISTS owner_email      TEXT;

-- Číslo leadu přiděluje databáze, ne ruka. V tabulce se K0004 a K0005 objevily
-- dvakrát hned první den — a to je přesně ta chyba, kterou sekvence nezná.
CREATE SEQUENCE IF NOT EXISTS leads_ref_seq START 1;
ALTER TABLE leads ALTER COLUMN ref SET DEFAULT 'K' || lpad(nextval('leads_ref_seq')::text, 4, '0');
CREATE UNIQUE INDEX IF NOT EXISTS leads_ref_uniq ON leads(ref) WHERE ref IS NOT NULL;

-- ─── Stav: k trychtýři agenta přibývají lidské fáze ──────────

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check CHECK (status IN (
    -- Zapisuje agent
    'new','qualified','rejected','contacted','replied',
    -- Zapisuje člověk
    'negotiating','offer','active','won','lost','inactive'
));

-- ─── Historie kontaktů ───────────────────────────────────────
-- List „Historie kontaktů" z tabulky. Ukládá se do `lead_events`, protože
-- trychtýř se počítá odsud — a ručně zavolaný telefonát je pro míru odpovědí
-- stejná událost jako odeslaný e-mail agenta.

ALTER TABLE lead_events DROP CONSTRAINT IF EXISTS lead_events_kind_check;
ALTER TABLE lead_events ADD CONSTRAINT lead_events_kind_check CHECK (kind IN (
    -- Zapisuje agent
    'discovered','qualified','rejected','sent','opened','clicked',
    'previewed','replied','unsubscribed','bounced','blocked',
    -- Zapisuje člověk
    'call','meeting','online','note','status'
));

-- Kdo událost zapsal. U agentových událostí zůstává NULL — ty píše robot.
ALTER TABLE lead_events ADD COLUMN IF NOT EXISTS actor TEXT;

-- Nejbližší schůzky a splatné kroky nahoru: tohle je jediný dotaz, který
-- obchodník ráno dělá.
CREATE INDEX IF NOT EXISTS leads_meeting_idx
    ON leads(meeting_at) WHERE meeting_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_next_contact_idx
    ON leads(next_contact_at) WHERE next_contact_at IS NOT NULL;

COMMENT ON COLUMN leads.ref IS 'Lidské číslo leadu (K0001). Přiděluje sekvence, ne ruka.';
COMMENT ON COLUMN leads.status IS 'Jeden trychtýř pro agenta i člověka. Fronta agenta = status ''qualified''.';
COMMENT ON COLUMN lead_events.actor IS 'E-mail člověka, NULL = zapsal agent.';
