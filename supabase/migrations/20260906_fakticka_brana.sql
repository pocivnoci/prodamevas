-- Faktická brána (instagram/fact-check.ts)
-- =========================================
-- Kritik hodnotí styl, tahle brána pravdivost. Výsledek patří do stejné tabulky jako
-- ostatní kvalitativní telemetrie příspěvku, ať se dá ptát „kolik postů si tenhle měsíc
-- vymýšlelo čísla" jedním dotazem.
--
-- fact_status: 'clean' (žádné konkrétní tvrzení mimo povolené zdroje)
--            | 'repaired' (nepodložené tvrzení vyměněno za bezpečné znění)
--            | 'flagged' (v textu ZŮSTALO — dashboard u postu varuje)
--            | NULL (brána neproběhla: vypnutá nebo judge nedostupný — NENÍ to „v pořádku")
alter table ig_generation_log add column if not exists fact_status text;
alter table ig_generation_log add column if not exists fact_flags text[];

-- Hledání problémových postů („ukaž, co prošlo označené") nesmí číst celou tabulku.
create index if not exists idx_gen_log_fact_status
    on ig_generation_log (client_id, fact_status)
    where fact_status is not null;
