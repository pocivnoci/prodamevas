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
9. **Deprecated modely** — `gemini-2.0-flash`, `gemini-3.1-pro-preview`, `imagen-4.0-ultra`, `gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview` (shutdown 25.6.2026) → NEPOUŽÍVAT
10. **Model ID** — vždy přes `getModel()` z `instagram/models.ts`, nikdy hardcoded string

---

## 📅 Historie verzí docs

| Datum | Verze | Co se změnilo |
|-------|-------|---------------|
| 2026-02-27 | v2.0 | Základní architektura, multi-tenant, retry logika |
| 2026-05-14 | v3.0 | 2-step API, feedback loops, weighted selection, Memory Agent, model upgrade |
| 2026-05-14 | v3.1 | Visual Memory, analyzeVisualPatterns(), Art Director injection |
| 2026-06-02 | v4.0 | **Beta Launch:** rate limiting (10/h), auth na všech routes, config validace, editorial log UI, imageInstructions UI, mock platby, error recovery, onboarding timeout, model upgrade gemini-3.5-flash, 16 DB tabulek |
| 2026-06-10 | v4.1 | **Production Hardening:** tenant isolation (requireProjectAccess/requireClientAccess všude, žádné tenant fallbacky), oprava mrtvého learning triggeru (delta bug), kredit charge při create-job + refund + idempotence, config cache TTL 60s, stuck-job reaper, Sentry + env validace, mock-payment kill switch, link_type (revize vs A/B varianty), reviseCaption() v enginu, smazán /api/ig-generate, dekompozice typů (lib/types/database.ts jako zdroj pravdy) |

| 2026-06-11 | v4.2 | **Native Design Engine:** centrální model registry (`instagram/models.ts`, env overrides `GEMINI_MODEL_*`), migrace image modelů na GA ID (preview shutdown 25.6.), AI Designer (`gemini-3.1-pro`) generuje design briefy, Nano Banana Pro renderuje celý post vč. české typografie + loga (vision QA + korektivní edit + Satori fallback), `ClientConfig.visualEngine`/`videoTier`, `ig_posts.design_brief`, `ig_generation_log.qa_status`, Veo tiers (lite/fast/premium), TTS fallback + audio tags |

*Při dalším updatu přidej řádek sem.*
