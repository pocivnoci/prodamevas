# Unit Economics & Pricing — Actual Costs → Profitable Model

> Written 2026-07-01. Grounds pricing in the engine's real `COSTS` (`instagram/caption-generator.ts`), the credit map (`lib/subscription.ts`), and the live plans (`supabase/migrations/20260612_growth_tiers.sql`). Companion to `docs/AI_PROVIDER_STRATEGY.md`.

## Assumptions (adjust these — they move every margin)

| Assumption | Value | Note |
|---|---|---|
| FX rate | **23 Kč / $1** | Verify current rate; margins scale with it. |
| Gemini COGS | from the engine `COSTS` object | Operator's own estimates — **verify against real Google billing**; image + Veo dominate. |
| Claude judge (Phase 3) | Sonnet 4.6 @ $3/$15 per M tok | Not yet shipped; projected below. |
| Reel tier | `fast` (default) | `lite`/`premium` swing reel cost 2–3× (see §6). |
| Post mix | stated per scenario | The single biggest driver of margin. |

Plan prices: **Start 490 Kč ≈ $21.3 · Růst 990 Kč ≈ $43.0 · Dominance 1990 Kč ≈ $86.5.**

---

## 1. AI unit costs (per operation — from the engine)

| Operation | Cost | Model |
|---|---|---|
| Flash text (idea/review/context/memory) | $0.025 | gemini-3.5-flash |
| Pro text (copywriter / critic / editor, each) | ~$0.025 | gemini-pro-latest |
| Designer brief | $0.03 | Pro |
| **Image (Nano Banana Pro, 2K)** | **$0.134** | gemini-3-pro-image |
| Image QA / corrective edit | $0.01 / $0.134 | vision / image |
| **Reel video (Veo 3.1, 8s)** | **lite $0.48 · fast $1.20 · premium $3.20** | veo-3.1-* |
| TTS voiceover | $0.02 | gemini-tts |
| **Claude judge call** (projected) | **~$0.010** | Sonnet 4.6, ~2k in / 400 out, cache-read prefix |

## 2. Cost per finished post (the number that matters)

Includes the full multi-agent pipeline (copywriter + critic + ≤3 editorial rounds + designer + render + QA + occasional corrective edit).

| Post type | Gemini now (realistic) | + Claude judge (Phase 3) | Engine floor (`COSTS`) |
|---|---|---|---|
| **Image** | ~$0.35 | ~$0.39 | $0.27 |
| **Carousel** (4–5 slides) | ~$0.85 | ~$0.89 | $0.75 |
| **Reel** (fast tier) | ~$1.50 | ~$1.54 | $1.45 |
| Product mockup | ~$0.13 | — | $0.134 |
| Product brief (analysis) | ~$0.03 | — | $0.025 |

**Reels cost ~4× an image and ~1.7× a carousel.** That asymmetry is the whole story.

---

## 3. 🔴 The profitability bug: 1 credit ≠ 1 unit of cost

Today every post costs **1 credit** regardless of media (`ACTION_CREDITS.post = 1`), and an extra credit sells for **15 Kč ≈ $0.65**. So what a credit *costs us* vs *sells for*:

| What 1–5 credits buy | Credits | We pay | Customer pays | Margin |
|---|---|---|---|---|
| Image post | 1 | $0.39 | $0.65 | **+$0.26** ✅ |
| Carousel post | 1 | $0.89 | $0.65 | **−$0.24** 🔴 sold below cost |
| **Reel post** | 1 | $1.54 | $0.65 | **−$0.89** 🔴🔴 sold at ~40% of cost |
| Product mockup | 2 | $0.13 | $1.30 | +$1.17 ✅ |
| Product brief | 5 | $0.03 | $3.25 | +$3.22 ✅ |

Two problems: **(a)** carousels and especially **reels are sold below cost** as extra credits; **(b)** inside a subscription a reel burns the *same 1 credit* as a cheap image, so a reel-heavy customer is far more expensive than the plan assumes. Products are the opposite — cheap to make, priced high (good; leave them).

### What that does to the plans (worst-case, current model)

| Plan | Price | Credits | Cheapest use (all image) COGS | **Worst use (all reels) COGS** | Worst-case margin |
|---|---|---|---|---|---|
| Start | $21.3 | 15 | ~$5.9 | *(no reels)* ~$12.8 all-carousel | +40% |
| **Růst** | $43.0 | 40 | ~$15.6 | **40 × $1.54 = $61.6** | **−43%** 🔴 |
| **Dominance** | $86.5 | 100 | ~$39 | **100 × $1.54 = $154** | **−78%** 🔴 |

A power user on Růst/Dominance who generates mostly reels **costs more in AI than they pay.** That's the leak.

---

## 4. ✅ The fix: weight credits by cost (COGS-aligned credits)

Make 1 credit ≈ a fixed unit of cost (~$0.30), so price tracks what's expensive to produce:

| Media | Credit cost (new) | COGS | 1-credit value |
|---|---|---|---|
| Image | **1** | $0.39 | $0.39 |
| Carousel | **3** | $0.89 | $0.30 |
| Reel | **5** | $1.54 | $0.31 |
| Product mockup | 1–2 (keep) | $0.13 | value-priced |
| Product brief | 5 (keep) | $0.03 | value-priced |

**Why this is the elegant fix:** expensive media now *drains the credit budget faster*, so the worst case is capped automatically — no separate "max reels" rule needed. A Růst customer with 45 credits can make at most **9 reels** (45÷5), COGS ≈ $13.9 on $43 revenue — still 68% margin. The blast radius is bounded by construction.

### Re-budget the plans so the marketing promise still holds

| Plan | Price | New credits | Example month | COGS | Margin (pre-opex) |
|---|---|---|---|---|---|
| Start (image + carousel) | 490 Kč | **20** | 20 images, or ~6 carousels | $5.9–7.8 | ~65–72% |
| Růst (+ reels, A/B) | 990 Kč | **45** | 20 images + 5 reels (25 posts) | ~$15.5 | ~64% |
| Dominance (+ product studio, priority) | 1990 Kč | **110** | 40 img + 10 reels + products | ~$30 | ~65% |

Extra-credit price: keep **15–20 Kč**. With reels now costing 5 credits, an extra reel sells for ~$3.25–4.35 vs $1.54 cost → profitable on *every* media type.

---

## 5. Profit per customer at the recommended model

Non-AI opex per customer ≈ **$3/mo** at moderate scale (see §7).

| Plan | Revenue | AI COGS | Opex | **Net / customer / mo** | Margin |
|---|---|---|---|---|---|
| Start | $21.3 | ~$7 | $3 | **~$11** | ~52% |
| Růst | $43.0 | ~$16 | $3 | **~$24** | ~56% |
| Dominance | $86.5 | ~$32 | $4 | **~$50** | ~58% |

A healthy **~55% gross-margin SaaS** — and critically, **no plan can go net-negative**, because credits are cost-weighted. Under the current flat-credit model, Růst/Dominance reel users are underwater.

---

## 6. Second lever: reel tier by plan

Veo tier is a direct COGS dial (`ClientConfig.videoTier`): **lite $0.48 · fast $1.20 · premium $3.20** for 8s. Recommendation:

- **Start/Růst → `lite` or `fast`** (reel COGS $0.73–1.50).
- **Dominance → `premium`** as a paid differentiator ("cinematic reels").

Dropping default reels from `fast` to `lite` nearly **halves reel COGS** — the fastest single margin win if quality holds. A/B it.

---

## 7. Non-AI costs (don't forget these)

| Cost | Estimate | Note |
|---|---|---|
| Vercel Pro + Fluid Compute | ~$20/mo base + CPU | 800s reel/campaign functions burn active-CPU. |
| Supabase Pro | ~$25/mo + storage/egress | Images ~60 MB/customer/mo — cheap. |
| HikerAPI (IG scrape + metrics sync) | ~$0.30–0.60/customer/mo | **Verify pricing**; per-post/daily sync adds up. |
| Comgate fees | ~1–2% of revenue | ~5–10 Kč on a 490 Kč charge. |

Fixed platform cost (~$45/mo) amortizes: **$4.50/customer at 10 customers → $0.45 at 100.** Low-scale margins are dominated by fixed cost; the model gets much healthier past ~30 paying customers.

---

## 8. Implementation notes (when you build it)

- **Media-weighted credits** → extend `ACTION_CREDITS` / the `post` charge in `lib/subscription.ts` to take the post's `medium` (image/carousel/reel from `PostFormat`) into account. `canPerformAction` / `creditGuard` already receive the action; thread the medium through so the deduction is `creditsForMedia(medium)`.
- **Re-budget plans** → update `credits_per_month` in a new `subscription_plans` migration (mirror `20260612_growth_tiers.sql`); regenerate `/api/plans` copy + landing tiers (`app/page.tsx`).
- **Per-customer COGS guard** → the engine already computes cost per post (`RenderResult.cost`, logged to `ig_jobs`/`ig_generation_log`). Aggregate monthly COGS ÷ plan price per client; flag >50% for upsell. This is the L4 "margin floor" loop from `docs/AGENT_SYSTEM_AND_LOOP_ENGINEERING.md`.
- **Claude judge (Phase 3)** adds ~$0.04/post — absorbed by the weighted-credit margins above; gate it behind the model registry so it's tunable per plan.

## TL;DR

1. **Your real cost is ~$0.35 image / ~$0.85 carousel / ~$1.50 reel** (Gemini; +~$0.04 with the Claude judge).
2. **The current flat 1-credit-per-post model sells reels at ~40% of cost** — reel-heavy Růst/Dominance customers are net-negative.
3. **Fix = weight credits by media (image 1 / carousel 3 / reel 5)** + re-budget plan credits. This auto-caps the worst case and yields ~55–60% margins across all plans.
4. **Also** default reels to a cheaper Veo tier per plan, and add a per-customer COGS guard.
