---
name: campaigns-plans
description: >-
  Vícepříspěvkové kampaně a obsahové plány v Chrlit Studiu — durable server-side worker,
  drafty plánů, zásobník nápadů a produktové řady. Načti při práci s
  app/actions/campaign-actions.ts, content-plan-actions.ts, line-actions.ts,
  app/api/cron/campaign-worker/, instagram/plan-pipeline.ts, line-generator.ts,
  tabulkami ig_campaigns / ig_post_ideas / ig_product_lines, nebo když řešíš worker_lease,
  cursor, resume, dvojité účtování, schvalování draftu či kadenci plánu.
---

# Kampaně, plány a produktové řady

Hlídají to aserce **§12 a §19** v `test-beta-e2e.ts` plus
`scripts/test-schedule-planner.ts` a `scripts/test-product-lines.ts` (`npm run guard`).

## Dávka se negeneruje v prohlížeči

Ta smyčka umírala se zavřeným tabem („chtěl jsem 7, dostal 4"). Schválený plán se
proto ukládá jako řádek `ig_campaigns` (`startCampaign()`) a jednou za minutu ho
vyprazdňuje Vercel cron (`app/api/cron/campaign-worker`, `vercel.json`).

Co na tom drží trvanlivost:

- **Lease s nezávislým časovačem.** Worker si kampaň zabere přes `worker_lease`, který
  tluče **samostatný 60s interval** — `onProgress` fíruje jen mezi fázemi pipeline
  a jediná fáze (backoff `withQualityRetry` na přetíženém Pro modelu) umí mlčet déle
  než 5minutový lease. Druhý worker by pak živou kampaň ukradl. Interval **musí být
  zrušený na každé cestě ven** (`try/finally`) — zombie interval na recyklované Fluid
  instanci by prodlužoval lease uvolněné kampaně.
- **Cursor po každém bodu.** `ig_campaigns.cursor` se posouvá po každém postu, takže
  timeout nebo pád **navazuje z cursoru** na dalším ticku, ne od nuly.
- **`jobId` na řádku plánu už při založení jobu** (ne až při deferralu): kill uprostřed
  generování pak na dalším ticku job **znovu použije i s jeho platbou** místo druhého
  účtování. Zaparkovaný job, který je už `done`, se započítá a nikdy negeneruje znovu.
- **Účtování bez session.** Worker nemá přihlášeného uživatele, takže účtuje přes
  `clientId` primitiva (`canPerformAction`/`deductCredits`/`incrementPlanPostCount`/
  `refundJobCharge`), **ne** přes `creditGuard`/`requireProjectAccess`.
- Každý post nese `config.campaignId` na svém `ig_jobs` řádku. UI polluje
  `getCampaignStatus()` a po mountu se přes `localStorage` připojí zpět k běžící
  kampani — tab se může zavřít.

## Draft nemůže generovat ani účtovat

Náhled plánu se ukládá jako `ig_campaigns` se `status:'draft'`. Worker si bere jen
`pending|running`, takže draft **strukturálně nemůže** nic vygenerovat ani naúčtovat.

**Schválení je podmíněný claim:** `UPDATE … WHERE id=? AND client_id=? AND
status='draft'`. Je jednorázový, takže dvojklik se odmítne místo dvojího účtování —
a **nikdy nepřidávej insert fallback, když claim nevrátí řádek.** `savePlanDraft`/
`discardPlanDraft` jsou ze stejného důvodu omezené na status. Opuštěné drafty (>14 dní)
uklízí worker na idle ticku.

Tahle doktrína platí doslova i pro **produktové řady** (`approveLine`) a pro **doklady**
(`UNIQUE INDEX ON invoices(payment_id)`).

## Plán ↔ zásobník nápadů

`generateContentPlan` bere témata z `getWeightedIdeas` (model vrací `ideaIndex`,
v kódu se clampuje → `ContentPlanItem.ideaId`). `startCampaign` ověří vlastnictví
příchozích ideaIds a **vymyšlená schválená témata uloží zpět** do `ig_post_ideas` —
jen tam, worker při resume **nikdy nesmí insertovat**. Řádky plánu nesou `ideaId` →
worker → `generateOnePost({ideaId, topic})` = pravdivá atribuce.

**Náhled plánu je bez vedlejších efektů.** Jiný týdenní plánovač neexistuje:
`planWeekAction`/`content-planner.ts` byly odstraněné (účtovací díra — neúčtovaná
synchronní generace). CalendarTab „Naplánovat týden" otevírá kampaňový flow přes
`generateIntent`.

Strategický oblouk se ukládá do `options.strategySummary` a předává se **každému**
postu včetně prvního — jeho injektáž v `autopilot.ts` nesmí být gatovaná na
`previousPosts.length > 0`.

## Produkt patří k tomu, o čem post mluví

Hook jmenuje konkrétní produkt — a připojení produktu k postu dlouho řešilo úplně jiné
pravidlo (round-robin přes kampaňové produkty, cooldown v enginu). Ta dvě pravidla se
nepotkala, takže popisek mluvil o jednom produktu a vyrenderovala se fotka jiného.

Pořadí důkazů (`generateContentPlan`, stejně i `autopilot`):

1. **Text sám** — `matchProductInText()` (`lib/product-match.ts`) najde produkt jmenovaný
   v hooku/tématu. Popisek to jméno vysloví, takže tohle **nesmí nic přebít**. Párování je
   schválně přísné (musí sedět všechna obsahová slova) a stemuje kvůli české deklinaci.
2. **`productIndex`** — číslo ze **číslovaného** seznamu produktů v promptu, mapované zpátky
   na `ig_products.id` s clampem. Přesně jako `ideaIndex`; prompt bez seznamu (fill, revize)
   musí index **strippnout**, jinak ukazuje na seznam, který model nikdy neviděl.
3. **Round-robin** přes kampaňové produkty — až poslední instance a jen pro typy
   s `uses_product`.

Nový zdroj konceptů (fill, regenerace položky, jiný plánovač) musí projít stejným pořadím —
jinak se štítek produktu rozejde s textem. Hlídá `scripts/test-product-link.ts`.

## Hloubkový plán běží na Pro ladderu

`runPlanPipeline` (`instagram/plan-pipeline.ts`) = stratég → koncepty → cross-family
soudce → cílená revize, celé na `planner` ladderu (**nikdy flash**). UI polluje
`getPlanProgress(planRunId)`. Brief je objekt `PlanBriefOptions` (count, topic, `goal`,
`carouselShare`, `productIds`), ne poziční argumenty. Týdenní kadence
(`getPlanCadence`/`savePlanCadence`) řídí počet, odhad kreditů **i** rozprostření do
kalendáře (`lib/schedule-planner.ts`).

## Produktová řada je systém, ne štítek

`ig_product_lines`: každý řádek katalogu nese `line_step` (pozice v procesu),
`line_role` (co ten krok dělá) a `specs`. `instagram/line-generator.ts` řadu navrhuje
na **designer Pro ladderu** a `validateLine()` strukturu překontroluje v kódu —
souvislé kroky, žádná kolize s katalogem, žádná cenová klikatice (jeden sestup je
v pořádku; udržovací produkt legitimně stojí míň než ochranný krok).
