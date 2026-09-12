-- ═══════════════════════════════════════════════════════════════
-- Migration: karanténa opuštěných značek (`clients.deactivated_at`)
-- ═══════════════════════════════════════════════════════════════
-- `is_active = false` říká „tuhle značku už neobsluhujeme", ale neříká OD KDY.
-- Bez toho data nejde druhý stupeň úklidu udělat bezpečně:
--
--   • Zásady zpracování (`app/privacy/page.tsx`) slibují „údaje účtu a obsah:
--     po dobu trvání účtu a 30 dní po jeho zrušení, poté smazány nebo
--     anonymizovány". Ta lhůta potřebuje počáteční razítko, jinak je to buď
--     slib, který nikdo nesplní, nebo mazání dřív, než měl člověk šanci se vrátit.
--   • Deaktivace je vratná (`is_active = true`), mazání ne. Karanténa je to
--     jediné okno, ve kterém se omyl sweepu dá ještě opravit.
--
--   PŘED   clients: is_active = false, kdy se to stalo neví nikdo
--   PO     clients: is_active = false + deactivated_at
--          scripts/neaktivni-klienti.ts --deaktivuj razítko zapisuje
--          scripts/smazat-opustene-klienty.ts podle něj počítá 30 dní
--
-- Daňové doklady se tím NEMAŽOU: `invoices.client_id` má ON DELETE CASCADE,
-- takže klient s jakoukoli platbou nebo fakturou se v druhém stupni jen
-- anonymizuje (řádek `clients` zůstane). Zákonná lhůta na doklady je 10 let
-- a žádostí o výmaz se zkrátit nedá.
--
-- Backfill: značky deaktivované před touhle migrací dostanou razítko `now()`,
-- ne datum vzniku. Karanténa jim tak začíná dneškem — raději o 30 dní později
-- než smazat něco, u čeho nevíme, kdy vypadlo z provozu.
--
-- Run: Supabase Management API / SQL editor. Bezpečné re-run (IF NOT EXISTS
-- + podmíněný UPDATE jen nad NULL razítky).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE clients ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

COMMENT ON COLUMN clients.deactivated_at IS
  'Kdy značka vypadla z provozu (is_active = false). Začátek karantény před druhým stupněm úklidu: po 30 dnech (zásady zpracování) ji scripts/smazat-opustene-klienty.ts smaže, a pokud má platbu nebo doklad, jen anonymizuje. NULL = nikdy deaktivovaná.';

-- Částečný index: dotaz druhého stupně se ptá výhradně na deaktivované značky
-- („is_active = false AND deactivated_at < now() - 30 dní"), takže aktivní
-- tenanti do indexu nepatří — jsou to jednotky řádků místo celé tabulky.
CREATE INDEX IF NOT EXISTS idx_clients_deactivated_at
  ON clients (deactivated_at)
  WHERE is_active = false;

UPDATE clients
   SET deactivated_at = now()
 WHERE is_active = false
   AND deactivated_at IS NULL;
