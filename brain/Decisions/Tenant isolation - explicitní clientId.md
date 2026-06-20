---
tags: [decision, security, multitenancy]
status: accepted
date: 2026-06-10
area: tenant-isolation
---

# Tenant isolation — explicitní clientId

> [!summary] Rozhodnutí
> Tenant se předává jako **explicitní `clientId` parametr** napříč engine kódem. `setActiveProject()` (globální mutable stav) se v novém kódu nepoužívá.

## Proč

`setActiveProject()` v `instagram/service.ts` je module-global mutable stav. Při souběžných requestech v jedné lambdě může **zkřížit data mezi tenanty** — jeden klient dostane data druhého. Bezpečnostní díra v multi-tenant systému.

## Co jsme zavrhli

- **Globální active-project stav** — pohodlné (nemusíš protahovat parametr), ale neudržitelné při concurrency na serverless.
- **Default na konkrétního klienta při chybějícím identifikátoru** — tiše vrací cizí data. Místo toho: chybějící identifikátor = `throw`.

## Co z toho plyne (pravidla)

- Akce se slugem z UI → `requireProjectAccess(slug)` (vrací `clientId`).
- Akce s row id (post, memory, job) → fetch `client_id` z řádku → `requireClientAccess(uuid)`.
- Slug → UUID resolve **právě jednou** na hranici, dál se nosí UUID.
- Každý `ig_*` dotaz filtruje `client_id`.
- Žádný nový `getActiveProject()` caller. Nový engine kód bere `clientId` parametrem (vzor: `propagateMetricsToSources`, `analyzeAndLearn`).

## Odkazy

- [[Glossary]] — slug vs client_id
- [[AI_AGENT_KNOWLEDGE_BASE]] §5 (Tenant isolation v4.1)
- `lib/auth-guard.ts`, `instagram/service.ts`

## Update 2026-06-20 — Fáze 0 (core hardening)

`setActiveProject()` už **není** modul-globální `let`. Teď zapisuje do request-scoped `AsyncLocalStorage` (`clientStorage.enterWith(clientId)`), `_fallbackClientId` odstraněn. Tím je zkřížení tenantů při concurrency v jedné lambdě **fyzicky vyloučené** i pro starší call-sites — ne jen pro nový kód. Pravidla výše platí dál; preferovaný vzor pro nový kód zůstává `withActiveProject(clientId, fn)` (explicitní `.run()` scoping).

Navazuje na → [[Core hardening - bezpečný základ pro agenty]] (Fáze 0).
