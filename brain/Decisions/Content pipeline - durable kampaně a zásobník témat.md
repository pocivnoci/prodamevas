---
tags: [decision, data-model, pipeline]
status: accepted
date: 2026-07-05
area: pipeline
---

# Content pipeline — durable kampaně a zásobník témat

> [!summary] Rozhodnutí
> Jedna soudržná smyčka: **zásobník témat → plán → kampaň → výkon**. Vícepostové kampaně běží jako **durable server-side job** (ne smyčka v prohlížeči) a témata kolují zpátky do zásobníku s pravdivou atribucí.

## Proč

Batch podle content-planu se dřív generoval smyčkou v tabu prohlížeče — když uživatel zavřel tab, smyčka umřela („chtěl 7, dostal 4"). Zároveň plán vymýšlel témata odnikud, takže se nedala poctivě přiřadit k nápadu ani se z výkonu učit. Potřebovali jsme jeden pipeline, který přežije zavřený prohlížeč a drží pravdivou linii **nápad → post → metrika**.

## Co jsme zavrhli

- **Browser-side smyčka** přes joby — umře se zavřeným tabem, žádná resumovatelnost.
- **`planWeekAction` / `content-planner.ts`** — synchronní generace bez účtování (billing leak); smazáno. „Naplánovat týden" v CalendarTab teď otevírá kampaňový flow (`generateIntent`).
- **Plán vymýšlí témata odnikud** — rozbíjí atribuci a feedback smyčku.

## Co z toho plyne (pravidla)

- Schválený plán = řádek `ig_campaigns` (`startCampaign`, `app/actions/campaign-actions.ts`). Cron `app/api/cron/campaign-worker` (1×/min) ho drénuje: claimne kampaň přes `worker_lease` (heartbeat přes `onProgress`), vygeneruje post v 800s budgetu jako `ig-run-job`, a **posune `cursor` po každém postu → timeout/crash resumuje od cursoru**.
- Worker **nemá user session** → účtuje přes clientId primitiva (`canPerformAction`/`deductCredits`/`incrementPlanPostCount`/`refundJobCharge`), **ne** `creditGuard`/`requireProjectAccess`.
- Plán čerpá témata z `getWeightedIdeas` (model vrací `ideaIndex` → clamp → `ContentPlanItem.ideaId`). `startCampaign` **ověří ownership ideaId** a **vymyšlená schválená témata uloží zpět do `ig_post_ideas`** (jen tady — worker na resume nikdy neinsertuje).
- Plán rows nesou `ideaId` → worker → `generateOnePost({ideaId, topic})` = pravdivá atribuce (koexistuje s pravidlem „explicitní topic přeskočí weighted selection").
- Preview plánu je **side-effect-free**. UI pollí `getCampaignStatus()` a po reloadu se napojí na běžící kampaň přes localStorage — tab může padnout.
- Migrace: `supabase/migrations/20260618_ig_campaigns.sql`.

## Odkazy

- [[2-step generation API]] — single-post cesta, na kterou to navazuje
- [[Nativní rendering - text i logo z Nano Banana Pro]]
- [[Roadmap]]
- [[Glossary]]
- [[CLAUDE]] — §Multi-post campaigns / Plan ↔ idea bank
- `app/actions/campaign-actions.ts`, `app/api/cron/campaign-worker`
