# Propojení modulů — průřezový audit (9/2026)

Šest paralelních průchodů kódem, každý po jiné ose: duplicity, učicí smyčky,
crony a workery, peníze, tenancy a vstupní body, glue (config / eventy / navigace).
Otázka byla vždy stejná: **co spolu na první pohled nesouvisí, ale souvisí — a kde
se výsledek jednoho modulu ztrácí dřív, než ho jiný stihne použít.**

Tenhle dokument je zápis: co se propojilo hned (sekce 2), co zbývá seřazené podle
dopadu (sekce 3) a matice signál × konzument, která to celé drží pohromadě
(sekce 4). Když si dokument a kód odporují, platí kód; aserce v `npm run guard`
(23.6b, 23.6c, 28.7, 31.11, 31.12, 34.8, 41.1) hlídají, aby se propojení zase
nerozpojila.

---

## 1. Hlavní zjištění (jedním odstavcem na osu)

**Učicí smyčky.** Smyčka *metriky → nápady / recenze / formáty → vážený výběr* je
uzavřená a dobře postavená. Skoro všechno ostatní bylo otevřené: systém sbíral pět
tříd kvalitního signálu o preferencích (úpravy uživatele, revize, A/B souboje,
skóre kritika, náklady) a spotřebovával sotva jednu. Tři ze čtyř největších
generačních rozhodnutí — **který produkt, jaký layout, co řekne první věta reelu** —
padala naslepo k datům, která ležela ve stejné tabulce nebo ve stejné funkci.

**Tenancy.** Čtyři cesty zapisovaly do tenanta zvoleného vstupem z prohlížeče jen po
ověření *přihlášení*: re-onboarding (`?reonboard=<cizí slug>` přepsal config cizí
značky), generování recenzí a nápadů, upload do sdíleného bucketu. Varování v CLAUDE.md
o `setActiveProject()` mířilo na špatný objekt — ten je dnes AsyncLocalStorage; skutečný
modulově globální stav byl `let CLIENT_CONFIG` v autopilotu.

**Workery.** Tři různé implementace lease (kampaně, agent tasky, resume jobů), reaper
jen jako vedlejší efekt pollingu z prohlížeče, `attempts` které se nezvedaly u pokusu,
co zabil lambdu (= neomezený účet za AI handler), šest prázdných `catch` na refundu,
a `ig-metrics-sync` běžící *po* obou reportech, které z něj čtou.

**Peníze.** Účtování kreditů je čisté (jedna tabulka vah, atomická rezervace, idempotentní
refund). Nákladová strana se měří, ale **nikdo v produktu ji nečte** — jediný čtenář
`cost_usd` byl CLI skript. Spadlé a zaparkované generace (nejdražší běhy) se nezapisovaly
vůbec, embeddingy se neměřily, `revisePost` běžel mimo jakýkoli měřič.

**Glue.** Sedm e-mailových šablon posílalo na `#subscription` / `#billing`, což nejsou
sekce — dunningový e-mail vedl na přehled. Deep link nesl UUID tam, kde se validoval slug.
`useStudioNavigate` v nejběžnějším volání nepřepínal route. Event bus měl 4 emitery,
1 subscriber a 0 čtenářů tabulky `domain_events`.

**Duplicity.** 19 souběžných implementací téhož: QA žebřík ve čtyřech orchestrátorech
(~180 řádků 3× verbatim), 18 parserů JSON z modelu ve čtyřech dialektech, 13 ručně
skládaných bloků hlasu značky se čtyřmi politikami zkracování, 11 kopií brány cronu,
9 `fetchWithTimeout`, 5 slugifikátorů se čtyřmi různými stropy délky.

---

## 2. Co se propojilo (hotovo, v gitu)

| Propojení | Odkud → kam | Proč to nebylo vidět |
|---|---|---|
| Brand memory → scenárista reelů | `autopilot.ts` (blok pro copywritera) → `reel-scriptwriter.ts` `memorySection` | Scénář narraci copywritera *nahrazuje*, takže naučené vzory u reelů zmizely |
| Metriky → produkty | `propagateMetricsToSources` → `ig_products.performance_score` → vážený výběr v `autopilot.ts` (migrace `20260912_product_performance.sql`) | Poslední zdroj obsahu bez zpětné vazby; vybíral se náhodně ze tří |
| Zhlédnutí → analyzátor paměti | `metrics-sync` už posílal `views`, `analyzeAndLearn` je neuměl přijmout | Bez míry engagementu na zhlédnutí se štěstí distribuce zapisovalo jako vzor hooku |
| Úprava obrazu → vizuální paměť | `post-edit-actions.ts` → `upsertMemory(visual, 0.3)` | `learnFromRevision` porovnává text; nejčastější retuš se neučila |
| Rozhodnuté A/B souboje → preference | `lib/events/subscribers.ts` (`metrics.updated`) → `buildDuels` → `learnFromVariantSelection` | Věta „Chrlit s tím počítá" v UI nebyla pravda; učilo se jen z lidského tipu před publikací |
| Naměřený čas publikace → plánovač | `measuredTimeSlots` + `igBaseline.bestPostingTimes` → `resolvePostingTimes` → `calendar-actions`, `auto-publish` | Plánovač četl `config.postingTimes`, které nikdo nezapisoval; každá značka jela 09/17/19 |
| Pravidla značky → tisk | `print-pipeline.ts` čte i `preference` / `avoid` | Tisk četl jen `visual` |
| Živý katalog → šéfredaktor plánu | `editorial-board.ts` dostává `getCatalogProducts` | Poslední čtenář zmraženého `config.products` v enginu |
| Reaper jobů → cron | `lib/job-reaper.ts`, sweep v `/api/cron/job-resume` | Reaper žil jen v pollingu z prohlížeče; job bez otevřeného tabu visel se strženým kreditem |
| Spotřeba spadlé generace → `ai_spend` | `generateOnePost` `finally` → `post_partial` | Nejdražší běhy (zaparkované reely) byly v datech nejlevnější |
| Embeddingy → měřič | `gemini-client.ts` `embedTexts` → `recordUsage` | Sazby existovaly, měřič se nevolal |
| `revisePost` → měřič | `variant-actions.ts` → `trackSpend("post_revise")` | Celá pipeline za paušál bez měření |
| Refund platby → kredity / schůzka | `admin-actions.ts` `refundPayment` | Peníze zpět, kredity a schůzka zůstaly |
| COGS + kvalita → týdenní report | `weekly-report.ts` čte `cost_usd`, `critic_score`, `qa_status` | Tržby bez nákladů; propad skóre kritika neměl detektor |
| Deep linky → existující sekce | šablony → `#settings`; `?project=` umí slug i UUID; `studioDeepLink` typovaný `StudioSection` | Dunning a lifecycle e-maily vedly na dashboard |
| Cron brána → jedno místo | `lib/cron-auth.ts` (`timingSafeEqual`) | 11 kopií, jediné porovnání tajemství přes `!==` |
| Pořadí denních cronů | token-refresh 03:30 → metrics 04:15 → billing 04:00 → growth 05:00 → daily-ops 05:30 → weekly 06:00 | Metriky přicházely 07:00, po obou reportech |
| Tenant → brána | `saveReviewedConfig`, `trigger*Generation`, `uploadCustomImage`, `learnFromVariantSelection`, `markIdeaAsUsed`, `schedulePost`, `getIGPostTypes` | Přihlášení stačilo k zápisu do cizí značky |
| Config tenanta → návratová hodnota | `ensureConfig` vrací `{ clientUuid, config }` | `let CLIENT_CONFIG` sdílený lambdou křížil tenanty po `await` |
| Ceník → nápověda | `ACTION_CREDITS`, `mediaCreditsSentence` v client-safe `lib/credits.ts` | FAQ a hint nesly čísla opsaná ručně (dlouhý reel chyběl) |

Plus: guard běží bez `.env.local` (admin klient se staví líně), `attempts` se zvedají i při
reclaimu prošlé lease, heartbeat kampaně jen u `status=running`, nepřipojený Instagram je
pro publisher přechodný stav, kontinuita kampaně se filtruje v SQL, učení z revize má
hlasitý `catch`, admin týden počítá dny v Praze.

---

## 3. Co zbývá — seřazeno podle (dopad × jistota) / náklad

Velikost: **S** ≈ půl dne, **M** ≈ 1–2 dny, **L** ≈ 3+.

### Stabilita a peníze

1. **Jeden lease helper pro všechny workery — M.** `campaign-worker/route.ts:68-78`,
   `lib/agent-runner.ts:129-139`, `job-resume/route.ts` (claim přes `retry_after`),
   `ig-publisher` (claim bez lease). `lib/worker-lease.ts` s `claimOne` + `startHeartbeat`
   (filtr `status=running` zapečený uvnitř). Heartbeat kampaně je opravený, zbytek je
   duplicita, která se rozejde znovu.
2. **`dedupeKey` na každém `requestAction` dispatchi — M.** `lib/agent-safety.ts:118-123`
   enqueuuje bez klíče; `task_triage` se dispatchuje ze dvou rout a `triageTasks`
   (`lib/tasks/triage.ts:78-85`) je read-then-write — dva souběžné běhy platí model za tytéž
   řádky. Klíč `${taskType}:${clientId ?? "global"}:${den}`, v triage nejdřív `spec_at` claim.
3. **Reaper i pro `ig_posts` ve stavu `posting` a `ig_product_designs` `running` — S/M.**
   Nic je nedetekuje. Pozor: post zaseklý v `posting` mohl být publikovaný (selhal až
   terminální zápis) — reset na `scheduled` by publikoval dvakrát; správně je označit
   `failed` s důvodem a nechat incident-watch říct zákazníkovi.
4. **Per-tenant crony do agentového fan-outu — M.** `ig-metrics-sync`, `growth-snapshot`,
   `ig-token-refresh` iterují všechny tenanty sekvenčně bez rotace a bez `truncated`
   příznaku; `lib/agents/client-sweep.ts` vznikl přesně proti tomu. Nad ~25 připojených
   tenantů odnesou strop lambdy vždy titíž na konci.
5. **`growth-snapshot` idempotentně — S.** Holý INSERT bez unikátního indexu
   `(client_id, týden)` — opakovaný běh vyrobí plochý týden v grafu.
6. **Token bez `token_expires_at` se nikdy neobnoví — S.** `ig-token-refresh/route.ts:24`
   filtruje `.lt(...)`, NULL neprojde; callback takový řádek zakládá, když Meta
   `expires_in` nepošle. `.or("token_expires_at.is.null,…")`.
7. **OAuth `state` je podepsaný, ne jednorázový — S.** `lib/ig-oauth-state.ts` nonce
   nikde nespálí; zachycený state je 10 minut přehratelný. Krátký řádek s nonce.
8. **Marže a útrata v health-checku — M.** `lib/agents/health-check.ts` hlídá testovací
   Stripe klíče a prodávané formáty, ale ne COGS na klienta ani skok útraty proti mediánu.
   Ingredience jsou v `ai_spend` + `payments` + `USD_TO_CZK`; arithmetika v
   `scripts/spend-report.ts:118-165`. Návrh C10 v `docs/ADMIN_NAVRHY_2026-09.md`.
9. **`refundJobCharge` pro plánový post není idempotentní — S.** `decrementPlanPostCount`
   je read-modify-write bez `reference_id`; dva refundy téhož jobu dají post zdarma.
10. **Anthropic cache tokeny se odečítají dvakrát — S (spící).** `anthropic-client.ts`
    mapuje `input_tokens` (už bez cache) na `promptTokenCount`, `model-pricing.ts:243`
    pak `fresh = prompt − cached`. Opravit před zapnutím `cache_control`.
11. **Kill-switch → účtované médium na jednom místě — S.** `format-clamps.ts` je kanonický,
    mirroruje se ručně v `ig-create-job`, `campaign-worker`, `variant-actions`,
    `content-plan-actions`; `campaign-actions.ts:79` odhad ignoruje clamp a falešně odmítá
    kampaň, na kterou zákazník má.

### Učicí smyčky (zdarma, bez nových volání AI)

12. **Váha layout archetypů podle výkonu — M.** `image-pipeline.ts:372-381` má jen
    anti-repeat; `lib/hook-patterns.ts` (`hookPatternStats` / `hookPatternWeights`) je
    generický a ověřený na reelech. 16 archetypů × značka, které sedí 4 = 75 % renderů
    mimo styl.
13. **Skóre judge plánu jako prior nápadu — M (migrace).** `plan-pipeline.ts:277` platí
    Claude judge za každý hook, `campaign-actions.ts:140-190` skóre zahodí; judged-8 téma
    vstupuje do zásobníku se stejnou vahou jako judged-3. `ig_post_ideas.prior_score` +
    exploration tickets podle něj.
14. **Kritikovy poznámky → scenárista reelů — S.** Blok last-5 keep/fix se staví v
    `autopilot.ts` ~250 řádků nad voláním scenáristy; paměť už jde, poznámky ještě ne.
15. **Redakce čte brand memory — S.** `editorial-board.ts` `reviewPost` nevidí
    `preference`/`avoid` — šéfredaktor umí „opravit" caption zpět do vzoru, který klient
    odmítl.
16. **Konzultační brief z výkonu, ne z pěti posledních captionů — M.**
    `lib/agents/consultation-brief.ts:68-76`: řadit podle `engagementScore`, přidat
    `getBrandMemories(5)` a rozhodnuté duely. Placený artefakt bez jediného čísla.
17. **`learnFromVariantSelection` ignoruje vizuál — S.** Selectuje `image_prompt`,
    porovnává jen text, píše jen `preference`. Druhý `upsertMemory(visual)`.
18. **Persona / `ctaStyle` psychologa se neměří — S (migrace).** Vybírá se per post,
    nikde se neukládá, efekt je z principu neměřitelný.

### Glue a UI

19. **Settings ukládá celý config → klobása souběžných zápisů — M.** `SettingsTab.tsx:77`
    posílá celý objekt; `confirmFact`, `savePlanCadence`, `brand-images` delete/retag,
    `voice-examples` promotion a `autoPublish` toggle (sousední komponenta!) se při Uložit
    tiše vrátí. Dirty-set + `patch_client_config(jsonb_set)` RPC jako u `append_brand_image`.
20. **Dva `updateClientConfig` — S.** `settings-actions.ts:60` je plný přepis bez
    `reconcileFormats`; jediný volající je JSON editor na `/dashboard/settings`. Smazat
    nebo přesměrovat na `config-actions`.
21. **Event bus rozhodnout — S.** Buď `lib/events.ts` sám importuje subscribery a
    `subscription.cancelled/resumed/gifted` dostanou potvrzovací e-mail (šablony pro
    nedobrovolné události existují, pro dobrovolné ne — chargeback risk), nebo bus smazat
    a `metrics-sync` volá obě funkce přímo.
22. **„IG token brzy vyprší" ≠ „odpojený" — S.** `client-health.ts:182` slučuje obojí do
    `ig_disconnected` (outbound, čeká na schválení) — zákazník s funkčním tokenem dostane
    „připojte znovu", nebo nic.
23. **Otázka od AI viditelná jen adminovi — S/M.** Badge i tab jsou `isAdmin`; klientsky
    vázaná otázka blokuje úkol navždy. `question_pending` transakční notice.
24. **`industry`, `city`, `brandVoiceExamples`, `autoReplenishIdeas` bez UI — S.**
    `industry` řídí přísnost fact gate, vizuální profil i casting hlasu, a přepsat ho
    umí jen skript.
25. **`postingTimes` — S.** Teď je čtvrtá priorita v `resolvePostingTimes`, ale pořád
    bez zapisovatele. Buď pole v Nastavení vedle kadence, nebo smazat z typu.

### Duplicity (v pořadí, ve kterém se vyplatí)

26. **`ladder(action)` v `instagram/models.ts` — S.** 16 míst skládá
    `[getModel(x), fallback]` ručně; `editorialLadder()` a `printLadder()` jsou táž funkce.
27. **`parseModelJson()` — S/M.** 18 míst, 4 dialekty stripování ```json; jen jeden
    přežije prózu kolem, jen jeden neuzavřený fence. Fixture per dialekt, pak jeden parser
    v `instagram/gemini-client.ts`.
28. **`BUCKETS` + `clientBucket(slug)` v `lib/storage-buckets.ts` — S.** `"audit-screenshots"`
    17× jako literál, `SettingsTab.tsx:1836` má zapečené celé projektové URL.
29. **`fetchWithTimeout` + `USER_AGENT` + SSRF guard defaultně — S/M.** 9 kopií;
    `assertFetchableUrl` z `lib/product-url.ts` chybí u fetchů uživatelských URL
    v `app/onboarding/core.ts` a `config-actions.ts`.
30. **`buildBrandVoiceSection(config, depth)` — M.** 13 ručních bloků se 4 politikami
    zkracování persony (200/300/600/700 znaků). Nejdřív „stejné stringy, jedna funkce".
31. **QA žebřík orchestrátorů — M/L.** 4 kopie, už divergované (image má fresh-regen navíc,
    reel nemá severe větev, `MAX_CORRECTIVE_EDITS` 2/3/—). Poslední, s testy.
32. **Signované tokeny — S.** `ig-oauth-state.ts` a `ig-connect-handoff.ts` jsou z 90 %
    tentýž soubor; `lib/signed-token.ts`, drátový formát beze změny.
33. **Slugifikace — S.** 5 kopií se stropy 30/40/60/∞; orchestrátory navíc bez NFD foldu
    (`"příběh"` → `"p-b-h"` v `ig_posts.image_style`). Stropy zachovat per volající.

---

## 4. Matice signál × konzument (stav po tomhle auditu)

Sloupce: **CW** copywriter · **RS** scenárista reelů · **AD** art director · **EB** redakce ·
**PLAN** plán · **PROD** výběr produktu · **SCHED** plánovač času · **PRINT** tisk ·
**REP** týdenní report / brief.

| Signál | CW | RS | AD | EB | PLAN | PROD | SCHED | PRINT | REP |
|---|---|---|---|---|---|---|---|---|---|
| engagement (likes/comments/saves) | ✅ | ✅ | ➖ | ❌ | ✅ | **✅ nově** | **✅ nově** | ❌ | ❌ |
| zhlédnutí / dosah | **✅ nově** (přes paměť) | — | — | — | ❌ | — | — | — | ❌ |
| `performance_score` nápadů / recenzí / formátů | — | — | — | — | ✅ | — | — | — | ❌ |
| `performance_score` produktů | — | — | — | — | ❌ | **✅ nově** | — | ❌ | — |
| kritik keep/fix (last-5) | ✅ | ❌ (#14) | ❌ | ✅ | ❌ | — | — | ❌ | **✅ nově** (průměr) |
| brand memory pattern/preference/avoid | ✅ | **✅ nově** | — | ❌ (#15) | ✅ | — | — | **✅ nově** | — |
| brand memory visual | — | — | ✅ | — | — | — | — | ✅ | — |
| úprava obrazu (`edit_history`) | — | — | **✅ nově** | — | — | — | — | — | — |
| revize textu (`feedback`) | ✅ | — | — | — | — | — | — | — | — |
| A/B souboj (naměřený vítěz) | **✅ nově** | — | ❌ (#17) | — | — | — | — | — | — |
| layout archetyp × výkon | — | — | ❌ (#12) | — | — | — | — | ❌ | — |
| judge skóre plánu | — | — | — | — | ❌ (#13) | — | — | — | — |
| naměřený čas publikace | — | — | — | — | — | — | **✅ nově** | — | — |
| `cost_usd` / `ai_spend` | — | — | — | — | — | — | — | — | **✅ nově** |
| `qa_status` | — | — | ❌ | — | — | — | — | — | **✅ nově** |
| `consistency_score` | ❌ | — | — | — | — | — | — | — | ✅ (jen průměr) |

Dead data, která pořád nikdo nečte: `ig_generation_log.angle`, `usage_breakdown` (per-krok
náklady), `ig_product_lines.performance_score` (nikdy zapsáno), `ig_posts.feedback` po
synchronním učení, `igBaseline.avgEngagementRate` (nikde „porážíme vlastní baseline?"),
`ig_product_designs.rating = -1`, historie zamítnutí `agent_actions` (rate per druh nikdy
nedojde do `agent-policy`), smazané drafty plánů (hard delete bez stopy).

---

## 5. Jak číst tenhle dokument za půl roku

- Tabulka v sekci 2 říká, **proč** vazba vznikla — když ji někdo bude chtít rozpojit,
  ať ví, co tím otevře.
- Sekce 3 je backlog, ne slib. Pořadí je podle dopadu a jistoty; velikosti jsou odhad
  ze čtení kódu, ne z měření.
- Sekce 4 je jediný obrázek, který má cenu udržovat: nový signál bez konzumenta a nový
  konzument bez signálu jsou přesně ty chyby, které se v kódu nedají vidět, protože
  každý modul zvlášť je v pořádku.
