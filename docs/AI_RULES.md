# 🤖 AI Agent Rules — Chrlit Studio

> Tento soubor musí být přečten KAŽDÝM AI asistentem na začátku každé session.

---

## ⚠️ POVINNÉ PO KAŽDÉ ZMĚNĚ KÓDU

Kdykoli uděláš změnu v kódu, **MUSÍŠ** aktualizovat relevantní dokumentaci:

### Rychlý checklist

```
[ ] Přidán/změněn soubor v instagram/    → AI_AGENT_KNOWLEDGE_BASE.md §2, §3, §9 + SYSTEM_KNOWLEDGE_BASE.md §7
[ ] Přidán API endpoint                  → SYSTEM_KNOWLEDGE_BASE.md §3, §7 (API Routes tabulka)
[ ] Změněn AI model                      → SYSTEM_KNOWLEDGE_BASE.md §5 + AI_AGENT_KB §7
[ ] Přidána DB tabulka/sloupec           → SYSTEM_KNOWLEDGE_BASE.md §6 + AI_AGENT_KB §6
[ ] Změněn agent pipeline                → obě docs sekce o pipeline
[ ] Nový feedback loop                   → SYSTEM_KNOWLEDGE_BASE.md §4
[ ] Nové gotcha/bug pattern              → AI_AGENT_KNOWLEDGE_BASE.md §8
[ ] Změněn env var                       → SYSTEM_KNOWLEDGE_BASE.md §9
[ ] Změněny LOC nebo file counts         → README.md + AI_AGENT_KB §9
```

---

## 📋 Mapa: Kde co dokumentovat

| Co se změnilo | Soubor | Sekce |
|---------------|--------|-------|
| Architektura, stack | SYSTEM_KNOWLEDGE_BASE | §1 |
| Multi-tenancy | SYSTEM_KNOWLEDGE_BASE | §2 |
| Generovací pipeline | SYSTEM_KNOWLEDGE_BASE | §3 + AI_AGENT_KB §3 |
| Feedback loops | SYSTEM_KNOWLEDGE_BASE | §4 + AI_AGENT_KB §4 |
| AI modely | SYSTEM_KNOWLEDGE_BASE | §5 + AI_AGENT_KB §7 |
| DB tabulky | SYSTEM_KNOWLEDGE_BASE | §6 + AI_AGENT_KB §6 |
| Klíčové soubory | SYSTEM_KNOWLEDGE_BASE | §7 |
| Security, auth | SYSTEM_KNOWLEDGE_BASE | §8 |
| ENV proměnné | SYSTEM_KNOWLEDGE_BASE | §9 |
| Agenti, role | AI_AGENT_KNOWLEDGE_BASE | §2 |
| Záludnosti, gotchas | AI_AGENT_KNOWLEDGE_BASE | §8 |
| Adresářová struktura | AI_AGENT_KNOWLEDGE_BASE | §9 + README.md |

---

## 🏗️ Architektonická pravidla (nikdy neporušovat)

1. **Tenant isolation** — každý `ig_*` dotaz musí filtrovat `client_id`
2. **Config v DB** — žádné config soubory v kódu, pouze `configs/types.ts` + `configs/index.ts`
3. **Config validace** — `loadConfig()` volá `validateConfig()` — nový field musí mít default
4. **Retry logika** — pouze z `utils/retry.ts`, nekopírovat
5. **Admin Supabase** — backend používá `supabase/admin`, nikdy `supabase/client`
6. **Feedback loop** — nový datový zdroj → přidat `performance_score` + weighted selection
7. **Auth guard** — každý nový API route musí mít `requireAuth()` (kromě webhooků)
8. **Rate limiting** — nové generovací endpointy → zvážit přidání rate limitu
9. **Deprecated modely** — `gemini-2.0-flash`, `gemini-3.1-pro-preview`, `imagen-4.0-ultra` → NEPOUŽÍVAT

---

## 📅 Historie verzí docs

| Datum | Verze | Co se změnilo |
|-------|-------|---------------|
| 2026-02-27 | v2.0 | Základní architektura, multi-tenant, retry logika |
| 2026-05-14 | v3.0 | 2-step API, feedback loops, weighted selection, Memory Agent, model upgrade |
| 2026-05-14 | v3.1 | Visual Memory, analyzeVisualPatterns(), Art Director injection |
| 2026-06-02 | v4.0 | **Beta Launch:** rate limiting (10/h), auth na všech routes, config validace, editorial log UI, imageInstructions UI, mock platby, error recovery, onboarding timeout, model upgrade gemini-3.5-flash, 16 DB tabulek |

*Při dalším updatu přidej řádek sem.*
