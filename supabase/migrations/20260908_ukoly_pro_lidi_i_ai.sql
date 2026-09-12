-- Úkoly jako sdílená deska: člověk × člověk × AI
-- ═══════════════════════════════════════════════════════════════════════════
-- `tasks` byl řádek textu z Google tabulky. Pracují s ním dva lidé (Tomáš, Luděk)
-- a nově i agent — a ani jeden z nich z holého názvu nepozná, co je „hotovo",
-- čím začít a kdo na to smí sáhnout. („prezentace zpracování změna" — tenhle
-- řádek nešlo přečíst ani člověkem, ani modelem.)
--
-- Vlastnictví sloupců (stav po 9/2026, kdy sync skončil a databáze se stala
-- jediným zdrojem pravdy):
--
--   lidi vlastní → title, note, priority, status, owner_email, due_date,
--                  client_id, blocked_on, blocked_until, result
--   AI vlastní   → spec, next_step, effort, agent, spec_at
--
-- Google tabulka nevlastní nic — je to historický import (`lib/tasks/sheet-sync.ts`).
-- AI dál NEPÍŠE do title/note: člověk musí poznat svou vlastní větu a nemít
-- pocit, že mu ji někdo pod rukama přepsal.
--
-- Spustit v SQL editoru Supabase / přes Management API query endpoint,
-- NIKDY `db push`. Bezpečné opakovaně.

-- ── Zadání od AI ────────────────────────────────────────────────────────────
-- spec: { cil, hotovo, kde_zacit } — tři věty, ne esej. `hotovo` je to jediné,
-- co z úkolu dělá zadání: bez kritéria se nedá poznat, kdy skončit.
alter table tasks add column if not exists spec jsonb;
-- Kdy se třídilo. Nenulová hodnota = netřídit znovu; bez ní by každý běh platil
-- model za totéž. Odpověď na otázku ho vynuluje, aby se úkol přečetl znovu.
alter table tasks add column if not exists spec_at timestamptz;
-- Jedna věta „co teď". Pro člověka, který má deset minut, ne pro archiv.
alter table tasks add column if not exists next_step text;
-- Hrubá velikost. Ne story pointy — tři hodnoty, aby šlo vybrat práci podle
-- toho, kolik zbývá času.
alter table tasks add column if not exists effort text
    check (effort is null or effort in ('S', 'M', 'L'));
-- Kdo to smí vzít. NULL = jen člověk (verifikace v bance, schůzka, focení).
-- 'ops' = in-app agent, 'code' = cloudová routine, která otevírá PR.
alter table tasks add column if not exists agent text
    check (agent is null or agent in ('ops', 'code'));

-- ── Provázání se zbytkem appky ──────────────────────────────────────────────
-- Úkol o konkrétním klientovi → jedno kliknutí do jeho studia. Není to obsah
-- tenanta (proto bez `ig_` a bez NOT NULL), jen ukazatel.
alter table tasks add column if not exists client_id uuid references clients(id) on delete set null;

-- ── Čekání ──────────────────────────────────────────────────────────────────
-- „čeká na verifikaci Revolutu" musí zmizet z pracovní množiny DO DATA, ne
-- navždy. Bez `blocked_until` se na takový úkol každý běh znovu kouká člověk
-- i model.
alter table tasks add column if not exists blocked_on text;
alter table tasks add column if not exists blocked_until date;

-- Co z úkolu vzniklo: odkaz na PR, doklad, rozhodnutí. Bez toho se hotový úkol
-- nedá po měsíci doložit ničím než pamětí.
alter table tasks add column if not exists result text;

-- „Co mám na sobě" a „co je k roztřídění" jsou dotazy, které přibyly.
create index if not exists idx_tasks_untriaged on tasks (spec_at) where spec_at is null;
create index if not exists idx_tasks_blocked on tasks (blocked_until) where blocked_until is not null;

-- ── Vlákno úkolu ────────────────────────────────────────────────────────────
-- Jediné místo, kde se potkají obě strany: AI se ptá, člověk odpovídá, oba
-- píšou, co udělali. Append-only jako `lead_events` — historie se needituje,
-- protože z ní se pozná, jestli se agentovi dá věřit.
create table if not exists task_events (
    id       uuid primary key default gen_random_uuid(),
    task_id  uuid not null references tasks(id) on delete cascade,
    at       timestamptz not null default now(),
    -- E-mail člověka, nebo 'ai'. Ne cizí klíč: členy týmu mažeme, historii ne.
    actor    text not null,
    kind     text not null check (kind in ('triage', 'question', 'answer', 'note', 'status', 'result')),
    body     text,
    meta     jsonb
);

create index if not exists idx_task_events_task on task_events (task_id, at desc);

-- Doktrína projektu: RLS zapnuté bez policy = deny-all. Čte a píše jen service
-- role za bránou `requireSuperAdmin()`. Jsou to interní data firmy.
alter table task_events enable row level security;

comment on table task_events is
    'Vlákno úkolu: otázky AI, odpovědi lidí, stopa akcí. Append-only. RLS deny-all — jen service role.';
