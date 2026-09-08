-- Návrh, na který se nikdo nepodíval, se sám zavře
-- ════════════════════════════════════════════════════════════════════════════
-- 8. 9. 2026 čekalo ve frontě schválení 27 akcí, nejstarší 46 dní. Nešlo o to,
-- že by je nikdo nechtěl odbavit — polovina z nich neměla nikdy vzniknout
-- (značky z výlohy, testovací adresy, viz `lib/audience.ts`) a zbytek už dávno
-- nedávalo smysl poslat: „zapsal se před týdnem" po sedmi týdnech není pravda.
--
-- Seznam, který se nedá dočíst, se přestane číst celý — a pak v něm uvázne
-- i to, co odbavit šlo. Proto nový koncový stav.
--
-- **`expired` je vlastní hodnota schválně.** `rejected` znamená „člověk řekl
-- ne" a je to rozhodnutí, které dedupe v `lifecycle.ts` respektuje. Kdyby se
-- do téhož stavu vešlo i „nikdo se nepodíval", ztratí se rozdíl mezi
-- rozhodnutím a zapomenutím právě tam, kde je audit trail k něčemu.
--
-- Spustit v SQL editoru Supabase / přes Management API query endpoint,
-- NIKDY `db push`. Bezpečné opakovaně.

alter table agent_actions drop constraint if exists agent_actions_status_check;

alter table agent_actions add constraint agent_actions_status_check
    check (status in ('proposed', 'approved', 'executed', 'rejected', 'failed', 'expired'));

comment on column agent_actions.status is
    'proposed → čeká na člověka · approved/executed → běží nebo doběhlo · rejected → člověk řekl ne · expired → nikdo se nepodíval včas (lib/agent-safety.ts, PROPOSAL_TTL_DAYS) · failed → spadlo';

-- ── Úklid fronty, která tímhle vznikla ──────────────────────────────────────
-- Jednorázově, tady a ne ve skriptu, aby bylo v gitu vidět, co se s těmi
-- konkrétními řádky stalo. Tři důvody, každý zvlášť čitelný v `actor`:
--
--   showcase — návrh na značku z výlohy (vlastníkem jsme my)
--   internal — návrh na naši vlastní / testovací adresu
--   stale    — nikdo se nepodíval do PROPOSAL_TTL_DAYS
--
-- Nové už nevzniknou: první dva případy odfiltruje `lib/audience.ts` při
-- návrhu, třetí zavře `expireStaleProposals()` v denním běhu.

update agent_actions a
   set status = 'expired', actor = 'system:expired:showcase'
  from clients c
 where a.status = 'proposed'
   and a.client_id = c.id
   and c.config->>'isPortfolio' = 'true';

update agent_actions
   set status = 'expired', actor = 'system:expired:internal'
 where status = 'proposed'
   and (
        payload->>'email' like '%@example.com'
     or payload->>'email' like '%qa-test%'
     or payload->>'email' like '%@prodamevas.cz'
     or payload->>'email' like '%@chrlit.cz'
   );

-- Návrhy mířené na zakladatele (drží si pod svým gmailem zkušební značky, takže
-- měl schvalovat e-mail sám sobě) se tu záměrně NEuklízejí SQL dotazem: podmínka
-- „adresa vlastníka klienta" platí i pro každý legitimní návrh, takže by smazala
-- celou frontu. Nové nevzniknou (`isSuperAdminEmail` v `lifecycle.ts`) a ty tři
-- existující zavře do dvou týdnů pravidlo o stáří o pár řádků níž.

update agent_actions
   set status = 'expired', actor = 'system:expired:stale'
 where status = 'proposed'
   and created_at < now() - interval '14 days';
