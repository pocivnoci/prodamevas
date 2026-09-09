-- Předání značky zákazníkovi, který ještě nemá účet
-- ═══════════════════════════════════════════════════════════════════════════
-- Značku onboardovanou z adminu vlastní ten, kdo průvodce spustil. `user_clients`
-- se dá přepsat jen na EXISTUJÍCÍ účet — a zákazník ho ve chvíli onboardingu
-- typicky nemá. Do 9/2026 tím předání končilo hláškou „účet neexistuje" a správce
-- si musel pamatovat, že se má k předání vrátit, až se zákazník zaregistruje.
--
-- `client_handoffs` je ten zapamatovaný slib: řádek řekne „až se přihlásí tenhle
-- e-mail, patří mu tenhle klient". Zabírá se podmíněným UPDATEm při prvním
-- přihlášení (`lib/handoff.ts`), takže dvě souběžná přihlášení nevytvoří dvě
-- vazby ani jednu nezdvojí.
--
-- Spustit v SQL editoru Supabase / přes Management API query endpoint,
-- NIKDY `db push`. Bezpečné opakovaně.

create table if not exists client_handoffs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  -- Vždy lowercase (normalizuje `lib/handoff.ts`) — e-mail je tu klíč, podle
  -- kterého se slib páruje s přihlášením, a Supabase e-maily nerozlišuje velikostí.
  email text not null,
  -- Jednorázový kód pozvánky, se kterým se zákazník dostane přes bránu bety.
  -- Bez něj by mu předání otevřelo projekt, do kterého se nemá jak zaregistrovat.
  invite_code text,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz
);

-- Jeden živý slib na dvojici klient+e-mail. Opakované předání témuž člověku tak
-- není nový řádek, ale znovuposlaný týž kód — a `stageHandoff` se o to nemusí
-- prát aplikační logikou.
create unique index if not exists client_handoffs_pending_uniq
  on client_handoffs (client_id, email)
  where claimed_at is null and cancelled_at is null;

-- Přihlášení se ptá „má tenhle e-mail něco čekat?" u KAŽDÉHO průchodu branou.
create index if not exists client_handoffs_email_idx
  on client_handoffs (email)
  where claimed_at is null and cancelled_at is null;

-- Doktrína projektu: RLS zapnuté, žádné policy = deny-all. Čte a píše sem jen
-- service role (`supabase/admin.ts`).
alter table client_handoffs enable row level security;

comment on table client_handoffs IS
  'Slíbené předání značky na e-mail bez účtu. Zabírá se při prvním přihlášení (lib/handoff.ts). RLS deny-all — jen service role.';
