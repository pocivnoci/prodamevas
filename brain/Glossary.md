---
tags: [reference, glossary, chrlit]
updated: 2026-06-10
---

# 📖 Glossary

Pojmy, které se v kódu a v rozhodnutích opakují. Když narazíš na termín, který „nějak znamená", patří sem.

## Multi-tenancy

- **slug** — lidsky čitelný identifikátor klienta na hranici UI. `projectId` v `StudioContext` je ve skutečnosti slug, ne UUID.
- **client_id (UUID)** — skutečný klíč klienta v DB. Slug se na něj resolvuje **právě jednou** přes `requireProjectAccess(slug)`, dál se předává UUID.
- **`requireProjectAccess(slug)`** — membership check ze slugu, vrací `clientId`. Pro akce, které dostanou slug z UI.
- **`requireClientAccess(uuid)`** — membership check, když už máš `client_id` z řádku (post, memory, job). Viz [[Tenant isolation - explicitní clientId]].
- **`setActiveProject()`** — globální mutable stav v `service.ts`. Nebezpečné u souběžných requestů. Nový kód bere `clientId` jako explicitní parametr, ne přes tohle.

## Config

- **`ClientConfig`** — interface v `instagram/configs/types.ts`. Veškerá per-klient specifika žijí v `clients.config` (JSONB), ne v souborech. Viz [[Config v DB jako JSONB]].
- **`loadConfig()` / `validateConfig()`** — loader (60s TTL cache) + safe defaults pro neúplný config, aby nový klient necrashnul. Nový field = nový default ve `validateConfig()`.
- **`invalidateConfigCache()`** — čistí jen lokální lambdu; ostatní instance dojedou přes 60s TTL. Nikdy nespoléhej na okamžitou propagaci.

## Pipeline & učení

- **mega prompt** — velký prompt copywritera, sestavený v `buildMegaPrompt()` (`caption-generator.ts`). Sem se injektují memory, context a critic feedback.
- **Editorial Board** — šéfredaktor + copywriter, max 3 kola revizí, když critic score < 9. Log → `ig_jobs.editorial_log`.
- **critic_score** — hodnocení 1–10 + `keep[]` / `fix[]`, ukládá `logGeneration()`. Posledních 5 se injektuje zpět do promptu (učení z chyb).
- **performance_score** — skóre na `ig_post_ideas` / `ig_reviews`, řídí weighted selection. **Každý nový datový zdroj musí mít performance_score + weighted-selection funkci.**
- **weighted selection** — `score > avg*1.5 → 3×`, `> avg → 2×`, jinak `1×` výběr.
- **`ig_brand_memory`** — dlouhodobé naučené vzorce, typy: `pattern` / `preference` / `avoid` / `visual`. Bez FTS indexu → match přes `.ilike()`.
- **`propagateMetricsToSources()` / `analyzeAndLearn()`** — auto-trigger po `updateIGPostMetrics()`. Metriky se čtou **před** updatem, jinak jsou delty 0 a učení se nespustí (delta bug, opraveno v4.1).

## Generování (2-step)

- **`/api/ig-create-job`** — rychlý (10s), rate limit 10/h per klient, **charge kreditu**, vrací `jobId`. Viz [[2-step generation API]].
- **`/api/ig-run-job`** — blokuje až 300s, běží `generateOnePost()`, refund při selhání.
- **`/api/ig-job-status`** — polling po 2s + **stuck-job reaper** (job bez aktivity >8 min → failed + refund, žádný cron).
- **kredit idempotence** — unique index `credit_transactions(action, reference_id)`. `config.charged` v `ig_jobs` říká, co vrátit (`plan` / `credits` / `none`).

## Posty & varianty

- **`link_type`** — `'revision'` (přepsání z user feedbacku) vs `'variant'` (A/B). Obojí linkuje přes `revision_of`. Viz [[link_type - revize vs A-B varianta]].
- **Satori → Sharp** — text v obrázcích NIKDY z image modelu; overlay přes `text-overlay.ts` (Satori SVG → Sharp PNG). Viz [[Text v obrázcích přes Satori]].

## Supabase klienti (nemíchat)

- **`supabase/client.ts`** — jen frontend (`"use client"`).
- **`supabase/server.ts`** — server actions, má auth kontext, respektuje RLS.
- **`supabase/admin.ts`** — engine backend, service role, **bypasses RLS**. Nikdy `client` v backendu.

## Ostatní

- **`utils/retry.ts`** — jediný zdroj retry logiky. Nikdy nekopírovat.
- **`COMGATE_MOCK=true`** — mock platby; na produkci (`VERCEL_ENV=production`) ignorováno přes `isMockPaymentMode()`.
- **DEPRECATED modely** — `gemini-2.0-flash`, `gemini-3.1-pro-preview`, `imagen-4.0-ultra`. Nepoužívat.
