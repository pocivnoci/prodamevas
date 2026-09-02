# Technické due diligence — stav projektu Chrlit Studio

**Datum auditu:** 2. 9. 2026
**Předmět:** repozitář `pocivnoci/prodamevas`, větev `feat/nabidkovy-email`, HEAD `fe5225b4`
**Metoda:** statická analýza kódu, migrací, konfigurace a git historie (6 615 objektů, 545 commitů).
Aplikace nebyla spuštěna proti produkční databázi; tvrzení o produkčním prostředí jsou
označena jako **neověřeno**.

**Zadavatelem dodaný kontext (nebyl ověřován):** nula platících zákazníků, aplikace není
plně spuštěná, billing se překlápí z Comgate na Stripe, publikování na Instagram jde přes
třetí stranu za ~60 USD / 25 klientů měsíčně, repozitář byl dlouho veřejný.

---

## Shrnutí pro netrpělivého čtenáře

Projekt je **výrazně dál, než je u jednočlenného předlaunchového produktu obvyklé**.
75 000 řádků TypeScriptu, 60 migrací, 10 cronů, vlastní testovací sada s ~425 asercemi,
která prochází. `npm run build` i `npm run guard` jsou zelené. Kvalita kódu v platební
vrstvě je nadprůměrná — podmíněné claimy, idempotence, oddělené adaptéry bran.

Tři věci ale brání tomu vzít zítra peníze od cizího člověka:

1. **Stripe běží na testovacích klíčích** (`sk_test`) a přepínač bran stále volí Comgate.
2. **V git historii je reálný Meta access token** z doby, kdy byl repozitář veřejný.
3. **Chybí cookie lišta, ačkoli aplikace nasazuje Google Analytics** se souhlasem
   natvrdo nastaveným na „granted" — a zásady ochrany údajů tvrdí pravý opak.

Odhad do stavu „můžu brát peníze": **8–12 člověkodnů** vlastní práce plus externí lhůty.
Do stavu „obsloužím 100 zákazníků": **35–50 člověkodnů** a jedna nejistá externí závislost.

---

## 1. Skutečný stav funkcí

Označení: **HOTOVO** = nasazené, ošetřené chyby · **ROZDĚLANÉ** = kód existuje, ale chybí
ošetření, ověření nebo je to za přepínačem · **NEEXISTUJE**.

### Jádro platformy

| Funkce | Stav | Důkaz |
|---|---|---|
| Autentizace + Google OAuth | HOTOVO | `middleware.ts:70–95`, `GOOGLE_AUTH_ENABLED=1` |
| Brána bety (invite kód) | HOTOVO | `lib/beta-access.ts`, `middleware.ts:84–95`, tabulka `invite_codes` |
| Multi-tenancy v aplikační vrstvě | HOTOVO | `lib/auth-guard.ts`, 149 ze 158 server actions má guard |
| Multi-tenancy v databázi (RLS) | ROZDĚLANÉ | viz §5 — 3 tabulky mají `USING (true)`, 2 nemají RLS vůbec |
| Build / typecheck | HOTOVO | `npm run build` prochází (ověřeno 2. 9. 2026) |
| Statické aserce invariantů | HOTOVO | `npm run guard` — ~425 asercí, 0 selhání |
| Sentry monitoring | HOTOVO | `instrumentation.ts`, `instrumentation-client.ts` |
| Automatizované testy (unit/integrační) | NEEXISTUJE | framework není; `package.json:8` — jen `tsx` skripty se statickými asercemi |

### Platby a předplatné

| Funkce | Stav | Důkaz |
|---|---|---|
| Comgate — jednorázová platba | HOTOVO | `lib/comgate.ts`, `app/api/payments/callback/route.ts:50` (serverové ověření stavu) |
| Comgate — automatické obnovy | ROZDĚLANÉ | `lib/comgate.ts:90` — vyžaduje `COMGATE_RECURRING=1`, není nastaveno |
| Stripe — checkout (hostovaný i vestavěný) | HOTOVO | `lib/payments/checkout.ts:140–230` |
| Stripe — režim `subscription` | HOTOVO | `lib/payments/checkout.ts:167` — `mode: "subscription"` + `interval_count` |
| Stripe — webhook, 4 události | HOTOVO | `app/api/payments/stripe/webhook/route.ts` |
| Stripe — ostrý provoz | ROZDĚLANÉ | klíč začíná `sk_test` → sandbox; `activeGateway()` volí Comgate |
| Sdílené jádro po platbě | HOTOVO | `lib/payments/on-paid.ts` — jedna cesta pro obě brány |
| Dunning + grace okno | HOTOVO | `lib/payments/on-paid.ts:600–640`, `app/api/cron/billing-worker/route.ts` |
| Daňové doklady (Fakturoid) | HOTOVO | `lib/invoicing.ts`, idempotence přes `UNIQUE(payment_id)` |
| Refundace — stav v DB | HOTOVO | `app/actions/admin-actions.ts:728` |
| Refundace — pohyb peněz | NEEXISTUJE | ruční krok v portálu, vědomé rozhodnutí (`admin-actions.ts:709–712`) |
| Změna tarifu (upgrade/downgrade) | NEEXISTUJE | v `app/actions/billing-actions.ts` není; jen `upgradeTrialToPaid` |
| Stripe Customer Portal | NEEXISTUJE | žádný výskyt `billingPortal` v repozitáři |
| Výpověď předplatného | HOTOVO | `app/actions/billing-actions.ts:220+`, propisuje se i do Stripu |
| Dobití kreditů | HOTOVO | `lib/payments/on-paid.ts:95–130`, idempotence přes unikátní index |

### AI engine

| Funkce | Stav | Důkaz |
|---|---|---|
| Generování příspěvku (text) | HOTOVO | `instagram/autopilot.ts`, `caption-generator.ts` |
| Kritik + editorial board | HOTOVO | `instagram/judge.ts`, `editorial-board.ts` |
| Claude judge (cross-family) | HOTOVO | `instagram/anthropic-client.ts:32`, `ANTHROPIC_API_KEY` je nastaven |
| Render obrázků a karuselů | HOTOVO | `instagram/image-pipeline.ts`, `orchestrators/` |
| Stories | ROZDĚLANÉ | za `STORIES_ENABLED`; hodnota v prostředí nečitelná |
| Reels | ROZDĚLANÉ | `REELS_ENABLED=1`, ale `publishNowAction` je odmítá (`calendar-actions.ts:190`) |
| Best-of-2 pipeline (v7.0) | ROZDĚLANÉ | `instagram/autopilot.ts:913` — vyžaduje `PIPELINE_BESTOF2=1`, není nastaveno |
| Měření útraty za modely | ROZDĚLANÉ | `ai_spend` tabulka existuje, ale pokrývá jen část cest — viz §4 |
| Zpětnovazební smyčka (metriky) | ROZDĚLANÉ | `app/api/cron/ig-metrics-sync`, omezeno Standard Access |

### Publikování

| Funkce | Stav | Důkaz |
|---|---|---|
| Publikování přes upload-post | HOTOVO | `lib/channels/uploadpost.ts`, `app/api/cron/ig-publisher/route.ts` |
| Publikování přes vlastní Meta app | ROZDĚLANÉ | kód hotov (`lib/channels/instagram.ts`), chybí App Review |
| Retry + backoff při selhání | HOTOVO | `ig-publisher/route.ts:91–117`, `MAX_ATTEMPTS = 4` |
| Rozlišení trvalé vs. přechodné chyby | HOTOVO | `ig-publisher/route.ts:110–117`, `ChannelPermanentError` |
| Oznámení zákazníkovi o selhání | HOTOVO | `lib/agents/incident-watch.ts:80`, `customer-notices.ts:175` |
| Šifrování IG tokenů | HOTOVO | `lib/ig-token-crypto.ts` — AES-256-GCM, `IG_TOKEN_ENCRYPTION_KEY` |
| Strop 2 profilů (Free tier) | ROZDĚLANÉ | `scripts/spike-uploadpost.ts:4`; v našem kódu **není žádná kontrola stropu** |

### Právní a provozní

| Funkce | Stav | Důkaz |
|---|---|---|
| Obchodní podmínky | HOTOVO | `app/terms/page.tsx` — 18 článků vč. odstoupení a ADR |
| Zásady zpracování osobních údajů | HOTOVO | `app/privacy/page.tsx`; seznam 10 zpracovatelů v `lib/legal.ts:172` |
| Cookie lišta s opt-in | NEEXISTUJE | žádná komponenta; `components/GoogleAnalytics.tsx:22` nastavuje souhlas natvrdo |
| Zpracovatelská smlouva (DPA) | NEEXISTUJE | žádný dokument v repozitáři |
| Právní identita na dokladech | HOTOVO | `lib/legal.ts`, ověřeno skriptem `check-legal-identity.ts` |
| Meta Data Deletion callback | HOTOVO | `app/api/data-deletion/route.ts` — ověřuje `signed_request` |

---

## 2. Stav migrace na Stripe

### Co je hotové

Stripe je implementovaný **v celém životním cyklu**, ne jen jako pokladna:

- **Checkout** — hostovaný i vestavěný (`ui_mode: "embedded_page"`), `lib/payments/checkout.ts:140`.
  Vestavěná varianta má i proxy ověřovacího souboru pro Apple Pay (`app/api/apple-pay-domain/route.ts`).
- **Předplatné, ne jednorázovka** — `mode: "subscription"` s `interval_count` pro 3/6/12 měsíců
  (`checkout.ts:167`). Metadata se ukládají i na samotné předplatné, takže druhá faktura ví,
  komu patří (`checkout.ts:190–195`).
- **Webhook** — ověřuje podpis nad syrovým tělem, obsluhuje `checkout.session.completed`,
  `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`
  (`app/api/payments/stripe/webhook/route.ts`).
- **Idempotence** — podmíněný claim `WHERE provider='stripe' AND provider_ref=? AND status NOT IN (PAID, REFUNDED)`
  ve sdíleném jádře (`lib/payments/on-paid.ts:441–465`). Replay webhooku plán neaktivuje podruhé.
- **Ochrana proti dvojímu účtování** — `billing-worker` Stripe předplatná přeskakuje
  (`billing-worker/route.ts:104`), první faktura (`billing_reason = subscription_create`)
  se ve webhooku ignoruje, protože ji řeší Session (`webhook/route.ts:151`).
- **Storno** — propisuje se oběma směry (`lib/payments/stripe-billing.ts:60`).
- **Dunning** — vlastní čítač `billing_failures` + oznámení zákazníkovi (`on-paid.ts:600`).

Kvalita téhle vrstvy je vysoká. Komentáře dokumentují **proč**, ne co, a několik z nich
popisuje reálné incidenty (např. `checkout.ts:38–43` — nález z 11. 8. 2026, kdy výběr brány
tiše směroval platby na bránu bez webhooku).

### Co chybí k tomu, aby si zákazník sám koupil a příští měsíc se mu strhlo

| # | Co | Odhad | Kdo |
|---|---|---|---|
| 1 | **Ostré Stripe klíče.** Dnes `sk_test` → žádné reálné peníze. | 0,5 d | sám |
| 2 | **Přepnout bránu.** `activeGateway()` (`checkout.ts:52–59`) volí Comgate, dokud existují `COMGATE_MERCHANT_ID` + `COMGATE_SECRET`. Nutno nastavit `PAYMENT_GATEWAY=stripe` nebo Comgate creds odstranit. | 0,25 d | sám |
| 3 | **Webhook endpoint v ostrém režimu** + `STRIPE_WEBHOOK_SECRET` pro live. Bez něj `stripeCanCompletePayment()` vrátí false a brána se nepoužije. | 0,25 d | sám |
| 4 | **E2E test skutečnou kartou** — platba → aktivace → doklad → obnova. | 0,5 d | sám |
| 5 | **Oprava dvojího účtování při změně tarifu** (viz níže). | 0,5 d | sám |

**Celkem 2 člověkodny vlastní práce.** Kritická cesta je aktivace Stripe účtu pro ostrý
provoz (externí lhůta, dny).

### 🔴 Nalezená vada: změna tarifu vyrobí dvě živá Stripe předplatná

`activatePaidPlan()` (`lib/subscription.ts:880–886`) při změně tarifu zruší **v naší
databázi** všechna ostatní předplatná klienta. U Stripu ale odpovídající předplatné
**neruší** — `expireStripeSubscription()` se volá jen z webhooku na
`customer.subscription.deleted`, `setStripeCancelAtPeriodEnd()` jen z výpovědi.

Důsledek: zákazník na Startu si koupí Dominanci → v naší DB zůstane jedno předplatné,
u Stripu běží **dvě** a fakturují se **obě**. První stížnost přijde třicátý den.

Oprava: v `activatePaidPlan` (nebo v jádře po claimu) zrušit staré Stripe předplatné
u brány. ~0,5 dne.

### Mrtvý kód po Comgate

Odstranitelné, ale **ne bezpodmínečně** — pozor na dvě závislosti:

| Soubor | Řádků | Poznámka |
|---|---|---|
| `lib/comgate.ts` | 265 | ✅ **Vyřešeno 2. 9. 2026.** `generateRefId` už bydlel v `lib/payments/ref-id.ts` a `comgate.ts` ho jen re-exportoval; `checkout.ts:16` teď importuje přímo odtud. Poslední vazba je **jen typová** (`ComgateStatusResponse` v reconcileru), a ta se při buildu zahodí. |
| `app/api/payments/create/route.ts` | 268 | Comgate větev; Stripe má vlastní `/stripe/create` |
| `app/api/payments/callback/route.ts` | 82 | Comgate callback |
| `app/api/payments/return/route.ts` | 39 | Comgate návratová stránka |
| `app/mock-payment/page.tsx` | 137 | Mock pokladna (`COMGATE_MOCK=true`) |
| `lib/agents/payment-reconcile.ts` | 161 | Importuje **jen typ** `ComgateStatusResponse` (mizí při buildu). Reconciler zaseklých plateb má smysl i pro Stripe — přepsat, ne smazat. |
| `app/api/cron/billing-worker/route.ts` | ~150 z 294 | Kroky 2–5 (stržení tokenem) jsou po Stripu zbytečné; krok 0 (posun kreditových oken) a krok 6 (oznámení dopředu) musí zůstat. |

**Celkem ~950 řádků k odstranění**, z toho ~430 vyžaduje předchozí refaktor.

Databáze: sloupce `payments.comgate_trans_id` a `payments.comgate_response`
**nemazat** — druhý z nich se záměrně používá i pro syrovou odpověď Stripu
(`on-paid.ts:451–453`). Jméno lže, obsah ne.

Env proměnné k odstranění: `COMGATE_MERCHANT_ID`, `COMGATE_SECRET`, `COMGATE_MOCK`,
`COMGATE_TEST`, `COMGATE_RECURRING`.

### Napojení kreditů na Stripe

Kredity **nejsou** navázané na Stripe objekt. Napojení je nepřímé a je správně:

- Období předplatného píše `activatePaidPlan()` z naší strany po `invoice.paid`.
- Kreditové okno je **vždy měsíční**, i u ročního tarifu, a posouvá ho vlastní krok
  cronu (`billing-worker/route.ts:66`, `rollLapsedCreditWindows`). To je dobrý návrh:
  jedna platba, dvanáct resetů.
- Kotva okna je `current_period_start`, ne poslední zapsané okno — brání to posunu
  u zákazníka, který platil 31. (`lib/subscription.ts:360–375`).

**Při neúspěšné platbě:** čítač `billing_failures` roste, zákazník dostane oznámení,
předplatné zůstává použitelné po dobu `BILLING_GRACE_DAYS` (`getClientSubscription`,
`subscription.ts:294–305`). Po vyčerpání dunningu se persistuje `expired` a
`canPerformAction` akce zablokuje. **Kredity se nezabavují** — okno se prostě přestane
posouvat. To je konzistentní a obhajitelné.

**Při downgradu:** `activatePaidPlan` nastaví nový tarif, kreditové okno restartuje
**od teď** a nevyčerpané kredity ze starého období propadají. Poměrné vyrovnání
(proration) neexistuje a je to vědomé (`subscription.ts:795`). Zákazník, který
downgraduje druhý den po zaplacení, přijde o zbytek období bez náhrady —
**obchodní podmínky by to měly explicitně říkat**; ověřte s právníkem, jestli to
u spotřebitele obstojí.

### Dunning: vlastní i Stripe zároveň

Existuje **vlastní** dunning (`billing_failures`, `MAX_BILLING_FAILURES`, oznámení).
Stripe Smart Retries přitom běží také — a každý jeho neúspěšný pokus pošle
`invoice.payment_failed`, což náš čítač inkrementuje a pošle další e-mail
(`on-paid.ts:600–640`, dedupe klíč je číslo pokusu).

Není to vada, ale **dva systémy řídí totéž**. Doporučení: v nastavení Stripu vypnout
jeho vlastní e-maily zákazníkům, jinak zákazník dostane dvě různě znějící upomínky
na tutéž platbu.

### Faktury

**Vlastní řešení přes Fakturoid**, ne Stripe Invoicing (`lib/invoicing.ts`, `lib/fakturoid.ts`).
To je pro české prostředí správná volba — Stripe Invoicing české náležitosti neumí.

České náležitosti: ✅ IČO, ✅ adresa, ✅ živnostenský úřad (`lib/legal.ts:47`),
✅ režim DPH (neplátce → „Nejsem plátce DPH, uvedené ceny jsou konečné"),
✅ zdaňovací období na dokladu pro časové rozlišení (`on-paid.ts:265–268`).
`npm run guard` identitu kontroluje a hlásí ji jako kompletní.

🟠 **Jedna vada (upřesněno po druhém čtení):** UI si fakturační údaje **před
pokladnou vyžádá** (`SubscriptionSection.tsx:148`, `hasBillingDetails`), takže
běžný zákazník doklad s náhradní adresou nedostane. Zbývají dvě mezery:
kontrola je jen klientská (přímý POST na `/api/payments/create` ji obejde)
a záměrně selhává propustně (`.catch(() => true)` — „neprodat je horší než
dovyplnit potom"). Když se tedy přesto vystaví doklad s `"Neuvedeno"` a PSČ
`"00000"` (`lib/invoicing.ts:68–77`), je to **vadný daňový doklad v nevratné
číselné řadě**, který podnikatelský odběratel nemůže uplatnit.

**Opraveno 2. 9. 2026:** takový doklad teď zakládá provozní úkol
(`proposeBillingDetailsFix`) místo řádku v logu, takže se na něj přijde hned
a dá se vystavit opravný doklad. Vynucení na serveru zůstává jako úkol —
je to obchodní rozhodnutí, ne technické.

---

## 3. Publikování na Instagram — riziko závislosti

### Která služba a kde

**upload-post.com** (`https://api.upload-post.com`), autentizace hlavičkou
`Authorization: Apikey <UPLOADPOST_API_KEY>`.

Integrace je v `lib/channels/`, celkem ~610 řádků ve třech souborech:

| Soubor | Řádků | Role |
|---|---|---|
| `lib/channels/uploadpost-client.ts` | 102 | HTTP klient, retry, klasifikace chyb |
| `lib/channels/uploadpost-profiles.ts` | 198 | životní cyklus připojení (profily, JWT odkaz) |
| `lib/channels/uploadpost.ts` | 312 | vlastní adaptér — publikování + metriky |

Volající: `app/api/cron/ig-publisher/route.ts`, `app/api/ig-connect/bridge/*`,
`instagram/metrics-sync.ts`.

Návrh je čistý: základní URL a klíč žijí na jednom místě (`uploadpost-client.ts:16`),
transport je explicitní sloupec `ig_connections.transport` s `CHECK (transport IN ('meta','uploadpost'))`
a kód ho **nikdy neodhaduje** — neznámá hodnota vyhodí výjimku
(`instagram/ig-connection.ts:54–57`). To je přesně to, co při výměně dodavatele chcete mít.

### Co se rozbije, když služba skončí

**Rozbije se:**
- publikování na účty zákazníků připojených transportem `uploadpost`;
- načítání metrik u příspěvků publikovaných tímto transportem
  (`ig_posts.publish_request_id` je jejich handle).

**Nerozbije se:** generování obsahu, plánování, kalendář, fakturace, ani účty
připojené transportem `meta`.

**Náhrada — kolik dní práce:**
Náhradní cesta **už v kódu je** (`lib/channels/instagram.ts`, 272 ř., transport `meta`).
Samotné přepnutí je 2–4 člověkodny (migrace řádků, reconnect flow, testy).

🔴 **Ale to není to úzké místo.** Transport `meta` vyžaduje od Mety schválení scope
`instagram_business_content_publish` v App Review (`docs/META_APP_REVIEW_PLAN.md`).
To je **2–8 týdnů bureaukratické lhůty mimo vaši kontrolu** a schválení není jisté.
Kdyby upload-post skončil ze dne na den, **publikování stojí týdny, ne dny.**

Zmírnění, které stojí za zvážení: podat App Review **teď**, i když se dnes nepoužije.
Náklad je čas, ne peníze, a odstraní to jednu z největších závislostí projektu.

### Škálování nákladů

Vstupní údaj od zadavatele (**neověřeno** proti ceníku dodavatele): **60 USD / 25 klientů
měsíčně** = 2,40 USD/klient = **50,9 Kč/klient** při kurzu 21,2 Kč/USD
(`lib/model-pricing.ts:196`).

| Klientů | USD/měs. | Kč/měs. | Kč/klient | % z tarifu Start (999 Kč) |
|---|---|---|---|---|
| 10 | 24 | 509 | 50,9 | 5,1 % |
| 50 | 120 | 2 544 | 50,9 | 5,1 % |
| 200 | 480 | 10 176 | 50,9 | 5,1 % |
| 500 | 1 200 | 25 440 | 50,9 | 5,1 % |

⚠️ **Extrapolace předpokládá lineární cenu**, což u SaaS dodavatelů obvykle neplatí —
mají cenová pásma a stropy. Cena nad 25 profilů je **neověřená**. Před slibem investorovi
si vyžádejte od upload-post cenu pro 200 a 500 profilů písemně.

🔴 **Dnešní stav je vážnější než ta tabulka:** podle `scripts/spike-uploadpost.ts:4`
běží integrace na **Free tieru se stropem 2 profilů**. V našem kódu **není žádná kontrola
tohoto stropu** — třetí zákazník, který si bude chtít připojit Instagram, dostane chybu
od cizího API a my se to dozvíme z logu. Před prvním placeným zákazníkem je nutné
přejít na placený tarif.

### Ošetření pádu publikace

Dobře ošetřené (`app/api/cron/ig-publisher/route.ts`):

- Příspěvek se zabírá podmíněným claimem `status: scheduled → posting` (ř. 80–87),
  takže dva běhy cronu nepublikují dvakrát.
- **Přechodná chyba:** exponenciální backoff `min(2^n, 30)` minut, max 4 pokusy (ř. 91–108).
- **Trvalá chyba** (odvolaný profil, odmítnuté médium): žádný retry, rovnou `failed` (ř. 110–117).
- Důvod se ukládá do `ig_posts.publish_error` a zobrazuje se v UI (`PostsTab.tsx:792`).
- **Zákazník se to dozví** — `lib/agents/incident-watch.ts:80` zakládá oznámení
  `publish_failed` se srozumitelným důvodem.

Tohle je nadprůměrné. Jediná výhrada: 4 pokusy s backoffem do 30 minut znamenají,
že se to vzdá zhruba po hodině. U výpadku dodavatele delšího než hodina propadnou
všechny naplánované příspěvky toho dne.

### Kde jsou přihlašovací údaje k Instagramu

Toto je nejcitlivější místo aplikace a je řešené **správně**, ale s podstatnou výhradou.

**Transport `meta` (vlastní připojení):**
- Token je v `ig_connections.access_token` jako **AES-256-GCM** šifrotext ve tvaru
  `iv:authTag:ciphertext` (`lib/ig-token-crypto.ts`, migrace `20260619_ig_connections.sql:19`).
- Klíč je v `IG_TOKEN_ENCRYPTION_KEY`, 32 bajtů, validovaná délka (`ig-token-crypto.ts:36`).
- Tabulka má **RLS deny-all** — RLS zapnuté, žádné policy, dostupná jen přes service role
  (migrace `20260619:50–53`). Komentář v migraci to výslovně označuje za přísnější
  než u ostatních `ig_*` tabulek. To je správný instinkt (a zároveň důkaz, že autor
  o děravých policies jinde věděl — viz §5).
- Rotace tokenů cronem `ig-token-refresh` (denně 05:00).
- Meta Data Deletion callback maže tokeny na vyžádání (`app/api/data-deletion/route.ts`).

**Transport `uploadpost` (dnešní ostrý provoz):**
- 🟠 **Přihlašovací údaje k Instagramu u nás vůbec nejsou.** Drží je upload-post.
  Ve sloupci `access_token` je jen jméno profilu (`ig-connection.ts:28`).
- Zákazník autorizuje svůj účet na **hostované stránce dodavatele** (JWT platný 48 h,
  `uploadpost-profiles.ts:85–89`).

**Co to znamená pro riziko:** naše šifrování je v tomto režimu irelevantní. Bezpečnost
instagramových účtů zákazníků se rovná bezpečnosti upload-post.com. Prolomení
dodavatele = kompromitace všech účtů zákazníků, bez naší možnosti to detekovat
nebo zmírnit.

🔴 **Právní důsledek:** upload-post je zpracovatel osobních údajů. **Zpracovatelská
smlouva podle čl. 28 GDPR neexistuje** a v zásadách je zmíněn jen jménem, bez
uvedení předávání do třetí země. Viz §6.

---

## 4. Reálné náklady na generování

### Zdroje čísel

| Zdroj | Co obsahuje | Ověřeno |
|---|---|---|
| `lib/model-pricing.ts` | sazebník USD/M tokenů, per obrázek, per vteřinu videa | ✅ ai.google.dev, **2026-08-10** |
| `instagram/caption-generator.ts:28–43` | odhad nákladu jednotlivých kroků a součty per post | ⚠️ „as of June 2026", odhad provozovatele |
| `USD_TO_CZK = 21,2` | kurz | `lib/model-pricing.ts:196`, zdroj `docs/pricing/cost-model.ts`, **2026-07-15** |
| `docs/UNIT_ECONOMICS_AND_PRICING.md` | rozbor marží | ⚠️ **sám sebe označuje za neplatný** — psáno pro ceník v4 |

🔴 **Nález: dva rozcházející se sazebníky.** `caption-generator.ts:37` účtuje Veo 3.1 Fast
za **0,15 USD/s**, `model-pricing.ts:100` za **0,12 USD/s**. Podobně u Lite (0,06 vs 0,08).
Dokud se to nesjednotí, žádný výpočet nákladů na reely nesedí. Jediný sazebník má být
`model-pricing.ts` — ten má zdroj i datum.

### Cena jednoho příspěvku, rozepsaná po API

Skladba podle `instagram/caption-generator.ts:41` a pipeline v `autopilot.ts`:

**Obrázkový příspěvek:**

| Krok | API / model | USD | Kč |
|---|---|---|---|
| Copywriter + kritik + editor (3× text) | Gemini Pro (`gemini-pro-latest`) | 0,075 | 1,59 |
| Kontextový agent (svátky, počasí) | Gemini Flash | 0,025 | 0,53 |
| Designer brief | Gemini 3.1 Pro | 0,030 | 0,64 |
| Render obrázku | Nano Banana Pro (`gemini-3-pro-image`) | 0,134 | 2,84 |
| Vision QA | Gemini Flash vision | 0,010 | 0,21 |
| Judge (výběr/hodnocení) | **Claude Sonnet 5** | 0,010 | 0,21 |
| **Celkem** | | **0,284** | **6,02 Kč** |

**Ostatní formáty** (součty z `COSTS`, + judge, × 21,2):

| Formát | USD (podlaha) | USD (reálně, s revizemi) | Kč (reálně) | Kredity | Kč/kredit |
|---|---|---|---|---|---|
| Obrázek | 0,28 | 0,36 | **7,63** | 1 | 7,63 |
| Story | 0,57 | 0,57 | **12,08** | 2 | 6,04 |
| Karusel | 0,76 | 0,86 | **18,23** | 3 | 6,08 |
| Reel | 1,46 | 1,51 | **32,01** | 5 | 6,40 |

Sloupec „reálně" pochází z `docs/UNIT_ECONOMICS_AND_PRICING.md §2`, kde autor připočítal
editorial rounds a občasnou korektivní editaci. Reel obsahuje Veo 8 s — **při sazbě
z `model-pricing.ts` (0,12 USD/s) by byl o 0,24 USD levnější**; použil jsem vyšší,
konzervativní hodnotu z enginu.

**HikerAPI** (`lib/ig-scraper.ts`) se používá při onboardingu ke scrapingu profilu.
Cena: **neověřeno** — v repozitáři není žádný sazebník.

### Měsíc plného vyčerpání kreditů

✅ **Ceník potvrzen: 999 / 2 999 / 4 999 / 8 999 Kč.** V zadání auditu zaznělo
990 / 1 990 / 3 990 / 7 990 Kč, což vypadalo jako rozpor — majitel 2. 9. 2026
potvrdil, že platí čísla z kódu a chybný byl podklad. Kód je konzistentní:
`supabase/migrations/20260901_pricing_v6_kredity.sql` (DB), `lib/pricing.ts:281–284`
(statická záloha) a aserce v `npm run guard`, která obojí porovnává. Marže níž
tedy počítají se správnými cenami.

Nejhorší případ pro nás = samé **obrázky** (nejhorší poměr Kč/kredit — 7,63 Kč).
Nejlepší = samé karusely (6,08 Kč).

| Tarif | Cena | Kredity | COGS nejhorší | COGS nejlepší | Hrubá marže |
|---|---|---|---|---|---|
| Start | 999 Kč | 20 | 153 Kč | 122 Kč | **84,7 – 87,8 %** |
| Růst | 2 999 Kč | 70 | 534 Kč | 426 Kč | **82,2 – 85,8 %** |
| Dominance | 4 999 Kč | 130 | 992 Kč | 790 Kč | **80,2 – 84,2 %** |
| Impérium | 8 999 Kč | 260 | 1 984 Kč | 1 581 Kč | **78,0 – 82,4 %** |

Vlastní odhad v migraci (`20260901_pricing_v6_kredity.sql:26`) uvádí „81–87 %".
**Nezávislým přepočtem to zhruba sedí.** Vážení kreditů podle média (obrázek 1 /
story 2 / karusel 3 / reel 5, `lib/credits.ts:33`) funguje — drží COGS na kredit
v pásmu 6,0–7,6 Kč, takže žádný formát nemůže tarif potopit. To je dobrý návrh.

**Poznámka k „30 příspěvkům v ceně":** všechny tarify mají v konfiguraci
`plan_posts_limit: 30`, ale `activatePaidPlan()` nastavuje čítač `plan_posts_unlocked`
rovnou na 30 (`subscription.ts:875`), zatímco brána zní `planPostsUnlocked < planLimit`
(`subscription.ts:539`). Podmínka je tedy u placeného tarifu **vždy nepravdivá** —
příspěvky zdarma se nikdy neuplatní a vše se platí kredity. UI to zákazníkovi neslibuje
(kreditový pruh se u placených plánů počítá z kreditů, `SubscriptionSection.tsx:405`),
takže dnes to nikoho nepoškozuje a marže výše platí. **Je to ale nastražená mina:**
kdyby to někdo „opravil" na nulu v domnění, že odemyká slíbenou funkci, každý tarif
najednou rozdá 30 příspěvků zdarma — u Startu je to 229 Kč COGS proti 999 Kč tržby.

### 🔴 Proč těmto maržím nevěřte bez ověření

Migrace `20260823_ai_spend.sql` dokumentuje vlastní měření z 23. 8. 2026:

> „Google účtoval za týden 411,78 Kč, ale `ig_generation_log` uměl vysvětlit jen ~100 Kč.
> Zbytek — tedy tři čtvrtiny — byl neviditelný."

Měřič obaloval jen `generateOnePost`. Všechno ostatní — generování nápadů, onboarding,
produktové briefy, agenti — bylo mimo účetnictví. Jediný hromadný běh (400 nápadů)
stál ~250 Kč a v účtech nebyl vůbec.

Tabulka `ai_spend` byla založena právě proto. **Ale marže výše počítají jen náklad na
příspěvek** — tedy tu čtvrtinu, která byla vidět. Skutečná COGS na zákazníka je
**neověřená** a podle toho jediného měření může být násobně vyšší.

Dále v marži **nejsou** vůbec zahrnuté:

| Položka | Kč/klient/měs. | Zdroj |
|---|---|---|
| upload-post most | 50,9 | zadání, neověřeno |
| Onboarding nového klienta (jednorázově) | neověřeno, řádově stovky | `ai_spend` incident |
| Vercel, Supabase, Resend, Fakturoid, Sentry | **neověřeno** | v repozitáři není |
| HikerAPI | **neověřeno** | v repozitáři není |

**Poctivá formulace pro investora:** hrubá marže na samotném generování příspěvků je
78–88 %. Marže na zákazníka **není změřená** a jediné existující měření naznačuje, že
neúčtované AI operace mohou být několikanásobkem účtovaných. Do 30 dnů se to dá zjistit —
tabulka `ai_spend` na to existuje, jen potřebuje pokrýt zbývající cesty a porovnat se
skutečnou fakturou od Googlu.

---

## 5. Bezpečnost po veřejném repu

### 🔴 Priorita jedna: tajné klíče v git historii

Prohledal jsem **všech 6 615 objektů** v historii (nejen současné soubory) dvěma
nezávislými vzorky — na tvary klíčů (Stripe, Supabase JWT, Google, Anthropic, Meta,
GitHub, PEM) a na přiřazení hodnot do proměnných s názvem obsahujícím SECRET / KEY /
TOKEN / PASSWORD.

**Nález — jeden, ale skutečný:**

| | |
|---|---|
| **Co** | Meta (Facebook) user access token, tvar `EAF7htOH3hn8…ngQZDZD`, 233 znaků |
| **Soubor** | `instagram/test-api.ts:5` |
| **Blob** | `5b8b16d44b42124d30d17ca976e96afae49c0816` |
| **Přidán** | `9e6970d5` — 21. 2. 2026 („chore: install dependencies and configure .gitignore") — **druhý commit projektu** |
| **Odstraněn** | `1f6fb7f7` — 27. 2. 2026 |
| **Stav dnes** | Soubor v HEAD **není**, ale **blob v historii zůstává** a je dohledatelný `git cat-file`. |
| **Expozice** | ~6 dní jako živý soubor + **celá doba, kdy byl repozitář veřejný**, jako historie. |

Token nesl podle kódu scope `instagram_basic`, `instagram_content_publish`,
`pages_read_engagement` — tedy **právo publikovat na propojený Instagram**.

**Doporučení, v tomto pořadí:**
1. **Zneplatnit token** v Meta → Business → System Users / Access Tokens. Long-lived
   Meta tokeny mají 60denní platnost, takže je téměř jistě po expiraci — *ale
   neověřoval jsem to a nepředpokládejte to.*
2. **Rotovat `META_APP_SECRET`.** Pokud unikl i ten (v historii nalezen nebyl, ale
   app secret umožňuje razit nové tokeny), je to horší než token sám.
3. **Přepsat historii** (`git filter-repo`) nebo — jednodušeji a spolehlivěji —
   **založit nový repozitář bez historie** a starý smazat. Přepis historie u veřejného
   repozitáře nezruší forky ani cache GitHubu.
4. Zapnout **GitHub secret scanning + push protection**.

**Žádné jiné tajemství jsem v historii nenašel.** Konkrétně: žádný Stripe klíč, žádný
Supabase service role, žádný Gemini ani Anthropic klíč, žádný HikerAPI klíč.
Soubory `.env*` nebyly **nikdy** commitnuty (`.gitignore:31` je vylučuje od začátku)
— to je dobrá zpráva a je to doložitelné.

### RLS: které tabulky mají díru

Z 34 vytvořených tabulek:

**🔴 2 tabulky nemají RLS vůbec** (`supabase/migrations/20260811_sales_leads.sql`):

- **`leads`** — obsahuje `email`, `company`, `ig_handle`, `website` cizích osob a firem.
  Osobní údaje získané scrapingem Instagramu. Bez RLS.
- **`lead_events`** — historie oslovení k těmto kontaktům. Bez RLS.

Je to zároveň **bezpečnostní i GDPR problém**: databáze kontaktů oslovovaných bez jejich
vědomí, bez ochrany na úrovni databáze. Oprava (`ENABLE ROW LEVEL SECURITY` bez policy →
deny-all) je triviální, ~0,25 dne.

**🟠 3 tabulky mají policy `USING (true)`** — tedy prakticky žádnou:

```sql
-- supabase/migrations/20260514_ig_jobs.sql
CREATE POLICY "Users can read own jobs" ON ig_jobs FOR SELECT USING (true);
CREATE POLICY "Service role can manage jobs" ON ig_jobs FOR ALL USING (true);
```

Totéž v `20260514_ig_brand_memory.sql` a `20260618_ig_campaigns.sql`. Název policy
(„Users can read **own** jobs") tvrdí něco jiného, než co dělá. `FOR ALL USING (true)`
bez `WITH CHECK` znamená v Postgresu čtení **i zápis** pro roli `public` — tedy `anon`
i `authenticated`, napříč všemi tenanty. Žádná pozdější migrace to neopravuje
(`DROP POLICY` se v repozitáři nevyskytuje).

`ig_brand_memory` je přitom **naučený hlas značky zákazníka** — jádro produktového IP.

**Míra rizika — buďme přesní:** ověřil jsem, že **dnes to není zvenčí zneužitelné**:
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` **není v klientském bundlu** (prohledal jsem
  `.next/static/` — jsou tam jen veřejné storage URL, žádný JWT).
- `supabase/client.ts` (prohlížečový klient) existuje, ale **není odnikud importován**.
- `supabase/server.ts` (uživatelský kontext, respektuje RLS) se používá na 2 místech
  a **nikdy nečte `ig_*` tabulky**.
- Všechna data tečou přes `supabase/admin.ts` (service role, RLS obchází) s explicitním
  filtrem na `client_id` v aplikačním kódu.

**Takže:** multi-tenancy dnes drží **výhradně aplikační kód**. Databáze je buď
deny-all (29 tabulek, bezpečné), nebo dokořán (3 tabulky). Obrana do hloubky neexistuje.
Jediný `import supabase from "@/supabase/client"` v komponentě — nebo únik anon klíče —
a hlas značky každého zákazníka je čitelný i mazatelný kýmkoli. Oprava ~0,5 dne.

### Server actions a API routy bez autorizace

**API routy: v pořádku.** Prošel jsem všech 6 rout, které nepoužívají `requireAuth()`
ani `CRON_SECRET`, a **každá má vlastní, správné ověření**:

| Routa | Ověření |
|---|---|
| `payments/callback` | stav se ověřuje serverovým dotazem na bránu (`route.ts:50`) |
| `payments/return` | jen zobrazení, stav z brány |
| `payments/stripe/webhook` | HMAC podpis nad syrovým tělem |
| `consultations/cal-webhook` | HMAC + `timingSafeEqual` (`route.ts:36–42`) |
| `data-deletion` | Meta `signed_request`, HMAC + `timingSafeEqual` |
| `email/unsubscribe` | podepsaný odkaz (`verifyEmailSig`) |
| `apple-pay-domain` | veřejný statický soubor, bez dat |

**Server actions: 149 ze 158 má guard.** Zbytek jsem prošel ručně:

| Action | Verdikt |
|---|---|
| `isCurrentUserSuperAdmin`, `getAvailableIGClients` | ✅ čtou vlastní session, guard uvnitř |
| `editProductCategory`, `removeProductCategory` | ✅ `requireCategoryAccess` |
| `generateMultipleVariants`, `generatePrintVariants` | ✅ delegují na guardované funkce |
| `hasBillingDetails` | ✅ přes `getBillingDetails` |
| `joinWaitlist` | 🟠 veřejná záměrně, ale **bez rate limitu** — kdokoli může zaplavit tabulku |
| **`syncConfigProductsToDb`** | 🔴 **bez autorizace** |

🔴 **`app/actions/product-actions.ts:722` — `syncConfigProductsToDb()`**
je exportovaná ze souboru s `"use server"`, nemá žádné ověření a **iteruje přes všechny
aktivní klienty** (`.eq("is_active", true)`) a zapisuje jim produkty. Server actions
v Next.js jsou volatelné POST požadavkem s hlavičkou `Next-Action`; middleware chrání
`/dashboard/*`, ale action lze vyvolat z libovolné trasy. Dopad: nepřihlášený útočník
spustí zápisový průchod celou zákaznickou bází. Oprava: přidat `requireSuperAdmin()`,
~0,1 dne.

### 🟠 Middleware selhává „otevřeně"

`middleware.ts:105–108`:

```ts
} catch (e) {
    console.error('Middleware exception:', e);
    return NextResponse.next({ request });   // ← propustí request dál
}
```

Jakákoli výjimka v middleware (výpadek Supabase Auth, poškozená cookie) **propustí
požadavek na `/dashboard` bez ověření i bez brány bety**. Stránky mají vlastní guardy,
takže data neuniknou, ale je to nesprávný směr selhání. Autentizace má selhávat zavřeně.

### Credit-guard: je všude, ale nedrží pod souběhem

**Pokrytí je dobré.** `creditGuard()` / `creditGuardBatch()` (`app/actions/credit-guard.ts`)
volají `requireProjectAccess` a jakákoli výjimka akci **blokuje**, nikdy nepropouští
(„All errors block the action — no silent bypass", ř. 108). Kontroluje se i `allowed_actions`
tarifu a médium se váží. Selhaná generace se refunduje (`refundJobCharge`,
idempotentně přes unikátní index).

🔴 **Ale kontrola není atomická.** `canPerformAction()` (`lib/subscription.ts:489`) jen
**čte** zůstatek. `deductCredits()` (`ř. 574`) zapisuje **až po dokončení AI operace** —
komentář to říká výslovně: *„Call this AFTER the AI operation succeeds."* Mezi čtením
a zápisem není zámek, rezervace ani atomický dekrement.

Důsledek: N souběžných požadavků přečte **týž** zůstatek, všechny projdou kontrolou
a všechny se vygenerují. Zákazník s 1 kreditem může spustit 50 paralelních generování.

### Rate limiting: neexistuje

Hledal jsem `rateLimit`, `Ratelimit`, `throttle`, `@upstash/*`, pravidla WAF ve
`vercel.json`, limity v middleware. **Nenašel jsem nic.**

**Přímá odpověď na otázku ze zadání — ano, může.** Zákazník na tarifu Start
(999 Kč, 20 kreditů) může:

1. Spustit skript, který paralelně volá generování.
2. Díky neatomické kontrole projdou všechny požadavky se stejným zůstatkem.
3. Nic jiného ho nezastaví — žádný limit požadavků za minutu, žádný strop souběhu,
   žádná fronta.

Strop je fakticky jen **doba běhu funkce na Vercelu (800 s)** a rychlost Gemini API.
Při ~7,6 Kč za obrázkový příspěvek a stovkách souběžných požadavků jde o účet
v řádu tisíců korun za jedno odpoledne, z jednoho účtu za 999 Kč.

**Doporučené minimum před prvním zákazníkem:**
- limit požadavků na uživatele (Vercel WAF nebo `@upstash/ratelimit`) — 1 den;
- atomická rezervace kreditu (dekrement s podmínkou `WHERE credits >= n`
  před spuštěním práce, refundace při selhání) — 1–2 dny;
- denní strop generování na klienta jako pojistka — 0,5 dne.

---

## 6. Cesta k prvním pěti platícím zákazníkům

### A) „Můžu zítra vzít peníze od cizího člověka"

Seřazeno podle toho, co blokuje nejdřív.

| # | Co | Proč to blokuje | Dny | Kdo |
|---|---|---|---|---|
| 1 | **Zneplatnit uniklý Meta token, rotovat `META_APP_SECRET`** | Únik z veřejného repa; dokud se nerotuje, nevíte, kdo má přístup | 0,5 | sám |
| 2 | **Ostré Stripe klíče + `PAYMENT_GATEWAY=stripe` + live webhook** | Dnes `sk_test` → nelze přijmout ani korunu | 0,5 | sám (+ aktivace účtu, externí lhůta) |
| 3 | **Placený tarif upload-post** | Free tier = 2 profily; 3. zákazník se nepřipojí | 0,5 | sám |
| 4 | **E2E test platby ostrou kartou** | Nikdy neproběhlo; nejdražší chyba je zaplaceno-neaktivováno | 0,5 | sám |
| 5 | **Vynutit fakturační údaje před pokladnou** | Jinak vzniká doklad s adresou „Neuvedeno" | 0,5 | sám |
| 6 | **Cookie lišta s reálným opt-in + oprava zásad** | GA je nasazená se souhlasem „granted" natvrdo, zásady tvrdí opak | 1,0 | sám |
| 7 | **Doplnit seznam zpracovatelů do zásad** | Uvedeni 3 z ~9; chybí Google, Anthropic, Stripe, Vercel, Resend, Fakturoid, Sentry | 0,5 | sám |
| 8 | **Zpracovatelská smlouva (DPA)** s upload-post, Google, Anthropic, Supabase | Zpracováváte data zákazníků i jejich publika bez smlouvy podle čl. 28 GDPR | 1,0 | sám + **právník** |
| 9 | **Revize VOP proti skutečnému chování** | Propadání kreditů při downgradu bez náhrady; §8 automatická obnova vs. reálný stav bran | 0,5 | sám + **právník** |
| 10 | **Oprava dvojího účtování při změně tarifu** | Zákazník po upgradu platí dvakrát | 0,5 | sám |
| 11 | **RLS na `leads` a `lead_events`** | Osobní údaje bez ochrany na úrovni DB | 0,25 | sám |
| 12 | **Guard na `syncConfigProductsToDb`** | Nepřihlášený zápis napříč tenanty | 0,1 | sám |
| 13 | **Základní rate limit** | Jeden zákazník za 999 Kč umí vyrobit účet u Googlu v řádu tisíců | 1,0 | sám |
| 14 | **Ověřit ceník** (999 vs 990 — viz §7) | Investorovi i zákazníkovi říkáte jiné číslo, než má produkt | 0,25 | sám |
| 15 | Vydat invite kódy prvním zákazníkům | Brána bety platí i pro platící | 0,25 | sám |

**Součet: 7,85 člověkodne.** S rezervou na to, co se objeví při ostrém testu platby
(a něco se objeví vždycky): **8–12 dnů.**

**Externí, nikoli člověkodny:** aktivace ostrého Stripe účtu (dny), právní revize
DPA a VOP (dny až týden), placený tarif upload-post (hodiny).

**Vše kromě položek 8 a 9 zvládnete sám.** Externího vývojáře na tuhle fázi
nepotřebujete — potřebujete právníka na dvě položky.

### B) „Můžu obsluhovat 100 zákazníků"

Jiné číslo, protože jiné problémy: ne „jde to vůbec", ale „unese to zátěž,
nekrade to peníze a nespadne to o víkendu".

| # | Co | Proč | Dny | Kdo |
|---|---|---|---|---|
| 1 | **Atomická rezervace kreditů** | Souběh dnes propustí neomezené generování | 2 | sám |
| 2 | **Opravit `USING (true)` policies + obrana do hloubky v DB** | Multi-tenancy stojí jen na aplikačním kódu | 1 | sám |
| 3 | **Změřit skutečnou COGS na zákazníka** — dokončit `ai_spend`, porovnat s fakturou Googlu | Marže dnes stojí na čtvrtině změřené útraty | 3 | sám |
| 4 | **Podat Meta App Review** a přejít na vlastní transport | Dnes celý produkt visí na jednom dodavateli | 3 (+ 2–8 týdnů lhůta) | sám |
| 5 | **Self-service změna tarifu + Stripe Customer Portal** | Bez toho každý upgrade a každá změna karty ručně | 3 | sám |
| 6 | **Automatizovat refundace** | Dnes ruční pohyb + ruční dobropis; 30denní garance ve VOP | 2 | sám |
| 7 | **Testovací sada nad kritickou cestou platby a kreditů** | 158 server actions, 0 automatizovaných testů | 5 | sám nebo externí |
| 8 | **Odstranit mrtvý Comgate kód** (~950 ř., 2 refaktory napřed) | Dvě platební cesty = dvojnásobek míst, kde se chybuje | 2 | sám |
| 9 | **Zátěžový test + fronta generování** | Cron `campaign-worker` běží každou minutu; při 100 klientech neověřeno | 3 | sám nebo externí |
| 10 | **Vlastní odbavení zákazníků** — onboarding bez asistence | Dnes onboarding předpokládá dohled | 5 | sám |
| 11 | **Provozní pohotovost** — alerting, runbook, zálohy | Bus factor 1 (viz §7) | 3 | sám |
| 12 | **Sjednotit sazebníky modelů** (0,12 vs 0,15 USD/s) | Dva zdroje pravdy o ceně | 0,5 | sám |
| 13 | **Vyjednat cenu upload-post pro 200+ profilů** | Extrapolace je neověřená | 1 | sám |
| 14 | **Právní: hranice DPH, rozsah živnosti** | Viz §7 — obrat se sčítá napříč činnostmi téhož IČO | 2 | **daňový poradce** |

**Součet: 35,5 člověkodne**, realisticky **35–50 dnů** vlastní práce.

**Kritická cesta ale není v člověkodnech** — je to Meta App Review (položka 4).
Dokud neproběhne, obsluha 100 zákazníků znamená 100 profilů u třetí strany,
každý za ~51 Kč/měsíc, s jejími limity a jejím rizikem.

**Externího vývojáře stojí za to zvážit** na položky 7 a 9 (testy a zátěž) — je to
práce, která se dá dobře zadat, a je to práce, kterou autor kódu píše nejhůř.

---

## 7. Tři věci, které řekněte investorovi dřív, než se zeptá sám

### 1. Produkt neumí vzít peníze a nikdy to nezkusil na ostro

Ne „skoro hotovo" — **doslova nula transakcí**. Stripe běží na `sk_test`
(`STRIPE_SECRET_KEY="sk_test…"`), přepínač bran stále volí Comgate
(`lib/payments/checkout.ts:52–59`) a automatické obnovy Comgatem jsou vypnuté
(`COMGATE_RECURRING` není nastaveno). Celý platební řetězec — od kliknutí přes
webhook a aktivaci až po daňový doklad — **nikdy neproběhl s reálnými penězi**.

Kód té cesty je psaný pečlivě, s idempotencí a podmíněnými claimy, a mám k němu
větší důvěru než k průměrné produkční platební integraci. Ale to je předpověď,
ne měření. A už jedna vada je vidět staticky: **změna tarifu vyrobí u Stripu
dvě živá předplatná a zákazník platí dvakrát** (§2).

**Proč to říct první:** investor to zjistí za deset minut a zjištění „nula
transakcí" je mnohem horší, když ho najde sám. Řečeno vámi je to konkrétní,
ohraničený úkol na dva dny. Nalezeno jím je to červená vlajka o tom, jak
odhadujete hotovost.

### 2. Celý produkt stojí na jednom dodavateli, na jehož bezplatném tarifu

Publikování na Instagram — tedy věc, kterou zákazník kupuje — jde přes
**upload-post.com**. Přitom:

- Běží to na **Free tieru se stropem 2 profilů** (`scripts/spike-uploadpost.ts:4`),
  z toho jeden je obsazený. **Třetí zákazník se dnes nepřipojí.**
- V našem kódu **není žádná kontrola toho stropu** — projeví se to chybou od cizího
  API v logu, ne varováním.
- **Přihlašovací údaje k instagramovým účtům zákazníků nedržíme my, ale on.**
  Naše šifrování AES-256-GCM se v tomhle režimu vůbec nepoužije. Prolomení
  dodavatele = kompromitace účtů všech zákazníků, bez naší možnosti to zjistit.
- **Zpracovatelská smlouva s ním neexistuje.**
- Náhrada je v kódu připravená (transport `meta`), ale vyžaduje **Meta App Review**:
  2–8 týdnů lhůty mimo vaši kontrolu, s nejistým výsledkem.

**Řekněte to takhle:** „Publikování máme vyřešené obchvatem, protože oficiální cesta
má bureaukratickou lhůtu. Obchvat funguje a přepnutí zpátky je v kódu hotové. Riziko
je, že dnes visíme na cizí firmě, u které nemáme ani smlouvu, ani placený tarif —
a to je jedna z prvních věcí, na kterou půjdou peníze."

To je podstatně silnější než nechat investora objevit, že produkt za 999–8 999 Kč
měsíčně jede na bezplatném účtu s limitem dvou profilů.

### 3. Marže, kterou uvádíte, měří jen čtvrtinu nákladů — a víte to

Vaše vlastní migrace `20260823_ai_spend.sql` dokumentuje měření z 23. 8. 2026:
Google fakturoval **411,78 Kč za týden**, zatímco vlastní účetnictví umělo vysvětlit
**~100 Kč**. Tři čtvrtiny útraty byly neviditelné, protože měřič obaloval jedinou
cestu. Jeden hromadný běh (400 nápadů, ~250 Kč) v účtech nebyl vůbec.

Přepočítal jsem marže nezávisle a **na příspěvek to sedí**: 78–88 % hrubé marže,
což potvrzuje váš odhad 81–87 %. Vážení kreditů podle média je dobře navržené —
žádný formát nemůže tarif potopit.

**Ale marže na zákazníka nikdo nezměřil.** Nezahrnuje onboarding, generování nápadů,
produktové briefy, agenty ani infrastrukturu. Tabulka `ai_spend` vznikla přesně proto,
aby to šlo zjistit, a zatím pokrývá jen část cest.

K tomu tři drobnosti, které stejný obrázek dokreslují:
- **Dva sazebníky si odporují** — Veo Fast za 0,15 vs 0,12 USD/s
  (`caption-generator.ts:37` vs `model-pricing.ts:100`).
- **Ceník v zadání nesouhlasí s produktem.** Uvádíte 990/1990/3990/7990 Kč; v databázi,
  migracích i ve statické záloze ceníku je **999/2999/4999/8999 Kč**. Rozdíl u nejvyššího
  tarifu je 1 009 Kč měsíčně. Ověřte to, než to řeknete nahlas — investor si ceník otevře.
  Tohle je jediný bod, který **nejde opravit v kódu** — kód je konzistentní sám se sebou
  a nevím, které z těch dvou čísel je to zamýšlené.
- **`docs/UNIT_ECONOMICS_AND_PRICING.md` sám sebe označuje za neplatný** („ceny z éry v4
  a už neplatí"), přesto je to jediný dokument o marži, který v repozitáři existuje.

**Řekněte to takhle:** „Jednotková ekonomika na příspěvek je změřená a je dobrá.
Ekonomika na zákazníka změřená není a mám doložený případ, kdy mi tři čtvrtiny útraty
utekly z účetnictví. Vím, kde to je, mám na to tabulku a do 30 dnů to bude změřené."

Investor, který slyší „78–88 % marže" bez téhle výhrady a pak si přečte
`20260823_ai_spend.sql`, přestane věřit i těm číslům, která jsou správně.

---

### Bonusové věci, o které se nezeptá, ale měly by zaznít

**Bus factor je 1.** 495 z 545 commitů má jednoho autora, zbylých 50 druhý účet téže
osoby. 75 000 řádků, nula automatizovaných testů (jen ~425 statických asercí ve
vlastních `tsx` skriptech, které ale prochází a jsou lepší než nic). Dokumentace je
nadprůměrná a komentáře vysvětlují *proč* — což bus factor zmírňuje, ale neruší.

**Zásady ochrany údajů si přímo odporují s kódem.** `app/privacy/page.tsx:142` tvrdí:
*„Nepoužíváme marketingové ani analytické cookies třetích stran, a proto nevyžadujeme
souhlas s cookies."* Přitom `app/layout.tsx:85` vykresluje `<GoogleAnalytics />`
a `components/GoogleAnalytics.tsx:22` nastavuje `gtag('consent', 'default',
{ 'analytics_storage': 'granted' })` — tedy souhlas natvrdo udělený, bez jakékoli lišty.
Komponenta je podmíněná `NEXT_PUBLIC_GA_ID`, který v lokálním prostředí není;
**na produkci to ověřte**. Pokud tam je, jde o porušení §89 zákona č. 127/2005 Sb.
i GDPR, a text zásad je nepravdivý. To je věc, kterou najde kterýkoli auditor
za pět minut a která zpochybní důvěryhodnost všech ostatních právních dokumentů —
přitom oprava je jeden den.

**Daňová a živnostenská hranice.** Podnikáte jako OSVČ, IČO 21263990, neplátce DPH
(`lib/legal.ts:74`). Obrat pro povinnou registraci k DPH se **sčítá napříč všemi
činnostmi téhož IČO**, ne jen za SaaS. Zároveň stojí za ověření, jestli současný rozsah
živnosti softwarovou službu vůbec kryje. Při 100 zákaznících na tarifu Růst je roční
obrat ~3,6 mil. Kč — hluboko nad hranicí. Investor se na právní formu zeptá;
mít odpověď od daňového poradce předem je lepší než improvizovat.

---

## Příloha: co bylo ověřeno a co ne

**Ověřeno statickou analýzou:** struktura kódu, migrace, git historie (všech 6 615
objektů), autorizace všech 158 server actions a všech API rout, RLS policies,
šifrování tokenů, sazebníky modelů, konfigurace přepínačů v `.env.local`.

**Ověřeno spuštěním:** `npm run build` (prochází), `npm run guard` (~425 asercí,
0 selhání), obsah klientského bundlu v `.next/static/`.

**Neověřeno:**
- Produkční prostředí na Vercelu — všechna tvrzení o env proměnných vycházejí
  z lokálního `.env.local`. **Produkční hodnoty se mohou lišit** a je nutné je
  zkontrolovat, zejména `STRIPE_SECRET_KEY`, `PAYMENT_GATEWAY`, `NEXT_PUBLIC_GA_ID`.
- Skutečný stav RLS a policies v produkční databázi (audit četl migrace, ne DB).
- Platnost uniklého Meta tokenu — **záměrně jsem ho nepoužil**.
- Ceník upload-post nad 25 profilů, ceny HikerAPI, Vercelu, Supabase, Resendu.
- Chování pod zátěží a při souběhu — analýza je statická, ne experimentální.
