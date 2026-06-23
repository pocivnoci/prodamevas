# Design: tighter onboarding → content-plan workflow

**Date:** 2026-06-23
**Author:** audit follow-up (formats → plan binding → workflow)
**Status:** proposal — pick which to build

## Problem recap

Onboarding learns what already works on the client's real Instagram (`igInsights`)
and seeds `ig_brand_memory`, but the content plan **ignores all of it**:
`content-plan-actions.ts` reads no brand memory and no IG insights, and
`buildSmartWeekPlan` adapts only from *our* posts' performance — which is empty at
cold start, so it falls back to cycling the static `config.weekPlan`. Result: the
first weeks of plans are generic and blind to the client's proven winners.

Three independent improvements below, each shippable alone.

---

## #1 — Wire `igInsights` + brand memory into cold-start planning ✅ DONE (2026-06-23)

**Implemented:**
- (a) No change needed — insights already persist to `config.igBaseline`
  (`contentMix`, `topHashtags`, `bestPostingTimes`) and proven patterns to
  `ig_brand_memory` (confidence 0.45, so `getBrandMemories` returns them).
- (b) `buildSmartWeekPlan` cold-start now **rotates the start offset** (breaks the
  repetitive fixed rhythm) + guards empty `weekPlan`. **Deviation from plan:** did NOT
  hard-weight by `contentMix` — its keys are free-form content themes (`produkt`,
  `edukace`), not pillar IDs/media, so a hard map would be brittle. The pillar ratios in
  `config.contentPillars` already encode the client's mix (onboarding LLM saw igInsights).
  `contentMix` is instead surfaced to the planner as a textual hint (see c).
- (c) `generateContentPlan` now injects a **brand-grounding section** (brand memory via
  `formatMemoriesForPrompt` + `igBaseline` content mix & hashtags) into the planner prompt,
  guarded by try/catch. Fills the cold-start void where `topHooks` is empty.

---

### Original plan (kept for reference)

**Why:** biggest quality jump, no UX change. The plan starts brand-true on day one
instead of generic for the first ~weeks.

**What `igInsights` already carries** (`app/onboarding/actions.ts:17`, persisted via
`generateConfigPreview` scrape snapshot + `seedMemoriesFromAnalysis`):
`provenPatterns`, `contentMix`, `topHashtags`, `bestPostingTimes`, `voiceProfile`,
`brandToneHint`, `avgEngagementRate`.

### Changes

**a) Persist insights where the planner can read them.**
Today the scrape snapshot is saved at onboarding (`actions.ts:917` "scrapedAt").
Confirm it lands in `clients.config` (e.g. `config.scrapedInsights`) so
`loadConfig()` exposes it. If it's only in brand memory, read memory instead — see (c).

**b) `instagram/caption-generator.ts` → `buildSmartWeekPlan()` (line 332).**
The cold-start branch (`performance.avgEngagement === 0`) currently does:
```ts
for (let i = 0; i < count; i++) staticPlan.push(config.weekPlan[i % config.weekPlan.length])
```
Replace with insight-weighted selection:
- If `config.scrapedInsights.contentMix` exists, weight pillar/medium selection by the
  client's *actual* proven mix (e.g. 60% carousel, 25% reel → carousel-heavy plan).
- Rotate the starting offset / lightly shuffle so the type rhythm isn't identical every
  run (also fixes #3 below).
- Fallback to current `weekPlan` cycling when no insights.

**c) `app/actions/content-plan-actions.ts` → `generateContentPlan()` (line 31).**
The flash planner prompt pulls "top hooks" from `ig_posts` (empty at cold start,
lines 93–114). Add a cold-start branch:
- When `topHooks.length === 0`, fetch `ig_brand_memory` (type `pattern`/`preference`)
  via `getBrandMemories(clientId)` and inject the client's *proven* patterns +
  `igInsights.provenPatterns` into the prompt as "what already works for THIS brand".
- Pass `igInsights.brandToneHint` / `voiceProfile` into the prompt header.

**Files:** `instagram/caption-generator.ts`, `app/actions/content-plan-actions.ts`,
maybe `app/onboarding/actions.ts` (ensure snapshot persisted to config).
**Risk:** low — additive, guarded by "insights exist" checks. No schema change if
insights already live in `clients.config`.

---

## #2 — Pro tier + critic pass on the onboarding config

**Why:** brand voice / personas / pillars are the foundation every post inherits.
They're generated on the **flash** tier today (`models.ts:26` — onboarding = fast tier)
for latency, but onboarding is a one-time event where the user expects to wait. This is
the right place to spend quality.

### Changes

**a) `app/onboarding/core.ts` → `generateConfigCore()` (line 350) and the twin
`generateConfigPreview()` (`actions.ts:732`).**
Swap the brand-DNA generation calls from `getModel("text")` (flash) to
`getModel("textPro")` (`gemini-pro-latest`, runs via the quality ladder).
Keep the cheap/structural calls (questions, format normalization) on flash.

**b) Add a critic pass.** After the config draft, one Pro call reviews brand voice +
pillars for cohesion/specificity and rewrites weak sections (mirrors the editorial-board
idea, but one-shot). Gate behind the existing review step so the user still approves.

**Note:** logic is duplicated in `actions.ts` (UI) and `core.ts` (scripts) — see memory
`onboarding-config-twin-duplication`. **Both must change.**
**Files:** `app/onboarding/core.ts`, `app/onboarding/actions.ts`, possibly `instagram/models.ts`.
**Risk:** medium — slower onboarding (acceptable), higher per-onboarding token cost.
Mitigate: only the foundation sections go Pro, not every field.

---

## #3 — Generate the first plan as the last onboarding step ✅ DONE (2026-06-23)

**Implemented:**
- `app/onboarding/page.tsx` — after the showcase posts, a new "Phase 3" calls
  `generateContentPlan(clientSlug, 7)` (insight-grounded via #1) and stashes the result in
  `localStorage['ig_draft_plan_<slug>']`. The "generating" screen is phase-aware (shows a
  first-plan message). Non-fatal on failure.
- `GenerateTab.tsx` — a mount effect consumes `ig_draft_plan_<projectId>` once: loads it
  into `contentPlan`, flips `batchMode`, jumps to step 2 (plan review). Declared after the
  reset/reconnect effects so its `setStep(2)` wins; skipped if a campaign is already
  in-flight. Self-clears after consuming.

**Note (not blocking):** the onboarding "done" CTA could deep-link straight to the Generate
tab for the full magic moment; today the plan simply waits there until the user opens it.
This is the **discoverability teaser** mechanism's sibling — the 27 `plan_locked` posts
(`generateMonthlyPlan`) are a separate blurred paywall, unrelated to this editable plan.

---

### Original plan (kept for reference)

**Why:** onboarding ends at a blank dashboard (`page.tsx` step machine ends at `done`).
Hand the user a ready, brand-true week instead of a cold start.

### Changes

**a) `app/onboarding/page.tsx` step machine (line 10).**
Between `generating` (showcase posts) and `done`, add a `firstPlan` step that calls
`generateContentPlan(slug, 7)` (now insight-aware from #1) and stores it so the
dashboard's Generate tab opens with the plan pre-loaded.

**b) Handoff.** Persist the draft plan (e.g. localStorage key the Generate tab already
reads for in-flight campaigns, or a `clients.config.draftPlan`) so PlanTab/GenerateTab
shows it on first load. The medium badge (already shipped) makes it immediately legible.

**Depends on #1** to be worth doing (otherwise the handoff plan is generic).
**Files:** `app/onboarding/page.tsx`, `app/(dashboard)/dashboard/instagram/tabs/GenerateTab.tsx`.
**Risk:** low–medium — mostly UX wiring; reuses existing plan action.

---

## Suggested order

1. **#1** — unlocks brand-true plans immediately, prerequisite for #3.
2. **#3** — turns the win from #1 into a visible "here's your week" moment.
3. **#2** — deeper foundation-quality bump; independent, do when ready to eat the latency/cost.

## Cross-cutting note

Per `AI_RULES.md`, whichever ships must update `AI_AGENT_KNOWLEDGE_BASE.md`
(plan pipeline) and `SYSTEM_KNOWLEDGE_BASE.md` (onboarding flow) — both are stale on
the post-v4.0 onboarding rewrite + campaign system already.
