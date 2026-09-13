-- Finance firmy — co kdo platil a kdo kolik dal
-- =============================================
-- Náklady a vklady se dosud vedly mimo systém. Dokud je firma dvoučlenná, není
-- to účetnictví, ale odpověď na jednu otázku: „kolik jsme do toho dali a kolik
-- nás to měsíčně stojí". Ta otázka se dnes zodpovídá po paměti.
--
-- CO TO NENÍ. Není to účetní systém a nenapojuje se na Fakturoid ani na banku.
-- Doklady vydané zákazníkům žijí v `invoices` a přijaté platby v `payments` —
-- tahle tabulka je nezastupuje ani z nich nečerpá. Je to ruční evidence toho,
-- co se z těch dvou tabulek nikdy nedozvíme: nájem, předplatné nástrojů, vklad
-- zakladatele. Kdyby se sem někdy tahaly `payments`, začne se totéž počítat
-- dvakrát.
--
-- Rodina bez `client_id` a bez `ig_` prefixu, stejně jako `tasks`, `leads`
-- a `team_members`: jsou to interní data firmy, ne obsah tenanta.
--
-- Run: Supabase SQL editor. Bezpečné re-run (IF NOT EXISTS).

create table if not exists finance_entries (
    id           uuid primary key default gen_random_uuid(),

    -- Dvě věci, ne dva sloupce se znaménkem. Záporná částka je past: kdo ji
    -- jednou zapomene, dostane vklad mezi náklady a součet tiše lže.
    kind         text not null check (kind in ('naklad', 'vklad')),

    -- Fixní = platí se, i když firma měsíc nic neudělá (nájem, předplatné).
    -- Variabilní = váže se na provoz (modely, tisk, kampaň). Vklad ani jedno
    -- není, proto u něj musí zůstat NULL — jinak by se dal vyrobit „fixní vklad"
    -- a filtr nákladů by ho započítal.
    cost_type    text check (cost_type in ('fixni', 'variabilni')),

    -- Kladná částka v korunách; znaménko nese `kind`. Haléře se nezahazují —
    -- předplatná v eurech se přepočtem na celé koruny netrefí.
    amount_czk   numeric(12,2) not null check (amount_czk > 0),

    -- Co to bylo („Nájem kanceláře", „Vklad na provoz").
    label        text not null check (length(btrim(label)) > 0),

    -- Kdo platil / kdo dal. Volný text schválně: `team_members` říká, kdo je
    -- v týmu, ale náklad platí i „Firma" kartou a ta v týmu není. Cizí klíč by
    -- tu vynutil fiktivního člena.
    person       text not null check (length(btrim(person)) > 0),

    -- Kdy se to stalo, ne kdy se to zapsalo. Nájem za srpen se zapisuje v září.
    happened_on  date not null default current_date,

    note         text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    created_by   text,
    updated_by   text,

    -- Fixní/variabilní má smysl jen u nákladu. Vynucené v databázi, ne jen
    -- v akci: evidence se plní i ručně ze SQL editoru.
    constraint finance_cost_type_jen_u_nakladu check (
        (kind = 'naklad' and cost_type is not null) or
        (kind = 'vklad'  and cost_type is null)
    )
);

comment on table finance_entries is
    'Ruční evidence nákladů a vkladů firmy. NENÍ účetnictví a nenapojuje se na Fakturoid ani banku; vydané doklady jsou v invoices, přijaté platby v payments.';

-- Obrazovka se ptá na jediné: poslední záznamy odshora. Bez indexu by to při
-- pár stech řádcích byl seq scan — levný dnes, zbytečný navždy.
create index if not exists idx_finance_entries_happened_on
    on finance_entries (happened_on desc);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Zapnuté bez jediné policy, stejně jako `tasks`: čte i zapisuje výhradně
-- service-role klient (`supabase/admin`) za bránou `requireSuperAdmin()`.
-- Anon klíč sem nesmí — jsou to peníze firmy, ne obsah tenanta.
alter table finance_entries enable row level security;
