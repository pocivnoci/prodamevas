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
   - `content-plan-actions.ts` — deep text-only content-plan preview before media generation: `runPlanPipeline` (`instagram/plan-pipeline.ts`) = strategist → concepts → cross-family judge → targeted revision, all on the `planner` Pro ladder (never flash); UI polls `getPlanProgress(planRunId)` for live stage messages (~1–2 min run). Takes a `PlanBriefOptions` object (count, topic, `goal`, `carouselShare`, `productIds`) — not positional args; the weekly cadence chip (`getPlanCadence`/`savePlanCadence`, recommended value derived from the subscription's credit affordance) drives count, credit estimate AND the calendar spread (`lib/schedule-planner.ts` spreads posts weekly, tested by `scripts/test-schedule-planner.ts`). The generated preview is persisted as a **draft campaign** (`getPlanDraft`/`savePlanDraft`/`discardPlanDraft`) so a refresh can't throw the run away; the preview itself stays side-effect-free (idea-bank deposits happen only at `startCampaign`)
   - `variant-actions.ts` — A/B variant system: `revisePost`, `generatePostVariant`/`generateMultipleVariants`, `selectVariantWinner` (winner feeds memory learning), variant groups shown in PostsTab comparison modal
   - `line-actions.ts` — product lines (v8.3): `generateLine` (credit `product_line`, row created up-front at `status:'generating'` so `getLineProgress(runId)` has something to poll), `reviseLineSku`, `approveLine`, `discardLine`. Approval is a **conditional claim** (`UPDATE … WHERE id=? AND client_id=? AND status='draft'`) exactly like plan drafts — single-use, **never add an insert fallback**
   - `print-actions.ts` — print designs (v8.3): `generatePrintDesign`, `generatePrintVariants` (A/B), `editPrintDesign` (**edits** existing artwork, never re-rolls), `generateMockup`, `selectDesignWinner` (→ `visual` brand memory)
   - `billing-actions.ts` — fakturační údaje zákazníka (`ig_billing_details`) + přehled dokladů. `recordInstantAccessConsent` ukládá čas **i znění** souhlasu se zahájením plnění a zapisuje **podmíněně** (`.is(…, null)`), aby re-potvrzení nepřepsalo původní razítko
   - `memory-actions.ts`, `post-actions.ts`, `product-actions.ts`, `calendar-actions.ts`, `credit-guard.ts`, …
   - `app/onboarding/actions.ts` — onboarding wizard backend: `analyzeWebsite()` scrapes the website **and** the Instagram profile (`IgProfileData`, `IgInsights`), then config preview → refine → save flow. Save is transactional-ish: the `user_clients` link is created right after the client insert and is **fatal** (rollback of the client row on failure — an unlinked client is an unreachable orphan and a retry would duplicate the tenant); re-onboarding (`existingClientSlug`) preserves slug-bound assets (`storageBucket`, `logoFile`, `postsPerWeek`, voice examples…) so a re-scan can't clobber them. Post-save showcase content runs via `startOnboardingBootstrap()` — teaser plan + idea-bank seed inline, then the 3 showcase posts as a durable `ig_campaigns` row (`adminBypass: true`, never charged) drained by the campaign worker, so closing the tab no longer strands a new client

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

Content-plan batches do **not** loop in the browser (that loop died with the tab → "asked for 7, got 4"). Instead the approved plan is persisted as an `ig_campaigns` row by `startCampaign()` (`app/actions/campaign-actions.ts`), and a once-a-minute Vercel cron (`app/api/cron/campaign-worker`, `vercel.json`) drains it: it claims one campaign via a `worker_lease` (heartbeated by an **independent 60s timer** — `onProgress` alone can stay silent longer than the 5min lease during a `withQualityRetry` backoff, letting a second worker steal a live campaign; the interval must be cleared on every exit path), generates each post inside the 800s budget exactly like `ig-run-job`, and advances `ig_campaigns.cursor` after each post so a timeout/crash **resumes from the cursor** on the next tick. Each item's `jobId` is persisted onto the plan row **at job creation** (not only on deferral), so a process kill mid-generation reuses the job + its charge on the next tick instead of double-charging; a parked job already `done` is counted, never regenerated. The worker has no user session, so it charges credits via the `clientId`-based primitives (`canPerformAction`/`deductCredits`/`incrementPlanPostCount`/`refundJobCharge`), **not** `creditGuard`/`requireProjectAccess`. Each post's `ig_jobs` row carries `config.campaignId`. UI polls `getCampaignStatus()` and reconnects to an in-flight campaign on mount via `localStorage` — the tab can close freely. Run the `supabase/migrations/20260618_ig_campaigns.sql` migration before this works.

**Plan drafts + campaign arc (v7.9):** a generated plan preview is persisted as an `ig_campaigns` row at `status:'draft'` (migration `20260718_plan_drafts.sql`). The worker claims only `pending|running`, so a draft **structurally cannot generate or charge**. Approval is a **conditional claim** (`UPDATE … WHERE id=? AND client_id=? AND status='draft'`) — single-use, so a double-click is refused rather than billed twice; **never add an insert fallback when that claim returns no row.** `savePlanDraft`/`discardPlanDraft` are status-scoped for the same reason. Abandoned drafts (>14 d) are GC'd on the worker's idle tick. The strategist's arc is persisted into `options.strategySummary` and handed to **every** post including #1 (its injection in `autopilot.ts` must not be gated on `previousPosts.length > 0`).

**Feed pattern (v7.9):** `config.feedPattern` (`lib/feed-pattern.ts`: `none | checkerboard | rows | columns | diagonal`) gives each post a grid-position-derived **visual mode** (photo/typography/graphic) that maps onto a group of the designer's `LAYOUT_ARCHETYPES`. The pattern picks the **family**; the archetype rotation ban applies *within* it, and the pattern wins if the ban would empty the family. `PHOTO-FIRST`/`NO EMPTY VOIDS` are **slot-conditional** — never apply them to a typography/graphic slot (they'd forbid exactly what the slot asks for). `slotIntent` is decided at plan time, rides the plan row, and the worker **must never recompute it** (a resumed post would flip mode mid-grid). Single posts derive it from `countFeedPosts(clientId)`, whose filter must stay identical to FeedTab's grid (`image_url IS NOT NULL`) or the ghost cells lie. `feedPattern` needs its `validateConfig()` clamp — engine code indexes `ARCHETYPE_GROUPS[mode]`. Pattern math is pure and tested: `npx tsx scripts/test-feed-pattern.ts`.

**Plan ↔ idea bank (v7.6):** `generateContentPlan` draws topics from `getWeightedIdeas` (model returns `ideaIndex`, clamped in code → `ContentPlanItem.ideaId`); `startCampaign` validates incoming ideaIds (ownership) and **deposits invented approved topics back** into `ig_post_ideas` (only there — the worker must never insert on resume); plan rows carry `ideaId` → worker → `generateOnePost({ideaId, topic})` = truthful attribution (the topic was derived from that idea; this deliberately coexists with the v7.5 "explicit topic skips weighted selection" rule). The plan preview is side-effect-free. There is no other week-planner: `planWeekAction`/`content-planner.ts` were removed (billing leak — uncharged synchronous generation); CalendarTab's "Naplánovat týden" opens the campaign flow via `generateIntent`.

### Product lines + print (v8.3)

A **product line** (`ig_product_lines`, migration `20260729_product_lines.sql`) is an ordered *system* of SKUs, not a tag: each catalog row carries `line_step` (1-based position in the process), `line_role` (what that step does) and `specs`. `instagram/line-generator.ts` designs it on the **designer Pro ladder** and `validateLine()` re-checks the structure in code — contiguous steps, no catalog collision, no price zig-zag (one descent is fine; a maintenance product legitimately costs less than the protection step). Approval follows the plan-draft doctrine to the letter.

**Print is a separate engine from Instagram** (`instagram/print-pipeline.ts`) and produces **flat artwork, never a product photograph** — the removed `generateDesignConcept` failed at the prompt level, forcing "Product photography, studio lighting, photorealistic" so the mockup step pasted a shirt photo onto another shirt. Geometry comes from `ig_product_categories` (`artwork_kind`/`aspect_ratio`/`print_size_mm`/`panels`/`bleed`), **never a hardcoded ratio**. QA mirrors `verifyNativeImage` (exact Czech diacritics, flatness, logo integrity, safe area) and ships the best attempt. `finalizePrintFile` resizes with **`cover`, never `fill`** — the model only renders five fixed ratios, so filling would squash a 75×160 mm label ~17 % and deform the typography QA just verified. The output is a proposal for a printer (RGB, upscaled from ~1024 px), not resolution-independent production data; UI and FAQ must keep saying so.

### Feedback loops (sacred — don't break them)

- Post metrics → `propagateMetricsToSources()` updates `performance_score` on `ig_post_ideas` / `ig_reviews` / `ig_post_types` → weighted selection on next generation (autopilot type pick ×[0.5,1.6] vs measured avg; `buildSmartWeekPlan` weighted rotation within a pillar). Any new content source needs a `performance_score` + weighted-selection function.
- Critic scores in `ig_generation_log` are injected back into prompts (last 5) — filtered by `post_type` first, client-wide as cold-start fallback.
- Formats are creative briefs: `PostTypeDef.description/structure/visualStyle` reach the copywriter (structure replaces the generic medium skeleton), and BOTH designers via `formatBrief` — config def is the source of truth (`getPostTypeDef`), the `ig_post_types` row is a picker copy.
- `memory-agent.ts` learns patterns into `ig_brand_memory` (pattern/preference/avoid/visual); `updateIGPostMetrics()` auto-triggers propagation + learning (fire & forget).
- **Product ideas** have their own loop (v8.3): `rateProductIdea` writes 👍/👎 → `getWeightedProductIdeas(clientId, limit)` mirrors `getWeightedIdeas` but takes **clientId explicitly** (no new `getActiveProject()` callers). Ratings feed both the idea generator and the line generator. Picking an A/B print winner (`selectDesignWinner`) writes a `visual` memory, so a print decision also reaches the Instagram art director.

### Úprava příspěvku ≠ přegenerování (v8.6)

`editPost` (`app/actions/post-edit-actions.ts`) je **retuš hotového vizuálu**, ne nový návrh: stáhne publikovaný obrázek (`fetchImageBuffer`), pošle **ten buffer** do `editExistingImage` s uživatelovou instrukcí + ochrannou klauzulí a zapíše výsledek **na tentýž řádek**. Přesně vzor, který už roky funguje u tisku (`editPrintDesign`). Předtím `revisePost` odpovídal na „posuň nadpis" voláním `renderImage()` → `generateDesignBrief()` vymyslel nový koncept, archetyp, fotku i layout; hotový obrázek nikdy neviděl žádný model, takže každá drobná poznámka vrátila jiný příspěvek.

Čtyři pravidla, která to drží (aserce §15 v `test-beta-e2e.ts`):

- **`post-edit-actions.ts` nesmí importovat `renderImage` ani `generateDesignBrief`.** To je cesta k novému návrhu; „malá oprava", která se k nim dostane, je ta chyba, ne fallback.
- **Po uživatelské úpravě se nikdy neregeneruje od nuly.** Nejvýš **jeden** korektivní edit, a jen při `qa.severity === "severe"` (rozbitá/nečitelná typografie). Po textové úpravě je očekávaný text z `design_brief` schválně neaktuální, takže kosmetický nesoulad se ignoruje — soudce je uživatel. Čerstvá regenerace by zahodila návrh, který si uživatel nechává.
- **Poměr stran ze skutečných pixelů** (`sharp().metadata()` → `nearestAspectRatio`), nikdy z formátu post typu. Jiný `aspectRatio` než má vstup = model překomponuje celý snímek (tak `revisePost` cpe 9:16 story do 4:5). A `mimeType: "image/webp"` — uložené obrázky jsou WebP, `editExistingImage` má default `image/jpeg`.
- **In-place + historie, žádný insert fallback.** Předchozí stav se odloží do `ig_posts.edit_history` (max 10) pro `revertPostEdit`; `revision_of`/`link_type` patří revizím a variantám a nesahá se na ně. Publikovaný příspěvek (`posted`/`posting`) se needituje — rozešel by se s `ig_media_id`.

Rozsah omezují tři páky z UI: přepínač text/obrázek/obojí, označená oblast (normalizované 0..1, `buildPostEditPrompt` z ní udělá procenta **i** slovní kvadrant) a pole „nesahej na". Textová úprava jede přes `reviseCaption({ keepHook: true })` — vynutí hook vypálený v obrázku **kódem** a smaže `imagePrompt` z výstupu; jeho povinnost ve schématu byla důvod, proč i „zkrať text" spustilo re-roll. Úprava obrázku stojí 1 kredit (`post_edit`, plochý — jedno volání modelu), textová je zdarma. `revisePost` zůstává jako **vědomé** „vygenerovat úplně znovu" a konečně má vlastní credit guard (do v8.6 to byla jediná neúčtovaná plná generace v produktu).

`editExistingImage` bere **jen jeden vstupní obrázek** — logo ani produktovou referenci nelze přiložit, takže špatný produkt úprava neopraví; to patří přegenerování (stejný důvod, proč `image-orchestrator.ts` u `productAccurate === false` regeneruje místo editu).

### Platební brány — jedno jádro, adaptéry na okrajích (v8.5)

`lib/payments/on-paid.ts` je **jediné místo**, kde žije „co se stane, když platba dojde": aktivace plánu, token pro obnovy, daňový doklad, potvrzovací e-mail. ComGate callback i (chystaný) Stripe webhook ho volají — druhá brána proto **není druhá kódová cesta**, a tedy ani druhé místo, kde se zapomene na doklad. Hlídá to aserce §14.9 v `test-beta-e2e.ts`.

Rozdělení respektuje to, co se mezi branami skutečně liší: **v routě zůstává parsování, serverové ověření stavu a zabrání stavu** (`payments` má pro každou bránu jiný lokátor), **v jádru je všechno po claimu**. Jádro nesmí importovat klienta konkrétní brány. `finalizePaidPayment` běží synchronně (aktivaci plánu nelze odkládat), `deliverPaidArtifacts` v `after()` (brána musí dostat ACK hned) a **nikdy nevyhazuje výjimku**. Když aktivace selže, vrací `activated:false` a route musí skončit — řádek zůstává PAID pro ruční opravu.

**Mock transId se nikdy nesmí uložit jako `recurring_trans_id`** — příští měsíc by se na něj poslala skutečná platba. Guard je v ComGate routě, jádro token ukládá jen u první platby, nikdy u obnovy.

### Fakturace a právní identita (v8.5)

Identita podnikatele má **jediný zdroj — `lib/legal.ts`** (jméno, IČO, adresa, režim DPH, `SUBPROCESSORS`); obchodní podmínky, zásady zpracování, patička i faktury ji jen vykreslují, IČO se nikdy nepíše do JSX. Nevyplněné údaje nesou hodnotu `"DOPLNIT"` a `npx tsx scripts/check-legal-identity.ts` kvůli nim končí **exit 1** — prodej s prázdným IČO je porušení informační povinnosti, ne kosmetická vada.

Po zaplacení vystaví `lib/invoicing.ts` doklad přes Fakturoid (`lib/fakturoid.ts`). **`UNIQUE INDEX ON invoices(payment_id)` je nárok na vystavení** — INSERT předchází volání API, konflikt znamená konec (`status:"duplicate"`), a **nikdy se nepřidává insert fallback**: číselná řada je nevratná, duplicitu jde jen stornovat. Celá cesta běží v `after()` a chyby polyká, ale **vždy je persistuje** jako `status='failed'` — tichý `catch` = zákazník bez dokladu a nikdo o tom neví. Částky jsou v **haléřích** (`payments.amount`, `invoices.total_czk`); do Fakturoidu smí jen přes `haleruToCzk()`.

Podmínky musí odpovídat kódu: trial je **obsahově omezený, ne 7denní**, kredity propadají, předplatné se automaticky obnovuje. Hlídá to §14 v `test-beta-e2e.ts`. Reálný postup (živnost, identifikovaná osoba k DPH, ComGate, Fakturoid, GDPR) je v `docs/LEGAL_SETUP.md`.

## Hard rules

- **Identifier convention:** the tenant *slug* lives at the UI boundary (`projectId` in `StudioContext` is actually the slug); resolve it to the client UUID exactly once via `requireProjectAccess(slug)` (or `requireClientAccess(uuid)` when you already have a row's `client_id`) and pass the UUID everywhere inside. Never default a missing identifier to a real tenant — throw.
- **`setActiveProject()` is module-global mutable tenant state** in `instagram/service.ts` — with concurrent requests per lambda it can cross-contaminate tenants. New engine code must take `clientId` as an explicit parameter (see `propagateMetricsToSources`, `analyzeAndLearn`); don't add new `getActiveProject()` callers.
- **`ig_posts.link_type`** distinguishes `'revision'` (user-feedback rewrite via `revisePost`) from `'variant'` (A/B variant) — both link via `revision_of`. Always set it when linking posts; A/B comparison and variant learning filter on `link_type='variant'`.

- **Products for AI grounding:** always read the live catalog via `getCatalogProducts(clientId, config.products)` from `instagram/service.ts` — `config.products` is a frozen onboarding snapshot (`@deprecated`). Grounding prompts on the snapshot produced captions naming deleted products while the engine rendered a different live one.
- **Auth:** every new API route needs `requireAuth()` from `lib/auth-guard.ts` (only payment webhooks are exempt). Middleware protects `/dashboard/*` + `/onboarding`.
- **Retry logic:** import from `utils/retry.ts`, never copy it.
- **No hardcoding** of DB IDs, buckets, or admin emails — use `ClientConfig` or env vars (`SUPER_ADMIN_EMAILS`).
- **AI models:** all model IDs live in `instagram/models.ts` — always use `getModel()`, never hardcode a model string (env override: `GEMINI_MODEL_<ACTION>[_FALLBACK]`). Deprecated, never use: `gemini-2.0-flash`, `gemini-3-pro-preview` (404'd "no longer available" 2026-06-18), `imagen-4.0-ultra`, `gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview` (preview image IDs shut down June 25, 2026). The deep-quality Pro tier (`textPro`/`designer`/`visionQA`) uses the **`gemini-pro-latest` alias** — never pin a Pro preview ID, the alias auto-rotates to the current GA Pro so a shutdown can't 404 us (it currently resolves to `gemini-3.1-pro-preview`; don't hardcode that ID directly).
- **Visual engine (native-only):** AI Designer (`generateDesignBrief` in `image-pipeline.ts`) produces a design brief → Nano Banana Pro renders the complete post **including Czech typography + logo** (logo passed as labeled reference image) → `verifyNativeImage` vision QA → corrective edit → one fresh regen. **There is no Satori/overlay engine** — the legacy `visualEngine` config, `text-overlay.ts`, `renderImageOverlay`/`renderCarouselOverlay`, and `reviewOverlayComposition` were removed (satori + @resvg deps gone). **Ship-best-native:** if no attempt passes QA cleanly, the orchestrator publishes the **best-scoring** native buffer (`qaScore` in `image-pipeline.ts`, `qa_status: "native_forced"`) — never a text-stamped fallback, never an empty post. A true infra failure (generation threw) returns no image. `qa_status` (pass/retry_pass/native_forced) still logs to `ig_generation_log`. **`overlayStyle: "none"` is ONLY valid for reels** — `renderImage` coerces `"none"` → `"default"` on entry so a reel-format type clamped to an image (reels off) can't ship a bare text-free photo. `overlayStyle` is otherwise advisory now (the AI Designer decides layout); it's still editable per-format in SettingsTab.
- **Fonts/assets on Vercel** must be listed in `outputFileTracingIncludes` in `next.config.ts`.

## UI conventions

Dark theme only, brutalist/tech aesthetic: `bg-[#050505]`, `border-white/5`. Labels are always `uppercase tracking-widest font-bold` at `text-[8px]`–`text-[11px]`; body text `text-xs`–`text-sm`. Tailwind 4 via PostCSS plugin (no `@tailwind` directives).
