# AI AGENT KNOWLEDGE BASE: Chrlit Studio — Instagram Multi-Tenant Autopilot

**POZOR PRO VŠECHNY AI AGENTY**: Tento dokument slouží jako zdroj pravdy pro architektonická a technická rozhodnutí. Přečtěte si ho jako první.

*Last Updated: 2026-06-02 — v4.0 Beta Launch*

---

## 🏗️ 1. Hlavní účel a Architektura systému

Chrlit Studio (`instagram/autopilot.ts`) je automatizovaný **Multi-Tenant Content Engine** pro generování Instagram příspěvků. Běží na serverless stacku (Next.js 16, Vercel) s daty v **Supabase** (PostgreSQL + Object Storage).

**Klíčová pravidla:**
- **Multi-tenant by design**: Všechna specifika v `clients.config` JSONB
- **Žádný hardcoding**: Databázová ID, buckety, admin emaily → vždy z `ClientConfig` nebo ENV
- **Config v DB**: POUZE `configs/types.ts` (interface) a `configs/index.ts` (loader + `validateConfig()`)
- **Feedback loops jsou posvátné**: Každý agent předává data dalšímu

---

## 🤖 2. Multi-Agent Pipeline

```
Researcher → Copywriter → Critic → Editorial Board (max 3 kola) → Art Director → Renderer → Uploader
    ↑                        ↓                                                                    ↓
Brand Memory ←────── ig_generation_log (critic_score) ──────────────── ig_posts ─────────────────┘
    ↑                                                                      ↓
ig_post_ideas (weighted) ←──────── propagateMetricsToSources() ←──────────┘ (AUTO)
ig_reviews (weighted) ←─────────── propagateMetricsToSources() ←──────────┘ (AUTO)
Context Agent (svátek, počasí) ──→ buildMegaPrompt()
```

### Agent Role Assignment

| Agent | Funkce | Model |
|-------|--------|-------|
| **Researcher** | Vybere typ, nápad (weighted), recenzi (weighted), product, dedup check | — |
| **Context Agent** | Svátek, počasí, trendy → injektuje do promptu | `gemini-3.5-flash` |
| **Copywriter** | Generuje caption/script/carousel z mega promptu | `gemini-3.5-flash` |
| **Critic** | Hodnotí 1–10, vrací `keep[]` a `fix[]` | `gemini-3.5-flash` |
| **Editorial Board** | Šéfredaktor + copywriter revize (max 3 kola) | `gemini-3.5-flash` |
| **Art Director** | Vylepšuje image prompt, injektuje vizuální pravidla z memory | `gemini-3.5-flash` |
| **Renderer** | Generuje obrázek/video, přidává text overlay | Nano Banana Pro / Veo 3.1 |
| **Memory Agent** | Analyzuje vzorce z postů, zapisuje/updatuje `ig_brand_memory` | `gemini-3.5-flash` |

---

## 📦 3. Průběh Pipeline (krok za krokem)

1. **UI volá `/api/ig-create-job`** → rate limit check (10/h) → vytvoří `ig_jobs`, vrátí `jobId`
2. **UI začne pollovat `/api/ig-job-status?id=...`** každé 2s
3. **UI volá `/api/ig-run-job`** s `{ jobId }` — blokuje až 300s
4. **Uvnitř `generateOnePost()`:**
   - Config: `loadConfig()` → `validateConfig()` (safe defaults pro neúplný config)
   - Researcher: vybere typ, nápad (`getWeightedIdeas()`), recenzi (`getWeightedReviews()`)
   - Context Agent: `gatherContext()` → svátek, počasí, trendy
   - Brand Memory: `getBrandMemories(8)` + `getPostTypeBoosts()` + critic_score feedback
   - Copywriter: `generateText(megaPrompt)` → JSON `{hook, body, cta, hashtags, imagePrompt}`
   - Dedup check: hook + body vs. posledních 30 postů (Levenshtein)
   - Critic: `scorePost()` → score 1–10, `keep[]`, `fix[]`
   - Pokud score < 9: Editorial Board — šéfredaktor review + copywriter revize (max 3 kola)
   - Art Director: `refineImagePrompt()` → vylepšený prompt (s visual memory)
   - Renderer: `generateImage()` / `editExistingImage()` (product→scene) / `generateVideo()`
   - Text overlay: Satori SVG → Sharp PNG → gradient + hook text + logo watermark
   - Overlay review: `reviewOverlayComposition()` — vision check
   - Upload: Supabase Storage → `createPost()` → `logGeneration(+ critic data)`
5. **`ig_jobs` se updatuje** `status=done`, `editorial_log` uložen

---

## 🔄 4. Feedback Loop (v4.0 — plně automatický)

### Automatický trigger
Po zadání metrik přes `updateIGPostMetrics()` se **automaticky** spustí:

**A) `propagateMetricsToSources()`** — Metrics → Ideas/Reviews
- Načte `ig_posts` s metrikami
- Vypočítá engagement score
- Updatuje `ig_post_ideas.performance_score` + `ig_reviews.performance_score`

**B) `analyzeAndLearn()`** — Metrics → Brand Memory
- Načte top posty (>1.5x průměr) a slabé posty (<0.5x průměr)
- Gemini extrahuje max 3 pravidla (pattern / preference / avoid)
- Ukládá/updatuje `ig_brand_memory` (dedup přes ilike match)

### Critic → Prompt Feedback
- `logGeneration()` ukládá `critic_score`, `critic_keep[]`, `critic_fix[]`
- Autopilot čte posledních 5 critic scores a injektuje keep/fix do mega promptu
- Umožňuje systému se učit z vlastních chyb

### Weighted Selection
```typescript
getWeightedIdeas(3)   // score > avg*1.5 → 3x výběr, score > avg → 2x, ostatní 1x
getWeightedReviews(3) // stejný pattern
buildSmartWeekPlan()  // pillar ratio × 1.5 (top) / × 0.5 (under), normalizováno
```

---

## 🔐 5. Bezpečnostní pravidla

### Auth & Rate Limiting
- Všechny API routes mají `requireAuth()` (kromě payment webhooks)
- Rate limit: 10 jobů/hodinu per klient (admin bypass) v `ig-create-job`
- Registrace vyžaduje invite code
- `COMGATE_MOCK=true` → testovací platby
- `validateConfig()` zabraní crashům u neúplných configů

### Supabase klienti

| Klient | Soubor | Kdy použít |
|--------|--------|------------|
| **Browser** | `supabase/client.ts` | POUZE frontend `"use client"` |
| **Server** | `supabase/server.ts` | Server actions — má auth kontext |
| **Admin** | `supabase/admin.ts` | Engine backend — service role, bypasses RLS |

> [!CAUTION]
> **NIKDY nepoužívat `supabase/client` v backendu.** Retry logika: importovat z `utils/retry.ts`, nikdy nekopírovat.

---

## 🗃️ 6. Databázová Struktura (16 tabulek)

| Tabulka | Klíčové sloupce | Poznámka |
|---------|----------------|----------|
| `clients` | `id`, `slug`, `config` (jsonb) | Multi-tenant root |
| `user_clients` | `user_id`, `client_id`, `role` | RBAC |
| `ig_post_types` | `name`, `display_name`, `emoji`, `frequency` | Per-client |
| `ig_post_ideas` | `performance_score`, `times_used_with_metrics` | Weighted selection |
| `ig_reviews` | `performance_score`, `times_used_with_metrics` | Weighted selection |
| `ig_products` | `name`, `price`, `image_urls[]` | Products + photos |
| `ig_product_ideas` | `name`, `concept`, `design_url` | AI product designs |
| `ig_product_categories` | `name`, `client_id` | Categories |
| `ig_posts` | `caption`, `image_url`, `status`, `idea_id`, `review_id`, `product_id` | FK + metriky |
| `ig_content_calendar` | `date`, `post_id`, `time_slot` | Calendar |
| `ig_generation_log` | `critic_score`, `critic_keep[]`, `critic_fix[]` | Critic → learning |
| `ig_brand_memory` | `memory_type` (pattern/preference/avoid/visual), `confidence` | Long-term learning |
| `ig_jobs` | `status`, `progress`, `editorial_log` (jsonb), `result` (jsonb) | Job tracking + editorial board log |
| `subscription_plans` | `id`, `name`, `price_czk`, `features` | Plans |
| `subscriptions` | `plan_id`, `status`, `plan_posts_unlocked` | Active subs |
| `payments` | `comgate_trans_id`, `amount`, `status` | Comgate payments |

---

## 🤖 7. AI Modely (aktuální stav k 2.6.2026)

| Role | Model | Fallback |
|------|-------|----------|
| Text gen (primary) | `gemini-3.5-flash` | `gemini-2.5-flash-lite` (na 503/429) |
| Image gen | `gemini-3-pro-image-preview` (Nano Banana Pro) | `gemini-3.1-flash-image-preview` (Nano Banana 2) |
| Image edit | `gemini-3-pro-image-preview` | — |
| Vision | `gemini-3.5-flash` | — |
| Video | `veo-3.1-fast-generate-001` / `veo-3.1-generate-001` | — |
| TTS | `gemini-3.1-flash-tts-preview` | — |

> [!CAUTION]
> **DEPRECATED:** `gemini-2.0-flash`, `gemini-3.1-pro-preview`, `imagen-4.0-ultra` — NEPOUŽÍVAT!

---

## 🧩 8. Záludnosti při úpravách

1. **2-step API**: `ig-create-job` (fast, vrátí jobId) → `ig-run-job` (300s). UI polluje od prvního requestu.
2. **Rate limit**: 10/h per klient v `ig-create-job`. Admin bypass přes `SUPER_ADMIN_EMAILS`.
3. **Config validace**: `loadConfig()` volá `validateConfig()` — safe defaults pro 11+ polí. Nový klient necrashne.
4. **Weighted selection**: Nové datové zdroje musí mít `performance_score` + weighted selection funkci.
5. **Critic → Prompt**: Autopilot čte posledních 5 critic_score z `ig_generation_log` → injektuje do promptu.
6. **Editorial Board**: `reviewPost()` — max 3 kola revizí. Log se ukládá do `ig_jobs.editorial_log`.
7. **Editorial log UI**: `getEditorialLog(postId)` → PostDetailModal zobrazuje celou konverzaci s role-specific barvami.
8. **Vercel timeouty**: `ig-create-job` = 10s, `ig-run-job` = 300s, `ig-learn` = 60s.
9. **Fonty/assets na Vercelu**: Musí být v `outputFileTracingIncludes` v `next.config.ts`.
10. **Text v obrázcích**: Imagen NESMÍ generovat text — vždy přes Satori (`text-overlay.ts`).
11. **Memory Agent ilike**: `ig_brand_memory` nemá FTS index — používat `.ilike("content", ...)`.
12. **imageInstructions**: Per-post-type image instructions v `ClientConfig` — editor v SettingsTab, consumováno v `buildMegaPrompt()`.
13. **Onboarding timeout**: 90s `Promise.race` per showcase post — non-fatal, přeskočí se.
14. **Mock platby**: `COMGATE_MOCK=true` → mock-payment stránka, callback bypass.
15. **Feedback auto-trigger**: `updateIGPostMetrics()` automaticky spustí `propagateMetrics()` + `analyzeAndLearn()` (fire & forget).

---

## 📁 9. Adresářová Struktura

```
instagram/                            # AI Engine (8101 LOC)
├── autopilot.ts                      # 1849 LOC — orchestrátor
├── caption-generator.ts              # 791 LOC — mega prompt, schemas, quality gate
├── editorial-board.ts                # 777 LOC — 6 AI agentů review
├── text-overlay.ts                   # 683 LOC — Satori → Sharp
├── product-generator.ts              # 643 LOC — product ideas, design concepts
├── service.ts                        # 617 LOC — DB access, weighted selection, feedback
├── memory-agent.ts                   # 459 LOC — brand memory, learning
├── gemini-client.ts                  # 455 LOC — AI gateway (text, image, video, TTS)
├── image-pipeline.ts                 # 346 LOC — prompt refinement, visual memory
├── video-processor.ts                # 247 LOC — Veo 3.1 reels
├── context-agent.ts                  # 232 LOC — svátek, počasí, trendy
├── content-planner.ts                # 223 LOC — AI week planning
├── performance.ts                    # 186 LOC — per-pillar analytics
├── idea-generator.ts                 # 145 LOC — AI ideas (with memory)
├── review-generator.ts               # 142 LOC — AI reviews (with memory)
├── brand-tagger.ts                   # 128 LOC — vision auto-tagging
├── logo-loader.ts                    # 50 LOC — logo assets
├── types.ts                          # 128 LOC — pipeline types
└── configs/
    ├── index.ts                      # loadConfig(), validateConfig(), resolveClientId()
    └── types.ts                      # ClientConfig interface

app/api/
├── ig-create-job/route.ts            # Auth ✅ + rate limit (10/h)
├── ig-run-job/route.ts               # Auth ✅ — 300s
├── ig-job-status/route.ts            # Auth ✅ — polling
├── ig-generate/route.ts              # Auth ✅ — direct generate
├── ig-learn/route.ts                 # Auth ✅ — feedback
├── payments/create/route.ts          # Auth ✅ + COMGATE_MOCK
├── payments/callback/route.ts        # Comgate webhook (no auth)
├── payments/return/route.ts          # Payment redirect
└── subscription/route.ts             # Auth ✅

app/actions/                          # 12 server action files (4387 LOC)
├── admin-actions.ts                  # 2366 LOC — 27+ akcí (CRUD, stats, editorial log)
├── product-actions.ts                # 537 LOC
├── ig-generate-action.ts             # 519 LOC
├── credit-guard.ts                   # 197 LOC
├── calendar-actions.ts               # 180 LOC
├── product-brief-actions.ts          # 154 LOC — DOCX brief
├── brand-images-action.ts            # 174 LOC
├── product-category-actions.ts       # 98 LOC
├── settings-actions.ts               # 60 LOC
├── waitlist-admin.ts + waitlist.ts
└── admin-onboard-actions.ts
```
