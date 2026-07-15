# AI Provider Strategy & Consistency Audit

> **Status:** Strategy / audit — written 2026-06-30. Drives the multi-phase consistency program tracked in this repo.
> **Scope:** Every AI API call in the engine, the multi-agent relationships, why posts drift in voice/style, and the per-agent verdict on Gemini vs. Claude vs. OpenAI.

---

## 0. TL;DR

The engine is **100% Google Gemini** today, through one gateway (`instagram/gemini-client.ts`) and one model registry (`instagram/models.ts`). The architecture is already strong — multi-agent pipeline, learning loops, an A/B variant system.

**The inconsistency is mostly structural/tuning, not a model-provider deficiency.** Two facts dominate:

1. **No temperature is set on any text agent** → the Copywriter *and the Critic/Chief-Editor judges* run at Gemini's default (~1.0), the most random setting. An unstable judge can't enforce consistency.
2. **The audience persona is picked at random every post** (`Math.random()`), so the brand's tone, pain-points and CTA intensity whiplash post-to-post — plus 4 random hook templates and 6 random CTAs per post.

**Provider verdict:** keep **all visual/audio + high-volume text on Gemini** (Nano Banana Pro and Veo are best-in-class and the native-typography render depends on them). Add **exactly one** new provider — **Claude** — at the **judge layer** (Critic + Chief Editor) for *adversarial cross-family review*, and as a *measured A/B arm* for the copywriter. Net new dependency: one.

**Honest expectation:** provider-swapping alone = modest. The big jump is the **combination**: explicit temperatures + deterministic identity + few-shot voice anchors + a reliable cross-family judge + measurement.

---

## 1. Full AI call inventory (the audit)

All calls route through `instagram/gemini-client.ts`. Model IDs come from `instagram/models.ts` via `getModel(action[, "fallback"])`, env-overridable with `GEMINI_MODEL_<ACTION>[_FALLBACK]`.

### 1.1 Gateway functions (`gemini-client.ts`)

| Function | Tier | Primary → fallback | Notes |
|---|---|---|---|
| `generateText` | fast | `gemini-3.5-flash` → `gemini-2.5-flash` | JSON via native `responseSchema`. Falls back on 503/429/404. |
| `generateTextQuality` | quality ladder | `gemini-pro-latest` → `gemini-2.5-pro` | **Never degrades to flash.** Retries top Pro hard on 503/429; throws `QualityUnavailableError` if exhausted. |
| `generateImage` / `generateImageWithReferences` / `editExistingImage` | image | `gemini-3-pro-image` → `gemini-3.1-flash-image` | Nano Banana Pro; renders Czech typography + logo from up to 4 labeled reference images. |
| `generateVideo` | video | `veo-3.1-{lite,fast,premium}` (no cross-tier fallback) | Async op polling every 10s. |
| `generateVoiceover` | tts | `gemini-3.1-flash-tts-preview` → `gemini-2.5-flash-preview-tts` | Czech, mood + expressive tags. |
| `detectLogoPlacementArea` / `analyzeImagesWithText` | vision | `gemini-3.5-flash` | Multimodal JSON. |

### 1.2 Registry actions (`models.ts`) — 11 total

`text`, `textPro`, `designer`, `vision`, `visionQA`, `image`, `imageCheap`, `videoLite`, `videoFast`, `videoPremium`, `tts`. The Pro tier uses the **`gemini-pro-latest` alias** (auto-rotates to current GA Pro; currently `gemini-3.1-pro-preview`) so a shutdown can't 404 a pinned ID.

### 1.3 Call sites by purpose (~28 distinct)

| Purpose | Function | Action / model | Temp | File |
|---|---|---|---|---|
| Post ideas | `generateText` | `text` (flash) | default | `idea-generator.ts:98` |
| Synthetic reviews | `generateText` | `text` (flash) | default | `review-generator.ts:99` |
| Context pulse | `generateText` | `text` (flash) | default | `context-agent.ts:186` |
| Weekly content plan | `ai.models.generateContent` | `text` (flash) | default | `content-planner.ts:194` |
| **Copywriter (caption)** | `generateTextQuality` | `textPro` (Pro) | 0.75 | `caption-generator.ts` (`buildMegaPrompt` → autopilot) |
| **Critic score (1-10)** | `judgeText` | `judge` = Claude Sonnet 5 (Gemini Pro fallback) | 0.25 / effort low | `caption-generator.ts` (`scorePost`) |
| **Best-of-2 ranking judge** | `judgeText` | `judge` | 0.25 / effort low | `caption-generator.ts` (`rankDrafts`) |
| Caption revision | `generateTextQuality` | `textPro` (Pro) | 0.75 | `caption-generator.ts` (`reviseCaption`) |
| **Chief Editor plan/post review** | `judgeText` | `judge` | 0.25 / effort low | `editorial-board.ts` (`reviewContentPlan`, `reviewPost`) |
| Strategist / copywriter revision | `generateTextQuality` | `textPro` (Pro) | default | `editorial-board.ts:294,650` |
| Overlay composition check | `ai.models.generateContent` | `vision` (flash) | default | `editorial-board.ts:736` |
| Memory: text/visual/variant/revision learning | `ai.models.generateContent` | `text` (flash) | default | `memory-agent.ts` |
| AI Designer brief | `generateTextQuality` | `designer` (Pro) | high | `image-pipeline.ts` |
| Image prompt / video prompt refine | `generateTextQuality` | `designer` (Pro) | default | `image-pipeline.ts` |
| Image render + corrective edit | `generateImageWithReferences` / `editExistingImage` | `image` | n/a | `orchestrators/*` |
| Vision QA (`verifyNativeImage`) | quality vision | `visionQA` (Pro) | n/a | `image-pipeline.ts` |
| Video render | `generateVideo` | `video*` | n/a | `reel-orchestrator.ts` |
| Voiceover | `generateVoiceover` | `tts` | n/a | `reel-orchestrator.ts` |
| Brand image tagging | `ai.models.generateContent` | `vision` (flash) | 0.2 | `brand-tagger.ts` |
| Feed visual profile | `analyzeImagesWithText` | `vision` (flash) | default | `feed-vision.ts` |
| Product ideas / design concepts / mockups | `generateText` / image | `text` / `image` | default | `product-generator.ts` |

**Cost reference (`caption-generator.ts` COSTS):** flash text $0.025 · designer brief $0.03 · Nano Banana Pro image $0.134 · image QA $0.01 · Veo $0.06–0.40/s · TTS $0.02. Per-post ≈ $0.27 image / $0.75 carousel / $1.45 reel.

> **Audit note:** `temperature` is only sent when a caller explicitly passes it (`gemini-client.ts:68,92`). Almost no text caller does → Gemini default applies. `brand-tagger.ts` (0.2) is the lone exception.

---

## 2. Agent relationship map

`autopilot.ts:generateOnePost()` runs this chain (each stage's output feeds the next):

```
Researcher ─ weighted-random post TYPE (memory-boosted)         autopilot.ts (generateOnePost, step 1)
           └ weighted-random IDEA/REVIEW (perf-decay + explore) service.ts (getWeightedIdeas/Reviews)
Context Agent ─ calendar signals + 1 Gemini-Flash "pulse"       context-agent.ts (6h cache)
CTA Policy ─ resolveCtaPolicyForPost (deterministic, 1×/post)   cta-policy.ts + caption-generator.ts
Copywriter ─ buildMegaPrompt (Pro) → caption JSON + "angle"     caption-generator.ts (buildMegaPrompt)
Critic ─ scorePost 1-10 + keep[]/fix[] (Claude judge)           caption-generator.ts (scorePost)
   └ best-of-2: rankDrafts picks A/B winner (Claude judge)      caption-generator.ts (rankDrafts)
Editorial Board ─ Chief Editor = SALES GATE ⇄ Copywriter, ≤3    editorial-board.ts (reviewPost)
Art Director ─ generateDesignBrief (Pro, high temp)            image-pipeline.ts
Renderer ─ Nano Banana Pro + refs → Vision QA → corrective edit orchestrators/*
Save ─ ig_posts + ig_generation_log (incl. angle)              autopilot.ts
```

**What each agent can see:**
- **Copywriter** sees: priority ladder (téma > produkt+CTA politika > voice/gold > learning > kontext), brand voice, tone-by-type, selected idea/product, deterministic persona, 4 random hook templates, **CTA policy block** (single source of truth — replaces the old random CTA pool + pillar section), gold examples, performance patterns, **top-8 brand memories**, last-5 critic keep/fix, context pulse, recent captions (dedup) + **angle commit** instruction.
- **Critic & ranking judge** see: persona (700 chars), 8 anti-patterns, **gold examples (2×250)**, **the same CTA policy as the writer**, the declared angle, and the caption. Overall = pure rubric sum; anchors 9/6/3.
- **Chief Editor** is a **publish/sales gate** (CTA–pillar fit, product-claim truthfulness vs. product data, reason-to-act-now, red flags) — it no longer re-scores hook/voice (that's the critic's rubric). Sees caption + critic feedback + CTA policy + product data + history; **Copywriter can "pushback."**
- **Art Director** sees caption + brand kit + visual memories + recent design fingerprints (must diverge); **does not see** the critic/editor.

**Learning loops (feedback):**
- Post metrics → `propagateMetricsToSources()` → `performance_score` on ideas/reviews → weighted selection (`service.ts`).
- Critic scores → `ig_generation_log` → last-5 injected into next prompt (`autopilot.ts`, caption phase).
- `memory-agent.ts` learns patterns/preferences/avoids/visual into `ig_brand_memory`; A/B winner + user revision feed it.

---

## 3. Where randomness enters (the consistency-vs-creativity tension)

| # | Stage | Mechanism | File |
|---|---|---|---|
| 1 | Post type | weighted `Math.random()` | `autopilot.ts:175` |
| 2 | Idea/review | weighted shuffle | `service.ts:441` |
| 3 | Audience persona | deterministic per post type/pillar (fixed in Phase 1) | `caption-generator.ts` (`selectPersonaForPost`) |
| 4 | Hook templates | 4 random | `caption-generator.ts` (`getHookTemplates`) |
| 5 | CTA pool | pillar-filtered via CTA policy (random pool removed 2026-07-04) | `cta-policy.ts` (`buildCtaPolicySection`) |
| 6 | Overlay variant | random, avoids last 2 | `caption-generator.ts` |
| 7 | Hashtag fill | random shuffle | `autopilot.ts:574` |
| 8 | Product | random of top-3 LRU | `autopilot.ts:284` |
| 9 | **Copywriter output** | **temp ~1.0** | `caption-generator.ts` |
| 10 | **Art Director brief** | **high temp + forced divergence** | `image-pipeline.ts` |
| 11 | Image model | inherent stochasticity | Nano Banana Pro |

Items **3, 4, 5, 9, 10** are the structural inconsistency drivers. The pipeline also *deliberately* forces divergence on the visual side (overlay rotation, hard-banned layout archetypes, "diverge from recent briefs") — good against sameness, but currently overshoots into an incoherent feed.

---

## 4. Diagnosis — why posts drift (ranked by leverage)

1. **Default temperature (~1.0) everywhere.** Over-creative writer; *unreliable judges* that pass off-brand posts. A judge re-scoring the same caption can swing several points.
2. **Per-post random brand identity** (persona/hooks/CTAs) → tone whiplash.
3. **No canonical voice anchor.** Voice is abstract free-text traits, re-interpreted each call. **No few-shot gold examples** of "this is exactly how we sound" — the single biggest text-consistency lever LLMs respond to.
4. **Visual anti-repetition over-tuned.** Forces a different *vibe* per post, not just a different *layout*.
5. **Open/lossy learning.** Critic/Editor insights never persist (expire after 5 posts); memory retrieval is top-8 with no post-type scoping; config-vs-memory conflicts unresolved.
6. **Same-family judging.** Writer + judges all Gemini Pro → self-preference bias; blind to that family's failure modes.

---

## 5. Provider strategy — per-agent verdict (the "what's best")

**Principle:** *the writer and its judge must be different model families* — "adversarial cross-family review" — so the gate catches what the writer's family can't see.

| Agent / call | Now | Verdict | Why |
|---|---|---|---|
| **Image** (Nano Banana Pro) | Gemini | **STAY** | Native Czech typography + logo/product fidelity from reference images. No competitor matches the multi-ref workflow the render depends on. |
| **Video** (Veo 3.1) | Gemini | **STAY** | Best-in-class; reference-image conditioning keeps reels on-brand. |
| **TTS** | Gemini | **STAY** | Czech + expressive tags, cheap; ~zero leverage to change. |
| **Fast text** (ideas, reviews, context, plan, memory, tagging) | Gemini Flash | **STAY** | High-volume, latency-sensitive, cheap; divergence here is desirable. |
| **Vision QA** (`verifyNativeImage`) | Gemini Pro | **→ Claude, behind the SAME `judgeText` kill switch, unmeasured** | See the 2026-07-07 addendum below — the original "STAY" reasoning (OCR accuracy, not a taste call) is still logically sound and wasn't actually falsified by that incident, so treat this as an A/B candidate like the Copywriter arm, not a settled verdict. |
| **Copywriter** (caption ≈ 80% of text quality) | Gemini Pro | **STAY now + Claude A/B arm** | Biggest wins are temp + few-shot, not provider. Route a Claude variant through the **existing A/B system** and let winners + engagement decide. Keeps writer ≠ judge family. |
| **Critic** (1-10 score) | Gemini Pro | **→ Claude** | Cross-family judge removes self-preference; strong evaluative reasoning; **low temp = reliable gate**, which is what enforces consistency. |
| **Chief Editor** (board) | Gemini Pro | **→ Claude** | The nuanced-judgment layer Claude is strongest at. |
| **Embeddings** (NEW: consistency score + semantic dedup) | none | **ADD — Gemini embeddings** | Keeps net-new providers to exactly one (Claude). OpenAI `text-embedding-3` is a drop-in alt. |

**Claude models:** Sonnet 4.6 (`claude-sonnet-4-6`) for judges (fast, strong, cost-sensible across ≤3 rounds); Opus 4.8 (`claude-opus-4-8`) as the high tier + Claude copywriter A/B arm. Confirm exact IDs + pricing via the `claude-api` reference. Claude IDs live in `models.ts` behind `getModel()` (repo hard rule).

**Why not OpenAI as a core agent:** for Czech voice *taste/judgment* the real contest is Gemini vs. Claude; a third family adds sprawl without a distinct edge. Its one niche (embeddings) is covered by Gemini. Keep GPT documented as a fallback, not a dependency.

### Addendum — 2026-07-07: Vision QA moved to `judgeVision`, honestly caveated

A burst of 11 rapid generations on the `chrlit` account produced the first two `qa_status: native_forced` posts in the project's history: one with a missing háček baked into the rendered image ("CINKOU" instead of "ČINKOU"), one with genuinely overlapping/garbled carousel typography. Investigation found:

- **`verifyNativeImage` (Gemini) correctly flagged both as failing** — the retry loop only fires on `!qa.ok`, and it fired. QA was not fooled or lenient; the *rendering* (Nano Banana Pro) kept failing to reproduce clean typography across all 3 retry attempts, most likely because `generateImageWithReferences`/`editExistingImage` silently fall back to the weaker `gemini-3.1-flash-image` tier under 503/overload (see `instagram/gemini-client.ts`) — a burst of concurrent image calls for one client is exactly when that fallback would trigger. There was no visible evidence of Gemini being lenient toward its own render (self-preference bias) in either case.
- That means the original "STAY" reasoning above — *reading rendered text is OCR-like accuracy, not subjective taste, so writer≠judge self-preference doesn't obviously transfer* — was **not actually contradicted** by this incident. The real fixes were: (1) log the true rendering tier per attempt so a fallback-under-load is visible (`RenderResult.imageModel`), (2) add a `severity` grade (cosmetic vs. severe) so an unreadable/overlapping render gets one more bounded repair attempt instead of shipping as-is, (3) delete the two affected drafts (never posted).
- **`judgeVision()` was still added** (`instagram/judge.ts`, mirrors `judgeText`) and `verifyNativeImage` now calls it — so Claude Sonnet 5 grades the render when the same `ANTHROPIC_API_KEY`/`CLAUDE_JUDGE` switch is on, falling back to the Gemini `visionQA` ladder on any error, identical fail-open contract to the text judges. This is a legitimate thing to *try* (Claude's raw OCR accuracy on Czech diacritics might simply be better or worse than Gemini's — that's an empirical question the original strategy pass didn't have data for), but it was wired in as a byproduct of fixing today's bug, not because self-preference bias was demonstrated. **Treat it as unproven** until there's a comparison (Claude vs. Gemini QA verdicts on the same renders, ideally against human-labeled ground truth) — same evidentiary bar as the Copywriter Claude A/B arm, not an automatic "cross-family = better" upgrade.

### Addendum — 2026-07-14: the Claude vision judge was never actually running

Vercel logs showed `⚠️ Claude vision judge (vision-qa) failed — falling back to Gemini: 400 … messages.0.content.0.image.source.base64: The ima…`. The cause: `verifyNativeImage` hardcodes `mimeType: "image/png"` for the rendered post, but Nano Banana Pro returns **JPEG** bytes — and Anthropic rejects a mislabeled `media_type` outright (`"specified using the image/png media type, but the image appears to be a image/jpeg image"`). Because that mismatch is deterministic, **every** Claude vision-QA call 400'd and fell through to the Gemini ladder. The fail-open contract worked exactly as designed and hid the outage: posts kept shipping, QA kept running — but Gemini was grading its own render on every single post, which is precisely the self-preference setup `judgeVision` exists to avoid.

Fixed in `instagram/anthropic-client.ts`: images are normalized before the request (`toImageBlock`) — the `media_type` is **sniffed from the bytes** rather than taken from the caller's label, and the two other hard limits are clamped (max 8000 px per dimension; max 10 MB base64 — both verified against the live API). `img.mimeType` stays on the shape because the Gemini fallback path still reads it, but the Claude path ignores it. Verified end-to-end: Claude now reads Czech diacritics ("PŘÍBĚH") off a JPEG that previously produced a hard 400.

Consequence for the "unproven" verdict above: there is still **no** Claude-vs-Gemini QA comparison data, because the Claude arm has never once executed in production. The comparison starts from this deploy, not from 2026-07-07.

---

## 6. The complex solution — phased program

**Phase 1 — Tuning & determinism (Gemini-only, low-risk):** explicit temperatures (judges 0.2-0.3, copywriter ~0.75, ideas ~0.9); deterministic pillar→persona mapping; proven-biased hook/CTA selection; stable visual "house-style spine" (lock type family + grading + logo, rotate only layout skeleton).

**Phase 2 — Voice anchoring & closed loops:** few-shot gold-example set injected into `buildMegaPrompt` (seeded at onboarding, auto-promoted from A/B winners + top posts, user-curatable); persist Critic/Editor insights into `ig_brand_memory`; pillar-scoped memory retrieval + explicit config-vs-memory priority.

**Phase 3 — Cross-family judge:** `provider` field on `models.ts`; `instagram/anthropic-client.ts` mirroring `generateTextQuality` (+ `QualityUnavailableError`); dispatcher routes only judge call sites; Critic + Chief Editor → Claude Sonnet 4.6 (low temp); Claude copywriter A/B arm via the variant system.

**Phase 4 — Measurement:** `instagram/consistency.ts` — embed captions (Gemini) → cosine vs gold set → 0-100 brand-consistency score in `ig_generation_log`; semantic dedup replacing word-overlap. Optional: consolidate text layer onto the Vercel AI SDK + AI Gateway for unified observability/fallback (image/video/TTS stay on `@google/genai`).

---

## 7. Expected impact & cost

- **Phases 1-2 (Gemini-only)** likely deliver the *majority* of the felt consistency improvement at zero new infra.
- **Phase 3** raises the ceiling and makes the quality gate *trustworthy* (the reliable judge is what actually enforces brand consistency).
- **Cost:** Claude judges add modest per-post cost (≤3 rounds, Sonnet 4.6), gated behind the registry so it's tunable. All visual/audio costs unchanged.
- **Balance:** Phases 1-2 reduce *random* variance, not *intentional* creative variance — topic/idea divergence and layout-skeleton rotation stay. Target = **consistent voice, varied execution.**

---

## 8. Update 2026-07-04 — prodejní prompt pipeline ("posts that sell")

Shipped on top of the phased program above:

1. **CTA policy = single source of truth** (`instagram/cta-policy.ts`). `resolveCtaPolicyForPost()` derives `{mode, allowWebsite, productMention, productUrl}` from pillar `ctaStrategy` + selected product + persona tone once per post. The mega prompt, product section, reel/carousel/image format blocks, critic, ranking judge, Chief Editor and both revision prompts all render from it. Fixes the old contradiction (product section demanded a web link while a REACH pillar forbade the web) — product on a soft/none pillar → natural mention, no link. **Gotcha: never hardcode the website into CTA instructions again — always go through CtaPolicy.**
2. **Priority ladder** at the top of `buildMegaPrompt` (téma/hook > produkt+CTA politika > voice/gold > learning > kontext); competing "NEJVYŠŠÍ PRIORITA" claims demoted to `PRIORITA n` labels; decoration noise trimmed.
3. **Angle commit.** The copywriter must declare `"angle"` (1 Czech sentence, first schema field) before writing; judges score Originalita against it; logged to `ig_generation_log.angle` (migration `20260704_caption_angle.sql`).
4. **Judge parity.** Critic + ranking judge now see persona 700 chars (was 200), 8 anti-patterns (was 5), gold examples (2×250 chars) and the CTA policy — the judge finally evaluates against the same brand as the writer, and stops punishing REACH posts for lacking the website (old rubric asked "Obsahuje web?"). Token growth ≈ +1–1.5 KB per judge call (gold capped, board gets no gold examples).
5. **Calibration.** Third anchor (3/10 failure) added to `SCORE_ANCHORS`; `overall` = pure rubric sum (the "brand-manager vibe correction" is gone). Expect a mild downward shift in `critic_score` — monitor avg critic/final score + editorial rounds week-over-week; re-tune anchor wording, not the 8/9 thresholds.
6. **Chief Editor → sales gate.** The board no longer re-scores hook/storytelling/voice (critic's job); it gates publication on CTA–pillar fit, product-claim truthfulness (against injected product data), reason-to-act-now, and red flags. Loop mechanics (≤3 rounds, auto-approve ≥9, pushback, last-round leniency) unchanged.
7. **Debug:** `DEBUG_PROMPT=1` dumps the fully assembled mega prompt (autopilot caption phase) — use with `npx tsx instagram/cli.ts --config=<slug> --type=<typ> --dry-run`.
