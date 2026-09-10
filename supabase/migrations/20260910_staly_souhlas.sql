-- Stálý souhlas: rozhodnutí jednou pro druh akce, ne pokaždé pro jednu
-- ════════════════════════════════════════════════════════════════════════════
-- Kontrola produkce 10. 9. 2026: za celou historii systému bylo navrženo
-- 27 akcí ke schválení a schváleno **nula**. Dvacet vypršelo, sedm čekalo.
-- Sloupec `approved_at` byl prázdný u všech řádků v tabulce.
--
-- Nebyla to chyba stroje. Brief chodil každé ráno, odkazy se podepisovaly
-- znovu (7denní TTL, `lib/agent-approval-link.ts`), sweep expirace běžel,
-- dedupe fungoval. Vstupní šum se opravil 8. 9. (`lib/audience.ts`). A brána
-- se přesto neotevřela ani po té opravě.
--
-- Chyba byla v tom, NA CO se ptáme: systém žádal o individuální schválení
-- každého jednoho e-mailu, každý den, donekonečna. To je trvale otevřená
-- smyčka s N položkami. Fronta, která nikdy nedojde na nulu, se přestane
-- číst — a pak v ní uvázne i to, co odbavit šlo.
--
-- Stálý souhlas mění otázku z „pošlu tenhle e-mail?" na „chceš, abych tenhle
-- DRUH e-mailu posílal sám?". Ptá se jednou. Odpověď platí, dokud ji nezrušíš.
--
-- CO SE TÍM **NEMĚNÍ** (a proč to tu musí být napsané)
-- ----------------------------------------------------
-- `outbound` NEVSTUPUJE do `AUTO_TIERS` v `lib/agent-safety.ts`. Doktrína
-- „default-deny" platí dál: druh akce bez záznamu v téhle tabulce čeká na
-- člověka přesně jako dodnes. Rozdíl je, že člověk může své rozhodnutí uložit
-- dopředu místo toho, aby ho opakoval každé ráno. Auditní řádek v
-- `agent_actions` vzniká pořád — jen s `actor = 'policy:<key>'` místo
-- `'email-link'`, takže v logu je vidět, že to nebyl klik, ale pravidlo.
--
-- Spustit v SQL editoru Supabase / přes Management API query endpoint,
-- NIKDY `db push`. Bezpečné opakovaně.

create table if not exists agent_policies (
    -- Klíč druhu akce, ne konkrétní akce: `lifecycle:activation_nudge`, ne id
    -- řádku. Agent ho vysílá explicitně (`policyKey` v `ActionRequest`) — kdo
    -- ho zapomene poslat, dostane bezpečné chování (ptát se), ne tiché „auto".
    key           text primary key,

    -- 'auto' = posílej sám · 'ask' = ptej se (výchozí chování i bez řádku).
    -- 'ask' jako uložená hodnota má smysl: je to zaznamenané „ne, tohle chci
    -- vidět pokaždé", které přežije i to, že se souhlas jinde zapíná plošně.
    mode          text not null default 'ask' check (mode in ('auto', 'ask')),

    -- Strop na den. Stálý souhlas nesmí být bianko šek: kdyby hledač jednou
    -- vrátil padesát kandidátů, odejde padesát e-mailů dřív, než si toho
    -- kdokoli všimne. Nad strop se akce **navrhne** jako dřív, nezahodí se.
    daily_cap     integer not null default 5 check (daily_cap > 0),

    decided_by    text not null,
    decided_at    timestamptz not null default now(),

    -- Zrušení se nemaže, jen razítkuje: „kdy jsem to vypnul a proč" je přesně
    -- ta informace, kvůli které audit trail existuje.
    revoked_at    timestamptz,
    note          text
);

comment on table agent_policies is
    'Stálý souhlas s druhem agentní akce. Prázdná tabulka = systém se ptá na všechno, tedy chování před 10. 9. 2026. Čte `lib/agent-policy.ts`, respektuje `requestAction()`.';
comment on column agent_policies.key is
    'Druh akce, ne konkrétní akce (např. lifecycle:activation_nudge). Agent ho posílá jako `policyKey`; bez něj se akce vždy navrhne člověku.';
comment on column agent_policies.daily_cap is
    'Kolik akcí toho druhu smí za den odejít bez ptaní. Nad strop se akce navrhne člověku — nikdy se nezahodí.';
comment on column agent_policies.revoked_at is
    'Neprázdné = souhlas zrušen, akce se zase navrhují. Řádek zůstává kvůli auditu.';

-- Historii „kdo to spustil" nese `agent_actions.actor`; index je kvůli dennímu
-- počítání proti stropu, které běží při KAŽDÉM návrhu outbound akce.
create index if not exists agent_actions_actor_created_idx
    on agent_actions (actor, created_at desc);

-- ── Druh akce na auditním řádku ─────────────────────────────────────────────
-- Bez tohohle sloupce by tlačítko „schválit a příště se neptej" nemělo z čeho
-- odvodit, KTERÝ souhlas má uložit: `task_type` je u všech šesti lifecycle
-- e-mailů stejný (`send_lifecycle_email`) a `action` je volný text pro člověka
-- („Winback po expiraci → info@…"), ze kterého se klíč parsovat nedá a nemá.
--
-- Prázdná hodnota je legitimní a znamená „tenhle druh se stálým souhlasem
-- pokrýt nedá" — u takové akce se třetí tlačítko nezobrazí.

alter table agent_actions add column if not exists policy_key text;

comment on column agent_actions.policy_key is
    'Druh akce pro stálý souhlas (agent_policies.key), např. lifecycle:winback. NULL = akci nelze pokrýt stálým souhlasem, rozhoduje se pokaždé.';

create index if not exists agent_actions_policy_key_idx
    on agent_actions (policy_key) where policy_key is not null;

-- ── Doplnění druhu u návrhů, které tu už leží ───────────────────────────────
-- Sedm čekajících návrhů vzniklo dřív, než sloupec existoval, takže mají
-- `policy_key` prázdný — a tlačítko „schválit a příště se neptat" by se u nich
-- nenabídlo. U lifecycle e-mailů druh znám: nese ho `payload->>'kind'`, což je
-- přesně ta hodnota, ze které `lifecycle.ts` klíč skládá.
--
-- Doplňuje se JEN u čekajících a JEN u `send_lifecycle_email`: u rozhodnutých
-- řádků by to přepisovalo historii a u cizích handlerů by to hádalo.
--
-- Šum ve frontě se tu záměrně NEUKLÍZÍ. Čtyři ze sedmi míří na vlastní adresy
-- zakladatele a dnes by je `isSuperAdminEmail` v `lifecycle.ts` nepustil — ale
-- migrace z 8. 9. se mazání „podle adresy vlastníka" vědomě vyhnula, protože
-- táž podmínka sedí i na legitimní návrhy. To rozhodnutí platí dál; těch pár
-- řádků zavře pravidlo o stáří do dvou týdnů samo.

update agent_actions
   set policy_key = 'lifecycle:' || (payload->>'kind')
 where status = 'proposed'
   and task_type = 'send_lifecycle_email'
   and policy_key is null
   and payload->>'kind' is not null;
