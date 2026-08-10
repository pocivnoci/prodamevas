# CLAUDE.md

Naviguje Claude Code v tomhle repozitáři. **Drž ho krátký.** Patří sem jen to, co
z kódu nejde odvodit — orientace a invarianty. Detailní „proč" žije ve skillech
(`.claude/skills/`), vynucování v `npm run guard`, historie v gitu.

## Co to je

Chrlit Studio (kódové jméno „prodamevas") — multi-tenant AI engine na instagramový
obsah. Uživatel zadá web → AI se naučí značku → generuje hotové příspěvky (texty,
obrázky, karusely, stories, reely). Stack: Next.js 16 (App Router) · React 19 ·
TypeScript 5 · Tailwind 4 · Supabase · Google Gemini · ComGate + Stripe · Fakturoid.
Běží na Vercelu (Fluid Compute, strop funkce 800 s). **UI i dokumentace jsou česky.**

## Příkazy

```bash
npm run dev                              # Dev server (Turbopack)
npm run build                            # Produkční build — de facto typecheck
npm run lint                             # ESLint
npm run guard                            # Statické aserce invariantů (~3 s, bez DB)

npx tsx scripts/<script>.ts              # Utility (setup-user, check-db, buckets…)
npx tsx instagram/cli.ts --config=<slug> # CLI enginu (--stats, --feedback…)
```

Unit test framework tu není; testy jsou samostatné `tsx` skripty. Env je v
`.env.local` (tabulka proměnných v README). `COMGATE_MOCK=true` zapne mock platby.

**`npm run guard` je zdroj pravdy o invariantech** — stovky statických asercí nad
skutečným kódem. Když měníš chování, které aserce popisuje, **oprav kód, ne aserci**.
Stop hook (`.claude/hooks/guard.sh`) ho spouští sám, kdykoli je pracovní strom změněný.

## Architektura

Tři vrstvy, všechny multi-tenant:

1. **`app/`** — UI, server actions, API routes. Dashboard
   (`app/(dashboard)/dashboard/instagram/`) je SPA-like: jedna stránka s ~17 taby
   (`tabs/`) přepínanými přes `StudioContext.activeSection`, **ne** routováním Nextu.
   Server actions v `app/actions/` jsou dělené po doménách (admin, config,
   content-plan, variant, line, print, billing, memory, post, product, calendar…).
   Onboarding má vlastní backend v `app/onboarding/actions.ts`.

2. **`instagram/`** — server-only AI engine (~15k LOC). `autopilot.ts` orchestruje
   pipeline: Researcher → kontextový agent (svátky/počasí přes `signals/`) →
   copywriter (mega prompt v `caption-generator.ts`) → kritik → editorial board →
   art director → renderer → upload. Render médií je v `orchestrators/`.
   `gemini-client.ts` je jediná brána k modelům (text, obraz, video, TTS).

3. **`supabase/`** — tři klienti, **nikdy je nemíchej**:
   - `client.ts` — jen prohlížeč (`"use client"`)
   - `server.ts` — server actions (má auth kontext, respektuje RLS)
   - `admin.ts` — backend enginu (service role, obchází RLS)

## Invarianty

- **Multi-tenancy.** `clients` je kořen. **Každý `ig_*` dotaz musí filtrovat
  `client_id`.** Konfigurace klienta žije v `clients.config` JSONB (typ `ClientConfig`
  v `instagram/configs/types.ts`, načítá `loadConfig()` → `validateConfig()`). V kódu
  nejsou žádné config soubory; **nové pole `ClientConfig` potřebuje default ve
  `validateConfig()`**.
- **Identifikátory.** Na hranici UI žije *slug* (`projectId` ve `StudioContext` je ve
  skutečnosti slug). Přelož ho na UUID klienta **právě jednou** přes
  `requireProjectAccess(slug)` — nebo `requireClientAccess(uuid)`, když už máš
  `client_id` z řádku — a dovnitř předávej UUID. **Chybějící identifikátor nikdy
  nedefaultuj na skutečného tenanta — vyhoď výjimku.**
- **`setActiveProject()` je modulově globální mutable stav** (`instagram/service.ts`);
  při souběžných requestech v jedné lambdě umí zkřížit tenanty. Nový enginový kód bere
  `clientId` **explicitním parametrem** — nepřidávej další volající `getActiveProject()`.
- **Podmíněný claim, nikdy insert fallback.** Jednorázová akce se zabírá přes
  `UPDATE … WHERE id=? AND client_id=? AND status=?`. Když claim nevrátí řádek,
  **je to konec, ne důvod k insertu**. Platí pro drafty plánů, schválení produktové
  řady i vystavení dokladu (`UNIQUE INDEX ON invoices(payment_id)`).
- **Kvalita se nedegraduje potichu.** Pro tiery mají fallback na druhé Pro, nikdy na
  flash. Když se stane něco horšího, musí to být vidět v logu.
- **Zpětné vazby jsou posvátné.** Nový zdroj obsahu potřebuje `performance_score`
  + váženou selekci, jinak se učicí smyčka přetrhne. Detail ve skillu `content-engine`.
- **Modely** — všechna ID v `instagram/models.ts`, vždy přes `getModel()`, nikdy
  hardcoded string (env override `GEMINI_MODEL_<ACTION>[_FALLBACK]`). Pro tier používá
  alias `gemini-pro-latest`, **nepinuj Pro preview ID**.
- **Auth** — každá nová API route potřebuje `requireAuth()` z `lib/auth-guard.ts`
  (výjimka jen platební webhooky). Middleware chrání `/dashboard/*` a `/onboarding`.
- **Produkty pro grounding** — vždy živý katalog přes
  `getCatalogProducts(clientId, config.products)`; `config.products` je zmražený
  onboarding snapshot (`@deprecated`).
- **`ig_posts.link_type`** rozlišuje `'revision'` (přepis podle uživatele) od
  `'variant'` (A/B varianta); obojí odkazuje přes `revision_of`. Vždy ho nastav.
- **Retry logika** — importuj z `utils/retry.ts`, nikdy nekopíruj.
- **Nic nehardcoduj** — DB ID, buckety, adminské e-maily patří do `ClientConfig` nebo
  env (`SUPER_ADMIN_EMAILS`). Fonty a assety na Vercelu patří do
  `outputFileTracingIncludes` v `next.config.ts`.

## Kam pro hloubkový kontext

Skilly se načtou samy, když se úkolu týkají. Když víš dopředu, sáhni po nich rovnou:

| Skill | Kdy |
|---|---|
| `payments-billing` | platební brány, aktivace plánu, doklady, IČO/DPH, obchodní podmínky |
| `content-engine` | mega prompt, responseSchema, kritik, editorial board, brand memory, výběr modelu |
| `media-rendering` | obrázky, karusely, stories, reely, feed pattern, vision QA, ffmpeg, **tisk** |
| `post-editing` | „posuň nadpis", „zkrať text" — retuš hotového postu místo přegenerování |
| `campaigns-plans` | durable worker, drafty plánů, zásobník nápadů, produktové řady |

`docs/` popisuje **stabilní architekturu, ne changelog**. Když si dokumentace a kód
odporují, platí kód. Promptový audit: `docs/PROMPT_AUDIT_2026-08.md`, právní postup:
`docs/LEGAL_SETUP.md`.

## UI konvence

Jen tmavý režim, brutalistně-technická estetika: `bg-[#050505]`, `border-white/5`.
Labely vždy `uppercase tracking-widest font-bold` ve `text-[8px]`–`text-[11px]`, běžný
text `text-xs`–`text-sm`. Tailwind 4 přes PostCSS plugin (žádné `@tailwind` direktivy).

## Údržba tohohle souboru

Do CLAUDE.md **nepatří čísla verzí, příběhy o opravených chybách ani changelog** —
soubor se načítá v každém tahu, takže každý řádek platí každý úkol. Nové pravidlo
patří tam, kde ho něco vynutí: aserci do `npm run guard`, vysvětlení do skillu.
