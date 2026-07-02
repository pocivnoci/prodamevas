# AI AGENT KNOWLEDGE BASE: Chrlit Studio — Instagram Multi-Tenant Autopilot

**POZOR PRO VŠECHNY AI AGENTY**: Tento dokument slouží jako zdroj pravdy pro architektonická a technická rozhodnutí. Přečtěte si ho jako první.

*Last Updated: 2026-07-02 — v6.9 "Ready to Charge": media-weighted kredity (image 1 / carousel 3 / reel 5), Comgate recurring billing + billing-worker, idempotentní payment callback*

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
| **Critic** | Hodnotí 1–10, vrací `keep[]` a `fix[]` — přes `judgeText()` | **Claude `claude-sonnet-5`** (fallback Gemini `textPro` @ temp 0.25) |
| **Editorial Board** | Šéfredaktor review (přes `judgeText()`) + copywriter revize (max 3 kola) | šéfredaktor: **Claude `claude-sonnet-5`** / fb Gemini `textPro`; revize: Gemini `textPro` |
| **AI Designer** (native engine, default) | Navrhuje kompletní design brief: kompozice, česká typografie, logo placement, anti-repetition vůči posledním 6 briefům (`generateDesignBrief` v `image-pipeline.ts`). Brief obsahuje `layoutArchetype` (8 hodnot v `LAYOUT_ARCHETYPES`); fingerprinty posledních postů (concept + layout + text placement + color) jdou do promptu a archetypy posledních 3 postů jsou **hard-banned** — porušení se detekuje v kódu a brief se regeneruje (1 retry). Cíl: stejný brand vibe, jiná struktura ("same shit different day" guard) | `gemini-2.5-pro` |
| **Art Director** (overlay engine, legacy/fallback) | Vylepšuje text-free image prompt, injektuje vizuální pravidla z memory | `gemini-3.5-flash` |
| **Renderer** | Native: Nano Banana Pro renderuje celý post vč. českého textu a loga → vision QA (`verifyNativeImage`) → 1 korektivní edit → Satori fallback. Overlay: text-free obrázek + Satori overlay | `gemini-3-pro-image` / Veo 3.1 |
| **Memory Agent** | Analyzuje vzorce z postů, zapisuje/updatuje `ig_brand_memory` | `gemini-3.5-flash` |

**Cross-family judge (v6.8):** Critic + Šéfredaktor nevolají model přímo, ale přes `judgeText()` (`instagram/judge.ts`). Když je nastaven `ANTHROPIC_API_KEY`, běží na **Claude `claude-sonnet-5`** (`instagram/anthropic-client.ts`) — jiná modelová rodina než Gemini copywriter = žádný self-preference bias, quality gate je skutečný druhý názor (pravidlo „writer ≠ judge"). Bez klíče (nebo `CLAUDE_JUDGE=off`) fallback na Gemini `textPro` ladder @ temp 0.25 → beze změny původního chování. Copywriter i editorial revize zůstávají Gemini. Sonnet 5 je „5-gen" model → **žádná `temperature`/`thinking`** (jinak 400), běží na `output_config:{effort:"low"}`.

---

## 📦 3. Průběh Pipeline (krok za krokem)

1. **UI volá `/api/ig-create-job`** → rate limit check (10/h) → vytvoří `ig_jobs`, vrátí `jobId`
2. **UI začne pollovat `/api/ig-job-status?id=...`** každé 2s
3. **UI volá `/api/ig-run-job`** s `{ jobId }` — blokuje až 800s
4. **Uvnitř `generateOnePost()`:**
   - Config: `loadConfig()` → `validateConfig()` (safe defaults pro neúplný config)
   - Researcher: vybere typ, nápad (`getWeightedIdeas()`), recenzi (`getWeightedReviews()`)
   - Context Agent: `gatherContext()` → svátek, počasí, trendy
   - Brand Memory: `getBrandMemories(8)` + `getPostTypeBoosts()` + critic_score feedback
   - Copywriter: `generateText(megaPrompt)` → JSON `{hook, body, cta, hashtags, imagePrompt}`
   - Dedup check: hook + body vs. posledních 30 postů (Levenshtein)
   - Critic: `scorePost()` → `judgeText()` (Claude `claude-sonnet-5` / Gemini `textPro` fb) → score 1–10, `keep[]`, `fix[]`
   - Pokud score < 9: Editorial Board — šéfredaktor review (`judgeText()`) + copywriter revize (max 3 kola)
   - Art Director: `refineImagePrompt()` → vylepšený prompt (s visual memory)
   - Renderer: `generateImage()` / `editExistingImage()` (product→scene) / `generateVideo()`
   - Text overlay: Satori SVG → Sharp PNG → gradient + hook text + logo watermark
   - Overlay review: `reviewOverlayComposition()` — vision check
   - Upload: Supabase Storage → `createPost()` → `logGeneration(+ critic data)` → `learnFromCriticInsights()` (fire-&-forget, v6.8)
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

**C) `learnFromRevision()`** — Revize uživatele → Brand Memory (v5.9)
- Spouští se z `revisePost()` (fire-&-forget přes `waitUntil`), když uživatel přepíše post s feedbackem
- Feedback uživatele = nejsilnější signál (řekl přesně, co bylo špatně)
- Gemini z (původní caption + feedback + přepsaná verze) extrahuje 1–2 `avoid`/`preference` memories
- Stejný dedup/confidence pattern jako `learnFromVariantSelection`

### Critic → Prompt Feedback
- `logGeneration()` ukládá `critic_score`, `critic_keep[]`, `critic_fix[]`
- Autopilot čte posledních 5 critic scores a injektuje keep/fix do mega promptu
- Umožňuje systému se učit z vlastních chyb

### Critic → Brand Memory (v6.8 — judge-insight learning)
- `learnFromCriticInsights()` (`memory-agent.ts`) běží fire-&-forget z `autopilot.ts` hned po `logGeneration`
- Critic `fix` poznámky se seedují jako `avoid` memory na confidence **0.3** (pod prahem 0.4 v `getBrandMemories`) → jednorázová chyba zůstane dormantní, **opakující se** fix se reinforcuje (+0.1) přes 0.4 a stane se stálým „❌ VYHÝBEJ SE" pravidlem; decay retiruje fixy, které writer přestane dělat
- Scopováno per pillar (`ig_brand_memory.pillar`, migrace `20260701_brand_memory_pillar.sql`)

### Weighted Selection (v5.9 — recency decay + exploration)
```typescript
getWeightedIdeas(3)   // decayedScore > avg*1.5 → 3x, > avg → 2x, ostatní 1x
getWeightedReviews(3) // stejný pattern
buildSmartWeekPlan()  // pillar ratio × 1.5 (top) / × 0.5 (under), normalizováno
```
- **`decayedScore()`** (`service.ts`): `performance_score` slábne s ~120denním poločasem rozpadu
  (decay podle `last_used_at` / `used_at`) — staré hity nedominují výběr navždy, feed se
  nezasekne v lokálním optimu.
- **Exploration boost**: nezměřené zdroje (`!times_used_with_metrics`) dostanou garantovaně **2x**
  váhu (optimism under uncertainty) místo zahrabání mezi prokazatelně slabé — drží smyčku ve
  zkoumání nového.

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

### Tenant isolation (v4.1)
- Server action s `projectSlug` → `requireProjectAccess(slug)` (membership check, vrací `clientId`)
- Akce s row id (post, memory, job…) → fetch `client_id` z řádku + `requireClientAccess(uuid)`
- Žádné defaulty na konkrétního klienta — chybějící identifikátor = throw
- `setActiveProject()` je globální mutable stav — nový kód předává `clientId` explicitně

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
| `subscriptions` | `plan_id`, `status`, `plan_posts_unlocked`, `recurring_trans_id`, `billing_failures` | Active subs + recurring token & dunning counter (v6.9) |
| `payments` | `comgate_trans_id`, `amount`, `status` | Comgate payments |

---

## 🤖 7. AI Modely (aktuální stav k 2.7.2026)

**Centrální registr: `instagram/models.ts`** — jediný zdroj pravdy pro model ID. Per-env override bez deploye: `GEMINI_MODEL_<ACTION>` / `GEMINI_MODEL_<ACTION>_FALLBACK` (např. `GEMINI_MODEL_DESIGNER=gemini-3.5-flash`).

| Akce (registr) | Model | Fallback |
|------|-------|----------|
| `text` (interaktivní: plán preview, onboarding, produkty, ideas, context, memory) | `gemini-3.5-flash` (FAST — UI responzivní) | `gemini-2.5-flash` |
| `textPro` (copywriter — caption, jen v generation jobu) | `gemini-pro-latest` (alias na GA Pro) | `gemini-2.5-pro` (druhý Pro, ne flash — quality ladder) |
| `designer` (AI Designer) | `gemini-pro-latest` | `gemini-2.5-pro` |
| `judge` (**Critic + Šéfredaktor** — cross-family, v6.8) | **Claude `claude-sonnet-5`** (jen když je `ANTHROPIC_API_KEY`; kill switch `CLAUDE_JUDGE=off`) | Gemini `textPro` ladder @ temp 0.25 (`judgeText` dispatcher) |
| `vision` (tagging, logo placement, overlay review) | `gemini-3.5-flash` | — |
| `visionQA` (`verifyNativeImage` — QA gate native engine) | `gemini-pro-latest` | `gemini-2.5-pro` (pak fail-open) |
| `image` | `gemini-3-pro-image` (Nano Banana Pro GA) | `gemini-3.1-flash-image` (Nano Banana 2 GA) |
| `imageCheap` | `gemini-3.1-flash-image` (512px tier) | — |
| `videoLite` / `videoFast` / `videoPremium` | `veo-3.1-lite-generate-preview` / `veo-3.1-fast-generate-preview` / `veo-3.1-generate-preview` | — |
| `tts` | `gemini-3.1-flash-tts-preview` | `gemini-2.5-flash-preview-tts` |

> [!CAUTION]
> **DEPRECATED / NEPOUŽÍVAT:** `gemini-2.0-flash`, `gemini-3-pro-preview` (404 „no longer available" 18.6.2026), `gemini-3.1-pro-preview`, `imagen-4.0-ultra`, `gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview` (shutdown 25.6.2026). Pro tier běží na aliasu `gemini-pro-latest` (auto-rotace na aktuální GA Pro — **nikdy nepinovat** preview ID). Model ID vždy přes `getModel()`.

---

## 🧩 8. Záludnosti při úpravách

1. **2-step API**: `ig-create-job` (fast, vrátí jobId) → `ig-run-job` (800s). UI polluje od prvního requestu.
2. **Rate limit**: 10/h per klient v `ig-create-job`. Admin bypass přes `SUPER_ADMIN_EMAILS`.
3. **Config validace**: `loadConfig()` volá `validateConfig()` — safe defaults pro 11+ polí. Nový klient necrashne.
4. **Weighted selection**: Nové datové zdroje musí mít `performance_score` + weighted selection funkci.
5. **Critic → Prompt**: Autopilot čte posledních 5 critic_score z `ig_generation_log` → injektuje do promptu.
6. **Editorial Board**: `reviewPost()` — max 3 kola revizí. Log se ukládá do `ig_jobs.editorial_log`.
7. **Editorial log UI**: `getEditorialLog(postId)` → PostDetailModal zobrazuje celou konverzaci s role-specific barvami.
8. **Vercel timeouty**: `ig-create-job` = 10s, `ig-run-job` = 800s (Vercel Pro / Fluid Compute), `ig-learn` = 60s.
9. **Fonty/assets na Vercelu**: Musí být v `outputFileTracingIncludes` v `next.config.ts`.
10. **Text v obrázcích**: Imagen NESMÍ generovat text — vždy přes Satori (`text-overlay.ts`).
11. **Memory Agent ilike**: `ig_brand_memory` nemá FTS index — používat `.ilike("content", ...)`.
12. **imageInstructions**: Per-post-type image instructions v `ClientConfig` — editor v SettingsTab, consumováno v `buildMegaPrompt()`.
13. **Onboarding timeout**: 90s `Promise.race` per showcase post — non-fatal, přeskočí se.
14. **Mock platby**: `COMGATE_MOCK=true` → mock-payment stránka, callback bypass.
15. **Feedback auto-trigger**: `updateIGPostMetrics()` spustí `propagateMetrics()` + `analyzeAndLearn()` přes `waitUntil()`. POZOR: předchozí metriky se čtou PŘED updatem — jinak jsou delty 0 a učení se nikdy nespustí (bug opravený v4.1).
   - **Auto-ingestion metrik (v6.5, roadmap step 3):** metriky teď přitékají i bez ručního zadávání — `syncPostMetrics(clientId)` (`instagram/metrics-sync.ts`) stáhne IG insights (`fetchMetrics` v `lib/channels/instagram.ts`) a nakrmí **identickou** kaskádu. Posvátná smyčka byla vyčleněna z `updateIGPostMetrics` do session-less `writeIGPostMetrics` + `fireMetricsLearning` (sdílí UI i cron). Klíčový rozdíl proti ručnímu zadání: učení se po syncu spouští **jednou** (ne per-post — `analyzeAndLearn` je AI volání), pokud se aspoň jeden post změnil významně (Δlikes≥5 ‖ Δsaves≥2 ‖ Δcomments≥3). Handoff posty bez `ig_media_id` se párují přes caption-match (unikátní prefix). Spouštěče: denní cron `/api/cron/ig-metrics-sync` + tlačítko v PerformanceTab. Funguje hned pro vlastní účet (Standard Access); tenanti po 1. App Review. Manuální `MetricsInputForm` = fallback. Viz `docs/META_APP_REVIEW_PLAN.md`.
16. **Kredity — media-weighted (v6.9)**: post stojí `creditsForMedia(medium)` = **image 1 / carousel 3 / reel 5** (`lib/credits.ts` — client-safe zdroj pravdy, `lib/subscription.ts` re-exportuje; UI odhady importují z `lib/credits`). Charge při `ig-create-job` (ne po generování): účtované médium = explicitní `body.medium`, jinak formát post typu (`getPostFormat`), s pre-aplikací kill-switche a plan gatingu. `ig_jobs.config` nese `charged` ('plan'/'credits'/'none') + **`chargedCredits`** + **`chargedMedium`**. Engine dostává `options.chargedMedium` a **nikdy nevyrenderuje dražší médium** (rank clamp v `autopilot.ts` za kill-switchem); levnější clamp (reel→carousel) se po úspěchu dorovná refundem přes `reconcileJobCharge` (action `post_adjust`, idempotentní přes unique index). Refund při selhání vrací přesně `chargedCredits`. Kampaně: worker účtuje per-item médium (pre-clamped), `startCampaign` dělá weighted up-front check (Σ creditsForMedia) + per-item reel gating. **Varianty** (`generatePostVariant`) se nově účtují (`post_variant`, weighted podle média originálu — dřív běžely ZDARMA, billing leak); revize (`revisePost`) zůstává zdarma (feedback = learning signál). Plány re-budget: Start 20 / Růst 45 / Dominance 110 kreditů (`20260702_media_weighted_credits.sql`); trial má nově `allowed_media: image+carousel` (žádné reels zdarma).
17. **Stuck-job reaper**: `ig-job-status` označí job bez aktivity >8 min jako failed + refunduje. Žádný cron.
18. **link_type**: `revision_of` linkuje revize i A/B varianty — `link_type` ('revision'/'variant') je rozlišuje. A/B srovnání a `learnFromVariantSelection` filtrují na 'variant'. Revize ('revision') spouští `learnFromRevision()` (v5.9) — feedback uživatele → `avoid`/`preference` memory.
19. **Config cache TTL 60s**: `invalidateConfigCache()` čistí jen lokální lambdu — ostatní instance expirují přes TTL. Nikdy nespoléhat na okamžitou propagaci configu.
20. **Mock platby na produkci**: `isMockPaymentMode()` ignoruje `COMGATE_MOCK=true` když `VERCEL_ENV=production`.
    - **Recurring billing (v6.9)**: první platba se vytváří s `initRecurring: true` (jen když `COMGATE_RECURRING=1` — vyžaduje smluvní aktivaci „opakovaných plateb" u Comgate, jinak by create SELHAL). Callback po PAID uloží transId jako `subscriptions.recurring_trans_id` (token; renewaly VŽDY referencují INIT transId, ne poslední renewal) + resetuje `billing_failures`. **Denní cron `/api/cron/billing-worker`** (8:00): pro `active` suby s prošlým `current_period_end` → `chargeRecurring()` (server-to-server, bez redirectu; potvrzení jde standardním callbackem = jediná aktivační cesta `activatePaidPlan`), bez tokenu → e-mail „obnovte ručně". Dunning: `billing_failures++` per pokus, po **3** → persist `expired` + e-mail; `getClientSubscription` drží sub použitelný v grace okně **3 dny** po period_end a pak expiry PERSISTUJE (dřív jen read-time fikce). Renewal platby mají refId prefix `renew-` — CANCELLED renewal NIKDY neruší živou sub (jde do dunningu); CANCELLED při iniciální platbě ruší jen `pending` sub. **Callback je idempotentní**: status transition se claimuje podmíněným UPDATE (`.neq("status","PAID")`) — replay PAID callbacku je no-op. Selhání `activatePaidPlan` po PAID → Sentry alert (zaplaceno-neaktivováno = nejhorší stav). E-maily přes `lib/email.ts` (Resend), best-effort.
21. **Media gating (v3 tiery)**: reel je povolen od plánu Růst. Enforcement 2×: `ig-create-job` vrací 403 `featureBlocked` při explicitním `medium:"reel"`, a `generateOnePost({ allowedMedia })` clampne medium z configu/kategorie na carousel/image. Plány bez `features.allowed_media` (trial_v2, legacy chrlit) = vše povoleno (`canUseMedium` v `lib/subscription.ts`).
22. **Aktivace plánu po platbě**: `activatePaidPlan(clientId, planId, subscriptionId?)` — planId se čte z pending subscription vytvořené při `payments/create`; ostatní live subs klienta se cancelnou. Nikdy nehardcodovat plan id v callbacku.
21. **reviseCaption()**: revize captionu žije v `caption-generator.ts` (engine) — NIKDY nestavět copywriter prompt v `app/actions`.
22. **Onboarding gate = jen `user_clients`**: `checkOnboardingStatus()` rozhoduje o onboardingu výhradně podle členství v `user_clients` (super-admin výjimka výš). `clients.user_id` se NIKDY neplní (onboarding linkuje jen přes `user_clients`, role `owner` — `insertClient` user_id nenastavuje). Žádný „fallback na první aktivní klient" — to přilepovalo nové účty k cizímu tenantovi (role `member`) a přeskočilo onboarding. `role='member'` proto = legacy bug artefakt; čisticí skript `scripts/cleanup-orphan-links.ts`. Chybějící link = onboarding, nikdy default tenant.
23. **Onboarding slug-kolize propagace**: `insertClient` (DVĚ kopie — `core.ts` export + `actions.ts` private, edituj obě) při kolizi slugu vytvoří suffixovaný slug (`-xxxx`) a MUSÍ vrátit `{id, slug}`. Dřív vracel jen UUID → `saveReviewedConfig`/`saveConfigCore` vracely původní (nesuffixovaný) slug → post-save generování (`generateMonthlyPlan`, `generateShowcasePost`) běželo proti KOLIZNÍMU (cizímu) klientovi a uživatelův nový klient zůstal prázdný. Navíc `generateShowcasePost` měl jen `requireAuth()` místo `requireProjectAccess()` → cross-tenant zápis showcase postů prošel místo aby selhal. Obojí opraveno (v5.1).
24. **Slug vs UUID na API hranici**: `projectId` ve `StudioContext` = SLUG, ne UUID. Server actions to řeší (`requireProjectAccess`→`resolveClientId`), ale dvě API routes braly identifikátor jako UUID: `/api/payments/create` (`clients.id=<slug>` → „Client not found") a `/api/subscription` (`subscriptions.client_id=<slug>` → tiše null → „Žádný plán" i s aktivním trialem). Fix: klienti posílají `clientSlug` (payments/create route umí slug i UUID); `/api/subscription` resolvuje přes `requireProjectAccess(param)` (+ membership). Nové fetch volání s `projectId` MUSÍ posílat slug jako `clientSlug` nebo route nechat resolvovat (v5.2).
25. **Model 404 = fallback, ne crash + ověřuj reálná ID**: `generateText` fallbackoval jen na 503/429 — neexistující model ID (404 „not found") propadlo a shodilo native pipeline. Fix: `generateText` fallbackuje i na 404/`not found` a bere volitelný `fallbackModel` (designer pak fallbackuje na `gemini-2.5-pro`, ne na text flash-lite). **Model ID se NEHÁDÁ** — ověř přes `ai.models.list()` + reálné `generateContent` (model může být „listed but dead", viz `gemini-3-pro-preview` = 404). Aktuální best/working: designer `gemini-pro-latest`, image `gemini-3-pro-image` (GA), video `veo-3.1-*-generate-preview` (3.1 jen preview), tts fallback `gemini-2.5-flash-preview-tts`. `gemini-3.1-pro` neexistuje; `gemini-3.1-pro-preview` deprecated (shutdown 25.6.). Pozor: image/video fallbacky (`generateImage`…) řeší jen 503/UNAVAILABLE — 404 image/video modelu by stále crashlo.
26. **Brand-specific post formáty**: formáty v Generate selectoru jsou per-klient, ne generická globální sada. `generateCustomFormats(analysis, config)` (v `core.ts`, sdílené oběma onboarding twiny) vyrobí `config.postTypeDefs` (name/display_name/emoji/description/pillar/medium/aspectRatio/uses_product) + nastaví `postTypes`/`postFormats`/`weekPlan`/`contentPillars`. `ensurePostTypes()` (`service.ts`) je perzistuje do `ig_post_types` (volá se v save path onboarding I při generování). `getIGPostTypes` (UI) i `getActivePostTypes` (engine) filtrují per `client_id` + na `config.postTypes`. Copywriter už `postType.description` injektuje (`caption-generator.ts:517`) → custom formáty řídí obsah. Review detekce v `autopilot` je dle name patternu (`/recenz|review|testimonial|spokojen/`), ne přesné "recenze" (žádný `uses_review` sloupec). Backfill existujících klientů: `scripts/backfill-post-types.ts <slug>`.
   - **POZOR — multi-tenant + "generic formats" past:** `getIGPostTypes` (UI) DŘÍVE fallbackoval na **neomezený globální** `ig_post_types` dotaz když klient neměl vlastní řádky → cross-tenant bleed. Teď se místo toho **self-healuje per-client** (zavolá `ensurePostTypes(config, clientId)` a přečte znovu jen `client_id` řádky), nikdy globálně. ALE skutečná příčina "každý klient vidí stejné formáty": `generateCustomFormats` je **best-effort** (silent `return` při chybě AI/JSON/0 pilířů, `core.ts:735`) — když selže, klient zůstane s **generickým** `postTypes` z příkladu v `generateConfigCore` promptu (`core.ts:472` / `actions.ts:856`: `tip,meme,carousel,behind_scenes,product_drop,recenze,challenge`) a **prázdným `postTypeDefs`**. Audit napříč klienty: `scripts/audit-formats-pillars.ts` (read-only report; `--fix` dělá jen deterministické heely — ensurePostTypes + deaktivace stale řádků + prune dead pillar refs; NIKDY ne-AI-regen). Generic klienty se opravují jen `backfill-post-types.ts <slug>` (běží AI). `validateConfig` teď defaultuje `postTypes`/`postFormats`/`postTypeDefs` na prázdné (ne undefined).
27. **Publikování na Instagram (roadmap step 2)**: post se publikuje přes `/api/cron/ig-publisher` (cron každou minutu, `vercel.json`). Stav-stroj: `draft`/`ready` → (uživatel schválí čas přes `schedulePostAction`) → **`scheduled`** (armed) → cron atomicky flipne `scheduled→posting` (claim přes podmíněný UPDATE na `status` — zabrání double-publish dvou ticků) → `posted` (+ `ig_media_id`, `permalink`, `posted_at`) nebo `failed` (+ `publish_error`, po `MAX_ATTEMPTS=4` pokusech s exponenciálním backoffem). Graph volání je `instagramAdapter.publish()` v `lib/channels/instagram.ts` (container→publish; **image + carousel**, reel/video deferred → hodí `ChannelNotEnabledError` = permanent fail). Carousel slidy zůstávají pipe-joined v `ig_posts.image_url` (`url1|url2|...`), publisher splitne. `media_type` se ukládá při generování (`autopilot.ts` createPost). `schedulePostAction`/`retryPublishAction` guardují na `connected` řádek v `ig_connections`. **Vyžaduje scope `instagram_business_content_publish` = 2. App Review submission** — do schválení funguje jen pro účet, jehož přihlašující uživatel je admin/tester Meta appky (= dogfood). Žádné účtování kreditů v publisheru (kredity se berou při generování). Migrace: `supabase/migrations/20260622_ig_publishing.sql`.
   - **Manuální „handoff" cesta (publikování BEZ App Review, funguje hned):** dokud auto-publish čeká na 2. App Review, posty se publikují ručně přes tlačítko **📲 Publikovat na Instagram** v `PostsTab` (karta i detail). Otevře `PublishHandoffModal.tsx` — na telefonu použije **Web Share API** (`navigator.share({ files })`) a pošle obrázek(y) přímo do IG appky přes systémové sdílení + zkopíruje caption do schránky (IG přes share text nepřebírá → schránka je most); na desktopu fallback kopírovat/uložit. Po sdílení **✓ Označit jako publikováno** (`status='posted'`, ruční — reálný post nelze detekovat). Funguje pro libovolný účet **i reels** (na rozdíl od cron auto-publishe). Bez nové DB/API surface (čistě klientský UI nad existujícími veřejnými URL obrázků). Uživatelský návod: **`docs/POSTING_GUIDE.md`**.
   - **⚡ Publikovat hned (instant auto-publish z handoff modalu):** když je účet **připojený** a post je image/carousel, modal nabídne `publishNowAction` (`calendar-actions.ts`) jako primární akci — armne post (`status='scheduled'` + `scheduled_for=now`), `ig-publisher` cron ho vydá ≤60s, UI pollne `getPostPublishStatus` na „Publikováno"+permalink / „Selhalo". **Žádné synchronní Graph volání** (carousel s container-pollingem by jinak mohl timeoutnout server action — cron na to má 800s budget). Reuse publisher path = zero risk. Manuální Web Share zůstává sekundární (a jediná cesta pro reels / nepřipojené účty). `PostsTab` předává `connected` přes `getConnectionStatus`. iOS Zkratka (volitelná, jen manuální cesta — IG **neumožní** auto-post ze zkratky): `docs/IOS_SHORTCUT_HANDOFF.md`.

28. **Mix formátů v content plánu (carousel cap)**: `generateContentPlan` (`content-plan-actions.ts`) počítá efektivní medium každého postu **jednou předem** do pole `effectiveMediums[]`, ze kterého pak čte jak planner prompt (`typeList`), tak badge (`item.medium`) — musí vždy souhlasit. Dva průchody: (1) base formát z `getPostFormat`, plus reels kill-switch (když `REELS_ENABLED !== "1"`, klampnuté reely se rozprostřou ~2/3 image, ~1/3 carousel deterministicky dle pozice `i % 3`, aby reels-off plán nezaplavil karusely); (2) **tvrdý strop `carouselCap = Math.floor(count / 4)`** — max ¼ plánu smí být carousel. Walk v pořadí: drží carousely dokud nedosáhne stropu, pak demotuje každý další carousel (přirozený i ex-reel) na single image. Pro `count < 4` = nula karuselů. Reely (když povolené) a image se nedotýká.

29. **Délka plánu = trvání × kadence (ne 1 post/den)**: počet postů v content plánu se **neodvozuje od dní**. UI (`GenerateTab`) nabízí **trvání** (Zkouška / Týden / Dva týdny / Měsíc), z něj derivuje `count = round(weeks × postsPerWeek)` (Zkouška = fixně 3). `postsPerWeek` je nové pole na `ClientConfig` — **reálná kadence značky**, seedovaná při onboardingu z jejího skutečného IG (`estimatePostsPerWeek()` v `lib/ig-scraper.ts` z timestampů `recentPosts`, clamp 2–7), default 4. `validateConfig()` clampuje 1–7 a defaultuje na 4 (povinný default — viz hard rule v CLAUDE.md). UI čte kadenci přes server action `getPlanCadence(slug)`; zobrazuje výsledný počet postů + kredity + „X příspěvků/týden". **Proč to bylo třeba:** dřív `count` = počet dní (tlačítka 3/7/14/30 = „1 post denně") → 14 dní generovalo 14 postů místo reálných ~8 při kadenci 4/týden; to nafukovalo karusely (špatný jmenovatel u `carouselCap`), kredity i rozsah kalendáře. Kadence se neseeduje v onboarding twinu `core.ts` (ten IG nescrapuje) — script-vytvořené configy spadnou na default 4 z `validateConfig`. **Existující klienti** (onboardovaní před tímto polem): `scripts/backfill-cadence.ts [slug]` doscrapuje IG a dopočítá `postsPerWeek` (`--dry` = náhled). Fiktivní/referenční značky (`seed-reference-clients.ts`) mají vymyšlené handly → HikerAPI 404 → zůstanou na defaultu 4 (správně, nemají reálný IG).

---

## 📁 9. Adresářová Struktura

```
instagram/                            # AI Engine
├── autopilot.ts                      # ~730 LOC — orchestrátor (generateOnePost, generateBatch)
├── orchestrators/                    # rendering pipelines (extrahováno z autopilot.ts)
│   ├── image-orchestrator.ts         # ~430 LOC
│   ├── carousel-orchestrator.ts      # ~165 LOC (retry přes utils/retry)
│   ├── reel-orchestrator.ts          # ~200 LOC
│   └── types.ts                      # RenderContext, CaptionData, ProgressReporter
├── cli.ts                            # ~410 LOC — dev CLI (--stats, --feedback, ...)
├── caption-generator.ts              # ~890 LOC — mega prompt, schemas, quality gate, reviseCaption()
├── editorial-board.ts                # 777 LOC — 6 AI agentů review
├── text-overlay.ts                   # 683 LOC — Satori → Sharp
├── product-generator.ts              # 643 LOC — product ideas, design concepts
├── service.ts                        # ~640 LOC — DB access, weighted selection (decay+explore), feedback
├── memory-agent.ts                   # ~700 LOC — brand memory, learning, variant + revision + critic-insight learning
├── gemini-client.ts                  # 455 LOC — AI gateway (text, image, video, TTS)
├── judge.ts                          # cross-family judge dispatcher — judgeText() → Claude / Gemini textPro fb
├── anthropic-client.ts               # Claude gateway — judgeWithClaude(), claudeJudgeEnabled() (Sonnet 5, 5-gen API)
├── image-pipeline.ts                 # 346 LOC — prompt refinement, visual memory
├── video-processor.ts                # 247 LOC — Veo 3.1 reels
├── context-agent.ts                  # 232 LOC — svátek, počasí, trendy
├── signals/                          # calendar.ts, weather.ts — context zdroje
├── content-planner.ts                # 223 LOC — AI week planning
├── performance.ts                    # 186 LOC — per-pillar analytics
├── idea-generator.ts / review-generator.ts / brand-tagger.ts / logo-loader.ts
├── types.ts                          # pipeline types
└── configs/
    ├── index.ts                      # loadConfig() (60s TTL cache), validateConfig(), resolveClientId()
    └── types.ts                      # ClientConfig interface (+ imageBrief)

app/api/
├── ig-create-job/route.ts            # membership + rate limit + CHARGE kreditu
├── ig-run-job/route.ts               # job ownership — 800s, refund při selhání
├── ig-job-status/route.ts            # ownership + stuck-job reaper (>8 min)
├── ig-learn/route.ts                 # membership — feedback loop
├── payments/create|callback|return   # mock kill switch na produkci
├── subscription/route.ts
└── cron/ig-publisher/route.ts         # publisher — drainuje 'scheduled' posty → Graph publish (image+carousel)

app/actions/                          # server actions dekomponované podle domén
├── admin-actions.ts                  # ~640 LOC — stats, listy, metriky (+ learning trigger), checkIsAdmin
├── product-actions.ts                # ~1130 LOC
├── ig-generate-action.ts             # ~520 LOC
├── content-plan-actions.ts           # ~420 LOC — text-only plán (PlanTab)
├── variant-actions.ts                # ~400 LOC — revize + A/B varianty (link_type)
├── config-actions.ts                 # ~370 LOC — ClientConfig CRUD
├── credit-guard.ts                   # ~200 LOC — vše s membership checkem
├── calendar-actions.ts / memory-actions.ts / post-actions.ts / brand-images-action.ts
├── product-brief-actions.ts / product-category-actions.ts / settings-actions.ts
└── waitlist.ts + waitlist-admin.ts

app/onboarding/actions.ts             # ~1900 LOC — web scan + HikerAPI IG scraping → config wizard
                                      #   enrichWithInstagram(): captiony (IgInsights vč. voiceProfile/provenPatterns)
                                      #   + vision analýza reálných obrázků feedu (instagram/feed-vision.ts →
                                      #   FeedVisualProfile: typographyStyle, accentColorHex, logoPlacementHabit,
                                      #   dominantArchetypes z LAYOUT_ARCHETYPES, visualStrengths/Recommendations).
                                      #   generateConfigPreview() z toho plní native pole feedAesthetic
                                      #   (accentColor/typographyStyle/logoPlacement/customInstructions) + config.igBaseline;
                                      #   saveReviewedConfig() seeduje ig_brand_memory (seedOnboardingMemories,
                                      #   confidence 0.45, jen když je memory prázdná)
instagram/feed-vision.ts              # vision audit scrapnutého IG feedu (max 8 obrázků, 1 multimodální call, fail-open)
lib/env.ts + instrumentation.ts       # startup env validace + Sentry init
```
