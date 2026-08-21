-- Import produktu z přímého odkazu
-- ═══════════════════════════════════════════════════════════
--
-- Katalog uměl produkt vytvořit ručně nebo vyscrapovat celý web najednou.
-- Mezi tím chyběl krok „mám URL jednoho produktu" — a při něm je zdrojový
-- odkaz jediná informace, která šla dosud zahodit, přestože je to jediný
-- stabilní identifikátor produktu na straně e-shopu:
--
--   * dedup — druhý import téhož odkazu nesmí založit dvojče, i když si
--     mezitím uživatel přejmenoval produkt (a slug tedy nesedí),
--   * refresh — bez odkazu se nedá cena ani popis později znovu načíst.
--
-- Nullable záměrně: produkty z ručního formuláře, z AI řady i ze staršího
-- scrapu webu žádný zdrojový odkaz nemají a mít nebudou.

ALTER TABLE ig_products
  ADD COLUMN IF NOT EXISTS source_url text;

-- Dedup se ptá vždy v rámci klienta (multi-tenancy) na konkrétní odkaz.
CREATE INDEX IF NOT EXISTS idx_ig_products_source_url
  ON ig_products (client_id, source_url) WHERE source_url IS NOT NULL;
