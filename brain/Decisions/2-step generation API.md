---
tags: [decision, architecture, pipeline]
status: accepted
date: 2026-05-14
area: generation-api
---

# 2-step generation API

> [!summary] Rozhodnutí
> Generování je rozdělené na dva endpointy: `ig-create-job` (rychlý, vrátí `jobId`) → `ig-run-job` (blokuje až 300s). UI mezitím polluje `ig-job-status`.

## Proč

Generace jednoho postu trvá desítky sekund až minuty (multi-agent pipeline + image/video). Vercel serverless má **strop 300s** na funkci a UI nesmí viset na jednom dlouhém requestu. Potřebujeme okamžitou odezvu (job vytvořen) + sledování průběhu + odolnost proti spadnutí.

## Co jsme zavrhli

- **Jeden synchronní endpoint** — narazí na timeout, UI zamrzne, při pádu nevíš, kde to skončilo.
- **Cron na úklid mrtvých jobů** — místo toho stuck-job reaper přímo v `ig-job-status` (job bez aktivity >8 min → failed + refund).

## Co z toho plyne (pravidla)

- Kredit se **charguje při `ig-create-job`** (ne po generování), refunduje při selhání v `ig-run-job` nebo reaperu.
- Idempotence chargů: unique index `credit_transactions(action, reference_id)`.
- Rate limit 10 jobů/h per klient žije v `ig-create-job` (admin bypass přes `SUPER_ADMIN_EMAILS`).
- UI začne pollovat `ig-job-status` (po 2s) hned od prvního requestu.
- Vercel timeouty: create=10s, run=300s, learn=60s. Fonty/assets musí být v `outputFileTracingIncludes`.

## Odkazy

- [[Glossary]] — 2-step, stuck-job reaper, kredit idempotence
- [[AI_AGENT_KNOWLEDGE_BASE]] §3, §8
- `app/api/ig-create-job`, `app/api/ig-run-job`, `app/api/ig-job-status`
