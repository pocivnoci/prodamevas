---
name: content-engine
description: >-
  Textová část AI pipeline Chrlit Studia — mega prompt copywritera, responseSchema,
  kritik, editorial board, brand memory, kvalitativní žebřík modelů a zpětnovazební
  smyčky. Načti při práci s instagram/caption-generator.ts, judge.ts,
  editorial-board.ts, autopilot.ts, memory-agent.ts, models.ts, gemini-client.ts,
  plan-pipeline.ts, nebo když řešíš skóre kritika, revize, ig_generation_log,
  performance_score, váženou selekci a výběr modelu.
---

# Textový engine: prompty, schémata, hodnocení

Hlídají to aserce **§16** v `test-beta-e2e.ts` a `scripts/test-prompt-assembly.ts`
(`npm run guard`).

## Schéma a prompt se mění SPOLU

`responseSchema` je **whitelist, ne minimum**: pole, o které si prompt řekne a schéma
ho nedeklaruje, model **nevrátí**. Změřeno proti `gemini-pro-latest` 2026-08-05.

Takhle byly mrtvé dvě věci najednou:

- `buildVideoSchema` neměl `narration`/`soundEffect` → reelový voiceover i titulky se
  nikdy nevygenerovaly.
- Revizní schéma editorial boardu neumělo vrátit `slides`/`scenes`/`caption` → karusel
  nešlo opravit a u reelu se revize přepsala zpět starým textem.

**Když přidáš pole do JSON ukázky v promptu, přidej ho do schématu.**
`scripts/test-prompt-assembly.ts` to hlídá pro všechna čtyři média.

## Brand memory: filtr patří do dotazu

`getBrandMemories(limit, clientId, pillar, topic, types)` — **typový filtr patří do
SQL**, limit se aplikuje tam taky. Vzorec „načti 5 a pak `.filter(visual)`" vracel
prázdno, jakmile klient nasbíral 5 textových pamětí s vyšší confidence: vizuální paměť
tiše zmizela z promptu designéra.

`clientId` předávej **explicitně** a `catch` nikdy nenechávej němý — pád na
`getActiveProject()` mimo `withActiveProject` scope je jinak neviditelný.

## Learning sekce jen se skutečnými metrikami

Gatovaná na `performance.avgEngagement > 0`. Bez metrik je `bestHooks` prostě
posledních 5 postů; injektovat je jako „Zlaté hooky (nejlepší dosah)" nutí copywritera
kopírovat rytmus postů, které o dva odstavce níž zakazuje sekce „NEOPAKUJ SE".
Stejnou podmínku má `buildSmartWeekPlan`.

`scorePost` vrací `judged`; nehodnocený post loguje `critic_score: null`, **ne plochou
sedmičku** — fabrikované skóre je v `ig_generation_log` k nerozeznání od průměrného
postu. Editorial board po každé revizi **přeskórovává** (jinak `final_score ===
critic_score` vždy a přínos boardu je neměřitelný) a do promptu píše **skutečný**
`maxRounds`, ne `MAX_POST_ROUNDS`.

Celý audit a co zůstalo odložené: `docs/PROMPT_AUDIT_2026-08.md`.

## Kvalitativní žebřík: degradace nahlas, nebo vůbec

Modelové ID žijí v `instagram/models.ts`, vždy přes `getModel()`. Pro tier
(`textPro`/`designer`/`visionQA`/`planner`) používá **alias `gemini-pro-latest`** —
nikdy nepinuj Pro preview ID, alias se sám otáčí na aktuální GA Pro, takže shutdown
nás nemůže shodit na 404 (to se s pinnutým `gemini-3-pro-preview` už stalo).

**Fallback Pro tieru je druhé Pro, nikdy flash.** `generateTextQuality` nejdřív tvrdě
retryuje top Pro na přechodných 503/429 a teprve pak klesá o tier — a i ten je
Pro-grade. Flash captions = špatné posty. Když jsou oba Pro tiery vyčerpané, cesta
buď deferuje (`QualityUnavailableError` v `utils/retry.ts`), nebo **zaloguje**, že
degradovala. Tichý propad na flash je přesně to, co produkt nikde nepřipouští.

Cross-family **judge** (kritik + šéfredaktor) běží na Claude (`judge` v `models.ts`),
protože pisatel a soudce nemají být z jedné rodiny — jinak model preferuje vlastní
výstup. Bez `ANTHROPIC_API_KEY` padá na Gemini `textPro`.

## Měření spotřeby

COGS produktu jsou tokeny, takže **každé volání modelu hlásí spotřebu**
(`instagram/usage-meter.ts`). Akumulátor je v `AsyncLocalStorage`, ne v modulové
proměnné — jedna lambda obsluhuje víc requestů a globální součet by míchal účtování
mezi tenanty stejně, jako to umí `setActiveProject()`.

- `withUsageScope()` obaluje celou generaci (v `autopilot.ts`), `currentUsage()` čte
  průběžný součet zevnitř, `logGeneration` ho ukládá do `ig_generation_log`
  (`prompt_tokens`, `output_tokens`, `thought_tokens`, `cached_tokens`, `model_calls`,
  `cost_usd`, `usage_breakdown`).
- **Video jde přes `recordUnits`**, ne přes tokeny — Veo se účtuje za vteřinu a
  operace nenese `usageMetadata`, takže by nejdražší médium vycházelo na nulu.
- `lib/model-pricing.ts` překládá spotřebu na dolary. **Neznámý model má cenu `null`,
  ne `0`** a ohlásí se; jeden neoceněný krok zneplatní součet celé generace. Vymyšlená
  nula vypadá v datech jako levný post — stejný důvod, proč `critic_score` loguje
  `null` místo ploché sedmičky. Sazby doplňuj **se zdrojem a datem**, nebo přes env
  `MODEL_PRICE_<MODEL>_IN/_OUT`.
- **Thinking budget** je politika per role v `models.ts` (`THINKING`/`getThinkingBudget`,
  env `GEMINI_THINK_<ROLE>`), ne číslo v call site. `-1` = dynamické, `0` = vypnuté.
  Pro tiery mají `-1` schválně — snižovat jim rozpočet bez měření je tichá degradace.

Hlídají to aserce §20 a `scripts/test-usage-meter.ts`.

## Zpětné vazby jsou posvátné

- Metriky postu → `propagateMetricsToSources()` píše `performance_score` na
  `ig_post_ideas` / `ig_reviews` / `ig_post_types` → vážená selekce při další generaci.
  **Každý nový zdroj obsahu potřebuje `performance_score` + váženou selekci**, jinak se
  smyčka na něm přetrhne.
- Skóre kritika z `ig_generation_log` se vrací do promptů (posledních 5) — filtrované
  nejdřív podle `post_type`, client-wide jako cold-start fallback.
- Formáty jsou kreativní brief: `PostTypeDef.description/structure/visualStyle` jdou
  do copywritera i do obou designérů přes `formatBrief`. Zdroj pravdy je definice
  v configu (`getPostTypeDef`); řádek v `ig_post_types` je jen kopie pro picker.
- `memory-agent.ts` učí vzorce do `ig_brand_memory`; `updateIGPostMetrics()` spouští
  propagaci i učení (fire & forget).
- Produktové nápady mají vlastní smyčku: `rateProductIdea` → `getWeightedProductIdeas(clientId, limit)`,
  které bere **clientId explicitně** (nepřidávej nové `getActiveProject()` volající).
