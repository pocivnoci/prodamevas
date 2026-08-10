-- Druhá platební brána potřebuje vlastní lokátor
-- ==============================================
-- ComGate zabírá platbu přes `payments.comgate_trans_id`. Stripe žádný takový
-- sloupec neměl, takže jeho webhook nemohl platbu **idempotentně zabrat** — a bez
-- toho by replay webhooku (Stripe posílá opakovaně, dokud nedostane 2xx) aktivoval
-- plán dvakrát a vystavil dva doklady. Přesně proto webhook dosud jen ověřoval
-- podpis a nic neaktivoval.
--
-- Doktrína je stejná jako u faktur: **UNIQUE INDEX je nárok na zpracování.**
-- Když podmíněný claim nevrátí řádek, je to konec — nikdy insert fallback.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'comgate';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_ref TEXT;

-- Existující řádky jsou všechny ComGate. Backfill dá oběma branám JEDEN tvar
-- lokátoru, aniž by se sáhlo na běžící ComGate cestu (ta dál čte comgate_trans_id).
UPDATE payments
   SET provider_ref = comgate_trans_id
 WHERE provider_ref IS NULL
   AND comgate_trans_id IS NOT NULL;

-- Jedna platba u dané brány = jeden řádek. Tohle je ta pojistka proti dvojí
-- aktivaci při replay webhooku.
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref_uniq
    ON payments(provider, provider_ref)
    WHERE provider_ref IS NOT NULL;

-- Webhook hledá podle provider_ref; bez indexu by to byl seq scan na horké cestě.
CREATE INDEX IF NOT EXISTS payments_provider_status_idx
    ON payments(provider, status);

COMMENT ON COLUMN payments.provider IS 'comgate | stripe — která brána platbu zpracovala';
COMMENT ON COLUMN payments.provider_ref IS 'ID platby u brány (ComGate transId / Stripe payment_intent). Unikátní v rámci provider — nárok na zpracování.';
