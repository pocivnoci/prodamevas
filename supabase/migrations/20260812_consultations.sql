-- Nastavení značky na míru — placená vstupní konzultace
-- =====================================================
-- Dvě věci, které dosud v modelu nešlo vyjádřit:
--
--   1. Platba, která NEAKTIVUJE tarif. Každá dosavadní platba znamenala
--      předplatné; jednorázová služba za 990 Kč ale nesmí nic aktivovat —
--      a přesto na ni musí vzniknout daňový doklad úplně stejně.
--   2. Nárok bez platby. Kdo koupí 6 nebo 12 měsíců, dostane nastavení
--      v ceně; žádné peníze se nehýbou, ale schůzka musí vzniknout.

-- ─── Druh platby ────────────────────────────────────────────────────────────
-- DEFAULT 'subscription' je správný backfill: všechny dosavadní platby byly
-- předplatné. Bez tohohle rozlišení by `finalizePaidPayment` aktivoval tarif
-- i zaplacené konzultaci — zákazník by za 990 Kč dostal měsíc Startu.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'subscription';

DO $$ BEGIN
    ALTER TABLE payments ADD CONSTRAINT payments_kind_chk CHECK (kind IN ('subscription', 'service'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Konzultace ─────────────────────────────────────────────────────────────
-- Stavový automat, ne příznak. Každý přechod je vidět a dá se na něj navázat:
--
--   entitled   nárok vznikl (koupené 6/12 měsíců) — čeká na rezervaci
--   paid       zaplaceno jednorázově 990 Kč — čeká na rezervaci
--   booked     termín rezervovaný přes Cal.com
--   completed  schůzka proběhla
--   cancelled  zrušeno (zákazníkem nebo námi)
CREATE TABLE IF NOT EXISTS consultations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    -- NULL u nároku z předplatného: za tu schůzku se zvlášť neplatilo.
    payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'entitled'
        CHECK (status IN ('entitled', 'paid', 'booked', 'completed', 'cancelled')),
    -- Odkud nárok vzešel — do e-mailu i do statistiky, co ve skutečnosti prodává.
    source TEXT NOT NULL DEFAULT 'purchase'
        CHECK (source IN ('purchase', 'term_6', 'term_12', 'manual')),

    -- Cal.com. `booking_uid` je idempotenční klíč webhooku: stejná rezervace
    -- dorazí opakovaně, dokud nedostane 2xx.
    booking_uid TEXT,
    booking_url TEXT,
    scheduled_at TIMESTAMPTZ,

    -- Podklad, který si engine napíše sám z analýzy značky. Markdown.
    brief TEXT,
    brief_generated_at TIMESTAMPTZ,

    -- Co ze schůzky vzešlo — vyplňuje se ručně po hovoru.
    notes TEXT,
    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Jedna rezervace patří právě jedné konzultaci — to je nárok na zpracování
-- webhooku, stejně jako `payments_provider_ref_uniq` u plateb.
CREATE UNIQUE INDEX IF NOT EXISTS consultations_booking_uid_uniq
    ON consultations (booking_uid) WHERE booking_uid IS NOT NULL;

-- Jedna zaplacená platba nesmí založit dvě konzultace (replay webhooku).
CREATE UNIQUE INDEX IF NOT EXISTS consultations_payment_uniq
    ON consultations (payment_id) WHERE payment_id IS NOT NULL;

-- Nárok z předplatného se uděluje JEDNOU za klienta. Bez tohohle by každá
-- obnova ročního tarifu založila další schůzku zdarma.
CREATE UNIQUE INDEX IF NOT EXISTS consultations_entitlement_uniq
    ON consultations (client_id) WHERE source IN ('term_6', 'term_12');

CREATE INDEX IF NOT EXISTS idx_consultations_client ON consultations (client_id, created_at DESC);
-- Fronta „čeká na rezervaci" — z ní chodí připomínky.
CREATE INDEX IF NOT EXISTS idx_consultations_pending
    ON consultations (created_at) WHERE status IN ('entitled', 'paid');

ALTER TABLE consultations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE consultations IS
    'Vstupní nastavení značky. Peníze jdou vždy přes payments (kvůli dokladu), Cal.com řeší jen termín a video.';
