---
tags: [roadmap, chrlit]
updated: 2026-06-25
---

# 🗺️ Roadmap

## Kde to je (v6 — IG naživo / dogfood, 2026-06-25)

Instagram **publikování i metriky jsou živé pro vlastní účet** (chrlit dogfood, Standard Access — **bez App Review**). Kód hotový; chybí jen jednorázový Meta setup (viz Další).

- **Publikování:** auto-publisher (`ig-publisher` cron, image+carousel) **i** ruční „handoff" (📲 v Příspěvcích → Web Share přímo do IG appky + popisek do schránky; ~3 klepnutí, zvládne i reels). OAuth teď žádá i `instagram_business_content_publish` → vlastní účet může postovat sám. Návod uživatelům: `docs/POSTING_GUIDE.md`.
- **Metriky → učení:** `syncPostMetrics` (`instagram/metrics-sync.ts`) automaticky stahuje IG insights a krmí **stávající** learning loop (denní cron `/api/cron/ig-metrics-sync` + tlačítko ve Výkonu). Handoff posty bez `ig_media_id` se párují přes caption-match. Sacred smyčka vyčleněna do session-less `writeIGPostMetrics`/`fireMetricsLearning`. Ruční zadání zůstává fallback. Viz [[AI_AGENT_KNOWLEDGE_BASE]] §4.
- **Setup od nuly:** `docs/INSTAGRAM_SETUP_GUIDE.md` (fresh Meta účet na `info@chrlit.cz`).

Pod tím pořád stojí **základ pro autonomní agenty** (core hardening Fáze 0–5): request-scoped tenant identita, credential vault, durable agent-task runner, safety rails, event + channel adapter seam. Detaily: [[Core hardening - bezpečný základ pro agenty]], `docs/SYSTEM_KNOWLEDGE_BASE.md` §4b.

> [!note] Docs vs kód
> Když docs a kód nesouhlasí → věř kódu, pak uprav docs ([[AI_RULES]]).

## Další / zvažuje se

- [ ] **Meta aplikace naživo** (Business portfolio + app na `info@chrlit.cz`, owner-only) → doplnit `META_APP_ID`/`META_APP_SECRET` + `IG_TOKEN_ENCRYPTION_KEY` → propojit chrlit. **Tohle je teď jediný blocker pro dogfood — kód je hotový.** Krok-za-krokem: `docs/INSTAGRAM_SETUP_GUIDE.md`.
- [ ] **Business Verification + App Review** (basic+insights, pak content_publish) → odemkne publikování + auto-metriky pro **cizí (tenant)** účty. Viz `docs/META_APP_REVIEW_PLAN.md`.
- [ ] **Reels publikování** v auto-publisheru — chybí video storage path (handoff je zatím pokrývá ručně).
- [ ] **⚠️ Revidovat pozicování** — GTM texty ([[Pozicování]], [[Kanály]], blog, FAQ) tvrdí „Chrlit **nepublikuje** / nepostuje za vás". Po handoffu + auto-publishi to přestává platit. Až bude chrlit naživo, sladit příběh (pravdivost!).
- [ ] **První reálný ops-agent** (např. interní týdenní report) — důkaz, že rails fungují naostro.

## Hotovo (milníky)

- **v6** 2026-06-24/25 — IG go-live (dogfood): auto-publisher + handoff publikování, `content_publish` scope, auto-metriky (`syncPostMetrics`), setup guide
- **v5.0** 2026-06-20 — agent foundation (core hardening 0–5), IG Keystone OAuth, plánovač, pravdivé texty + blog
- **v4.1** 2026-06-10 — production hardening
- **v4.0** 2026-06-02 — beta launch (rate limiting, auth, config validace, 16 tabulek)
- **v3.0** 2026-05-14 — 2-step API, feedback loops, weighted selection, Memory Agent
- **v2.0** 2026-02-27 — základní multi-tenant architektura

*(Plnou historii drží [[AI_RULES]] → Historie verzí docs.)*
