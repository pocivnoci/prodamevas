-- Index pro „posledních N příspěvků tohohle klienta".
--
-- Tenhle tvar dotazu je v horké cestě generování hned třikrát:
--   1. autopilot — posledních 30 captionů do sekce NEOPAKUJ SE
--   2. findSemanticEcho — posledních 30 embeddingů pro sémantickou bránu
--   3. scoreConsistencyAndEmbed — až 60 embeddingů pro zlatý centroid
--
-- Dosud ho neobsluhoval žádný index. `idx_ig_posts_metrics` je částečný
-- (WHERE likes IS NOT NULL) a `idx_ig_posts_channel` sice umí prefix client_id,
-- ale řazení podle created_at pak stejně padá na sort. Při 307 řádcích to nikdo
-- nepozná; s rostoucím počtem příspěvků na klienta je to první místo, které
-- začne škrtit každou generaci.
--
-- CONCURRENTLY záměrně NE: tabulka je dnes malá, index vznikne okamžitě, a
-- Management API pouští dotazy v transakci, kde CONCURRENTLY nelze použít.
-- Až tabulka naroste, další index tvořte mimo transakci.

create index if not exists idx_ig_posts_client_recent
    on ig_posts (client_id, created_at desc);
