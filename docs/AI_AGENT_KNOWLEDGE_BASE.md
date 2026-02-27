# AI AGENT KNOWLEDGE BASE: Instagram Multi-Tenant Autopilot

**POZOR PRO VŠECHNY AI AGENTY A LLM MODELY**: Tento dokument slouží jako zdroj pravdy (Source of Truth) pro architektonická, obchodní a technická rozhodnutí platformy. Jste-li asistující AI, PŘEČTĚTE SI TENTO DOKUMENT jako první, než budete cokoliv modifikovat.

---

## 🏗️ 1. Hlavní účel a Architektura systému
Tato platforma (`instagram/autopilot.ts`) je automatizovaný **Multi-Tenant Content Engine** určený ke generování Instagram příspěvků pro RŮZNÉ nezávislé klienty/značky.
Aplikace běží na serverless stacku (Next.js 16, Vercel) a data ukládá do **Supabase** (PostgreSQL + Object Storage).

**Klíčová pravidla architektury:**
- **Multi-tenant by design**: Aplikace se nesmí chovat klientsky specificky. Všechna specifika (barvy, weby, tone of voice, hashtagy) jsou izolovaná v **klientské konfiguraci** uložené v DB (`clients.config` JSONB sloupec).
- **Žádný hardcoding**: Ať jde o databázová ID, názvy bucketů, admin emaily nebo URL, vždy si je aplikace musí vytáhnout z `ClientConfig` (z DB) nebo ENV proměnných.
- **Konfigurace žije POUZE v Supabase DB** — v kódu existují pouze `configs/types.ts` (TypeScript interface) a `configs/index.ts` (loader s cache a RBAC).

---

## 📦 2. Průběh Pipeline (Od nápadu k hotovému postu)
Proces běží v `instagram/autopilot.ts` a je zásadní ho dodržovat v přesném pořadí. NIKDY nepřeskakujte validaci.

1. **Inicializace Configu**: Určí se aktivní klient přes `resolveClientId(slug)` → `setActiveProject(UUID)`. Config se načte z DB přes `loadConfig()` (cached).
2. **Výběr typu postu**: Podle `weekPlan` (nebo `--type` v CLI) se vybere formát (např. `meme`, `product_drop`, `tip_nastaveni`).
3. **Výběr Nápadu (Idea)**: Z tabulky `ig_post_ideas` se vytáhne nejstarší nepoužitý nápad pro daný pilíř a klienta. Cooldown 90 dní. Pokud nic není, Gemini vygeneruje vlastní téma.
4. **Mega-Prompt pro Gemini 3.1 Pro**: `buildMegaPrompt()` v `caption-generator.ts` poskládá prompt obsahující specifikaci (tone of voice, háčky, anti-patterny, performance data, recenze) z `ClientConfig`. Výstup: strukturovaný JSON (hook, body, cta, hashtags, imagePrompt).
5. **Quality Gate (Autokritika AI)**: `scorePost()` ohodnotí výstup 1-10. Pokud skóre < 7, generování se opakuje s kritikou jako kontextem.
6. **Deduplikace**: Hook a body se porovnají s posledními 30 posty pomocí Levenshteinovy vzdálenosti. Duplicity se regenerují.
7. **Image Pipeline**:
   - `refineImagePrompt()` v `image-pipeline.ts` vylepší raw prompt pro Imagen
   - Imagen 4 Ultra vygeneruje POUZE RAW POZADÍ (žádný text v obrázku!)
   - `overlayText()` v `text-overlay.ts` přidá text vrstvy přes Satori + resvg-js (pure JS, žádné system dependencies)
   - Fonty: `instagram/fonts/` (Inter, BebasNeue)
   - Loga: `instagram/assets/` (logo-watermark.png, logo-hanzfans.png atd.)
8. **Storage Upload a DB Sync**:
   - Obrázky se ukládají do Supabase Storage
   - Post se zapíše do `ig_posts` s `status: "draft"`
   - Generování se zaloguje do `ig_generation_log`
   - Použitý nápad se označí jako `used`

---

## 🔐 3. Bezpečnostní pravidla

### Supabase klienti — 3 typy
| Klient | Soubor | Kdy použít |
|--------|--------|-----------|
| **Browser** | `supabase/client.ts` | POUZE frontend komponenty (`"use client"`) |
| **Server** | `supabase/server.ts` | Server actions — má auth kontext (cookies) |
| **Admin** | `supabase/admin.ts` | Engine backend (`autopilot.ts`, `performance.ts`, `service.ts`) — service role key, obchází RLS |

> [!CAUTION]
> **NIKDY nepoužívat `supabase/client` v backendu.** Browser klient nemá auth kontext na serveru a může selhat nebo obejít bezpečnost.

### Admin práva
- Super-admin emaily jsou v ENV proměnné `SUPER_ADMIN_EMAILS` (comma-separated)
- Funkce `isSuperAdmin()` v `configs/index.ts` je čte z ENV
- **ŽÁDNÉ hardcoded emaily v kódu**

### Retry logika
- Sdílený modul `utils/retry.ts` — jediný zdroj pravdy pro retry chování
- Použit v: `gemini-client.ts`, `ig-generate-action.ts`, `product-actions.ts`, `route.ts`
- **NEKOPÍROVAT retry logiku do nových souborů** — importovat z `utils/retry.ts`

---

## 🗃️ 4. Databázová Struktura (Supabase)
Celý engine se opírá o vztahy s `clients` tabulkou jakožto Multi-Tenant pojistkou (viz `client_id`).

### Nejdůležitější tabulky
1. **`clients`**: Registry klientů/tenantů. UUID + slug (`mobilnamiru`). Config jako JSONB.
2. **`ig_post_types`**: Typy příspěvků (meme, reel, carousel) aktivní pro dané `client_id`.
3. **`ig_post_ideas`**: Zásobárna nápadů. `used_count`, `cooldown_days`, `is_active`.
4. **`ig_posts`**: Hotové příspěvky. Image URL, caption, hashtags. Status: `draft` → `ready` → `posted`.
5. **`ig_reviews`**: Recenze. `is_approved` musí být true pro použití v pipeline.
6. **`ig_product_ideas`**: Produktové nápady. Status: `review` → `saved` / `rejected`.

### Pravidla DB volání
- `client_id` je UUID, ne slug — vždy resolvovat přes `resolveClientId(slug)`
- Backendové skripty používají `supabase/admin.ts` (service_role_key)
- `.env.local` musí být dostupný pro admin připojení

---

## 🎨 5. Přidání Nového Klienta

1. **Vložit řádek do `clients` tabulky** v Supabase Dashboard:
   - `slug`: unikátní identifikátor (např. `"novafirma"`)
   - `name`: zobrazovaný název
   - `config`: kompletní `ClientConfig` jako JSONB (viz `configs/types.ts` pro strukturu)
   - `is_active`: `true`
2. **Propojit uživatele** přes `user_clients` tabulku nebo `scripts/setup-user.ts`
3. **Připravit assets**: Logo do `instagram/assets/`, nastavit `logoFile` v configu
4. **Vytvořit storage bucket** přes `scripts/create-client-buckets.ts` pokud oddělený
5. Dashboard ho automaticky objeví přes `getAvailableClients()` (RBAC)

> [!WARNING]
> **NEEXISTUJÍ žádné config soubory v kódu** — konfigurace se vkládá přímo do DB jako JSON.

---

## 🧩 6. Záludnosti při úpravách

1. **Vercel vs. Statické Soubory**: Fonty a assets pro dynamický load nutno balit do `outputFileTracingIncludes` (`next.config.ts`), jinak na Vercelu nebudou dostupné.
2. **Text v obrázcích**: Imagen 4 NESMÍ generovat text — vždy přes Satori (`text-overlay.ts`). V případě pádu Satori se vrátí raw obrázek bez textu.
3. **Timeouty GenAI**: Ošetřuje sdílený `withRetry()` v `utils/retry.ts`. Gemini/Imagen hází 503 při přetížení. Vercel má 5min limit (`maxDuration = 300`).
4. **Carousel fallback**: Pokud selže generování jednoho slidu, pipeline pokračuje s fallback na raw obrázek.

---

## 📁 7. Adresářová struktura

```
instagram/
├── autopilot.ts          # Core orchestrator (1107 ř.)
├── caption-generator.ts  # Mega prompt, schemas, quality gate
├── gemini-client.ts      # AI gateway (Gemini, Imagen, Veo)
├── image-pipeline.ts     # Prompt refinement
├── text-overlay.ts       # Satori + resvg-js text rendering
├── performance.ts        # Neural Brand Engine analytics
├── product-generator.ts  # Product idea → design → mockup
├── service.ts            # DB access layer (multi-tenant)
├── idea-generator.ts     # AI idea generation
├── review-generator.ts   # AI review generation
├── eshop-scraper.ts      # Product image scraper
├── types.ts              # Pipeline types (GenerateOptions, BrandVoice)
├── configs/
│   ├── index.ts          # DB loader, RBAC, resolveClientId
│   └── types.ts          # ClientConfig interface (166 ř.)
├── fonts/                # TTF fonts (Inter, BebasNeue)
└── assets/               # Logos, watermarks (per-client)

app/actions/
├── admin-actions.ts      # Dashboard reads (773 ř.)
├── ig-generate-action.ts # Generation + ideas/reviews writes
├── product-actions.ts    # Product pipeline actions
└── brand-images-action.ts # Brand asset management

utils/
└── retry.ts              # Shared retry logic (single source)
```

---
*Last Updated: 2026-02-27 — v2.0 Architecture*
