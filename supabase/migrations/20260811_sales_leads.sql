-- Obchodní agent — databáze leadů
-- ================================
-- Produkt umí generovat obsah pro 13 značek a nevzal ani korunu: nikdo a nic
-- nepřivádí zákazníky. Tohle je fronta, ze které obchodní agent bere.
--
-- Dvě věci tu nejsou kvůli pořádku, ale kvůli doložitelnosti:
--   `source` + `source_ref` + `discovered_at` = doklad o PŮVODU kontaktu. Když se
--   někdo zeptá, odkud jeho adresu máme, musí na to jít odpovědět z dat.
--   `score_reasons` = proč je lead ve frontě. U obchodu musí jít vysvětlit, proč
--   zrovna tahle firma — skóre počítá kód deterministicky, ne model.
--
-- Suppression se ZÁMĚRNĚ neduplikuje: platí globální `email_optouts` a kontroluje
-- se před KAŽDÝM odesláním. Druhý seznam = druhé místo, kde se na odhlášení zapomene.

CREATE TABLE IF NOT EXISTS leads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Původ kontaktu
    source TEXT NOT NULL,                    -- 'instagram' | 'import' | 'manual'
    source_ref TEXT,                         -- id profilu / řádek importu
    seed_account TEXT,                       -- přes který zárodečný účet se našel
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Firma
    company TEXT,
    ig_handle TEXT,
    website TEXT,
    email TEXT,

    -- Kvalifikace
    score INTEGER NOT NULL DEFAULT 0,
    score_reasons JSONB NOT NULL DEFAULT '[]',
    last_post_at TIMESTAMPTZ,                -- signál „spící profil" = i první věta mailu
    followers INTEGER,

    -- Průchod trychtýřem
    status TEXT NOT NULL DEFAULT 'new'
        CHECK (status IN ('new','qualified','rejected','contacted','replied','won','lost')),
    reject_reason TEXT,
    last_contacted_at TIMESTAMPTZ,
    followup_at TIMESTAMPTZ,                 -- naplánovaný JEDINÝ follow-up
    followup_sent BOOLEAN NOT NULL DEFAULT FALSE,

    -- Ukázka na míru (předgenerovaná, aby stránka naskočila hned)
    preview_token TEXT,
    preview_ready_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tentýž podnik se nesmí dostat do fronty dvakrát. Částečné indexy, protože
-- e-mail ani source_ref nemusí být hned známé.
CREATE UNIQUE INDEX IF NOT EXISTS leads_source_ref_uniq
    ON leads(source, source_ref) WHERE source_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS leads_email_uniq
    ON leads(lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS leads_preview_token_uniq
    ON leads(preview_token) WHERE preview_token IS NOT NULL;

-- Fronta k oslovení: kvalifikovaní, nejlepší skóre první.
CREATE INDEX IF NOT EXISTS leads_queue_idx
    ON leads(status, score DESC, discovered_at) WHERE status = 'qualified';
-- Splatné follow-upy.
CREATE INDEX IF NOT EXISTS leads_followup_idx
    ON leads(followup_at) WHERE followup_at IS NOT NULL AND followup_sent = FALSE;

-- Trychtýř se počítá ODSUD, ne ze stavu na leadu: stav je „kde je teď", události
-- jsou „co se stalo". Bez nich nejde spočítat míra odpovědí, která je podle
-- playbooku brzda celé pipeline (pod 5 % → ladit zprávu, nezvyšovat objem).
CREATE TABLE IF NOT EXISTS lead_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    kind TEXT NOT NULL
        CHECK (kind IN ('discovered','qualified','rejected','sent','opened','clicked',
                        'previewed','replied','unsubscribed','bounced','blocked')),
    detail JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_events_lead_idx ON lead_events(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lead_events_kind_idx ON lead_events(kind, created_at DESC);

COMMENT ON TABLE leads IS 'Fronta obchodního agenta. source+discovered_at je doklad o původu kontaktu.';
COMMENT ON COLUMN leads.score_reasons IS 'Proč je lead ve frontě — počítá kód deterministicky, ne model.';
COMMENT ON TABLE lead_events IS 'Append-only. Trychtýř a míra odpovědí se počítají odsud.';
