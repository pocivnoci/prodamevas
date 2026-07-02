# Chrlit Studio — Business Plan (Bootstrap · CEE)

> Written 2026-07-01. Model: **bootstrap to profit** (no outside funding), **Central Europe first** (CZ → SK → PL). Grounded in real unit economics (`docs/UNIT_ECONOMICS_AND_PRICING.md`) and the product/AI roadmap (`docs/AGENT_SYSTEM_AND_LOOP_ENGINEERING.md`). Numbers at **23 Kč/$**; market sizes are **reasoned estimates to validate**, not measured.

---

## 1. Executive summary

**What:** Chrlit is an autonomous AI Instagram content engine. A business enters its website; Chrlit learns the brand and produces complete posts — captions, images, carousels, reels — in native Czech/CEE language, and (post Meta App Review) publishes them automatically.

**Who for:** CEE small businesses that need a consistent Instagram presence but can't justify a 15–20 000 Kč/mo designer + copywriter — e-shops, gastro, services, fitness, creators.

**Wedge:** *Done-for-you, not do-it-yourself.* Global tools (Buffer, Predis.ai, Ocoya) schedule or draft; Chrlit **runs the account** and does it in language that doesn't read as machine-translated — the weak spot of every global competitor in CEE.

**Model:** Subscription (490 / 990 / 1990 Kč/mo) with cost-weighted usage. ~55–60% gross margin after the pricing fix in §5.

**The bootstrap goal:** profitability is a *customer-count* problem, not a funding problem —

| Milestone | Customers | Monthly outcome |
|---|---|---|
| Cover all fixed costs | **~10** | break-even on infra/tools |
| Founder ramen income (~$2k/mo) | **~100** | quit-the-day-job viable |
| Comfortable solo income (~$5k/mo) | **~240** | a real living |
| Strong small business (~$12k/mo) | **~550** | hire #1 from profit |

In a CEE market of **hundreds of thousands** of Instagram-relevant SMBs, these are small numbers. The constraint is acquisition + retention, **not** market size.

---

## 2. Problem & solution

**Problem.** SMBs know Instagram matters but (a) posting consistently is a grind, (b) good creative needs a designer + copywriter (15–20k Kč/mo, or an agency at more), and (c) most CEE SMB Instagram accounts are dormant ("mrtvý profil"). Freelancers help but are expensive and don't scale.

**Solution.** Chrlit replaces that whole function with an autonomous engine at **~1/20th the cost**: brand learning from the website + IG, a multi-agent pipeline (researcher → copywriter → critic → editorial board → art director → renderer), native-language typography and voice, a learning loop that improves each brand's output from real engagement, and one-tap or fully-automatic publishing.

---

## 3. Product & moat

**Delivered value:** complete posts (image / carousel / reel) with captions, hashtags, on-image Czech typography and logo, plus content planning, A/B variants, and follower-growth tracking.

**Defensibility (honest):** no single hard moat — the durable advantages compound:
1. **CEE-native quality.** Czech/Slovak/Polish copy + typography that reads as written by a native, not translated. Global tools are structurally weak here.
2. **Autonomy + learning loop.** Per-brand memory + metrics feedback means output gets *more* on-brand over time — a retention hook competitors' stateless generators lack (see the loop-engineering doc).
3. **Full-service, zero-skill.** The customer does nothing; competitors sell a tool the customer must operate.
4. **Price.** Structurally cheaper than any human alternative.

**Where the moat is thin:** it's a crowded global category and it rides on Meta + Google AI. Mitigations in §8.

---

## 4. Market (CEE)

Top-down estimate of **Instagram-relevant SMBs** (B2C retail/e-shop/gastro/services/creators) — *validate before betting on them*:

| Market | Est. IG-relevant SMBs | Notes |
|---|---|---|
| Czech Republic | ~50–80k | Built + native. Shoptet e-shop ecosystem is a concentrated beachhead. |
| Slovakia | ~25–40k | Nearly free expansion — language + culture almost identical to CZ. |
| Poland | ~200–300k | 4–5× CZ. Needs Polish localization + local payments (BLIK/Przelewy24). |
| **CEE SAM** | **~300–400k** | |

**SOM (bootstrap, ~3-yr realistic):** 0.1–0.5% → **~500–2 000 customers** → **~$20–80k MRR** at ~$40 blended ARPU. Far beyond what a solo/small bootstrap needs — reinforcing that the game is execution on acquisition + churn, not TAM.

---

## 5. Business model & pricing (revised)

**The fix (mandatory):** today every post costs 1 credit regardless of media, which sells **reels at ~40% of cost** and makes reel-heavy Růst/Dominance customers net-negative (full analysis in the unit-econ doc). Weight credits by cost and **make reels the tier line** (reels are both the biggest cost *and* the top upgrade reason):

| Tier | Price/mo | Credits | Media | Reels | Extras |
|---|---|---|---|---|---|
| **Start** | 490 Kč | 20 | image + carousel | ❌ | content ideas |
| **Růst** ★ | 990 Kč | 45 | + reels | ~up to 8/mo | A/B variants, growth dashboard |
| **Dominance** | 1990 Kč | 110 | + premium reels | more, premium Veo | product studio, priority |

Credit weights: **image = 1 · carousel = 3 · reel = 5** (products stay value-priced). Because expensive media drains credits faster, **the worst case caps itself** — no separate reel limit needed. Extra credits: 15–20 Kč.

**Add annual plans** (pay 10, get 12): cash upfront + lower churn — outsized value for a bootstrap.

**Unit economics at revised pricing** (~$3/customer opex at moderate scale):

| Tier | Revenue | AI COGS | Net/mo | Margin |
|---|---|---|---|---|
| Start | $21.3 | ~$7 | ~$11 | 52% |
| Růst | $43.0 | ~$16 | ~$24 | 56% |
| Dominance | $86.5 | ~$32 | ~$50 | 58% |

**No plan can go net-negative** — the core repair. Blended: ARPU ~**$40**, gross profit ~**$22/customer/mo**.

---

## 6. Go-to-market (bootstrap, cheap channels first)

Sequenced **CZ → SK → PL**, ordered by cost-efficiency:

1. **Dogfood as proof.** Chrlit already runs its own IG — turn it into the flagship case study (before/after dead profiles, growth screenshots from `ig_growth_snapshots`). The product is its own best ad.
2. **Shoptet integration (CZ killer channel).** Shoptet is the dominant Czech e-shop platform — an app-marketplace listing puts Chrlit in front of thousands of exactly-right B2C e-shops. Highest-ROI single bet for CZ.
3. **Freelancer / micro-agency reseller channel.** Social-media freelancers serve many SMBs manually; let them run those clients on Chrlit (referral or white-label). Turns competitors into distribution.
4. **Cold outbound to dormant profiles.** The engine already detects weak/inactive IG accounts — scrape, generate a free sample post, pitch. Highly targeted, near-zero CAC.
5. **Vertical content + communities.** Local-language SEO/content per niche (e-shops, gastro, fitness); Czech/Slovak entrepreneur + Heureka/e-shop groups.
6. **SK expansion (near-free):** same content model, minor localization — bolt on once CZ playbook works.
7. **PL expansion (real work):** Polish language model tuning + typography QA + BLIK/Przelewy24 payments.

**CAC / payback (assumption, validate):** cheap channels → CAC ~$30–100 → payback = CAC ÷ $22 ≈ **1.5–4.5 months**. At 5%/mo churn, LTV ≈ $440 → **LTV/CAC ≈ 4–15×**. Healthy for bootstrap.

---

## 7. Financial plan (bootstrap path to profit)

**Cost structure:**
- *Variable:* AI COGS (~45% of revenue after the fix); payment fees ~2%.
- *Fixed (small scale):* Vercel ~$20 + Supabase ~$25 + HikerAPI ~$20–50 + email/domain/misc ~$20 ≈ **~$100/mo**, scaling gently with volume.
- *Founder:* unpaid until viable, then paid from profit (true bootstrap).

**Break-even math** (gross profit ~$22/customer/mo): fixed ~$100 ÷ $22 ≈ **~5 customers** to cover infra; ~10 with fees/buffer. Then each customer is ~$22/mo toward founder income (see §1 ladder).

**Illustrative bootstrap trajectory** (assumptions — not a forecast):

| Phase | Months | Customers | MRR | State |
|---|---|---|---|---|
| Repair + first sales | 0–3 | 10–20 | ~$500–800 | Costs covered; validate churn/CAC |
| Playbook + SK + Shoptet | 3–6 | 50–100 | ~$2–4k | Approaching founder ramen |
| Scale CZ/SK, launch PL | 6–12 | 150–300 | ~$6–12k | Solo-income profitable |
| Systematize | Y2 | 500–1000+ | ~$20–40k | Hire #1 from profit |

**Sensitivity (watch these):** post mix (reel-heavy shifts COGS), churn (SMB SaaS 3–7%/mo — the #1 bootstrap killer), FX (costs USD / revenue CZK+PLN), and Google AI pricing.

---

## 8. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Meta App Review** gates tenant auto-publish + insights | High | Ship App Review (it's on the go-live roadmap); until then, one-tap manual handoff already works. |
| **AI provider price hikes** (Gemini/Veo) | High | COGS-weighted pricing absorbs moderate rises; multi-provider path already planned (Claude judge); reel Veo-tier is a cost dial. |
| **Churn** (SMBs cancel) | High | Annual plans; prove ROI via growth dashboard; learning loop improves output over time (stickiness). |
| **Crowded category** | Medium | Defend on CEE-native quality + full autonomy + price, not features. |
| **Reel cost center** | Medium | Reels gated by tier + credit weight + Veo-tier per plan. |
| **Solo / key-person** | Medium | Keep ops lean/automated; first hire = support once profitable. |
| **FX exposure** | Low-Med | Price in local currency; revisit tiers if Kč/$ moves >10%. |

---

## 9. Roadmap (tied to the plan)

- **Now (0–3 mo):** ship media-weighted pricing + re-budgeted plans; ship Meta App Review (unlocks the auto-publish/insights that make the product "done-for-you"); land first 10–20 CZ customers; instrument churn/CAC. Continue the AI quality program (Phases 1–2 shipped → 3–4) — *quality is retention*.
- **3–6 mo:** Shoptet integration; annual plans; SK launch; reseller/freelancer program.
- **6–12 mo:** PL localization (language + typography QA + local payments); vertical content engine; per-customer COGS guard for upsell.
- **Y2:** systematize support/onboarding; evaluate first hire from profit.

---

## 10. The one-paragraph pitch

*Chrlit gives a CEE small business a full Instagram team — copywriter, designer, videographer, strategist — for the price of a couple of coffees a week. It learns your brand, writes in real Czech (not translated slop), makes the images and reels, and gets better at your voice every week from what actually performs. Bootstrapped, profitable from ~10 customers, and aimed at the hundreds of thousands of CEE businesses whose Instagram is currently a dead shop window.*

---

*Companion docs: `UNIT_ECONOMICS_AND_PRICING.md` (cost detail + the credit fix), `AI_PROVIDER_STRATEGY.md` (model strategy), `AGENT_SYSTEM_AND_LOOP_ENGINEERING.md` (product/tech moat).*
