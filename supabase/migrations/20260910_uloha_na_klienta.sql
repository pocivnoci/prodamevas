-- Rozeslání denní práce na klienta místo jednoho sdíleného běhu
-- ════════════════════════════════════════════════════════════════════════════
-- Denní agenti dnes projdou VŠECHNY klienty v jedné úloze s rozpočtem 600 s
-- (`lib/agents/client-sweep.ts`). Při 26 klientech to trvá vteřiny — ale jen
-- proto, že se produkt nepoužívá: zásobníky nápadů jsou plné, takže
-- `idea_replenish` každý den vrací `added: 0` a žádné AI volání nedělá.
--
-- Jakmile klienti obsah reálně berou, dělá doplnění zásobníku skutečné volání
-- modelu na klienta (~20-60 s). Do 600 s se vejde ~20 klientů. Při cíli 300
-- klientů by se na každého dostalo jednou za dva týdny — rotace zajistí, že to
-- nebude pořád tentýž smolař, ale neobslouží to nikoho.
--
-- `client-sweep.ts` to o sobě sám ví („až budou klientů tisíce"). Ten odhad je
-- optimistický: u AI-náročných průchodů se strop láme kolem dvaceti.
--
-- Řešení, které tenhle soubor umožňuje: plánovač zůstane levný (jeden dotaz,
-- žádné AI) a skutečnou práci rozešle jako JEDNU ÚLOHU NA KLIENTA. Souběžnost
-- pak přijde sama — `agent-worker` startuje každou minutu a žije až 700 s,
-- takže se běhy překrývají a lease brání tomu, aby si dva vzaly tutéž úlohu.
--
-- Spustit v SQL editoru Supabase / přes Management API query endpoint,
-- NIKDY `db push`. Bezpečné opakovaně.

-- ── Klíč proti dvojímu zařazení ─────────────────────────────────────────────
-- Bez něj by dvojí spuštění plánovače (retry, překrývající se cron, ruční
-- doplánování) založilo druhou úlohu pro téhož klienta a model by se zaplatil
-- dvakrát. Podmíněný claim tu nejde použít — nejde o UPDATE existujícího
-- řádku, ale o INSERT — takže se hranice drží unikátním indexem a kolize
-- (23505) se čte jako „už zařazeno", ne jako chyba.
--
-- Sloupec je schválně OBECNÝ a výchozí NULL: dosavadní úlohy klíč nemají,
-- index je částečný, takže se pro ně nic nemění. Kdo chce dedupe, přihlásí se
-- o něj vyplněním klíče — a nemusí se kvůli tomu psát migrace pro každý nový
-- typ úlohy.

alter table agent_tasks add column if not exists dedupe_key text;

comment on column agent_tasks.dedupe_key is
    'Volitelný klíč proti dvojímu zařazení téže práce (např. idea_replenish_client:<client_id>). Unikátní jen mezi čekajícími a běžícími úlohami — hotová úloha klíč uvolní, takže zítřejší běh projde. NULL = bez dedupe, dosavadní chování.';

-- Unikátnost JEN mezi `pending`/`running`. Kdyby index platil i na `done`,
-- zítřejší běh by se o tentýž klíč nepřihlásil a agent by umřel po prvním dni.
create unique index if not exists agent_tasks_dedupe_active_idx
    on agent_tasks (dedupe_key)
    where dedupe_key is not null and status in ('pending', 'running');

-- Plánovač se ptá „má tenhle klient čekající úlohu?" jednou za běh na klienta;
-- při 300 klientech je to 300 dotazů denně na týž tvar.
create index if not exists agent_tasks_type_status_idx
    on agent_tasks (type, status);
