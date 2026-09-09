-- Úkoly firmy (app/actions/task-actions.ts)
-- =========================================
-- Backlog Chrlitu, ne obsah tenanta — proto bez `ig_` prefixu a bez `client_id`,
-- stejná rodina jako `waitlist` / `invite_codes` / `leads`. Kdyby to byla `ig_*`
-- tabulka, každý dotaz by musel filtrovat klienta a žádný klient sem nepatří.
--
-- Vstupem je Google tabulka („dulezite kontakty", list ÚKOLY), kterou tým udržuje
-- ručně; zapisovat do ní zpátky nejde, takže stav žije tady.

-- ── Kdo je kdo ──────────────────────────────────────────────────────────────
-- POZOR: `team_members` říká, KDO jsi. Nikdy ne, jestli se dostaneš dovnitř.
-- Vstup do admin sekce dál rozhoduje výhradně `SUPER_ADMIN_EMAILS`
-- (`lib/super-admins.ts`). Kdyby členství v týmu udělovalo přístup, jeden insert
-- by tiše otevřel Mailing, Waitlist i data zákazníků.
create table if not exists team_members (
    email       text primary key,
    name        text not null,
    role        text not null check (role in ('founder', 'manager', 'investor')),
    active      boolean not null default true,
    created_at  timestamptz not null default now()
);

comment on table team_members is
    'Identita a role členů týmu. NEUDĚLUJE přístup — ten drží SUPER_ADMIN_EMAILS.';

-- ── Úkoly ───────────────────────────────────────────────────────────────────
-- Vlastnictví sloupců je celý vtip téhle tabulky:
--   tabulka (sync) vlastní  → title, priority, note
--   aplikace (lidi) vlastní → status, owner_email, due_date
-- Sync smí přepsat jen první skupinu. Kdyby sahal i na druhou, každé pondělí
-- a čtvrtek by smazal všechno, co tým během týdne odbavil.
create table if not exists tasks (
    id           uuid primary key default gen_random_uuid(),
    title        text not null,
    note         text,
    owner_email  text references team_members(email) on delete set null,
    priority     smallint check (priority between 1 and 3),
    status       text not null default 'todo'
                 check (status in ('todo', 'doing', 'blocked', 'done', 'dropped')),
    due_date     date,
    -- Odkud úkol přišel. 'sheet' = řádek z Google tabulky, 'app' = založený v appce.
    source       text not null default 'app' check (source in ('sheet', 'app')),
    -- Stabilní klíč řádku v tabulce (normalizovaný název). Na něm stojí idempotence
    -- syncu — bez něj by každý běh založil úkoly znovu.
    source_key   text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    done_at      timestamptz,
    created_by   text,
    updated_by   text
);

-- Claim řádku při syncu, přesně jako `UNIQUE INDEX ON invoices(payment_id)` drží
-- vystavení dokladu. Částečný index: úkoly založené v appce `source_key` nemají
-- a nesmí se o jediný NULL prát.
create unique index if not exists idx_tasks_source_key
    on tasks (source_key)
    where source_key is not null;

-- „Co mám na sobě" a „co je otevřené" jsou jediné dva dotazy, které tahle tabulka
-- dostane. Oba by jinak četly celou tabulku.
create index if not exists idx_tasks_owner_status on tasks (owner_email, status);
create index if not exists idx_tasks_status_priority on tasks (status, priority);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Zapnuté bez jediné policy: čte i zapisuje výhradně service-role klient
-- (`supabase/admin`) za bránou `requireSuperAdmin()`. Anon klíč tu nemá co dělat —
-- jsou to interní data firmy, ne obsah tenanta.
alter table team_members enable row level security;
alter table tasks enable row level security;

-- ── Seed týmu ───────────────────────────────────────────────────────────────
-- Jen lidi, kteří dnes reálně mají účet. Role 'investor' je v constraintu, aby šla
-- doplnit bez další migrace.
insert into team_members (email, name, role) values
    ('thomas.pocar@gmail.com', 'Tomáš', 'founder'),
    ('ludek.jasa1@gmail.com',  'Luděk', 'manager')
on conflict (email) do nothing;
