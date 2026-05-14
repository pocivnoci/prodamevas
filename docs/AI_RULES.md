# 🤖 AI Agent Rules — ProdámeVás

> Tento soubor musí být přečten KAŽDÝM AI asistentem na začátku každé session.
> Ignorování těchto pravidel = technický dluh a zastaralá dokumentace.

---

## ⚠️ POVINNÉ PO KAŽDÉ ZMĚNĚ KÓDU

Kdykoli uděláš změnu v kódu (nový soubor, nová funkce, nová tabulka, nový API endpoint, změna modelu, změna architektury), **MUSÍŠ** před commitem aktualizovat dokumentaci:

### Rychlý checklist

```
[ ] Přidán/změněn soubor v instagram/    → aktualizuj AI_AGENT_KNOWLEDGE_BASE.md sekce 2, 3, 9
[ ] Přidán API endpoint                  → aktualizuj SYSTEM_KNOWLEDGE_BASE.md sekce 3 (API Routes tabulka)
[ ] Změněn Gemini model                  → aktualizuj SYSTEM_KNOWLEDGE_BASE.md sekce 5 (Model Registry)
[ ] Přidána DB tabulka/sloupec           → aktualizuj SYSTEM_KNOWLEDGE_BASE.md sekce 6 + AI_AGENT_KB sekce 6
[ ] Změněn agent pipeline                → aktualizuj obě docs sekce o pipeline
[ ] Nový feedback loop                   → aktualizuj SYSTEM_KNOWLEDGE_BASE.md sekce 4
[ ] Nové gotcha/bug pattern              → přidej do AI_AGENT_KNOWLEDGE_BASE.md sekce 8
[ ] Změněn env var                       → aktualizuj SYSTEM_KNOWLEDGE_BASE.md sekce 9
```

### Rychlá update sekvence (automatizovatelná)

1. `Last Updated` datum v obou docs → aktuální datum
2. Dotčená sekce → update textu
3. `git add docs/ && git commit --amend --no-edit` (nebo samostatný commit)

---

## 📋 Mapa: Kde co dokumentovat

| Co se změnilo | Soubor | Sekce |
|---------------|--------|-------|
| Architektura systému, stack | SYSTEM_KNOWLEDGE_BASE | §1 Architecture |
| Multi-tenancy logika | SYSTEM_KNOWLEDGE_BASE | §2 Multi-Tenancy |
| Generovací pipeline, kroky | SYSTEM_KNOWLEDGE_BASE | §3 Pipeline |
| Feedback loops | SYSTEM_KNOWLEDGE_BASE | §4 Feedback Loop |
| Gemini/AI modely | SYSTEM_KNOWLEDGE_BASE | §5 Model Registry |
| DB tabulky, sloupce | SYSTEM_KNOWLEDGE_BASE | §6 Schema |
| Klíčové soubory, funkce | SYSTEM_KNOWLEDGE_BASE | §7 File Reference |
| ENV proměnné | SYSTEM_KNOWLEDGE_BASE | §9 Env Vars |
| Agenti, jejich role | AI_AGENT_KNOWLEDGE_BASE | §2 Multi-Agent Pipeline |
| Pipeline krok za krokem | AI_AGENT_KNOWLEDGE_BASE | §3 Pipeline |
| Feedback loop detaily | AI_AGENT_KNOWLEDGE_BASE | §4 Feedback Loop |
| DB tabulky (CZ popis) | AI_AGENT_KNOWLEDGE_BASE | §6 DB Struktura |
| AI modely (CZ) | AI_AGENT_KNOWLEDGE_BASE | §7 AI Modely |
| Záludnosti, gotchas, bugy | AI_AGENT_KNOWLEDGE_BASE | §8 Záludnosti |
| Adresářová struktura | AI_AGENT_KNOWLEDGE_BASE | §9 Adresářová Struktura |

---

## 🏗️ Architektonická pravidla (nikdy neporušovat)

1. **Tenant isolation** — každý `ig_*` dotaz musí filtrovat `client_id`
2. **Config v DB** — žádné config soubory v kódu, pouze `configs/types.ts` + `configs/index.ts`
3. **Retry logika** — pouze z `utils/retry.ts`, nekopírovat
4. **Admin Supabase** — backend používá `supabase/admin`, nikdy `supabase/client`
5. **Feedback loop** — nový datový zdroj → přidat `performance_score` + weighted selection
6. **Deprecated modely** — `gemini-2.0-flash` je deprecated, fallback je `gemini-2.5-flash-lite`

---

## 📅 Historie verzí docs

| Datum | Verze | Co se změnilo |
|-------|-------|---------------|
| 2026-02-27 | v2.0 | Základní architektura, multi-tenant, retry logika |
| 2026-05-14 | v3.0 | 2-step API, feedback loops, weighted selection, Memory Agent, model upgrade |
| 2026-05-14 | v3.1 | Visual Memory (Fáze 2): analyzeVisualPatterns(), getVisualMemoriesSection(), Art Director injection |

*Při dalším updatu přidej řádek sem.*
