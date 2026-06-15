# 🤖 AI Agent Rules — Chrlit Studio

> Tento soubor musí být přečten KAŽDÝM AI asistentem na začátku každé session.

---

## ⚠️ POVINNÉ PO KAŽDÉ ZMĚNĚ KÓDU

Kdykoli uděláš změnu v kódu, **MUSÍŠ** aktualizovat relevantní dokumentaci:

### Rychlý checklist

```
[ ] Přidán/změněn soubor v instagram/    → AI_AGENT_KNOWLEDGE_BASE.md §2, §3, §9 + SYSTEM_KNOWLEDGE_BASE.md §7
[ ] Přidán API endpoint                  → SYSTEM_KNOWLEDGE_BASE.md §3, §7 (API Routes tabulka)
[ ] Změněn AI model                      → SYSTEM_KNOWLEDGE_BASE.md §5 + AI_AGENT_KB §7
[ ] Přidána DB tabulka/sloupec           → SYSTEM_KNOWLEDGE_BASE.md §6 + AI_AGENT_KB §6
[ ] Změněn agent pipeline                → obě docs sekce o pipeline
[ ] Nový feedback loop                   → SYSTEM_KNOWLEDGE_BASE.md §4
[ ] Nové gotcha/bug pattern              → AI_AGENT_KNOWLEDGE_BASE.md §8
[ ] Změněn env var                       → SYSTEM_KNOWLEDGE_BASE.md §9
[ ] Změněny LOC nebo file counts         → README.md + AI_AGENT_KB §9
```

---

## 📋 Mapa: Kde co dokumentovat

| Co se změnilo | Soubor | Sekce |
|---------------|--------|-------|
| Architektura, stack | SYSTEM_KNOWLEDGE_BASE | §1 |
| Multi-tenancy | SYSTEM_KNOWLEDGE_BASE | §2 |
| Generovací pipeline | SYSTEM_KNOWLEDGE_BASE | §3 + AI_AGENT_KB §3 |
| Feedback loops | SYSTEM_KNOWLEDGE_BASE | §4 + AI_AGENT_KB §4 |
| AI modely | SYSTEM_KNOWLEDGE_BASE | §5 + AI_AGENT_KB §7 |
| DB tabulky | SYSTEM_KNOWLEDGE_BASE | §6 + AI_AGENT_KB §6 |
| Klíčové soubory | SYSTEM_KNOWLEDGE_BASE | §7 |
| Security, auth | SYSTEM_KNOWLEDGE_BASE | §8 |
| ENV proměnné | SYSTEM_KNOWLEDGE_BASE | §9 |
| Agenti, role | AI_AGENT_KNOWLEDGE_BASE | §2 |
| Záludnosti, gotchas | AI_AGENT_KNOWLEDGE_BASE | §8 |
| Adresářová struktura | AI_AGENT_KNOWLEDGE_BASE | §9 + README.md |

---

## 🏗️ Architektonická pravidla (nikdy neporušovat)

1. **Tenant isolation** — každý `ig_*` dotaz musí filtrovat `client_id`
2. **Config v DB** — žádné config soubory v kódu, pouze `configs/types.ts` + `configs/index.ts`
3. **Config validace** — `loadConfig()` volá `validateConfig()` — nový field musí mít default
4. **Retry logika** — pouze z `utils/retry.ts`, nekopírovat
5. **Admin Supabase** — backend používá `supabase/admin`, nikdy `supabase/client`
6. **Feedback loop** — nový datový zdroj → přidat `performance_score` + weighted selection
7. **Auth guard** — každý nový API route musí mít `requireAuth()` (kromě webhooků)
8. **Rate limiting** — nové generovací endpointy → zvážit přidání rate limitu
9. **Deprecated modely** — `gemini-2.0-flash`, `gemini-3.1-pro-preview`, `imagen-4.0-ultra`, `gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview` (shutdown 25.6.2026) → NEPOUŽÍVAT
10. **Model ID** — vždy přes `getModel()` z `instagram/models.ts`, nikdy hardcoded string

---

## 📅 Historie verzí docs

| Datum | Verze | Co se změnilo |
|-------|-------|---------------|
| 2026-02-27 | v2.0 | Základní architektura, multi-tenant, retry logika |
| 2026-05-14 | v3.0 | 2-step API, feedback loops, weighted selection, Memory Agent, model upgrade |
| 2026-05-14 | v3.1 | Visual Memory, analyzeVisualPatterns(), Art Director injection |
| 2026-06-02 | v4.0 | **Beta Launch:** rate limiting (10/h), auth na všech routes, config validace, editorial log UI, imageInstructions UI, mock platby, error recovery, onboarding timeout, model upgrade gemini-3.5-flash, 16 DB tabulek |
| 2026-06-10 | v4.1 | **Production Hardening:** tenant isolation (requireProjectAccess/requireClientAccess všude, žádné tenant fallbacky), oprava mrtvého learning triggeru (delta bug), kredit charge při create-job + refund + idempotence, config cache TTL 60s, stuck-job reaper, Sentry + env validace, mock-payment kill switch, link_type (revize vs A/B varianty), reviseCaption() v enginu, smazán /api/ig-generate, dekompozice typů (lib/types/database.ts jako zdroj pravdy) |

| 2026-06-11 | v4.2 | **Native Design Engine:** centrální model registry (`instagram/models.ts`, env overrides `GEMINI_MODEL_*`), migrace image modelů na GA ID (preview shutdown 25.6.), AI Designer (`gemini-3.1-pro`) generuje design briefy, Nano Banana Pro renderuje celý post vč. české typografie + loga (vision QA + korektivní edit + Satori fallback), `ClientConfig.visualEngine`/`videoTier`, `ig_posts.design_brief`, `ig_generation_log.qa_status`, Veo tiers (lite/fast/premium), TTS fallback + audio tags |

| 2026-06-12 | v4.3 | **Landing storytelling redesign** (`app/page.tsx`): copy + přeuspořádání sekcí pro ne-marketingové publikum (hero „Zadáte svůj web. Máte hotový Instagram."), nová Problem sekce, how-it-works posunuto nahoru, showcase posty z reálných oborů (`industry` chip), FAQ přeřazeno + oprava zastaralých „30 kreditů"/„7 dní zdarma" → 15/40/100 kreditů, „3 posty zdarma". Žádné změny logiky, API ani DB |
| 2026-06-14 | v4.4 | **Proof-led landing + reference brands:** hero přepsán na „web → hotový post" + sekce SeedToFlower (Sémě/Květ života vizualizace, `components/SeedToFlower.tsx`). Nová **reference** pipeline: `app/onboarding/core.ts` = auth-free dvojče onboarding logiky (buildManualAnalysisCore/generateConfigCore/saveConfigCore) sdílené headless skripty; `scripts/seed-reference-clients.ts` (4 fiktivní demo značky → config + bucket) + `scripts/export-references.ts` → `lib/reference-data.ts`; `components/References.tsx` sekce; hero/showcase čte reálné vygenerované posty (fallback na placeholdery). `ClientConfig.isReference` flag. **Oprava CLI:** `instagram/cli.ts` předává `configName` do `generateBatch`/`generateOnePost` (jinak `ensureConfig` házel „chybí configName"). Bez DB schema změn (jen nový volitelný config field) |

| 2026-06-15 | v4.5 | **Value-oriented landing restructure** (`app/page.tsx`): 10 sekcí → hodnotový oblouk (~7), důraz na výsledek místo mechaniky. Smazáno „how-it-works" (3 kroky), „30 hodin vs 15 minut" tabulka a credit-cost grid v ceníku; FAQ 10 → 4 (jen nákupní námitky). Nový `components/HeroPlayground.tsx` — hratelný hero (klik na obor → post se poskládá: skeleton → fade obrázku → typewriter captionu; čistá front-end simulace, bez backendu/kreditů, čte `SHOWCASE_POSTS`). Showcase sloučen do `References` galerie — přepsána z husté mřížky na **horizontální slider per značka** (uniform-height karty `h-auto w-auto` = mixed poměry 1:1/4:5/3:4/9:16 **bez ořezu**, šipky + scroll-snap), modal `object-contain` = celý obrázek; `SeedToFlower` zbaven „výukového" textu → úsporná emoční slova; `WaitlistForm` rounded-2xl/xl → rounded-sm. Nová sekce „stakes + cenová kotva" (loss aversion + agentura 15–20k vs od 490 Kč). Bez změn logiky, API ani DB |

| 2026-06-15 | v4.6 | **Agent Psycholog (prompt-vrstva):** nový `instagram/psychologist.ts` — deterministická vrstva prodejní psychologie (`buildPsychologistSection`) vkládaná do copywriterova mega promptu (`buildMegaPrompt` v `caption-generator.ts`), persuazní páky laděné podle `persona.ctaStyle` (hard/soft/medium). **Žádné AI volání ani nový pipeline krok** = bez latence/nákladu/failure-mode. Honesty guardrail (zákaz fake urgence/recenzí/čísel). Nový `ClientConfig.psychologist` (default `true` ve `validateConfig`). Živý review-agent (AI přepíše hotový caption) zaparkován v `brain/Ideas.md`. Bez DB změn |

| 2026-06-15 | v4.7 | **Pravidla věrnosti fotkám (Art Director):** nový `instagram/photo-fidelity.ts` — deterministický blok pravidel odvozený z `BrandImage.tags` (reálné místo/produkt vs generické) vkládaný do briefu Art Directora (`generateDesignBrief` v `image-pipeline.ts`). Brání klamavým hybridům (reálné zahradní židle + zbytek vymyšlený = falešný obraz reálného místa). Aktivuje se jen u značek s reálnými fotkami místa/produktu, jinak `""`. Žádné AI volání. Hlubší enforcement (vázat pravidla na konkrétní fotky přiložené k postu v orchestrátoru) → `brain/Ideas.md`. Bez DB změn |

| 2026-06-15 | v4.8 | **Doporučený styl komunikace na klienta (onboarding):** na konci generování configu (UI path `generateConfigPreview` v `app/onboarding/actions.ts` **i** twin `generateConfigCore` v `core.ts` — pozor, logika je v obou duplikovaná) se navíc vytvoří na míru doporučený styl komunikace (`headline`/`rationale`/`dos`/`donts`) — best-effort try/catch jako u person, takže selhání nerozbije onboarding. Zobrazeno jako **read-only panel** v review kroku (`app/onboarding/page.tsx`, mimo approval state machine) a uloženo do configu (`saveConfigCore` perzistuje celý config JSONB). Nový `ClientConfig.communicationStyle`. Bez DB schema změn |
| 2026-06-15 | v4.9 | **Self-serve obnova hesla:** nové routes `/forgot-password` (action `resetPasswordForEmail`, redirectTo `/auth/callback?next=/reset-password`) a `/reset-password` (action `updateUser({ password })`, vyžaduje recovery relaci). `/auth/callback` zpevněn — `next` sanitizován proti open-redirectu, vypršelý recovery odkaz → `/forgot-password?error=link_expired`. Odkaz „Zapomněl jsi heslo?" na `/login`. Admin nástroj `scripts/reset-password.ts <email> <heslo>` (přímý set hesla přes service role pro zaseknuté účty). Bez DB schema změn (čistě Supabase Auth) |
| 2026-06-15 | v5.0 | **Oprava tenant leaku v onboarding gate:** `checkOnboardingStatus()` měl „fallback", který nový účet bez `user_clients` linku přilepil k **prvnímu aktivnímu klientovi v DB** (role `member`) a vrátil `needsOnboarding:false` → nový uživatel viděl cizí značku místo onboardingu. Fallback odstraněn — členství v `user_clients` je jediný ownership signál (`clients.user_id` se neplní). Chybějící link = onboarding. `role='member'` = bug artefakt (nikde jinde nevzniká); čisticí skript `scripts/cleanup-orphan-links.ts` (dry-run / `--fix` / per-email). + **Admin menu gating:** `isCurrentUserSuperAdmin()` server action gateuje admin nav skupinu (Onboarding/Waitlist/Products) v `AdminSidebar` — dřív viditelná všem. Bez DB schema změn |
| 2026-06-15 | v5.1 | **Oprava onboarding slug-kolize → posty do cizího klienta:** `insertClient` (obě kopie: `core.ts` export + `actions.ts` private) při kolizi slugu vytvoří `-xxxx` suffix, ale vracel jen UUID → `saveReviewedConfig`/`saveConfigCore` vrátily původní nesuffixovaný slug → `generateMonthlyPlan`/`generateShowcasePost` generovaly do již existujícího (cizího) klienta, uživatelův nový klient zůstal prázdný. Fix: `insertClient` vrací `{id, slug}`, oba save twiny vrací reálný slug. Navíc `generateShowcasePost` dostal `requireProjectAccess()` (měl jen `requireAuth()`) — bránil cross-tenant zápisu. Bez DB schema změn |
| 2026-06-15 | v5.2 | **Oprava slug-vs-UUID na subscription/payment API:** `projectId` (StudioContext) = slug, ale `/api/payments/create` (klient posílal `clientId: projectId`) hledal `clients.id=<slug>` → „Client not found" při kliku na „Přejít na {plán}"; `/api/subscription` hledal `subscriptions.client_id=<slug>` → tiše null → žádný plán i s aktivním trialem. Fix: `SubscriptionSection` + `PaywallProvider` posílají `clientSlug: projectId`; `/api/subscription` resolvuje identifikátor přes `requireProjectAccess()` (slug→UUID + membership check). Bez DB schema změn |
| 2026-06-15 | v5.3 | **Free plány aktivují bez platby:** klik na bezplatný plán (Beta Trial, `price_czk=0`) šel taky přes `/api/payments/create` → „Missing COMGATE_MERCHANT_ID..." (Comgate creds nejsou v beta env). Nová server action `activateFreePlan(projectSlug, planId)` v `settings-actions.ts` — `requireProjectAccess` + guard `price_czk===0` (placené plány odmítne) + `activatePaidPlan()`. `SubscriptionSection.handleUpgrade` větví: `price_czk===0` → `activateFreePlan` + `refreshSubscription`, jinak Comgate. Placené plány stále vyžadují Comgate env (`COMGATE_MERCHANT_ID/SECRET`, `COMGATE_TEST=true` pro test gateway; mock je na produkci vypnutý killswitchem). Bez DB schema změn |

| 2026-06-16 | v5.4 | **Oprava „Native engine failed" (model 404):** `designer` model `gemini-3.1-pro` vrací 404 (není dostupný na v1beta / API klíči) a `generateText` fallbackoval jen na 503/429 → 404 shodilo celý native pipeline. Fix: `MODELS.designer` → `gemini-3.5-flash` (fallback `gemini-2.5-flash-lite`; Pro model lze vrátit přes `GEMINI_MODEL_DESIGNER` env override), `generateText` fallbackuje i na 404/`not found`. Image/video fallbacky 404 zatím neřeší. Bez DB schema změn |

| 2026-06-16 | v5.5 | **Best-quality model audit (ověřeno přes `ai.models.list()` + reálné volání):** opraveno několik neexistujících model ID, která by 404ovala. `designer` → `gemini-pro-latest` (best Pro, alias; `gemini-3.1-pro` neexistuje, `gemini-3-pro-preview` už je mrtvý, `gemini-3.1-pro-preview` deprecated 25.6.); video tiers → `veo-3.1-{lite,fast,}-generate-preview` (původní `-001`/`veo-3.1-lite` neexistovaly → reels by 404ovaly); `tts` fallback → `gemini-2.5-flash-preview-tts`. Image už byl optimální (`gemini-3-pro-image` GA). `generateText` má nový `fallbackModel` (designer fallback = `gemini-2.5-pro`, ne text flash-lite). `text`/`vision` zůstávají `gemini-3.5-flash` (rychlost + 300s timeout; Pro pro všechny text-agenty by riskoval timeout). Pro nejlepší reels: `ClientConfig.videoTier="premium"` (default `fast`). Bez DB schema změn |

| 2026-06-16 | v5.6 | **Designer 503/deadline → fast fallback (ne overlay):** Pro designer (`gemini-pro-latest`) občas vrací 503 „Deadline expired" (throttling Pro modelu na free Gemini tieru / overload). `withRetry` ho zkouší 3×, pak `generateText` fallbackoval na `gemini-2.5-pro` = taky pomalý Pro → taky timeout → `renderImage` spadl na legacy overlay engine (degradace vizuálu). Fix: designer fallback `gemini-2.5-pro` → `gemini-3.5-flash` (rychlý, dokončí do deadline → native Nano-Banana render pokračuje). **Skutečný fix kapacity = zapnout placený (pay-as-you-go) tier na Gemini API** (Google AI Studio/Cloud projektu za `GEMINI_API_KEY`) — free tier Pro modely silně throttluje. Není to Comgate subscription appky. Bez DB schema změn |

| 2026-06-16 | v5.7 | **Designer primary `gemini-pro-latest` → `gemini-2.5-pro`:** i na placeném Gemini tieru `gemini-pro-latest` (alias na nejnovější Pro) občas vrací 503 „Deadline expired" (transient congestion nejžhavějšího modelu). `gemini-2.5-pro` = zralý GA Pro s větší kapacitou/nižší latencí → spolehlivější, stále Pro kvalita (volba uživatele). Fallback zůstává FAST `gemini-3.5-flash`. Override `GEMINI_MODEL_DESIGNER` pořád možný. Bez DB schema změn |

| 2026-06-16 | v5.8 | **Brand-specific post formáty + all-text-Pro.** (1) `MODELS.text` → `gemini-2.5-pro` (fallback `gemini-3.5-flash`) = všichni text agenti (copywriter, critic, editorial, context, ideas, content-plan, onboarding) na Pro. `maxDuration` 300→800 (`ig-run-job`, `onboarding/layout`; **vyžaduje Vercel plán >300s**), stuck-job reaper 8→14 min. (2) Custom formáty: nový `ClientConfig.postTypeDefs` + `generateCustomFormats()` v `core.ts` (sdílené oběma onboarding twiny, best-effort) generuje brand-specific formáty s popisy; `ensurePostTypes()` rozšířen, aby je perzistoval do `ig_post_types` (volá se v save path). `getIGPostTypes` scopnut per `client_id` (fallback na generický set jen když klient nemá řádky). GenerateTab ukazuje popis formátu. Review detekce v autopilotu dle name patternu. `scripts/backfill-post-types.ts` pro existující klienty. Bez DB schema změn (sloupce `description`/`uses_product` už existovaly) |

*Při dalším updatu přidej řádek sem.*
