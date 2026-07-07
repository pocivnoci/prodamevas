---
tags: [roadmap, chrlit]
updated: 2026-07-07
---

# 🗺️ Roadmap

## Kde to je (v7 — soudržný content pipeline + nativní vizuál, 2026-07-07)

Postová smyčka je teď **jeden coherent pipeline**: **zásobník témat → plán → kampaň → výkon**, a všechno kolem něj se sešlo do pravdivé linie.

- **Durable kampaně:** vícepostové kampaně už neběží v tabu prohlížeče (ta smyčka umírala se zavřeným tabem — „chtěl 7, dostal 4"). Schválený plán je řádek `ig_campaigns`, cron worker (1×/min) ho drénuje, `cursor` resumuje po pádu. Detaily: [[Content pipeline - durable kampaně a zásobník témat]].
- **Pravdivá atribuce:** plán čerpá témata z `getWeightedIdeas`, vymyšlená schválená témata se ukládají zpět do zásobníku (`ig_post_ideas`) → linie nápad → post → metrika drží a krmí feedback smyčku. Poctivé Nápady (attribution fix + lifecycle UI).
- **Nativní vizuál:** kompletní post včetně české typografie a loga renderuje Nano Banana Pro podle design briefu — **Satori overlay zrušen**. Ship-best-native, nikdy orazítkovaný fallback. Detaily: [[Nativní rendering - text i logo z Nano Banana Pro]].
- **Menší:** nahraná fotka se stává vizuální bází designovaného postu (ne raw); feed continuity (recent published posty do promptu proti opakování).

### IG naživo (dogfood) — beze změny

Instagram **publikování i metriky jsou živé pro vlastní účet** (Standard Access, **bez App Review**). Kód hotový; jediný blocker zůstává jednorázový Meta setup (viz Další). Publikování: auto-publisher (`ig-publisher` cron, image+carousel) + ruční handoff (📲 Web Share do IG appky). Metriky → učení: `syncPostMetrics` (`instagram/metrics-sync.ts`) krmí stávající learning loop. Viz [[AI_AGENT_KNOWLEDGE_BASE]] §4.

Pod tím pořád stojí **základ pro autonomní agenty** (core hardening 0–5): request-scoped tenant identita, credential vault, durable agent-task runner, safety rails. Detaily: [[Core hardening - bezpečný základ pro agenty]], `docs/SYSTEM_KNOWLEDGE_BASE.md` §4b.

> [!note] Docs vs kód
> Když docs a kód nesouhlasí → věř kódu, pak uprav docs ([[AI_RULES]]).

## Další / zvažuje se

- [ ] **Meta aplikace naživo** (Business portfolio + app na `info@chrlit.cz`, owner-only) → doplnit `META_APP_ID`/`META_APP_SECRET` + `IG_TOKEN_ENCRYPTION_KEY` → propojit chrlit. **Jediný blocker pro dogfood — kód je hotový.** Krok-za-krokem: `docs/INSTAGRAM_SETUP_GUIDE.md`.
- [ ] **Business Verification + App Review** (basic+insights, pak content_publish) → odemkne publikování + auto-metriky pro **cizí (tenant)** účty. Viz `docs/META_APP_REVIEW_PLAN.md`.
- [ ] **Reels publikování** v auto-publisheru — chybí video storage path (handoff je zatím pokrývá ručně).
- [ ] **⚠️ Revidovat pozicování** — GTM texty ([[Pozicování]], [[Kanály]], blog, FAQ) tvrdí „Chrlit **nepublikuje** / nepostuje za vás". Po handoffu + auto-publishi to přestává platit. Až bude chrlit naživo, sladit příběh (pravdivost!).
- [ ] **První reálný ops-agent** (např. interní týdenní report) — důkaz, že rails fungují naostro.

## Hotovo (milníky)

- **v7** 2026-07 — soudržný content pipeline (zásobník ↔ plán ↔ kampaň ↔ výkon), durable server-side kampaně, nativní rendering (Satori zrušen), poctivé Nápady, feed continuity
- **v6** 2026-06-24/25 — IG go-live (dogfood): auto-publisher + handoff publikování, `content_publish` scope, auto-metriky (`syncPostMetrics`), setup guide
- **v5.0** 2026-06-20 — agent foundation (core hardening 0–5), IG Keystone OAuth, plánovač, pravdivé texty + blog
- **v4.1** 2026-06-10 — production hardening
- **v4.0** 2026-06-02 — beta launch (rate limiting, auth, config validace, 16 tabulek)
- **v3.0** 2026-05-14 — 2-step API, feedback loops, weighted selection, Memory Agent
- **v2.0** 2026-02-27 — základní multi-tenant architektura

*(Plnou historii drží [[AI_RULES]] → Historie verzí docs.)*
