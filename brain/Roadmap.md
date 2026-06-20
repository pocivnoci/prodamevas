---
tags: [roadmap, chrlit]
updated: 2026-06-20
---

# 🗺️ Roadmap

## Kde to je (v5.0 — Agent Foundation, 2026-06-20)

Postaven kompletní **základ pro autonomní agenty** (core hardening Fáze 0–5, naživo): request-scoped tenant identita, multi-provider credential vault, durable agent-task runner, safety rails (audit + approval brána), event seam, channel adapter seam. Plus Instagram OAuth připojení (Keystone), plánovač + náhled profilu, pravdivé texty + SEO blog. Detaily: [[Core hardening - bezpečný základ pro agenty]], `docs/SYSTEM_KNOWLEDGE_BASE.md` §4b.

> [!note] Docs vs kód
> Když docs a kód nesouhlasí → věř kódu, pak uprav docs ([[AI_RULES]]).

## Další / zvažuje se

- [ ] **Meta aplikace** (Business portfolio + app, owner-only) → doplnit `META_APP_ID/SECRET` → zapnout IG připojení naživo. Viz `docs/KEYSTONE_NEXT_STEPS.md`.
- [ ] **Business Verification + 2. App Review** (publish + insights) → odemkne živé publikování a auto-metriky.
- [ ] **IG roadmapa krok 2/3** — publikování (media container → publish cron) + metriky → učení (Graph API do `updateIGPostMetrics`).
- [ ] **První reálný ops-agent** (např. interní týdenní report) — důkaz, že rails fungují naostro.
- [ ] **Doc refresh** — knowledge base sjednotit s v5.0 stavem (částečně hotovo).

## Hotovo (milníky)

- **v5.0** 2026-06-20 — agent foundation (core hardening 0–5), IG Keystone OAuth, plánovač, pravdivé texty + blog
- **v4.1** 2026-06-10 — production hardening
- **v4.0** 2026-06-02 — beta launch (rate limiting, auth, config validace, 16 tabulek)
- **v3.0** 2026-05-14 — 2-step API, feedback loops, weighted selection, Memory Agent
- **v2.0** 2026-02-27 — základní multi-tenant architektura

*(Plnou historii drží [[AI_RULES]] → Historie verzí docs.)*
