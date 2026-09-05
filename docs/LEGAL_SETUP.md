# Právní a daňové zprovoznění — Chrlit / Adela Mužátková

> Stav k 30. 7. 2026, údaje ověřené v **ARESu** (IČO **21263990**).
> Fakturace přes **Fakturoid API**. Zákazníci zatím **jen ČR**.
>
> ⚠️ Tenhle dokument je pracovní checklist, ne právní ani daňové poradenství. Zálohy,
> sazby a limity se mění každý rok — položky označené **`[OVĚŘIT]`** si před podáním
> potvrď u účetní nebo na webu příslušného úřadu.

## Výchozí stav (z ARESu, 30. 7. 2026)

Dobrá zpráva: **většina byrokracie už je hotová.** Adela podniká od února 2024.

| Údaj | Hodnota |
|------|---------|
| Jméno v rejstříku | **Adela Mužátková** (bez délky nad „e" — viz upozornění níže) |
| IČO | 21263990 |
| Právní forma | 101 — fyzická osoba podnikající dle živnostenského zákona, nezapsaná v OR |
| Sídlo | Svitákova 2729/10, Stodůlky, 155 00 Praha 5 |
| Živnost | **volná** („Výroba, obchod a služby neuvedené v přílohách 1 až 3"), vznik **19. 2. 2024**, aktivní |
| DIČ | **žádné** — není plátce ani identifikovaná osoba |
| Provozovna | „Květiny nad Museem", Vinohradská 343/6, 120 00 Praha 2, od 10. 5. 2026 |

Z toho plyne, že **kroky „ohlásit živnost", „registrovat se u FÚ", „oznámit ČSSZ a
pojišťovně" a „aktivovat datovou schránku" jsou dávno za tebou.** Adela má běžící
podnikání (květinářství), takže platí zálohy, podává přiznání a skoro jistě má účetní.

> ⚠️ **Dvě věci, které z toho ale vyplývají a nejsou příjemné — viz kapitoly 1 a 4:**
> živnost **nemá zapsané obory, které Chrlit potřebuje**, a hranice pro DPH se počítá
> z **celkového** obratu, tedy včetně květinářství.

### Jméno: „Adela", ne „Adéla" — potvrzeno

V rejstříku je subjekt zapsaný jako **„Adela Mužátková"**, bez délky nad prvním „e",
a **tenhle tvar je správný** (potvrzeno 30. 7. 2026). Není to chyba přenosu z ARESu —
„Mužátková" si diakritiku zachovalo.

`lib/legal.ts` tedy zůstává na „Adela Mužátková" a **nepřepisovat na „Adéla"**: jméno
na faktuře i v obchodních podmínkách musí být shodné se zápisem v rejstříku.

---

## 0. Co ještě zbývá

| # | Krok | Kde | Priorita | Cena |
|---|------|-----|----------|------|
| 1 | **Doplnit obory činnosti k živnosti** | Živnostenský úřad | ⚠️ blokuje legální prodej | ~0 `[OVĚŘIT]` |
| 2 | **Registrace identifikované osoby k DPH** | Finanční úřad | ⚠️ zákonná lhůta 15 dnů | 0 |
| 3 | Překlopení dodavatelů na IČO + DIČ | Google, Vercel, Supabase… | po kroku 2 | 0 |
| 4 | Podnikatelský účet (pokud ještě není) | banka | před ComGate | 0–200 Kč/měs |
| 5 | Smlouva s ComGate vč. opakovaných plateb | ComGate | blokuje platby | dle sazebníku |
| 6 | Účet Fakturoid + API klíče | Fakturoid | blokuje doklady | ~200–500 Kč/měs |
| 7 | Doplnit číslo účtu do aplikace | `lib/legal.ts` / env | **neblokuje** `check-legal-identity` (viz `legalIdentityGaps()`); blokuje Stripe onboarding a výplatu | 0 |
| 8 | Záznamy o činnostech zpracování (GDPR) | složka u sebe | před spuštěním prodeje | 0 |

---

## 1. ⚠️ Doplnit obory činnosti — Chrlit dnes není krytý

Živnostenské oprávnění existuje, ale **obory činnosti, které má zapsané, na Chrlit
nesedí.** Podle ARESu jsou zapsané tyhle:

1. Poradenská a konzultační činnost, zpracování odborných studií a posudků
2. Poskytování služeb pro zemědělství, zahradnictví, rybníkářství, lesnictví a myslivost
3. Velkoobchod a maloobchod
4. Zprostředkování obchodu a služeb
5. Pronájem a půjčování věcí movitých

To je sada pro **květinářství**, ne pro SaaS. Chybí obory, pod které Chrlit spadá.

### Přesné znění k nadiktování na úřadě

Zkopíruj to takhle — je to **oficiální znění z číselníku**, ověřené 30. 7. 2026 proti
reálnému zápisu softwarové firmy v ARESu, ne parafráze:

```
Poskytování software, poradenství v oblasti informačních technologií,
zpracování dat, hostingové a související činnosti a webové portály
```

```
Reklamní činnost, marketing, mediální zastoupení
```

První kryje samotnou aplikaci a předplatné, druhý tvorbu obsahu na sociální sítě.
**Zapiš oba.** Čísla oborů z přílohy 4 nepotřebuješ — úřad je dohledá podle názvu
a počet oborů nemá vliv na cenu.

### Proč to není formalita

Živnost volná je **jedno oprávnění**, ale podnikatel smí provozovat jen ty **obory,
které má oznámené** (§ 45a živnostenského zákona). Podnikání v neoznámeném oboru je
**neoprávněné podnikání** — přestupek s pokutou v řádu stovek tisíc `[OVĚŘIT výši]`.

Nedá se to obhájit ani přes zapsaný obor „Poradenská a konzultační činnost": Chrlit
neprodává poradenství, ale **předplatné softwaru**, který sám vytváří obsah. To je
učebnicové „poskytování software … a webové portály".

### Jak to spravit

Podává se **oznámení změny oborů činnosti** — není to nová živnost, jen se rozšiřuje
rozsah té stávající. Tři cesty, vyber si:

| Kde | Jak | Poznámka |
|-----|-----|----------|
| Kterýkoli živnostenský úřad | osobně, s občanským průkazem, stačí uvést IČO 21263990 | nejrychlejší, vyřídí se na místě |
| CzechPOINT | osobně | když je blíž než ŽÚ |
| [rzp.cz](https://www.rzp.cz) elektronicky | JRF podepsaný datovou schránkou | ⚠️ **tohle za tebe nikdo udělat nemůže** — vyžaduje tvou datovku, tedy tvou identitu |

Podmínky:

- u živnosti volné se **nedokládá odborná způsobilost** ani rejstřík trestů,
- oznámení změny oborů je **bez správního poplatku**
  `[OVĚŘIT — v nejhorším počítej s 1 000 Kč]`,
- **zapiš oba obory najednou**; druhá cesta na úřad by byla zbytečná.

> Vlastní podání za tebe udělat nejde — je to úkon vázaný na tvou totožnost
> (občanka na přepážce nebo datová schránka). Připravené je všechno ostatní:
> IČO, přesná znění výše a odůvodnění, kdyby se úředník ptal, co Chrlit dělá.

> ⏱️ **Udělej to jako první věc, ještě před spuštěním prodeje.** Všechno ostatní v tomhle
> dokumentu jsou peníze a papíry; tohle je jediný bod, kde by prodej byl protiprávní.

### Sídlo a provozovna — nic neřeš

Sídlo (Svitákova 2729/10) už **v rejstříku veřejné je**, takže úvaha o virtuálním sídle
je bezpředmětná — adresa je dohledatelná od února 2024 a půjde i na faktury.

Provozovnu pro Chrlit **není potřeba zakládat**. Provozovna je místo, kde se
podnikání provozuje vůči zákazníkům; online služba bez pultu žádnou nemá. Zapsaná
provozovna „Květiny nad Museem" se Chrlitu nijak netýká.

---

## 2. Daň z příjmů — registrace hotová, řeší se jen režim

Registrace k dani z příjmů proběhla už při zahájení podnikání v roce 2024, stejně jako
datová schránka. **Nic z toho se znovu nedělá.** Chrlit je jen další příjem pod týmž
IČO — v přiznání se nerozděluje po činnostech, sčítá se.

To má jeden praktický důsledek: **daňový režim se nevybírá pro Chrlit, ale pro celé
podnikání včetně květinářství.** Rozhodnutí tedy patří účetní, která vidí obě strany.

### Daňový režim — co s tím

**A) Daňová evidence + výdajový paušál 60 % ← nejpravděpodobnější volba**
Živnost volná umožňuje uplatnit paušální výdaje **60 % z příjmů** (strop 1 200 000 Kč
výdajů). Neschovává se ani jedna účtenka, základ daně je 40 % z příjmů.
*Ale:* paušál se uplatňuje **na celý příjem z podnikání**, ne zvlášť na Chrlit a zvlášť
na květiny. Květinářství má reálné výdaje (nákup zboží, nájem provozovny na
Vinohradské) klidně nad 60 % — pak by paušál prodělával.
→ **Tohle musí spočítat účetní na reálných číslech obou činností.** Pro Chrlit samotný
by paušál vyhrál (marže jsou vysoké, viz `docs/pricing/PRICING_AUDIT.md`), pro součet
to vůbec jasné není.

**B) Skutečné výdaje**
Pravděpodobná volba, pokud květinářství žere víc než 60 % svého obratu. Znamená vést
evidenci dokladů — což u provozovny s nákupem zboží stejně probíhá.
*Výhoda pro Chrlit:* AI a cloud se stanou uznatelnými náklady (viz kapitola 4 — proto
je překlopení na IČO důležité).

**C) Paušální daň**
Pevná měsíční platba `[OVĚŘIT výši pro 2026]` bez ohledu na zisk, žádné přiznání.
Přihlásit se lze do **10. ledna** daného roku.
*Dvě podmínky, na které pozor:* obrat do 2 mil. Kč (počítá se **součet obou činností**)
a nebýt plátcem DPH. **Identifikovaná osoba paušální režim nevylučuje** — zákaz se týká
jen plátců. `[OVĚŘIT s účetní]`

> **Co s tím teď:** nic neměň. Režim už nějaký běží od 2024; pošli účetní tuhle kapitolu
> a čísla z `docs/pricing/` a ať vyhodnotí, jestli přírůstek příjmů z Chrlitu volbu mění.
> Změna režimu je stejně možná až od dalšího roku.

### Datová schránka — jen připomínka

Existuje od 2024, takže nic nezřizuješ. Ale protože přes ni přijde všechno důležité
(výzvy FÚ, registrace k DPH z kapitoly 4), stojí za zopakování:

- Po 10 dnech od dodání platí **fikce doručení** — zpráva je doručená, i když ji nikdo
  neotevřel. Takhle se propásnou lhůty. Mít zapnutou e-mailovou notifikaci.
- Daňová přiznání se kvůli ní podávají **povinně elektronicky**.

---

## 3. Sociální a zdravotní pojištění — nic nového

Oznámení zahájení SVČ proběhlo v roce 2024, zálohy běží. **Chrlit nezakládá žádnou novou
registrační povinnost** — je to týž podnikatel s vyšším příjmem.

Co se změní až zpětně, v ročních přehledech:

- Vyšší zisk = vyšší doplatek a vyšší zálohy na další rok. Počítej s tím v cash flow,
  ať doplatek v květnu nepřijde jako překvapení.
- Hlavní vs. vedlejší činnost je už dávno určená a Chrlit to nemění.
- Minimální zálohy pro rok 2026 `[OVĚŘIT na cssz.cz a u pojišťovny]`. V
  `docs/pricing/ASSUMPTIONS.md` je odhad 9 000 Kč/měs — po ověření ten řádek přepiš,
  jinak lže kalkulačka cen. **Navíc: ty zálohy nejsou náklad Chrlitu, platí se z celého
  podnikání** — kalkulačka je dnes přičítá celé Chrlitu, což jeho marži uměle snižuje.
- **Nemocenské pojištění je dobrovolné.** Pokud si ho Adéla neplatí, nemá nemocenskou
  ani peněžitou pomoc v mateřství — u OSVČ bez zaměstnání to stojí za zvážení.

---

## 4. ⚠️ Identifikovaná osoba k DPH — past, kterou většina přehlédne

**Tohle je nejdůležitější bod celého dokumentu.**

Ve chvíli, kdy Adela na IČO poprvé nakoupí službu od firmy neusazené v ČR — Google
(Gemini API), Vercel, Supabase, Anthropic, Resend — vzniká ze zákona povinnost
**registrovat se jako identifikovaná osoba k DPH** (ustanovení o identifikované osobě,
§ 6g–6l zákona o DPH `[OVĚŘIT označení po novele]`).

**Lhůta: do 15 dnů ode dne přijetí první takové služby.** Ne od začátku podnikání —
od té první faktury z Googlu.

### ✅ Stav k 30. 7. 2026: povinnost ještě NEVZNIKLA

Ověřeno s vlastníkem: **květinářství reklamu na Meta ani Google nedělá** (teprve bude)
a **květiny bere z ČR**. Neexistuje tedy zatím žádný spouštěč — žádná prošlá lhůta,
žádná pokuta, žádná dodatečná registrace. Odpovídá tomu i ARES (`DIČ: žádné`).

### ⏱️ Ale blíží se to ze dvou stran — a pořadí rozhoduje o penězích

Spouštěče, které přijdou v nejbližší době:

- **reklama na Meta / Google** — obojí fakturuje z Irska (plánuje se „brzy"),
- **náklady Chrlitu po překlopení na IČO** — Google Gemini, Vercel, Supabase,
  Anthropic, Resend,
- **provize Stripe**, pokud půjdeme přes Stripe — Stripe Payments Europe je irská entita
  (ComGate jako česká firma tenhle spouštěč nemá, ale ostatní položky výše zůstávají,
  takže identifikovaná osoba je stejně nevyhnutelná).

Kterákoli z nich přijde první, rozjede 15denní lhůtu.

> 💡 **Výhoda, kterou většina lidí nemá: pořadí si můžeš vybrat.** Protože se to ještě
> nestalo, dá se registrovat **dřív, než lhůta vůbec začne běžet.**

**Proč na tom záleží — riziko dvojího zdanění.** OSVČ je „osoba povinná k dani", i když
není plátce. Nákup reklamy z Irska proto spadá pod přenesenou daňovou povinnost a
**českou DPH dlužíš ty finančnímu úřadu**. Když ale Meta/Google nedostanou tvoje DIČ,
vyhodnotí tě jako spotřebitele a **naúčtují DPH sami**. Ta je nevratná a tvoji povinnost
odvést českou DPH neruší → 21 % Googlu a dalších 21 % úřadu z téže reklamy.
`[OVĚŘIT s účetní — závisí na tom, jak si tě Google zařadí]`

**Správné pořadí:**

1. **Registrovat identifikovanou osobu** — přihláška datovou schránkou, *dřív* než první
   koruna do reklamy a dřív než přepis dodavatelů na IČO.
2. **Doplnit DIČ do fakturačních údajů** u Meta, Google Ads, Google Cloud, Vercelu,
   Supabase, Anthropicu, Resendu a Stripe.
3. **Teprve pak** spustit reklamu a překlopit náklady Chrlitu na IČO.

Tím se 15denní lhůta stane bezpředmětnou a dvojí zdanění nevznikne.

**K pohlídání do budoucna:** dokud jsou květiny z ČR, pořízení zboží z EU se neřeší.
Při případném přechodu na holandské aukce (FloraHolland a podobné) nastupuje **druhý,
samostatný spouštěč** s roční hranicí okolo 326 000 Kč `[OVĚŘIT výši]`.

### Nezhorší to podmínky květinářství? Ne.

Nejčastější a nejpochopitelnější strach. Odpověď je ne — protože **identifikovaná osoba
není plátce DPH**. Jsou to dvě různé věci, které se pletou:

| | Identifikovaná osoba | Plátce DPH |
|---|---|---|
| Prodej v ČR (kytice i předplatné) | **bez DPH, ceny se nemění** | +21 % ke každé ceně |
| Povinnost účtovat zákazníkům DPH | ne | ano |
| Nárok na odpočet DPH z nákupů | ne | ano |
| Přiznání k DPH | **jen za měsíce, kdy nákup ze zahraničí nastal** | vždy, každé období |

Konkrétně pro květinářství:

- **Prodejní strana se nemění vůbec.** Kytice za 590 Kč zůstane za 590 Kč, cenovky
  zůstávají, zákazníkům se nemění nic. (Kdyby se Adela stala **plátcem**, tam by kytice
  zdražila o 21 % nebo by se to ukrojilo z marže — to je ten scénář, kterého se lidé bojí,
  a identifikovaná osoba ho nezpůsobuje.)
- **Nákupní strana je nákladově neutrální — pokud dodavatelé mají tvoje DIČ.** S DIČ
  fakturují bez daně a Adela odvede českých 21 %, nevratných. Bez DIČ naúčtují svou DPH
  (irskou, holandskou), taky nevratnou. Stejná sazba, stejný náklad, přidá se papír.
  **Nebezpečný je jen třetí případ:** mít povinnost, ale DIČ dodavatelům nedat — pak
  platíš DPH dvakrát (viz sekce o pořadí výše).
- **Přidá se měsíční přiznání** v měsících se zahraničním nákupem. To je práce účetní,
  u téhle velikosti otázka pár stovek měsíčně.

### Zadání pro účetní

Registrace ještě neproběhla a povinnost zatím nevznikla, takže se **neřeší zpětná
registrace**, ale příprava na tu blížící se:

> 📌 „Chystám se spustit reklamu na Meta/Google a překlopit cloudové náklady na IČO.
> Registruj mě prosím jako identifikovanou osobu k DPH **ještě předtím**, ať nevznikne
> prošlá lhůta ani dvojí zdanění, a řekni mi, do kdy podáváme měsíční přiznání."

### Na co si dát pozor později

Jakmile Chrlit prodá předplatné **firmě v jiném státě EU** (stačí jeden slovenský
zákazník), přidá se k tomu **souhrnné hlášení** — poskytnutí služby do JČS. Dokud jsou
zákazníci čeští, neřeší se. Proto je volba „zatím jen ČR" i administrativní úspora,
ne jen marketingové rozhodnutí.

Registrace do paušálního režimu daně tím **není vyloučena** — zákaz se týká plátců DPH,
ne identifikovaných osob. `[OVĚŘIT s účetní]`

### Co to znamená (a co ne)

✅ **Zůstáváš neplátcem DPH vůči zákazníkům.** Faktury pro české zákazníky se dál
vystavují bez DPH, ceny 999 / 2 999 / 4 999 / 8 999 Kč zůstávají konečné.

❌ **Ale z nákupů ze zahraničí odvádíš českou DPH 21 %** v režimu přenesené daňové
povinnosti — a **bez nároku na odpočet**.

> 💸 **Rozpočtový dopad:** AI a cloud se prodraží o 21 %. Když měsíční náklady na
> Gemini + Vercel + Supabase + Anthropic dělají 10 000 Kč, odvedeš navíc 2 100 Kč.
> Tohle patří do `docs/pricing/cost-model.ts` jako násobek 1,21 na zahraničních
> nákladech — jinak jsou marže v kalkulačce nadhodnocené.

### Povinnosti po registraci

| Co | Kdy |
|----|-----|
| Přiznání k DPH — **jen za měsíce, kdy nákup ze zahraničí nastal** | do 25. dne následujícího měsíce |
| Odvod DPH z těch nákupů | stejná lhůta |
| Souhrnné hlášení | **nepodává se** — vzniká jen při *poskytnutí* služby do EU, a prodáváme jen v ČR |

### Hned po registraci: dej DIČ dodavatelům

Do fakturačního nastavení u Googlu, Vercelu, Supabase, Anthropicu a Resendu vyplň
**IČO i DIČ**. Bez DIČ ti naúčtují svou lokální DPH (irskou, americkou sales tax) —
a tu už nikdy nedostaneš zpátky, protože zaplatíš i tu českou. S DIČ fakturují
v reverse charge, tedy bez daně.

### Překlopení nákupů ze soukromé karty

Dnes běží všechno na soukromé kartě. Dokud to tak zůstane, **nejsou to daňově
uznatelné náklady** — platíš z nich daň, jako by neexistovaly. Postup:

1. Ověř s účetní, že povinnost nevznikla už dřív (viz upozornění výše).
2. Zřiď podnikatelský účet, pokud ještě není.
3. Přepiš fakturační údaje u dodavatelů na IČO — tím **spustíš 15denní lhůtu**
   pro registraci, takže to udělej vědomě a všude v jeden den.
4. Podej přihlášku k registraci (elektronicky, datovou schránkou).
5. Doplň DIČ zpátky k dodavatelům.
6. Přepni platební karty na podnikatelskou.

> Pořadí 3 → 4 → 5 se nedá zamíchat. Kdo dá dodavatelům DIČ dřív, než ho má, dostane
> odmítnutou fakturaci; kdo se registruje později než 15 dnů po prvním nákupu, řeší
> pokutu za pozdní registraci.

---

## 5. Bankovní účet

Zákon podnikatelský účet OSVČ nenařizuje, ale:

- ComGate posílá výplaty na účet vedený na IČO — soukromý účet obvykle neuzná,
- oddělení soukromých a firemních plateb ušetří hodiny při přiznání,
- při případném přechodu na plátcovství DPH se číslo účtu registruje u FÚ.

Zřiď ho **před** jednáním s ComGate.

---

## 6a. Stripe — provisionováno, ale v test režimu

> **Stav k 30. 7. 2026:** integrace přes Vercel Marketplace je nainstalovaná
> (`stripe-charcoal-planet`, připojeno k projektu `prodamevas`). Klíče
> `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` a `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
> jsou v env pro `production` i lokálně.

⚠️ **Je to sandbox v TEST režimu** — účet je US/USD a má `charges_enabled: false`.
Skutečné peníze přes něj neprojdou. Na stavbu a testování platební cesty to stačí
(testovací karty fungují), na prodej ne.

Pro živé platby je potřeba:

1. **Claimnout resource:** `npx vercel integration resource claim stripe-charcoal-planet`
   — tím se ze sandboxu stane skutečný účet pod tvým Stripe přihlášením.
2. **Dokončit Stripe onboarding**: české údaje, IČO 21263990, bankovní účet, KYC.
   Je to samoobslužné, ale je to úkon vázaný na tvou totožnost.
3. **Přepnout na CZK** jako výchozí měnu a ověřit, že `charges_enabled` je `true`.
4. Nahradit test klíče živými v env pro `production`.

**Poplatky a DPH:** provize Stripe je služba z irské entity → přenesená daňová
povinnost → připočti si k ní 21 % (viz kapitola 4). Reálný náklad z platby 999 Kč je
tedy ~25,60 Kč, ne ~21,20 Kč. U ComGate tenhle příplatek nevzniká.

## 6b. ComGate — smlouva na IČO (odloženo)

Aktuální stav v kódu: platby jsou připravené, ale `COMGATE_MERCHANT_ID` a
`COMGATE_SECRET` jsou prázdné a `COMGATE_RECURRING` je vypnuté.

Co zařídit:

1. Smlouva na **IČO 21263990** (ne na fyzickou osobu bez IČO).
2. KYC/AML doklady: doklad totožnosti, výpis z živnostenského rejstříku, číslo účtu.
   → **Výpis si vytáhni až po doplnění oborů činnosti** (kapitola 1), ať na něm je
   „poskytování software", a ne jen květinářské obory. ComGate se ptá, co prodáváš.
3. **Výslovně si vyžádej podporu opakovaných plateb** — bez ní `chargeRecurring()`
   nefunguje a předplatné se neobnoví. Je to samostatný bod smlouvy, ne výchozí stav.
4. Po podpisu doplň `COMGATE_MERCHANT_ID`, `COMGATE_SECRET` a `COMGATE_RECURRING=1`
   do env na Vercelu.

---

## 7. Fakturoid — ✅ hotovo

> **Stav k 30. 7. 2026:** účet `adelamuzatkova` je propojený a otestovaný.
> Režim DPH `non_vat_payer`, IČO 21263990, tarif „Na maximum" (rozesílání faktur
> e-mailem tedy funguje). Klíče jsou v `.env.local` i ve Vercelu (**jen `production`** —
> na preview by mock platba vystavila skutečný doklad do číselné řady).
>
> Ověření po rotaci klíčů: `npx tsx scripts/test-fakturoid.ts`
> (bezpečné — subjekty zakládá i maže, čísel faktur se nedotkne;
> `--invoice` vystaví skutečnou fakturu, používej vědomě).
>
> ⚠️ **Účet nemá vyplněný bankovní účet** — doplň ho v nastavení Fakturoidu
> *i* v `lib/legal.ts`, jinak na dokladu chybí.

Postup pro případ, že by se účet zakládal znovu:

1. Založ účet na jméno **Adela Mužátková**, IČO **21263990** (ARES ostatní údaje
   doplní sám). Pokud už Fakturoid pro květinářství existuje, **použij ho** — jeden
   subjekt má mít jednu číselnou řadu a jednu účetní, ne dvě.
2. V nastavení **zaškrtni „nejsem plátce DPH"** — jinak Fakturoid začne na doklady
   tisknout DPH, kterou nesmíš účtovat.
3. Nastav číselnou řadu (např. `2026NNNN`) a logo. Sdílíš-li účet s květinářstvím,
   zvaž **samostatnou číselnou řadu pro Chrlit**, aby se doklady daly rozlišit.
4. Nastavení → API → **vytvoř aplikaci (client credentials)**, zkopíruj `client_id`
   a `client_secret`.
5. Slug účtu je v URL po přihlášení: `app.fakturoid.cz/<slug>/...`
6. Doplň do env (lokálně i na Vercelu):

```bash
FAKTUROID_CLIENT_ID=...
FAKTUROID_CLIENT_SECRET=...
FAKTUROID_SLUG=...
FAKTUROID_USER_AGENT="Chrlit (info@chrlit.cz)"   # nepovinné, jinak se odvodí
```

> ℹ️ Rozesílání faktur e-mailem je funkce **placených tarifů** Fakturoidu. Když na
> tarifu není, doklad se pořád vystaví a odkaz na něj odejde v našem vlastním
> potvrzovacím e-mailu — zákazník o doklad nepřijde.

**Pro účetní:** stačí jí dát přístup do Fakturoidu. Nemusí do aplikace ani do Supabase.

---

## 8. GDPR — co je a co není potřeba

### Potřeba

- **Záznamy o činnostech zpracování** (čl. 30 GDPR) — sepsaný dokument, který si
  necháváš u sebe. Nikam se neposílá, ale ÚOOÚ ho může chtít vidět. Obsah:
  účely zpracování, kategorie subjektů a údajů, příjemci, lhůty výmazu, zabezpečení.
  → Podklad je hotový: seznam zpracovatelů je v `lib/legal.ts` (`SUBPROCESSORS`),
  účely a právní základy v tabulce na `/privacy`. Stačí to přepsat do jednoho souboru.
- **Smlouvy o zpracování (DPA)** s dodavateli — u všech se uzavírají odsouhlasením
  jejich standardních podmínek. Zkontroluj, že máš odsouhlasený DPA u: Supabase,
  Vercel, Google Cloud, Anthropic, Resend, ComGate, Fakturoid, Meta.
- **Aktuální seznam zpracovatelů.** Když přibude dodavatel, přibude řádek
  v `SUBPROCESSORS` — jinak jsou zásady na `/privacy` nepravdivé.

### Není potřeba

- ❌ **Registrace u ÚOOÚ** — zrušena s příchodem GDPR v roce 2018.
- ❌ **Pověřenec pro ochranu osobních údajů (DPO)** — podmínky čl. 37 nesplňujeme.
- ❌ **Cookie lišta** — používáme jen technicky nezbytné cookies (přihlášení).
  Souhlas se u nich nevyžaduje. *Pozor: jakmile přibude Google Analytics nebo
  jakýkoli měřicí pixel, lišta se stává povinnou.*

---

## 9. Co v aplikaci ještě chybí vyplnit

Identita se čte z jednoho místa: **`lib/legal.ts`**. Údaje z ARESu už jsou doplněné:

| Údaj | Hodnota | Stav |
|------|---------|------|
| Jméno | Adela Mužátková | ✅ z rejstříku (viz upozornění o délce nahoře) |
| IČO | 21263990 | ✅ |
| Adresa | Svitákova 2729/10, 155 00 Praha 5 | ✅ |
| Živnostenský úřad | Úřad městské části Praha 13 | ⚠️ `[OVĚŘIT na výpisu]` — sídlo je ve Stodůlkách (správní obvod Praha 13), ale ARES u adresy uvádí městský obvod „Praha 5" |
| Režim DPH | neplátce | ✅ (ARES: bez DIČ) |
| **Bankovní účet** | — | ❌ **jediné, co chybí** |

Zbývá tedy doplnit jednu věc, buď v `lib/legal.ts`, nebo env proměnnou na Vercelu:

```bash
NEXT_PUBLIC_BUSINESS_BANK_ACCOUNT="123456789/0100"
```

Volitelně, až budou známé:

```bash
NEXT_PUBLIC_BUSINESS_PHONE="+420 ..."
NEXT_PUBLIC_BUSINESS_IBAN="CZ..."

# Až proběhne registrace identifikované osoby (kapitola 4):
NEXT_PUBLIC_BUSINESS_DIC="CZ..."
NEXT_PUBLIC_BUSINESS_VAT_STATUS="identified"

# Až obrat přeroste 2 mil. Kč (kapitola 10) — přepne texty i sazbu na fakturách:
NEXT_PUBLIC_BUSINESS_VAT_STATUS="payer"
```

Kontrola, že nic nechybí:

```bash
npx tsx scripts/check-legal-identity.ts
```

Skript projde povinné údaje a **skončí chybou, dokud tam zůstane `DOPLNIT`**. Pusť ho
před prvním ostrým prodejem — nedoplněné údaje v obchodních podmínkách jsou porušení
informační povinnosti, ne kosmetická vada.

---

## 10. Termíny hlídá agent — nemusíš si je pamatovat

> ✅ **Zautomatizováno.** `lib/agents/compliance-calendar.ts` běží denně v rámci
> `daily-ops` a **e-mailuje jen tehdy, když se blíží termín nebo je něco rozbité.**
> Tichý den nepošle nic — agent, který píše každý den, se přestane číst.

Co hlídá sám:

| Sleduje | Ozve se |
|---|---|
| měsíční přiznání k DPH (jen když je `vatStatus` ≠ `none`) | 5 dní před 25. |
| paušální režim daně | 14 dní před 10. 1. |
| nové minimální zálohy | 21 dní před koncem ledna |
| daňové přiznání | 30 dní před 2. 5. |
| Přehledy pro ČSSZ a pojišťovnu | 21 dní před 2. 6. |
| **obrat vůči hranici 2 mil. Kč** | při 70 % a znovu při 90 % |
| doklady, které se nepodařilo vystavit | ihned |
| chybějící identifikační údaje | bez termínu, „až bude čas" |

Dva detaily, které rozhodují, jestli je to k něčemu:

- **Měsíční přiznání se zapne samo** ve chvíli, kdy nastavíš
  `NEXT_PUBLIC_BUSINESS_VAT_STATUS=identified`. Tedy tentýž přepínač, který mění
  texty na fakturách, rozsvítí i upozornění. Není co zapomenout zvlášť.
- **Obrat je nutné doplnit o květinářství.** Hranice se počítá za osobu, ne za
  činnost, takže agent umí spočítat jen svoje faktury. Nastav roční obrat
  ostatních činností do `LEGAL_OTHER_TURNOVER_CZK` (v Kč) — dokud to tam není
  a Chrlit už něco vydělal, agent sám hlásí, že jeho číslo je neúplné.

Ověření a živý stav: `npx tsx scripts/test-compliance-calendar.ts` (27 assercí
+ výpis toho, co by agent poslal dnes).

### Referenční tabulka termínů

| Kdy | Co | Komu |
|-----|-----|------|
| do 25. dne měsíce | přiznání k DPH — **jen za měsíce s nákupem ze zahraničí** | Finanční úřad |
| leden (do 10.) | případný vstup do paušálního režimu na daný rok | Finanční úřad |
| leden | nová výše minimálních záloh — přenastavit trvalé příkazy | ČSSZ, pojišťovna |
| **2. 5.** `[OVĚŘIT přesné datum pro 2027]` | daňové přiznání za rok 2026 (elektronicky, povinně kvůli datovce) | Finanční úřad |
| do měsíce po přiznání | Přehled o příjmech a výdajích | ČSSZ |
| do měsíce po přiznání | Přehled o příjmech a výdajích | zdravotní pojišťovna |
| průběžně | sledovat obrat vůči hranici **2 000 000 Kč / 12 měsíců** | → povinné plátcovství DPH |

### ⚠️ Hranice plátcovství DPH je blíž, než tvrdí cenový audit

`docs/pricing/PRICING_AUDIT.md` říká, že 2 mil. Kč / 12 měsíců je „daleko", protože
odpovídá MRR přes 166 000 Kč. **Ten výpočet ale počítal jen s Chrlitem.**

Obrat se sleduje **za osobu, ne za činnost** — do hranice se sčítá **Chrlit i
květinářství**. Skutečná rezerva je tedy:

```
2 000 000 Kč − roční obrat květinářství = kolik smí Chrlit udělat, než vznikne plátcovství
```

→ **Zjisti obrat květinářství za posledních 12 měsíců a odečti ho.** Kamenné
květinářství na Vinohradské může samo o sobě dělat stovky tisíc až jednotky milionů;
v horším případě je hranice překročená ještě předtím, než Chrlit prodá první
předplatné, a plátcovství přijde jako podmínka spuštění, ne jako vzdálená budoucnost.

Až plátcovství nastane, ceny se **nezdraží o 21 %** — B2B zákazníci si DPH odečtou,
takže se přechází na uvádění cen bez DPH (`NEXT_PUBLIC_BUSINESS_VAT_STATUS=payer`
přepne texty i sazbu na fakturách automaticky). Pro spotřebitele je to ale reálné
zdražení nebo ukrojení z marže — proto to patří do plánu, ne do překvapení.

> 📌 **Akce:** dokud se to nespočítá, ber tvrzení „DPH je daleko" v cenových
> dokumentech jako neověřené a nepoužívej ho pro rozhodování o cenách.

---

## 11. Co dělat NEMUSÍŠ (ušetřený čas)

- ❌ **Zakládat novou živnost, IČO, nebo cokoli registrovat u FÚ / ČSSZ / pojišťovny** —
  Chrlit jede pod stávajícím IČO 21263990. Jediné, co se na úřadě dělá, je **doplnění
  oborů činnosti** (kapitola 1) a **registrace k DPH** (kapitola 4).
- ❌ **Zřizovat datovou schránku** — existuje od 2024.
- ❌ **Zakládat provozovnu pro Chrlit** — online služba bez pultu žádnou nemá.
- ❌ **EET / elektronická evidence tržeb** — zrušena k 1. 1. 2023. Neexistuje.
- ❌ **Registrace u ÚOOÚ** — viz výše.
- ❌ **Registrační pokladna, účtenky** — platby jdou kartou přes bránu, doklad je faktura.
- ❌ **Odkaz na evropskou platformu ODR** v obchodních podmínkách — platforma byla
  **ukončena 20. 7. 2025**. Odkazovat na ni je dnes chyba; v podmínkách je proto
  jen ČOI. Pokud narazíš na vzor podmínek, který ODR uvádí, je zastaralý.
- ❌ **Živnost vázaná nebo koncesovaná** — tvorba software i marketing spadají pod
  volnou, žádná odborná způsobilost se nedokládá.
- ❌ **Zápis do obchodního rejstříku** — OSVČ se zapisuje do živnostenského, ne obchodního.
- ❌ **Ochranná známka** — není povinná. Zvažuj až při reálné konkurenci
  (ÚPV, ~5 000 Kč, platnost 10 let).

---

## 12. Stav implementace v kódu

| Hotovo | Kde |
|--------|-----|
| Identita na jednom místě | `lib/legal.ts` |
| Obchodní podmínky (identifikace, 14denní odstoupení, reklamace, ČOI) | `app/terms/page.tsx` |
| Zásady zpracování údajů (správce, zpracovatelé, ÚOOÚ, doby uchování) | `app/privacy/page.tsx` |
| Identifikace prodávajícího v patičce + info o DPH u ceníku | `app/page.tsx` |
| Sběr fakturačních údajů + souhlas se zahájením plnění | `app/actions/billing-actions.ts`, `tabs/BillingSection.tsx` |
| Automatické vystavení dokladu po zaplacení | `lib/fakturoid.ts`, `lib/invoicing.ts`, `api/payments/callback` |
| Přehled dokladů pro zákazníka | `tabs/BillingSection.tsx` (Nastavení) |
| Kontrola úplnosti identity | `scripts/check-legal-identity.ts` |

| Hotovo | Kde |
|--------|-----|
| Identifikační údaje z ARESu (IČO, adresa, režim DPH, jméno „Adela") | `lib/legal.ts` |
| **Migrace `20260730_billing_invoices.sql` aplikovaná v produkci** (30. 7. 2026) | `ig_billing_details`, `invoices` |
| Ověřeno v produkci: UNIQUE index odmítne druhý doklad na tutéž platbu | `idx_invoices_payment_unique` |
| **Fakturoid propojený a otestovaný** (účet `adelamuzatkova`, neplátce DPH) | `.env.local` + Vercel `production` |
| Ověření napojení na Fakturoid | `scripts/test-fakturoid.ts` |
| **Denní hlídání daňových termínů + obratu** (e-mail jen když je co řešit) | `lib/agents/compliance-calendar.ts`, kapitola 10 |

| Čeká na tebe | Blokuje | Pořadí |
|--------------|---------|--------|
| **Doplnit obory činnosti k živnosti** (kapitola 1) | legální prodej — dnes Chrlit není krytý | 1. |
| **Registrovat identifikovanou osobu k DPH — PŘED spuštěním reklamy a před přepisem dodavatelů na IČO** | jinak prošlá lhůta + riziko dvojího zdanění (kapitola 4) | 2. |
| Spočítat obrat květinářství vs hranice 2 mil. Kč | cenovou strategii (možná plátcovství hned) | 3. |
| Přijmout licenční podmínky Stripe v prohlížeči | dokončení instalace platební brány | 4. |
| Doplnit `LEGAL_OTHER_TURNOVER_CZK` (roční obrat květinářství) | pravdivé sledování hranice DPH | 5. |
| Sepsat záznamy o činnostech zpracování | kontrolu ÚOOÚ | kdykoli |
| Doplnit číslo bankovního účtu | **nic** — už není blokátor, jen chybí na dokladu | kdykoli |
