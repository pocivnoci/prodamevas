-- Jeden instagramový účet = jedna značka
-- ════════════════════════════════════════════════════════════════════════════
-- `ig_connections` hlídal jen „jedno připojení na klienta" (client_id, provider).
-- Opačný směr nehlídal nic: dva klienti mohli mít `connected` tentýž Instagram.
-- Publisher pak pošle příspěvky značky A na profil značky B a obě v Nastavení
-- vidí „Připojeno".
--
-- Hranici drží databáze, ne kontrola v kódu: „zjisti a pak zapiš" je závod.
-- Kolizi (23505) překládá `saveConnection` na větu pro člověka.
--
-- Index je částečný — jen mezi `connected`. Vypršelé a zrušené řádky účet
-- neblokují, takže značka, která ho pustila, nebrání jiné si ho připojit.
--
-- `transport` v klíči schválně NENÍ: tentýž účet přes most i přes vlastní Meta
-- appku je pořád tentýž účet. (Obě cesty dnes hlásí jiné ID, takže je index
-- nerozliší — kdyby se ID sjednotila, chceme kolizi, ne tichý souběh.)
--
-- PŘED spuštěním musí být data čistá, jinak index nevznikne:
--   select provider, ig_user_id, count(*) from ig_connections
--   where status = 'connected' group by 1, 2 having count(*) > 1;
-- Oprava rozporů s upload-postem: npx tsx scripts/uploadpost-reconcile.ts --apply
--
-- Spustit v SQL editoru Supabase / přes Management API query endpoint,
-- NIKDY `db push`. Bezpečné opakovaně.

create unique index if not exists ig_connections_jeden_ucet_jedna_znacka
    on ig_connections (provider, ig_user_id)
    where status = 'connected';
