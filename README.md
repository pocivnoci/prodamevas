# 🔲 Chrlit Studio

AI-powered Instagram content engine. Zadáš web → AI pochopí brand → generuje kompletní posty (texty, obrázky, hashtagy, reels) ve tvém stylu.

**Stack:** Next.js 16 · React 19 · TypeScript 5 · Tailwind CSS 4 · Supabase · Google Gemini · Comgate  
**Deploy:** Vercel (serverless, max 300s timeout)  
**Codebase:** ~64 000 LOC, 237 souborů

---

## Quick Start

```bash
npm install
npm run dev          # Turbopack dev server
npm run build        # Production build
```

Open [http://localhost:3000](http://localhost:3000)

### Env vars (`.env.local`)

| Proměnná | Účel |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (frontend + middleware) |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin operace (bypass RLS) |
| `GEMINI_API_KEY` | Gemini 3.5 Flash, Nano Banana Pro, Veo 3.1, TTS |
| `COMGATE_MERCHANT` / `COMGATE_SECRET` | Platební brána (CZK) |
| `COMGATE_MOCK=true` | Testovací platby bez reálné brány (na produkci ignorováno) |
| `HIKERAPI_KEY` | IG scraping v onboardingu (volitelné) |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Error monitoring (volitelné) |
| `SUPER_ADMIN_EMAILS` | Comma-separated admin emaily |
| `NEXT_PUBLIC_SITE_URL` | URL pro auth callback + redirecty |

---

## Architektura

```
app/
├── page.tsx                          # Landing page (39 KB)
├── layout.tsx                        # Root layout + metadata
├── globals.css                       # Tailwind 4 + design tokens
├── sitemap.ts                        # Sitemap generator
├── (dashboard)/
│   ├── layout.tsx                    # Auth wrapper
│   ├── StudioContext.tsx             # Global state (17 sections, projectId, subscription)
│   ├── PaywallProvider.tsx           # Credit/paywall modals
│   ├── AdminSidebar.tsx              # Navigace (16 KB)
│   ├── ErrorBoundary.tsx             # Error boundary
│   └── dashboard/instagram/
│       ├── page.tsx                  # Tab router (SPA-like via StudioContext)
│       └── tabs/                     # 20 tab components + 3 shared files
│           ├── ProductsTab.tsx       # 1644 LOC
│           ├── SettingsTab.tsx       # 1619 LOC
│           ├── GenerateTab.tsx       # 1218 LOC
│           ├── PostsTab.tsx          # 808 LOC
│           ├── DashboardTab.tsx      # 609 LOC
│           └── ...                   # 15 dalších tabů
├── actions/                          # 12 server action souborů
│   ├── admin-actions.ts              # 2366 LOC — hlavní CRUD (27+ akcí)
│   ├── product-actions.ts            # 537 LOC
│   ├── ig-generate-action.ts         # 519 LOC — bridge → AI engine
│   ├── credit-guard.ts               # 197 LOC — kontrola kreditů
│   ├── calendar-actions.ts           # 180 LOC
│   ├── product-brief-actions.ts      # 154 LOC — DOCX brief generátor
│   ├── brand-images-action.ts        # 174 LOC
│   ├── product-category-actions.ts   # 98 LOC
│   ├── settings-actions.ts           # 60 LOC
│   ├── waitlist-admin.ts + waitlist.ts
│   └── admin-onboard-actions.ts
├── api/                              # 8 API routes
│   ├── ig-create-job/                # Membership ✅ + rate limit (10/h) + charge kreditu
│   ├── ig-run-job/                   # Job ownership ✅ — 300s, refund při selhání
│   ├── ig-job-status/                # Ownership ✅ — polling + stuck-job reaper
│   ├── ig-learn/                     # Membership ✅ — feedback loop
│   ├── payments/create/              # Auth ✅ + COMGATE_MOCK
│   ├── payments/callback/            # Comgate webhook (no auth — intentional)
│   ├── payments/return/              # Payment redirect (no auth — intentional)
│   └── subscription/                 # Auth ✅
├── auth/callback/                    # Supabase auth callback
├── login/                            # Login page
├── register/                         # Registrace s invite code
├── onboarding/                       # Onboarding wizard (90s timeout per showcase)
├── mock-payment/                     # Testovací platební stránka
├── privacy/ + terms/                 # Legal pages
│
instagram/                            # 🤖 AI Engine (server-only, 8101 LOC)
├── autopilot.ts                      # 1849 LOC — orchestrátor generování
├── caption-generator.ts              # 791 LOC — mega prompt + schemas + quality gate
├── editorial-board.ts                # 777 LOC — 6 AI agentů review
├── text-overlay.ts                   # 683 LOC — Satori SVG → Sharp PNG
├── product-generator.ts              # 643 LOC — product ideas + design concepts
├── service.ts                        # 617 LOC — DB helpers, weighted selection
├── memory-agent.ts                   # 459 LOC — učení z metrik → brand memory
├── gemini-client.ts                  # 455 LOC — AI gateway (text, image, video, TTS)
├── image-pipeline.ts                 # 346 LOC — prompt refinement, visual memory
├── video-processor.ts                # 247 LOC — Veo 3.1 reels processing
├── context-agent.ts                  # 232 LOC — svátek, počasí, trendy
├── content-planner.ts                # 223 LOC — AI plánování týdne
├── performance.ts                    # 186 LOC — per-pillar engagement analytics
├── idea-generator.ts                 # 145 LOC — AI generování nápadů
├── review-generator.ts               # 142 LOC — AI generování recenzí
├── brand-tagger.ts                   # 128 LOC — auto-tag brand images (vision)
├── logo-loader.ts                    # 50 LOC — logo asset loader
├── types.ts                          # 128 LOC — pipeline types
├── configs/
│   ├── types.ts                      # ClientConfig interface (JSONB schema)
│   └── index.ts                      # loadConfig(), validateConfig(), resolveClientId()
├── fonts/                            # Inter, BebasNeue (for Satori)
├── assets/                           # Logos, watermarks
└── README.md                         # Engine-specific docs

lib/
├── auth-guard.ts                     # requireAuth(), requireProjectAccess()
├── subscription.ts                   # 476 LOC — credit/plan system, trial v2
├── comgate.ts                        # 186 LOC — Comgate payment API
├── product-brief-docx.ts             # 432 LOC — DOCX generation
├── analytics.ts                      # Event tracking
└── types/                            # Shared TypeScript types

components/                           # 5 shared components
├── WaitlistForm.tsx                  # Landing page waitlist
├── LiveDemoWidget.tsx                # Landing page live demo
├── SeedOfLife.tsx                    # Landing page animated graphic
├── GoogleAnalytics.tsx               # GA4
└── LogoPV.tsx                        # Logo component

supabase/
├── admin.ts                          # Service role client (bypass RLS)
├── server.ts                         # User-scoped client (respects RLS)
├── client.ts                         # Browser client
├── database-schema.sql               # 16 tabulek
├── product-ideas-schema.sql          # Product ideas extension
└── migrations/                       # SQL migrations

utils/
└── retry.ts                          # Shared retry logic (single source of truth)

scripts/                              # 14 utility scripts
├── setup-user.ts                     # Create user + client
├── verify-beta-fixes.ts              # Beta verification
├── upload-product-images.ts          # Bulk image upload
└── ...                               # DB checks, bucket management

docs/                                 # Knowledge bases (THIS FILE)
├── SYSTEM_KNOWLEDGE_BASE.md
├── AI_AGENT_KNOWLEDGE_BASE.md
└── AI_RULES.md

middleware.ts                         # Auth redirect guard
```

---

## AI Model Registry (aktuální)

| Role | Model | Fallback |
|------|-------|----------|
| **Text gen** (caption, critic, art dir) | `gemini-3.5-flash` | `gemini-2.5-flash-lite` |
| **Image gen** (primary) | `gemini-3-pro-image-preview` (Nano Banana Pro) | `gemini-3.1-flash-image-preview` (Nano Banana 2) |
| **Image edit** (product→scene) | `gemini-3-pro-image-preview` | — |
| **Vision** (logo placement) | `gemini-3.5-flash` | — |
| **Video** (reels) | `veo-3.1-fast-generate-001` / `veo-3.1-generate-001` | — |
| **TTS** (voiceover) | `gemini-3.1-flash-tts-preview` | — |

> ⚠️ `gemini-2.0-flash` je **DEPRECATED**. `imagen-4.0-ultra` byl **sunset June 2026** — nahrazen Nano Banana Pro.

---

## Database (16 tabulek)

| Tabulka | Účel |
|---------|------|
| `clients` | Multi-tenant root (slug, config JSONB) |
| `user_clients` | RBAC (user_id → client_id, role) |
| `ig_post_types` | Typy postů per klient |
| `ig_post_ideas` | Nápady s `performance_score` (weighted selection) |
| `ig_reviews` | Recenze s `performance_score` (weighted selection) |
| `ig_products` | Produkty + image_urls |
| `ig_product_ideas` | AI generované product design koncepty |
| `ig_product_categories` | Kategorie produktů |
| `ig_posts` | Vygenerované posty (caption, image_url, status, metriky) |
| `ig_content_calendar` | Kalendář publikací |
| `ig_generation_log` | Log generování (critic_score, keep[], fix[]) |
| `ig_brand_memory` | Naučené vzorce (pattern/preference/avoid/visual) |
| `ig_jobs` | Job tracking (progress, editorial_log, result) |
| `subscription_plans` | Plány (cena, features) |
| `subscriptions` | Aktivní subscription per klient |
| `payments` | Platby (Comgate trans_id, amount, status) |

---

## Bezpečnost

- **Auth:** API routes ověřují členství v projektu (`requireProjectAccess`/`requireClientAccess`), ne jen přihlášení (kromě payment webhooků)
- **Kredity:** charge při vytvoření jobu, refund při selhání, idempotentní (unique index)
- **Middleware:** Chrání `/dashboard/*` + `/onboarding`
- **RLS:** Enabled na všech Supabase tabulkách
- **Rate limiting:** 10 jobů/hodinu per klient (admin bypass) v `ig-create-job`
- **Config validace:** `validateConfig()` v `loadConfig()` — safe defaults pro neúplné configy
- **Invite codes:** Registrace vyžaduje platný invite code (beta)
- **Mock platby:** `COMGATE_MOCK=true` → testovací platební stránka

---

## Testy

```bash
npx tsx test-beta-e2e.ts      # 57 statických kontrol — ověření beta/production fixů
npm run build                  # TypeScript + production build
npx tsx scripts/verify-beta-fixes.ts  # Dodatečná verifikace
npx tsx scripts/test-seq.ts    # buildSmartWeekPlan edge-cases (offline)
```

---

## Deploy

```bash
vercel              # Preview deploy
vercel --prod       # Production deploy
```

Automatický deploy z `main` branch na Vercel.

---

## Dev Conventions

- **Tailwind 4** — PostCSS plugin, NE `@tailwind` direktivy
- **Dark theme only** — brutalist/tech aesthetic (`bg-[#050505]`, `border-white/5`)
- **Font sizes** — `text-[8px]`–`text-[11px]` pro labels, `text-xs`–`text-sm` pro body
- **Labels** — vždy `uppercase tracking-widest font-bold`
- **SPA navigace** — `StudioContext.activeSection`, ne Next.js routing
- **Config v DB** — `clients.config` JSONB, typ `ClientConfig` v `instagram/configs/types.ts`
- **Retry logika** — vždy z `utils/retry.ts`, nikdy kopírovat
- **Backend** — `supabase/admin.ts` (service role), nikdy `supabase/client.ts`
