-- Zamčené atrapy nejsou nález faktické brány
-- ═══════════════════════════════════════════════════════════════════════════
-- `plan_locked` příspěvky jsou teasery měsíčního plánu. Jejich text je natvrdo
-- napsaná atrapa z `PLACEHOLDER_HOOKS` („5 tipů jak zvýšit engagement o 200 %",
-- „Trend kterému se nevyhnete v roce 2025") a uživatel ji vidí jen přes 3px
-- rozmazání — není to obsah značky a nikdy se nepublikuje.
--
-- Backtest brány (`scripts/audit-fact-gate.ts --write`) je 6. 9. 2026 přesto
-- proauditoval a jeho nálezy zapsal jako označená tvrzení klienta. Skript to
-- od 7. 9. (#90) nedělá — `neq('status', 'plan_locked')` — ale zapsaná data
-- zůstala a lhala dvakrát:
--
--   • HYDROIZOLACE MIVA vypadala na 25 příspěvků s označeným tvrzením,
--     ve skutečnosti jich má 14; z toho vznikl i úkol „zkontrolovat fakta!!",
--   • rozmazané dlaždice by v dashboardu dostaly štítek o faktech.
--
-- Řádek se NEMAŽE, jen se z něj sundá verdikt: kolik ten audit stál a kdy
-- proběhl, je poctivá historie. Vadné je jen to, co o textu tvrdil.
--
-- Spustit v SQL editoru Supabase / přes Management API query endpoint,
-- NIKDY `db push`. Bezpečné opakovaně.

update ig_generation_log l
   set fact_status = null,
       fact_flags  = null
  from ig_posts p
 where l.post_id = p.id
   and p.status = 'plan_locked'
   and l.model_used = 'audit'
   and l.fact_status is not null;
