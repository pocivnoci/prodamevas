# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Chrlit Studio (codename "prodamevas") — multi-tenant AI Instagram content engine. User enters a website → AI learns the brand → generates complete posts (captions, images, reels). Stack: Next.js 16 (App Router) · React 19 · TypeScript 5 · Tailwind 4 · Supabase · Google Gemini · Comgate payments. Deployed on Vercel Pro serverless / Fluid Compute (800s max function timeout). UI and docs are in Czech.

**Read first:** `docs/AI_AGENT_KNOWLEDGE_BASE.md` (agent pipeline, gotchas), `docs/SYSTEM_KNOWLEDGE_BASE.md` (architecture, DB, env vars), `docs/AI_RULES.md` (doc-update checklist). Per `AI_RULES.md`, code changes **must** be reflected in those docs — it contains the map of which section to update.

> ⚠️ The knowledge bases were last rewritten at v4.0 (2026-06-02). Features shipped after that (A/B variant system, god-file decomposition into `app/actions/*` + `instagram/orchestrators/`, onboarding rewrite with Instagram scraping) are **not** in them — when docs and code disagree, trust the code, then update the docs.

## Commands

```bash
npm run dev                              # Dev server (Turbopack)
npm run build                            # Production build — also the de-facto typecheck
npm run lint                             # ESLint

npx tsx test-beta-e2e.ts                 # E2E test suite (static checks, no server needed)
npx tsx scripts/<script>.ts              # Utility scripts (setup-user, check-db, buckets…)
npx tsx instagram/cli.ts --config=<slug> # Engine CLI (--stats, --feedback, --generate-ideas…)
```

There is no unit-test framework; tests are standalone `tsx` scripts. Env comes from `.env.local` (see README for the variable table). `COMGATE_MOCK=true` enables mock payments.

## Architecture

Three layers, all multi-tenant:

1. **`app/`** — UI + server actions + API routes. The dashboard (`app/(dashboard)/dashboard/instagram/`) is SPA-like: one page with ~17 tab components (`tabs/`) switched via `StudioContext.activeSection`, **not** Next.js routing. `StudioContext` holds global state (active section, `projectId`, subscription). Server actions in `app/actions/` are split by domain (post-decomposition — older docs still describe one giant `admin-actions.ts`):
   - `admin-actions.ts` — dashboard stats, list/read queries, post status + metrics updates
   - `config-actions.ts` — `ClientConfig` CRUD, logo upload, website rescan, client deletion
   - `content-plan-actions.ts` — cheap text-only content-plan preview before expensive generation (PlanTab)
   - `variant-actions.ts` — A/B variant system: `revisePost`, `generatePostVariant`/`generateMultipleVariants`, `selectVariantWinner` (winner feeds memory learning), variant groups shown in PostsTab comparison modal
   - `memory-actions.ts`, `post-actions.ts`, `product-actions.ts`, `calendar-actions.ts`, `credit-guard.ts`, …
   - `app/onboarding/actions.ts` — onboarding wizard backend: `analyzeWebsite()` scrapes the website **and** the Instagram profile (`IgProfileData`, `IgInsights`), then config preview → refine → save flow

2. **`instagram/`** — server-only AI engine (~8k LOC). `autopilot.ts` (~700 LOC) orchestrates the multi-agent pipeline: Researcher (weighted idea/review selection) → Context Agent (holiday/weather via `signals/`) → Copywriter (mega prompt in `caption-generator.ts`) → Critic (1–10 score + keep/fix) → Editorial Board (max 3 revision rounds, `editorial-board.ts`) → Art Director → Renderer → upload. Media rendering lives in `orchestrators/` (image/carousel/reel, shared `ProgressReporter` + `CaptionData` types in `orchestrators/types.ts`). Dev/management commands are in `cli.ts`. `gemini-client.ts` is the single AI gateway (text, image, video, TTS) with model fallbacks.

3. **`supabase/`** — three clients, never mix them:
   - `client.ts` — browser only (`"use client"`)
   - `server.ts` — server actions (has auth context, respects RLS)
   - `admin.ts` — engine backend (service role, bypasses RLS)

### Multi-tenancy

`clients` table is the root; the UI's `projectId` is the client UUID. **Every `ig_*` query must filter by `client_id`.** All per-client configuration lives in `clients.config` JSONB (typed by `ClientConfig` in `instagram/configs/types.ts`, loaded via `loadConfig()` in `instagram/configs/index.ts` which applies `validateConfig()` safe defaults). No config files in the codebase; any new `ClientConfig` field needs a default in `validateConfig()`.

### Generation flow (2-step API)

UI calls `/api/ig-create-job` (fast, rate-limited 10 jobs/h per client, returns `jobId`) → `/api/ig-run-job` (blocks up to 800s, runs `generateOnePost()`) while polling `/api/ig-job-status` every 2s. Job progress, editorial-board log, and result are stored in `ig_jobs`. This is the **single-post** path.

### Multi-post campaigns (durable, server-side)

Content-plan batches do **not** loop in the browser (that loop died with the tab → "asked for 7, got 4"). Instead the approved plan is persisted as an `ig_campaigns` row by `startCampaign()` (`app/actions/campaign-actions.ts`), and a once-a-minute Vercel cron (`app/api/cron/campaign-worker`, `vercel.json`) drains it: it claims one campaign via a `worker_lease` (heartbeated through `onProgress` so a live campaign can't be stolen), generates each post inside the 800s budget exactly like `ig-run-job`, and advances `ig_campaigns.cursor` after each post so a timeout/crash **resumes from the cursor** on the next tick. The worker has no user session, so it charges credits via the `clientId`-based primitives (`canPerformAction`/`deductCredits`/`incrementPlanPostCount`/`refundJobCharge`), **not** `creditGuard`/`requireProjectAccess`. Each post's `ig_jobs` row carries `config.campaignId`. UI polls `getCampaignStatus()` and reconnects to an in-flight campaign on mount via `localStorage` — the tab can close freely. Run the `supabase/migrations/20260618_ig_campaigns.sql` migration before this works.

### Feedback loops (sacred — don't break them)

- Post metrics → `propagateMetricsToSources()` updates `performance_score` on `ig_post_ideas` / `ig_reviews` → weighted selection on next generation. Any new content source needs a `performance_score` + weighted-selection function.
- Critic scores in `ig_generation_log` are injected back into prompts (last 5).
- `memory-agent.ts` learns patterns into `ig_brand_memory` (pattern/preference/avoid/visual); `updateIGPostMetrics()` auto-triggers propagation + learning (fire & forget).

## Hard rules

- **Identifier convention:** the tenant *slug* lives at the UI boundary (`projectId` in `StudioContext` is actually the slug); resolve it to the client UUID exactly once via `requireProjectAccess(slug)` (or `requireClientAccess(uuid)` when you already have a row's `client_id`) and pass the UUID everywhere inside. Never default a missing identifier to a real tenant — throw.
- **`setActiveProject()` is module-global mutable tenant state** in `instagram/service.ts` — with concurrent requests per lambda it can cross-contaminate tenants. New engine code must take `clientId` as an explicit parameter (see `propagateMetricsToSources`, `analyzeAndLearn`); don't add new `getActiveProject()` callers.
- **`ig_posts.link_type`** distinguishes `'revision'` (user-feedback rewrite via `revisePost`) from `'variant'` (A/B variant) — both link via `revision_of`. Always set it when linking posts; A/B comparison and variant learning filter on `link_type='variant'`.

- **Auth:** every new API route needs `requireAuth()` from `lib/auth-guard.ts` (only payment webhooks are exempt). Middleware protects `/dashboard/*` + `/onboarding`.
- **Retry logic:** import from `utils/retry.ts`, never copy it.
- **No hardcoding** of DB IDs, buckets, or admin emails — use `ClientConfig` or env vars (`SUPER_ADMIN_EMAILS`).
- **AI models:** all model IDs live in `instagram/models.ts` — always use `getModel()`, never hardcode a model string (env override: `GEMINI_MODEL_<ACTION>[_FALLBACK]`). Deprecated, never use: `gemini-2.0-flash`, `gemini-3-pro-preview` (404'd "no longer available" 2026-06-18), `imagen-4.0-ultra`, `gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview` (preview image IDs shut down June 25, 2026). The deep-quality Pro tier (`textPro`/`designer`/`visionQA`) uses the **`gemini-pro-latest` alias** — never pin a Pro preview ID, the alias auto-rotates to the current GA Pro so a shutdown can't 404 us (it currently resolves to `gemini-3.1-pro-preview`; don't hardcode that ID directly).
- **Visual engines:** `ClientConfig.visualEngine` selects the renderer. Default `"native"`: AI Designer (`generateDesignBrief` in `image-pipeline.ts`) produces a design brief → Nano Banana Pro renders the complete post **including Czech typography + logo** (logo passed as labeled reference image) → `verifyNativeImage` vision QA → one corrective edit → Satori fallback. Legacy `"overlay"`: image prompts on this path must stay **text-free** (the old hard rule) — text is stamped via Satori → Sharp (`instagram/text-overlay.ts`). Both paths log `qa_status` to `ig_generation_log`.
- **Fonts/assets on Vercel** must be listed in `outputFileTracingIncludes` in `next.config.ts`.

## UI conventions

Dark theme only, brutalist/tech aesthetic: `bg-[#050505]`, `border-white/5`. Labels are always `uppercase tracking-widest font-bold` at `text-[8px]`–`text-[11px]`; body text `text-xs`–`text-sm`. Tailwind 4 via PostCSS plugin (no `@tailwind` directives).
