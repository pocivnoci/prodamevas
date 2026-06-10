# 🧠 System Knowledge Base — Chrlit Studio

> **Codename:** ProdameVas  
> **Stack:** Next.js 16 (App Router) · Supabase (Postgres + Auth + Storage) · Google Gemini 3.5 Flash · Nano Banana Pro · Veo 3.1  
> **Last Updated:** 2026-06-10 (v4.1 — A/B varianty, dekompozice god files, onboarding + IG scraping)

---

## 1. High-Level Architecture

```mermaid
graph TB
    subgraph "Frontend - Next.js App Router"
        LP["Landing Page<br/>app/page.tsx"]
        DASH["Dashboard Studio<br/>17 Tab Components"]
        LOGIN["Auth Gate<br/>login + register (invite code)"]
        OB["Onboarding Wizard<br/>web scan + IG scraping → config → showcase"]
    end

    subgraph "API Routes"
        CJ["ig-create-job<br/>auth ✅ + rate limit 10/h"]
        RJ["ig-run-job<br/>auth ✅, 300s max"]
        JS["ig-job-status<br/>auth ✅, polling"]
        IG["ig-generate<br/>auth ✅, direct"]
        LN["ig-learn<br/>auth ✅, feedback"]
        PC["payments/create<br/>auth ✅ + COMGATE_MOCK"]
        PCB["payments/callback<br/>Comgate webhook"]
        SUB["subscription<br/>auth ✅"]
    end

    subgraph "Engine - instagram/"
        AP["autopilot.ts<br/>726 LOC Orchestrator"]
        OR["orchestrators/<br/>image · carousel · reel"]
        CG["caption-generator.ts<br/>Mega Prompt + Quality Gate"]
        EB["editorial-board.ts<br/>6 AI Agent Review"]
        SVC["service.ts<br/>DB Access + Feedback Loop"]
        GC["gemini-client.ts<br/>AI Model Gateway"]
        MA["memory-agent.ts<br/>Brand Memory + Learning"]
        CA["context-agent.ts<br/>Calendar + Weather + Trends"]
        IP["image-pipeline.ts<br/>Prompt Refinement"]
        TO["text-overlay.ts<br/>Satori → Sharp"]
        VP["video-processor.ts<br/>Veo 3.1 Reels"]
    end

    subgraph "Database - Supabase (16 tables)"
        CL[("clients + config JSONB")]
        IPO[("ig_posts")]
        II[("ig_post_ideas<br/>+performance_score")]
        IR[("ig_reviews<br/>+performance_score")]
        IGL[("ig_generation_log<br/>+critic_score/keep/fix")]
        BM[("ig_brand_memory<br/>pattern/preference/avoid/visual")]
        IJ[("ig_jobs<br/>+editorial_log")]
    end

    DASH -->|"1. create job"| CJ
    DASH -->|"2. run gen"| RJ
    DASH -->|"3. poll status"| JS
    CJ --> IJ
    RJ --> AP
    AP --> OR
    AP --> CG
    AP --> EB
    AP --> SVC
    AP --> GC
    AP --> MA
    AP --> CA
    AP --> IP
    AP --> TO
    LN -->|"triggers"| SVC
    LN -->|"triggers"| MA
    SVC --> II
    SVC --> IR
    SVC --> IPO
    MA --> BM
```

---

## 2. Multi-Tenancy Model

> [!IMPORTANT]
> **Every `ig_*` table uses `client_id uuid` FK to `clients.id`.** The dashboard passes a **projectId** (UUID), which maps to a client record. Config is stored as JSONB in `clients.config`.

| Layer | Identifier | Type |
|---|---|---|
| UI (StudioContext) | `projectId` | UUID string |
| API Routes | `clientId` from body/params | UUID |
| DB Queries | `client_id` | uuid FK |
| Config loader | `loadConfig(slug)` → `validateConfig()` | slug → ClientConfig |

> [!WARNING]
> Config lives ONLY in DB (`clients.config` JSONB). No config files in codebase — only `configs/types.ts` (TypeScript interface) and `configs/index.ts` (DB loader with caching + runtime validation).

---

## 3. Generation Pipeline (2-Step API)

```mermaid
sequenceDiagram
    participant UI as Dashboard
    participant CJ as ig-create-job
    participant RJ as ig-run-job
    participant JS as ig-job-status
    participant AP as Autopilot Engine
    participant DB as Supabase

    UI->>CJ: POST {configName, type, topic}
    Note over CJ: Rate limit check (10/h)
    CJ->>DB: INSERT ig_jobs → returns jobId
    CJ-->>UI: { jobId }
    UI->>RJ: POST { jobId } (fire)
    UI->>JS: GET /api/ig-job-status?id=... (poll every 2s)
    RJ->>AP: generateOnePost(options)
    AP->>DB: onProgress() → UPDATE ig_jobs status/progress
    JS-->>UI: { status, progress, agentMessage }
    AP-->>RJ: { id, caption, imageUrl, cost }
    RJ->>DB: UPDATE ig_jobs status=done, editorial_log
    RJ-->>UI: { success, postId, caption, imageUrl }
```

### Agent Pipeline (inside generateOnePost)

| Step | Agent | Model | Progress |
|------|-------|-------|----------|
| 1. Post type selection | Researcher | — | 5% |
| 2. Idea/Review selection | Researcher (weighted) | — | 15% |
| 3. Dedup check (Levenshtein) | Researcher | — | 20% |
| 4. Context gathering | Context Agent | `gemini-3.5-flash` | 20% |
| 5. Caption generation | Copywriter | `gemini-3.5-flash` | 25% |
| 6. Quality gate scoring | Critic | `gemini-3.5-flash` | 45% |
| 6b. Editorial Board review | Chief Editor + Copywriter | `gemini-3.5-flash` | 50% |
| 7. Image prompt refinement | Art Director | `gemini-3.5-flash` | 60% |
| 8. Image generation | Renderer | Nano Banana Pro / Nano Banana 2 | 75% |
| 9. Text overlay | Renderer | Satori + Sharp | 90% |
| 10. Upload + save | Uploader | Supabase Storage | 95% |

---

## 4. Feedback Loop Architecture

The system is **self-improving**. Metrics propagate back into future generations:

```
User enters metrics (likes, comments, saves) → updateIGPostMetrics()
    ↓ AUTO-TRIGGER (fire & forget)
    ├── propagateMetricsToSources()
    │       ├── ig_post_ideas.performance_score  (Idea Ranker)
    │       └── ig_reviews.performance_score     (Review Ranker)
    └── analyzeAndLearn()
            └── ig_brand_memory (new pattern/avoid/visual rules)

ig_generation_log
    └── critic_score, critic_keep[], critic_fix[]
        → autopilot reads last 5 scores → injects keep/fix into mega prompt

buildSmartWeekPlan()
    └── pillar ratios ×1.5 (top) / ×0.5 (under) based on real engagement

A/B Variant Loop (variant-actions.ts)
    generateMultipleVariants() → N draft variant postů (revision_of + link_type='variant')
        → uživatel vybere vítěze: selectVariantWinner()
            ├── winner → draft, losers → rejected
            └── learnFromVariantSelection(winner, losers, clientId)
                    → ig_brand_memory (preference)
    Pozn.: revisePost() linkuje přes revision_of + link_type='revision' —
    revize se do A/B srovnání ani učení NEpočítají.
```

> [!IMPORTANT]
> Learning trigger v `updateIGPostMetrics()` čte předchozí metriky PŘED updatem
> (jinak jsou delty vždy 0 a učení se nikdy nespustí) a běží přes `waitUntil()`
> z `@vercel/functions`, aby ho serverless neukončil s odpovědí.

> [!NOTE]
> Feedback loop is **automatic** — triggered when user saves metrics via `updateIGPostMetrics()`. Manual trigger: `POST /api/ig-learn { configName }`.

---

## 5. AI Model Registry

| Role | Model | Fallback | Notes |
|------|-------|----------|-------|
| **Text gen** (all agents) | `gemini-3.5-flash` | `gemini-2.5-flash-lite` | On 503/429 |
| **Image gen** (primary) | `gemini-3-pro-image-preview` | `gemini-3.1-flash-image-preview` | Nano Banana Pro → Nano Banana 2 |
| **Image edit** (product→scene) | `gemini-3-pro-image-preview` | — | editExistingImage() |
| **Image with refs** | `gemini-3-pro-image-preview` | — | generateImageWithReferences() |
| **Vision** (logo placement) | `gemini-3.5-flash` | — | detectLogoPlacementArea() |
| **Video** (reels) | `veo-3.1-fast-generate-001` | `veo-3.1-generate-001` | fast=$0.15/s, std=$0.40/s |
| **TTS** (voiceover) | `gemini-3.1-flash-tts-preview` | — | Czech narration, voice: Kore |

> [!CAUTION]
> `gemini-2.0-flash` is **DEPRECATED**. `imagen-4.0-ultra` was **sunset June 2026** — replaced by Nano Banana Pro. `gemini-3.1-pro-preview` was replaced by `gemini-3.5-flash`.

---

## 6. Database Schema (16 tables)

| Table | Key Columns | Notes |
|---|---|---|
| `clients` | `id` (uuid PK), `slug` (unique), `config` (jsonb) | Multi-tenant root |
| `user_clients` | `user_id`, `client_id`, `role` | RBAC |
| `ig_post_types` | `name`, `display_name`, `emoji`, `frequency` | Per-client post types |
| `ig_post_ideas` | `title`, `content`, `performance_score`, `times_used_with_metrics` | Idea Ranker (weighted) |
| `ig_reviews` | `quote`, `is_approved`, `performance_score`, `times_used_with_metrics` | Review Ranker (weighted) |
| `ig_products` | `name`, `type`, `slug`, `price`, `image_urls[]` | Products + photos |
| `ig_product_ideas` | `name`, `concept`, `design_url` | AI product design concepts |
| `ig_product_categories` | `name`, `client_id` | Product categories |
| `ig_posts` | `caption`, `image_url`, `status`, `idea_id`, `review_id`, `product_id`, `likes`, `saves`, `reach`, `feedback`, `revision_of`, `link_type` | `revision_of` + `link_type` ('revision'/'variant') link revisions & A/B variants to original |
| `ig_content_calendar` | `date`, `post_id`, `time_slot` | Calendar scheduling |
| `ig_generation_log` | `prompt_used`, `model_used`, `critic_score`, `critic_keep[]`, `critic_fix[]` | Critic feedback for learning |
| `ig_brand_memory` | `memory_type` (pattern/preference/avoid/visual), `content`, `confidence` | Long-term learning |
| `ig_jobs` | `status`, `progress`, `agent_message`, `editorial_log` (jsonb), `result` (jsonb) | Progress + editorial board log |
| `subscription_plans` | `id`, `name`, `price_czk`, `features` | Plan definitions |
| `subscriptions` | `client_id`, `plan_id`, `status`, `plan_posts_unlocked` | Active subscriptions |
| `payments` | `comgate_trans_id`, `amount`, `status` | Comgate payments |

---

## 7. File Reference

### AI Engine (`instagram/`)

| File | LOC | Role |
|---|---|---|
| `autopilot.ts` | ~730 | **Core orchestrator** — generateOnePost(), generateBatch() |
| `orchestrators/image-orchestrator.ts` | ~430 | Image rendering pipeline (extracted from autopilot) |
| `orchestrators/carousel-orchestrator.ts` | ~165 | Multi-slide carousel rendering |
| `orchestrators/reel-orchestrator.ts` | ~200 | Veo reel rendering |
| `cli.ts` | ~410 | Dev/management CLI (--stats, --feedback, --generate-ideas…) |
| `caption-generator.ts` | ~890 | Mega prompt builder, caption schemas, scorePost(), reviseCaption() |
| `editorial-board.ts` | 777 | reviewPost(), reviewContentPlan(), reviewOverlayComposition() |
| `text-overlay.ts` | 683 | Satori SVG → Sharp PNG overlay + logo watermark |
| `product-generator.ts` | 643 | Product ideas, design concepts, mockups |
| `service.ts` | 617 | DB access — getWeightedIdeas(), createPost(), propagateMetrics() |
| `memory-agent.ts` | 459 | getBrandMemories(), analyzeAndLearn(), getPostTypeBoosts() |
| `gemini-client.ts` | 455 | AI gateway — generateText(), generateImage(), editExistingImage(), generateVideo(), generateVoiceover() |
| `image-pipeline.ts` | 346 | refineImagePrompt(), refineCarouselPrompts(), getVisualMemoriesSection() |
| `video-processor.ts` | 247 | processReelVideo(), scenesToSubtitles() |
| `context-agent.ts` | 232 | gatherContext() — svátek, počasí, trendy |
| `content-planner.ts` | 223 | planWeek() — AI content planning |
| `performance.ts` | 186 | Per-pillar engagement analytics |
| `idea-generator.ts` | 145 | generateAIIdeas() with brand memory |
| `review-generator.ts` | 142 | generateAIReviews() with brand memory |
| `brand-tagger.ts` | 128 | tagBrandImages() — vision auto-tagging |
| `configs/index.ts` | — | loadConfig(), validateConfig(), resolveClientId(), invalidateConfigCache() |
| `configs/types.ts` | — | ClientConfig interface (brandVoice, contentPillars, feedAesthetic, imageInstructions, ...) |

### API Routes

| Route | Auth | Duration | Purpose |
|-------|------|----------|---------|
| `POST /api/ig-create-job` | ✅ membership + rate limit | 10s | Create job, **charge credit/plan counter** (refunded on failure), return jobId |
| `POST /api/ig-run-job` | ✅ job ownership | 300s | Run full generation pipeline |
| `GET /api/ig-job-status` | ✅ job ownership | 5s | Poll progress + **stuck-job reaper** (>8 min silent → failed + refund) |
| `POST /api/ig-learn` | ✅ membership | 60s | Trigger feedback loop |
| `POST /api/payments/create` | ✅ client membership | 10s | Create Comgate payment (mock disabled on prod) |
| `POST /api/payments/callback` | ❌ (webhook) | 10s | Comgate status callback (server-side verification) |
| `GET /api/payments/return` | ❌ (redirect) | 10s | Post-payment redirect |
| `GET /api/subscription` | ✅ | 10s | Client subscription info |

> `POST /api/ig-generate` byl odstraněn (v4.1) — obcházel rate limit i kredity a UI ho nepoužívalo.

### Server Actions (`app/actions/`) — decomposed by domain (v4.1)

| File | LOC | Key Exports |
|---|---|---|
| `product-actions.ts` | ~1130 | getProducts(), saveProduct(), deleteProduct(), product ideas |
| `admin-actions.ts` | ~640 | getDashboardStats(), getIGPostsList(), updateIGPostMetrics() (+ learning trigger), getEditorialLog(), checkIsAdmin() |
| `ig-generate-action.ts` | ~520 | triggerBatchGeneration(), triggerIdeaGeneration(), triggerReviewGeneration() |
| `content-plan-actions.ts` | ~420 | generateContentPlan() — levný textový plán před generováním (PlanTab) |
| `variant-actions.ts` | ~400 | revisePost(), generatePostVariant(), generateMultipleVariants(), selectVariantWinner(), getVariantGroup() |
| `config-actions.ts` | ~370 | getClientConfig(), updateClientConfig(), uploadClientLogo(), rescanClientWebsite(), deleteClient() |
| `credit-guard.ts` | ~200 | creditGuard(), creditGuardBatch(), canGenerate() — vše s membership checkem |
| `calendar-actions.ts` | ~180 | planWeekCalendar() |
| `product-brief-actions.ts` | ~155 | analyzeProductForBrief() → DOCX |
| `memory-actions.ts` / `post-actions.ts` | ~100 | brand memory CRUD / post delete |
| `app/onboarding/actions.ts` | ~1850 | analyzeWebsite() (web + HikerAPI IG scraping), generateConfigPreview(), refineConfigSection(), saveReviewedConfig() |

---

## 8. Security

| Layer | Protection |
|---|---|
| **Middleware** | Redirects unauthenticated to `/login` for `/dashboard/*`, `/onboarding` |
| **API Routes** | `requireProjectAccess()` (membership, ne jen login) na generovacích routes; job routes ověřují vlastnictví přes `requireClientAccess(job.client_id)` |
| **Server Actions** | Každá akce s `projectSlug` → `requireProjectAccess()`; akce s row id → fetch `client_id` + `requireClientAccess()`. Tenant fallbacky odstraněny — chybějící identifikátor = throw |
| **Rate Limiting** | 10 jobs/hour per client (DB-based, admin bypass) on `ig-create-job` |
| **Credits** | Charge při vytvoření jobu + refund při selhání; idempotence přes unique index `credit_transactions(action, reference_id)` |
| **Supabase RLS** | Enabled on all tables. `subscriptions`/`payments`/`subscription_plans` nemají policies = default-deny — záměr, frontend k nim přistupuje jen přes server (`/api/subscription`) |
| **Service Role** | `supabase/admin.ts` — bypasses RLS for engine operations |
| **Invite Codes** | Registration requires valid invite code (`invite_codes` table) |
| **Mock Payments** | `isMockPaymentMode()` — `COMGATE_MOCK=true` funguje, ale na `VERCEL_ENV=production` je ignorován (kill switch) |
| **Config Validation** | `validateConfig()` fills safe defaults; config cache má 60s TTL (invalidace platí jen pro lokální lambdu) |
| **Env Validation** | `lib/env.ts` přes `instrumentation.ts` — deploy spadne hned při chybějících povinných vars |
| **Monitoring** | `@sentry/nextjs` (aktivní jen s `SENTRY_DSN`) — captureException v ig-run-job |

### Supabase Clients

| Client | File | When to Use |
|--------|------|-------------|
| **Browser** | `supabase/client.ts` | ONLY frontend `"use client"` components |
| **Server** | `supabase/server.ts` | Server actions — has auth context (cookies) |
| **Admin** | `supabase/admin.ts` | Engine backend — service role, bypasses RLS |

---

## 9. Environment Variables

| Variable | Required | Used By |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | All |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Frontend, middleware |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server actions, engine |
| `GEMINI_API_KEY` | Yes for gen | gemini-client.ts |
| `SUPER_ADMIN_EMAILS` | Yes | auth-guard.ts, subscription.ts |
| `COMGATE_MERCHANT` | Yes for payments | lib/comgate.ts |
| `COMGATE_SECRET` | Yes for payments | lib/comgate.ts |
| `COMGATE_MOCK` | Optional (ignored on prod) | lib/comgate.ts — isMockPaymentMode() |
| `NEXT_PUBLIC_SITE_URL` | Yes | auth callback, payments |
| `HIKERAPI_KEY` | Optional | onboarding IG scraping (graceful skip) |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Optional | error monitoring (server / client) |

---

## 10. Cost Model (Per Generation)

| Operation | Model | Cost |
|---|---|---|
| Caption + Critic + Art Dir | gemini-3.5-flash | ~$0.02 |
| Image gen (Nano Banana Pro) | gemini-3-pro-image-preview | ~$0.05 |
| Image edit (product scene) | gemini-3-pro-image-preview | ~$0.05 |
| Video 8s | veo-3.1-fast | ~$1.20 |
| **Total per image post** | — | **~$0.10** |
| **Total per reel** | — | **~$1.25** |
| **Total per carousel (5 slides)** | — | **~$0.37** |
