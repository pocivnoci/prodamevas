---
tags: [decision, architecture, agents, multitenancy]
status: in-progress
date: 2026-06-20
area: core-hardening
---

# Core hardening — bezpečný základ pro agenty

> [!summary] Rozhodnutí
> Než přidáme další „patra" (LinkedIn/Facebook obsah **a** autonomní ops-agenti — email, support, ads, daně, sales, promo), zpevníme **společný základ pod nimi** ve fázích. Každá fáze je samostatný PR, **přidává** (nepřepisuje funkční kód) a dává smysl i kdyby další fáze nikdy nepřišly.

## Proč

Nebezpečí je nasadit autonomní agenty, kteří **utrácejí peníze a píšou zákazníkům**, na základ bez: záruky tenant izolace, audit logu a approval brány. Tři ze čtyř potřebných pilířů už existují v primitivní formě — durable lease worker (`campaign-worker`), šifrovaný credential store (`ig_connections`), job lifecycle (`ig_jobs`). Chybí hlavně bezpečnostní vrstva.

## Pilíře základu

**Identita** (kdo) · **Connections** (klíče ke světu) · **Task runner** (durable běh) · **Safety rails** (audit + permission + approval). Plus dva švy: **Events** (triggery) a **Channel adapter** (výstup obsahu).

## Bezpečnostní posture (rozhodnuto)

**Mixed-by-risk:** reverzibilní/interní akce běží automaticky; nevratné, utrácející peníze nebo směřující k zákazníkovi vyžadují **one-click human approval**. Default-deny pro cokoli s penězi nebo zákazníky.

## Fáze (pořadí: 0→1→2→3 před jakýmkoli reálným ops-agentem; 4 a 5 lze prokládat)

- **Fáze 0 — Tenant identita: konec globálního stavu.** ✅ Jádro hotové (viz níže). Navazuje na [[Tenant isolation - explicitní clientId]].
- **Fáze 1 — Generalizace credential vaultu.** `ig_connections` → `connections(provider)`; `lib/ig-token-crypto.ts` → `lib/token-crypto.ts`; `instagram/ig-connection.ts` → `lib/connections.ts`. Nejlevnější TEĎ (tabulka je nová/nepoužitá v produkci).
- **Fáze 2 — Durable agent-task runner.** Zobecnit lease/heartbeat/resume vzor z `campaign-worker` do `agent_tasks` + `lib/agent-runner.ts` (`registerHandler(type)`). Existující `ig_jobs`/`ig_campaigns` se NEMIGRUJÍ.
- **Fáze 3 — Action safety rails** (greenfield): audit log `agent_actions`, risk tiers + capability gate (`lib/agent-safety.ts`, `dryRun`), approval inbox v dashboardu.
- **Fáze 4 — Event seam.** `domain_events` + `lib/events.ts`; jako první přepsat metrics→learning (dnes `waitUntil` fire-and-forget) na event→handler beze změny chování.
- **Fáze 5 — Channel adapter seam.** `ChannelAdapter { formatDraft, constraints, publish, fetchMetrics }`, Instagram = první implementace; `channel` diskriminátor na obsahu (default `'instagram'`).

## Fáze 0 — co je HOTOVO (2026-06-20)

> [!check] Kritická díra zavřená
> `setActiveProject()` teď zapisuje do **request-scoped `AsyncLocalStorage`** (`enterWith`) místo modul-globální proměnné. Souběžné requesty v jedné Fluid Compute instanci si už **nemůžou zkřížit tenanta**.

- `instagram/service.ts`: `setActiveProject` → `clientStorage.enterWith(clientId)`; **odstraněn `_fallbackClientId`**; `getActiveProject()` čte jen request-scoped store (jinak `throw`).
- **Nulová změna call-site** — všech ~13 volajících je teď automaticky bezpečných.
- `npm run build` zelený, žádné dangling reference.
- Klíčové zjištění: bezpečný mechanismus (`withActiveProject` přes AsyncLocalStorage) v kódu **už existoval** — díra byl jen ten modul-globální fallback.

### Co ve Fázi 0 zbývá (inkrementální, neurgentní)

Migrovat ~13 entry pointů `setActiveProject(x)` → `withActiveProject(x, () => …)` (gold-standard `.run()` scoping), pak `setActiveProject` smazat. Díra je už pryč, tohle je leštění správnosti — soubor po souboru kdykoli.

## Odkazy

- [[Tenant isolation - explicitní clientId]] — navazující rozhodnutí
- [[Roadmap]]
- `instagram/service.ts`, `app/api/cron/campaign-worker/route.ts` (vzor pro Fázi 2), `lib/ig-token-crypto.ts` (Fáze 1)
- Plný plán (mimo vault): `~/.claude/plans/1-keystone-clever-honey.md`

## Update 2026-06-20 — Fáze 1: migrace hotová

> [!check] Schéma je teď multi-provider
> Migrace `supabase/migrations/20260620_connections_provider.sql`: `ig_connections` má `provider` (instagram/linkedin/facebook/email) + `refresh_token`/`scopes[]`/`metadata`, unikát přesunut z `(client_id)` na `(client_id, provider)`. Jeden tenant může držet víc připojení.

- Aditivní a nerozbíjející: tabulka je nová/nepoužitá v produkci; staré řádky default `provider='instagram'`.
- `instagram/ig-connection.ts` scopuje všechny dotazy na `provider='instagram'`, upsert `onConflict: "client_id,provider"`; refresh cron filtruje provider. Build + lint zelené.
- **Zbývá (Fáze 1 plně):** přejmenovat `lib/ig-token-crypto.ts` → `lib/token-crypto.ts`, `instagram/ig-connection.ts` → `lib/connections.ts`, generalizovat na `provider` parametr pro ne-IG providery. Schéma je ale připravené — kosmetika kódu může počkat.

**Aplikovat migraci:** Supabase SQL Editor → `20260620_connections_provider.sql` (jako u ostatních migrací).
