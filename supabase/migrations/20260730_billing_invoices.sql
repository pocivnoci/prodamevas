-- ═══════════════════════════════════════════════════════════════
-- Migration: fakturační údaje zákazníka + evidence vystavených faktur
-- ═══════════════════════════════════════════════════════════════
-- Do teď o zákazníkovi z platby zůstal jen `payments.payer_email` — z toho
-- nejde vystavit daňový doklad. Tahle migrace přidává dvě věci:
--
--   1. ig_billing_details — na koho se fakturuje (a u spotřebitele důkaz
--      souhlasu se zahájením plnění; bez něj právo na odstoupení do 14 dnů
--      NEZANIKÁ a vrácení peněz je vymahatelné);
--   2. invoices — co už bylo vystaveno, aby přehraný Comgate callback
--      nevystavil druhou fakturu na tutéž platbu.
--
-- RLS zapnuté bez politik = přístup výhradně přes service role (supabase/admin),
-- stejně jako u ostatních ig_* tabulek.
-- ═══════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────
-- 1. Fakturační údaje — jeden řádek na klienta (tenanta)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ig_billing_details (
  client_id uuid PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,

  -- Rozhoduje o právním režimu, ne o vzhledu formuláře: spotřebitel má
  -- 14denní odstoupení a nesmí se na něj uplatnit omezení odpovědnosti.
  customer_type text NOT NULL DEFAULT 'company'
    CHECK (customer_type IN ('company', 'consumer')),

  name text NOT NULL,
  ico text,
  dic text,
  street text NOT NULL,
  city text NOT NULL,
  zip text NOT NULL,
  country_code text NOT NULL DEFAULT 'CZ',
  -- Kam posílat fakturu. Když chybí, použije se payer_email z platby.
  email text,

  -- Souhlas se zahájením plnění před uplynutím 14denní lhůty (§1837 obč. zák.).
  -- Ukládá se ČAS i ZNĚNÍ, protože v případném sporu se prokazuje, s čím přesně
  -- zákazník souhlasil — samotný boolean by byl bezcenný.
  instant_access_consent_at timestamptz,
  instant_access_consent_text text,

  -- Znění obchodních podmínek, které zákazník odsouhlasil (datum účinnosti).
  terms_version text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ig_billing_details IS
  'Fakturační údaje tenanta + důkaz souhlasu se zahájením plnění. Jeden řádek na klienta.';
COMMENT ON COLUMN ig_billing_details.instant_access_consent_at IS
  'Kdy spotřebitel souhlasil se zpřístupněním služby ihned. NULL u spotřebitele = právo na odstoupení do 14 dnů TRVÁ.';

ALTER TABLE ig_billing_details ENABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────
-- 2. Vystavené faktury
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,

  provider text NOT NULL DEFAULT 'fakturoid',
  -- ID dokladu u poskytovatele; NULL dokud se vystavení nepovedlo.
  provider_invoice_id text,
  provider_subject_id text,
  number text,

  -- V haléřích — stejná jednotka jako payments.amount, aby se nemíchaly škály.
  total_czk integer,
  currency text NOT NULL DEFAULT 'CZK',

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'issued', 'failed')),

  pdf_url text,
  public_url text,
  issued_at timestamptz,
  -- Poslední chyba vystavení — bez ní by tichý fail znamenal zákazníka bez
  -- dokladu a nikoho, kdo o tom ví.
  error text,
  attempts integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE invoices IS
  'Evidence dokladů vystavených k platbám. Jedna platba = nejvýše jedna faktura (viz unikátní index).';

-- IDEMPOTENCE: přehraný callback nebo ruční retry nesmí vystavit druhý doklad
-- na tutéž platbu. Číselná řada faktur je nevratná — duplicitu nejde „smazat",
-- musela by se stornovat.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_payment_unique
  ON invoices (payment_id) WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_client
  ON invoices (client_id, created_at DESC);

-- Pro dohledání dokladů, které se nepodařilo vystavit (retry / ruční zásah).
CREATE INDEX IF NOT EXISTS idx_invoices_failed
  ON invoices (updated_at DESC) WHERE status = 'failed';

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
