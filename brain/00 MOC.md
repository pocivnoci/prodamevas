---
tags: [moc, chrlit]
updated: 2026-06-10
---

# 🧠 Chrlit — Mozek

Rozcestník celého vaultu. Začni tady. Tohle je **lidská vrstva** kolem kódu — *proč* a *souvislosti*. Tvrdý spec o architektuře žije v `docs/` a nepřepisuje se sem (jinak ti to rozjede ze dvou zdrojů).

> [!info] Jak je to rozdělené
> - **Spec (pro Claude Code při kódování)** → `docs/` + `[[CLAUDE]]`. Aktualizuje se při každé změně kódu podle `[[AI_RULES]]`.
> - **Mozek (pro tebe + strategický Claude)** → tenhle vault. Rozhodnutí, souvislosti, nápady, glosář.
> - Most mezi nimi → [[Jak Claude používá tenhle vault]]

---

## 📐 Spec / zdroj pravdy o kódu

Tohle nečteš pro inspiraci, ale když potřebuješ *fakt*:

- [[CLAUDE]] — vstupní brief pro Claude Code (hard rules, architektura, příkazy)
- [[SYSTEM_KNOWLEDGE_BASE]] — architektura, DB schéma, env vars, cost model
- [[AI_AGENT_KNOWLEDGE_BASE]] — pipeline, agenti, §8 záludnosti
- [[AI_RULES]] — co aktualizovat po změně kódu (mapa dokumentace)
- [[README]] — quick start, stack, adresářová struktura

## 🧭 Rozhodnutí (proč to tak je)

To, co `docs/` neřekne — *proč* zrovna takhle a co jsme zavrhli:

- [[Tenant isolation - explicitní clientId]]
- [[2-step generation API]]
- [[link_type - revize vs A-B varianta]]
- [[Text v obrázcích přes Satori]]
- [[Config v DB jako JSONB]]

> [!tip] Nové rozhodnutí
> Zkopíruj [[_template]], pojmenuj `Decisions/YYYY-MM-DD krátký název`. Drž to krátké — 5 řádků stačí. Po nějaké době tě graf sám propojí.

## 📚 Referenční

- [[Glossary]] — slovník pojmů (slug vs client_id, link_type, performance_score…)
- [[Roadmap]] — kde to je a kam to jde
- [[Ideas]] — backlog nápadů (sem patří brain-dump, ne do hlavy)

---

## 🔌 Most na Claude

- [[Jak Claude používá tenhle vault]] — MCP setup, na co se ho ptát
