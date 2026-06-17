# Instagram Content Engine — AI Multi-Client Platform

> **AI-powered Instagram autopilot** — Gemini 3.5 Flash (text) + Nano Banana Pro (images) + Veo 3.1 (video)

**Last Updated:** 2026-06-02

## Architecture

```
instagram/                            # 8101 LOC — server-only
├── autopilot.ts                      # 1849 LOC — orchestrátor (generateOnePost, generateBatch)
├── caption-generator.ts              # 791 LOC — mega prompt builder, caption schemas, scorePost()
├── editorial-board.ts                # 777 LOC — reviewPost(), 6 AI agentů, max 3 kola revizí
├── text-overlay.ts                   # 683 LOC — Satori SVG → Sharp PNG (gradient, hook, logo)
├── product-generator.ts              # 643 LOC — product ideas, design concepts, mockups
├── service.ts                        # 617 LOC — DB access, weighted selection, feedback loop
├── memory-agent.ts                   # 459 LOC — brand memory, analyzeAndLearn(), getPostTypeBoosts()
├── gemini-client.ts                  # 455 LOC — AI gateway (text, image, edit, video, vision, TTS)
├── image-pipeline.ts                 # 346 LOC — refineImagePrompt(), visual memory
├── video-processor.ts                # 247 LOC — Veo 3.1 reels, subtitles
├── context-agent.ts                  # 232 LOC — gatherContext() (svátek, počasí, trendy)
├── content-planner.ts                # 223 LOC — planWeek() AI week planning
├── performance.ts                    # 186 LOC — per-pillar engagement analytics
├── idea-generator.ts                 # 145 LOC — generateAIIdeas() (with brand memory)
├── review-generator.ts               # 142 LOC — generateAIReviews() (with brand memory)
├── brand-tagger.ts                   # 128 LOC — tagBrandImages() vision auto-tagging
├── logo-loader.ts                    # 50 LOC — loadLogo() for watermark
├── types.ts                          # 128 LOC — PostGenerationResult, GenerationOptions, etc.
├── configs/
│   ├── types.ts                      # ClientConfig interface (brandVoice, contentPillars, feedAesthetic, imageInstructions, hashtagPools, ctaStrategies, audiencePersonas, products...)
│   └── index.ts                      # loadConfig() → validateConfig(), resolveClientId(), invalidateConfigCache()
├── fonts/                            # Inter, BebasNeue (for Satori text rendering)
├── assets/                           # Logos, watermarks (per client)
├── reference-images/                 # Brand reference images
└── product-images/                   # Product photos for scene placement
```

## AI Models Used

| Action | Model | Fallback |
|------|-------|----------|
| **Text — interactive** (plan preview, onboarding, ideas, critic) | `gemini-3.5-flash` (FAST) | `gemini-2.5-flash` |
| **Text — copywriter** (caption, in-job) | `gemini-3-pro-preview` | `gemini-3.5-flash` |
| **AI Designer** (design briefs, native engine) | `gemini-3-pro-preview` | `gemini-3.5-flash` |
| **Image gen** (incl. edit + refs) | `gemini-3-pro-image` (Nano Banana Pro GA, 2K) | `gemini-3.1-flash-image` (Nano Banana 2 GA) |
| **Vision** (logo placement, tagging, overlay review) | `gemini-3.5-flash` | — |
| **Vision QA** (`verifyNativeImage` native gate) | `gemini-3-pro-preview` | `gemini-3.5-flash` (then fail-open) |
| **Video** (reels, 9:16, tier via `videoTier`) | `veo-3.1-lite` / `veo-3.1-fast-generate-001` / `veo-3.1-generate-001` | — |
| **TTS** (voiceover, Czech) | `gemini-3.1-flash-tts-preview` (voice: Kore) | `gemini-2.5-flash-tts` |

> Single source of truth: `instagram/models.ts` (`getModel()`, env override `GEMINI_MODEL_<ACTION>[_FALLBACK]`).
> ⚠️ `imagen-4.0-ultra` was sunset June 2026. `gemini-2.0-flash`, `gemini-3.1-pro-preview`, `gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview` (shutdown June 25, 2026) are deprecated.

## Generation Pipeline

```
1. PŘÍPRAVA
   loadConfig() → validateConfig() → Context Agent (svátek, počasí)
   → Memory Agent (naučené vzorce, brand memory) → critic_score feedback
   
2. GENEROVÁNÍ TEXTU
   Researcher (weighted idea/review/product selection, dedup check)
   → buildMegaPrompt() → Gemini 3.5 Flash → JSON schema output

3. QUALITY GATE
   Critic: scorePost() → score 1–10, keep[], fix[]
   → Editorial Board: šéfredaktor + copywriter (max 3 kola)
   → editorial_log uložen do ig_jobs
   
4. OBRÁZEK / VIDEO
   Art Director: refineImagePrompt() + visual memory injection
   → Nano Banana Pro (2K) / Nano Banana 2 (fallback)
   → editExistingImage() pro product scene placement
   → Veo 3.1 pro reels

5. OVERLAY + UPLOAD
   Satori SVG → Sharp composite → gradient + hook + logo watermark
   → reviewOverlayComposition() vision check
   → Supabase Storage upload → ig_posts INSERT → logGeneration()
```

## Feedback Loop (automatický)

```
updateIGPostMetrics() → AUTO-TRIGGER:
  ├── propagateMetricsToSources()  → ig_post_ideas.performance_score
  │                                → ig_reviews.performance_score
  └── analyzeAndLearn()            → ig_brand_memory (pattern/avoid/visual)

autopilot.ts reads:
  ├── posledních 5 critic_score z ig_generation_log → inject keep/fix
  ├── getWeightedIdeas(3)   → 3x weight pro top performers
  ├── getWeightedReviews(3) → 3x weight pro top performers
  └── buildSmartWeekPlan()  → pillar ratios adaptované na engagement
```

## Config System

Config je uložen jako JSONB v `clients.config` v Supabase DB. Typ: `ClientConfig` v `configs/types.ts`.

`loadConfig()` automaticky volá `validateConfig()` — safe defaults pro:
- `brandVoice` (prázdné fields)
- `contentPillars` (prázdné → default reach/value/convert/connect)
- `feedAesthetic` (default colors, opacity)
- `hashtagPools` (prázdné pools)
- `ctaStrategies` (prázdné arrays)
- `imageInstructions` (per-post-type, default prázdné)
- `audiencePersonas` (default prázdné)
- ...a dalších 4+ polí

Nový klient s neúplným configem **necrashne** — dostane safe defaults.

## Key Functions

| Function | File | Purpose |
|----------|------|---------|
| `generateOnePost()` | autopilot.ts | Full pipeline for one post |
| `generateBatch()` | autopilot.ts | Batch generation (sequential) |
| `buildMegaPrompt()` | caption-generator.ts | Assemble prompt from config, memory, context |
| `scorePost()` | caption-generator.ts | AI quality scoring 1–10 |
| `reviewPost()` | editorial-board.ts | Multi-agent editorial review (max 3 rounds) |
| `generateImage()` | gemini-client.ts | Nano Banana Pro → Buffer |
| `editExistingImage()` | gemini-client.ts | Product→scene editing |
| `generateVideo()` | gemini-client.ts | Veo 3.1 reels |
| `generateVoiceover()` | gemini-client.ts | TTS in Czech |
| `refineImagePrompt()` | image-pipeline.ts | Art Director + visual memory |
| `gatherContext()` | context-agent.ts | Calendar events, weather, trends |
| `analyzeAndLearn()` | memory-agent.ts | Extract patterns → brand memory |
| `getBrandMemories()` | memory-agent.ts | Read brand memory for prompt |
| `getWeightedIdeas()` | service.ts | Performance-weighted idea selection |
| `getWeightedReviews()` | service.ts | Performance-weighted review selection |
| `propagateMetricsToSources()` | service.ts | Back-propagate metrics to ideas/reviews |
| `planWeek()` | content-planner.ts | AI week content plan |
| `validateConfig()` | configs/index.ts | Runtime config validation with safe defaults |

## Dashboard Integration

Engine je volaný přes 2-step API:
1. `POST /api/ig-create-job` → rate limit check (10/h) → vytvoří `ig_jobs` → vrátí `jobId`
2. `POST /api/ig-run-job` → spustí `generateOnePost()` → 300s max → updatuje `ig_jobs`
3. `GET /api/ig-job-status` → UI polluje progress, `agent_message`, editorial board fáze

Dashboard zobrazuje:
- **GenerateTab** — single/batch generování s real-time progress a error recovery
- **PostsTab** — vygenerované posty, PostDetailModal s editorial log (collapsible, role-colored)
- **CalendarTab** — naplánované posty s drag&drop
- **BrainTab** — brand memory, naučené vzorce
- **PerformanceTab** — per-pillar analytics, engagement grafy
