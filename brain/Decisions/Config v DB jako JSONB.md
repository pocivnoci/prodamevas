---
tags: [decision, multitenancy, config]
status: accepted
date: 2026-02-27
area: config
---

# Config v DB jako JSONB

> [!summary] Rozhodnutí
> Veškerá per-klient konfigurace žije v `clients.config` (JSONB) typovaná `ClientConfig`. Žádné config soubory v kódu.

## Proč

Multi-tenant systém — každý klient má jiný brand, pravidla, image instrukce. Config souborem v repu by znamenal deploy na každou změnu klienta a nešel by editovat z UI. JSONB v DB jde měnit za běhu a editovat v SettingsTab.

## Co jsme zavrhli

- **Config soubory per klient v repu** — deploy na každou změnu, needitovatelné z UI, neškáluje.
- **Rozházená pole po více tabulkách** — těžko se validuje a verzuje.

## Co z toho plyne (pravidla)

- Schéma jen na dvou místech: `configs/types.ts` (interface) + `configs/index.ts` (loader).
- `loadConfig()` volá `validateConfig()` → safe defaults. **Nový field MUSÍ mít default**, jinak starý klient bez něj crashne.
- Žádný hardcoding DB ID, bucketů, admin emailů — vždy `ClientConfig` nebo ENV (`SUPER_ADMIN_EMAILS`).
- Config cache má 60s TTL; změna se nepropíše okamžitě napříč lambdami.

## Odkazy

- [[Glossary]] — ClientConfig, loadConfig/validateConfig
- [[AI_RULES]] — architektonická pravidla 2 & 3
- `instagram/configs/types.ts`, `instagram/configs/index.ts`
