---
tags: [gtm]
updated: 2026-06-11
---

# 💰 Ceník & payment model

Postaveno na kreditovém systému v2 (`lib/subscription.ts`, `supabase/migrations/20260524_credit_model_v2.sql`) a Cost Modelu (`docs/SYSTEM_KNOWLEDGE_BASE.md` §10). Kurz ~23 Kč/USD [PŘEDPOKLAD, 22–24].

## Fakta z kódu (nevymyšlená)

| Položka | Hodnota | COGS |
|---|---|---|
| Image post | 1 kredit (plan post zdarma v rámci 30) | ~$0.10 ≈ **2,3 Kč** |
| Carousel 5 slidů | 1 kredit (kód nerozlišuje typ!) | ~$0.37 ≈ **8,5 Kč** |
| Reel 8 s | 1 kredit (kód nerozlišuje typ!) | ~$1.25 ≈ **29 Kč** ⚠️ |
| Produktová vizualizace / mockup | 2 kredity | ~$0.10–0.15 ≈ 2–4 Kč |
| Design pro tisk | 3 kredity | ~$0.15 ≈ 3,5 Kč |
| Business Brief | 5 kreditů | text-only, < 1 Kč |
| Extra kredit | prodej 15 Kč | — |
| Trial `trial_v2` | 0 Kč: 3 plné posty + 27 zamčených, bez expirace, jen akce `post` | 7 Kč (image) až 87 Kč (reels!) |
| Plán `chrlit` | 490 Kč/měs: 30 plan postů + 30 kreditů, `max_projects: 1` | viz marže |

## Marže plánu `chrlit` (490 Kč) podle chování uživatele

| Scénář | COGS | Hrubá marže |
|---|---|---|
| 20 image postů, pár extras (typický) | ~60 Kč | **~88 %** |
| 30 image postů + 30 kreditů na extra posty (maximalista) | ~138 Kč | **~72 %** |
| 30 carouselů | ~255 Kč | ~48 % |
| **30 reels** | **~863 Kč** | **−76 % — PRODĚLEK** |

**Závěr:** ceník je zdravý pro image/carousel, ale reel za 1 kredit je díra v lodi. Jeden video-nadšenec spálí marži pěti normálních zákazníků.

## Návrh plánů

### 1. Trial — „3 posty zdarma" (existuje, beze změny)
- 0 Kč, bez kreditky, bez časového limitu. 3 plné posty + 27 zamčených = uvidí, o co přichází (content-gating je prodejní mechanika, ne jen limit).
- **Doporučení:** v trialu negenerovat reels (COGS 87 Kč/trial při zneužití). Vyžaduje malou změnu — viz níže.
- CAC příspěvek: ~7 Kč na trial. Při konverzi 15 % vychází COGS akvizice ~47 Kč/zákazníka — skvělé.

### 2. Chrlit — 490 Kč/měs (existuje, beze změny ceny)
- 30 postů v ceně + 30 kreditů na extras, 1 projekt. Marže 72–88 % při image/carousel chování.
- Pro koho: beachhead z [[ICP]] — majitel, který chce „živý profil" bez práce.

### 3. Chrlit Agentura — 1 490 Kč/měs (NEEXISTUJE — nový plán, fáze 2)
- 3 projekty (`max_projects: 3`), 90 plan postů (30/projekt), 60 kreditů, plná analytika.
- Marže při image chování: COGS ~250–350 Kč → ~75–83 %.
- Pro koho: segment C z [[ICP]] (freelance SMM). Spouštět až po validaci beachheadu — vyžaduje změny v kódu (níže).
- Psychologie: 1 490 Kč za 3 klienty = 497 Kč/klient — freelancer to klientovi přefakturuje 3–5× a pořád je levnější než jeho ruční práce.

## Reels — tři možnosti, doporučuju (b)

a) Reels jen jako extra akce za **8 kreditů** (120 Kč výnos vs. 29 Kč COGS) — čistě kreditové řešení.
b) **Limit reels v plánu** (např. 4 reels/měs v ceně, další za 8 kreditů) — zachová „reels v ceně" jako marketing, omezí škodu na ~116 Kč COGS.
c) Reels úplně mimo plán, jen dokup — nejbezpečnější, ale oslabí nabídku.

## Trial mechanika & invite codes

- Registrace vyžaduje invite code (`app/register/actions.ts`), kódy mají `max_uses` a `used_count` → **každý kanál dostane vlastní kód** (vlna waitlistu, influencer, outreach) a konverze se měří per kód zadarmo, bez analytics nástroje. Viz [[Kanály]].
- Content-gated trial bez expirace je pro českého živnostníka ideální: žádný tlak „zbývají 3 dny", žádná kreditka předem. Urgenci vytváří **omezený počet invite kódů na vlnu**, ne časovač.
- Upgrade flow existuje: `upgradeTrialToPaid()` odemkne 27 zamčených postů — moment platby = okamžitá viditelná hodnota („zaplatil jsem a TADY je zbytek měsíce").

## Psychologie ceny pro českého živnostníka

- **Kotva:** agentura 10–25 k/měs, freelancer 500–1 500 Kč/post [PŘEDPOKLAD] → 490 Kč/měs = „méně než jeden post od freelancera". Tuhle větu říkat všude.
- 490 je pod psychologickou hranicí 500 — „stovky, ne tisíce". Drobný podnikatel to schválí sám sobě bez přemýšlení o cash flow.
- „Zrušit kdykoliv, bez závazku" — český SMB má hlubokou averzi k úvazkům (zkušenost s telco/energo smlouvami). Už je na landingu, držet.
- Comgate v CZK = žádná karta v USD, žádný Stripe v angličtině. Lokálnost je tichý trust signál.
- Extra kredity 15 Kč: neexpirují (říká landing) — držet, je to fér a snižuje to bariéru dokupu.

## Co by se muselo změnit v kódu

1. **Reels pricing/limit** — `ActionType` nemá `reel`; `canPerformAction` nerozlišuje typ postu. Přidat buď `reel` akci do `ACTION_CREDITS`, nebo `reel_limit` do `PlanFeatures` + kontrolu v `credit-guard.ts`. (Pro variantu b.)
2. **Trial bez reels** — gate na typ postu pro `trial_v2` (UI v GenerateTab + server check).
3. **Plán Agentura** — nový řádek v `subscription_plans` (seed migrace) **a hlavně**: `upgradeTrialToPaid()` v `lib/subscription.ts:503` má **hardcoded `plan_id: "chrlit"`** — musí brát plán jako parametr z payment flow. Ověřit i vynucování `max_projects` (zda se vůbec kontroluje při zakládání projektu).
4. **Carousel** — sjednotit landing (2 kredity) s kódem (1 kredit). Doporučuju nechat 1 kredit (marže 48 % je OK) a opravit landing — jednodušší message: „1 post = 1 kredit, ať je to cokoliv kromě videa".

Souvisí: [[Pozicování]] (kotvy), [[Metriky]] (sledování COGS/uživatele), [[00 GTM přehled]].
