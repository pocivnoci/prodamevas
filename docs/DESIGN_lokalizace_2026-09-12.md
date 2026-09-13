# Lokalizace — návrh: jazyk značky a jazyk uživatele (12. 9. 2026)

Zadání: „přeložit celou aplikaci včetně promptů do víc jazyků". Tenhle dokument
říká, co to v Chrlitu znamená (z kódu), jaká rozhodnutí padla, co je hotové a
v jakém pořadí jde zbytek. Pravidla, která z toho plynou, jsou ve skillu
`.claude/skills/localization/SKILL.md`; vynucuje je `npm run guard` (§42, sekce L).

## Diagnóza z kódu (před zásahem)

| Vrstva | Stav | Rozsah |
|---|---|---|
| **Engine (prompty)** | čeština zadrátovaná ~160× („Piš česky", „Czech diacritics (ě š č…)", „Český text pro voiceover"), TTS `language: "cs"` jako literál typu, svátky jen české, `hashtagPools.czech` | 25 souborů v `instagram/`, `app/onboarding/`, `app/actions/` |
| **UI dashboardu** | texty přímo v JSX, žádná i18n knihovna, `<html lang="cs">`, `og:locale cs_CZ`, `lib/plural.ts` jen české tvary | ~2 700 řádků s češtinou v 54 souborech `app/(dashboard)/`, ~370 v `components/` |
| **Server actions / API** | chybové a stavové hlášky česky v návratových hodnotách | ~1 400 řádků v `app/actions/`, ~700 v `app/api/` |
| **Marketing** | landing, blog, `/aplikace`, `/ukazka`, metadata | ~250 řádků |
| **E-maily** | `lib/mail/templates/*` čisté funkce `vars → blocks`, česky | ~600 řádků |
| **Doklady, platby** | Fakturoid `language: "cz"`, ComGate `lang` (cs/en/sk), právní texty vázané na ČR | malé |
| **Interní agenti** | denní brief, obchodní preview, úkoly — mluví k provozovateli | zůstává česky záměrně |

Žádná existující osa „jazyk" — jediný náznak byl komentář u TTS („dnes vždy cs").

## Rozhodnutí

1. **Dvě osy, ne jedna.** Jazyk *obsahu* je vlastnost značky (tenantu), jazyk *UI*
   vlastnost uživatele. Česká agentura spravuje německou značku: dashboard česky,
   posty německy. Jedna osa by nutila buď agenturu pracovat v němčině, nebo
   německou značku psát česky.
2. **Prompty se nepřekládají, parametrizuje se výstup.** Mega prompt má ~1 700
   řádků a ladí se týdny; N kopií v N jazycích by se rozešly za měsíc. Model je
   vícejazyčný — prompt zůstává česky, každé místo, které dřív říkalo „česky",
   bere frázi z jazykového balíčku (`instagram/language.ts`), a u cizího jazyka
   dostane navíc **nativní kotvu** (věta v jazyce samotném) a výčet, co všechno
   má být v jazyce publika. Kdyby se u některého jazyka ukázalo, že česky psaná
   instrukce sráží kvalitu, je to důvod přepsat prompt do angličtiny — ne do N
   jazyků.
3. **Vše, co AI říká o značce, je v jazyce značky** — i brand memory, výtky
   kritika, popisky fotek, návrhy formátů. Důvod: to samé pak čte copywriter jako
   kontext a čím blíž výstupnímu jazyku, tím líp přenáší (německé „vyhni se
   klišé X" má smysl jen německy). Jediná výjimka: onboardingové otázky, což je
   rozhovor s uživatelem → jazyk UI.
4. **Svátky jsou vlastnost trhu, ne jazyka.** Balíček nese `country`; kalendář má
   tabulku per země a pohyblivé svátky **počítá** (Velikonoce, Den matek, Black
   Friday…) místo „přibližných" pevných dat.
5. **Clamp, ne default-through.** `validateConfig()` propustí jen známý kód;
   chybějící = čeština, takže všichni existující klienti mluví dál stejně.
6. **Jazyk UI bez prefixu v URL.** Dashboard je hash-SPA (`#posts`), marketingové
   URL jsou indexované; `/en/…` by rozbilo hluboké odkazy i SEO. Locale se řeší
   cookie + `user_metadata`, ne routováním.
7. **Právní texty se nepřekládají technicky.** Obchodní podmínky a zásady jsou
   vázané na českou jurisdikci; anglická verze je právní rozhodnutí.

## Hotovo (tahle větev)

### Osa 1 — jazyk obsahu značky

- `instagram/language.ts`: `CONTENT_LANGUAGES` = cs, sk, en, de, pl; `LanguagePack`
  (`englishName`, `adverbCs`, `styleCs`, `nativeRule`, `diacritics`, `country`,
  `locale`); helpery `contentLanguage(config)`, `languagePack(code)`,
  `writeRuleCs`, `languageSectionCs`, `exactTextRule`, `verbatimRule`,
  `diacriticsClause`, `detectContentLanguage`, `languageOptions`.
- `ClientConfig.language` + clamp ve `validateConfig()`; `languageForClient(clientId)`
  pro kód, který má jen UUID (učicí smyčky paměti).
- Prompty napojené na balíček: copywriter (schémata i mega prompt, všechna čtyři
  média), kritik, souboj návrhů, revize, plánovací pipeline, scenárista i režisér
  reelu, zkracování narrace, redakce, brand memory (4 učicí prompty), produktové
  nápady, produktové řady, zásobník nápadů, faktická brána, štítkování fotek,
  vision audit feedu, kontextový agent, CLI; obrazová pipeline (design brief,
  nativní prompt, karusel, story, retuš, vision QA), všechny čtyři orchestrátory
  (korektivní edity + QA očekávání), tisková pipeline (brief, artwork, QA), akce
  (návrh formátu, revize produktu, kategorie plánu, regenerace položky, produktový
  caption, retuš postu, retuš tisku, produktový brief).
- TTS: `TtsSynthesizeOptions.language: ContentLanguage`; `synthesizeNarration`
  bere jazyk explicitně, reel orchestrátor ho předává z configu.
- Kalendář per trh: CZ, SK, PL, DE, INTL (angličtina), jmeniny pro CZ/SK/PL.
- Onboarding: `analysis.language` z webu (`<html lang>` → `og:locale` →
  diakritika → anglické spojky → čeština), config ho dostane z analýzy; ruční
  onboarding má pole `language`; IG analýza, vision feedu a štítky fotek jdou
  v jazyce značky.
- Nastavení → Základní informace: výběr „Jazyk obsahu"; hashtagový pool „České"
  přejmenovaný na „Lokální" (klíč `czech` zůstává kvůli datům).
- Guard: §42 statické zámky (žádné „Czech"/„česky" natvrdo v promptech, clamp,
  TTS, kalendář, onboarding, Nastavení), sekce L v prompt-assembly (runtime:
  prompt pro de/pl/sk, schémata, obrazový prompt s diakritikou, retuš, scénář,
  režisér, kalendář vč. pohyblivých svátků, detekce jazyka).

### Co zůstává jako vědomý dluh v ose 1

- Rychlost řeči pro rozpočet narrace (`SPOKEN_WORDS_PER_SECOND` 2,2) je společná —
  po prvních cizojazyčných reelech případně parametrizovat v balíčku.
- Zalamování titulků (`reel-subtitles.ts`) používá české pravidlo o jednopísmenných
  předložkách — u ostatních jazyků neškodí, jen není optimální.
- Ukázka hlasu v Nastavení je česká katalogová věta (není to obsah značky).
- Země ≠ jazyk (rakouská značka, švýcarská): kalendář jde po `L.country`; kdyby
  to vadilo, přidat `ClientConfig.country` s defaultem z balíčku.
- Analýza produktového briefu počítá s českým DPH/clem — je to interní laboratoř
  produktů, ne obsah pro publikum.

### Osa 2 — jazyk UI: hotovo v téhle větvi

- `next-intl` bez routování: `lib/i18n/request.ts` (registrovaný v `next.config.ts`),
  `lib/i18n/locales.ts` (cs, en; cookie `NEXT_LOCALE`; `Accept-Language`),
  `lib/i18n/server.ts` (`resolveUiLocale`, `syncLocaleCookieFromUser`,
  `paymentPageLanguage`), `lib/i18n/messages.ts` (`MESSAGE_FILES` — jeden JSON na
  namespace, `loadMessages(locale)` je slévá), `lib/i18n/actions.ts`
  (`actionTranslator(ns)` pro server actions a API routy; mimo request spadne na
  češtinu, zóna Europe/Prague), `app/actions/locale-actions.ts` (`setUiLocale` =
  cookie + `user_metadata.locale`).
- `components/i18n/UiLocaleProvider` obaluje dashboard a auth stránky; kořenový
  layout zůstává statický, `<html lang>` nastavuje `HtmlLang` v prohlížeči;
  cookie lišta (v kořenovém layoutu, bez provideru) bere texty z `core.json`
  přímo podle cookie.
- `messages/cs/*.json` (zdroj) + `messages/en/*.json`: core (common, nav, sections,
  shell), auth, settings, generate, posts, dashboard, plan, inspiration, brand,
  performance, help, shared, billing, products, adminOnboard, adminOps, adminGrowth,
  onboarding, actionsPlan, actionsContent, actionsAccount, actionsAdmin, api, mail,
  notices, worker.
- Migrováno (UI): registr navigace, sidebar/sheet, spodní lišta, mobilní lišta,
  chybová obrazovka, pruh předplatného, instalační pruh, přihlášení / registrace /
  obnova hesla / nové heslo, přepínač jazyka; **všech 17 tabů studia** vč.
  adminských a produktových sekcí, nápověda a tutoriál; průvodce onboardingem
  (page, TaskProgress, task-client, layout; otázky se generují v jazyce UI);
  adminský JSON editor (`dashboard/settings`); paywall, dokoupení kreditů,
  vestavěná pokladna, chybová stránka studia.
- Migrováno (server): **všechny server actions** v `app/actions/*` a backend
  onboardingu — hlášky pro UI přes `actionTranslator(<namespace>)` uvnitř akce,
  prompty pro modely česky v blocích `i18n-ignore-start: prompt`, sentinely
  v datech s řádkovým `i18n-ignore`; API routy, které čte prohlížeč (`api`:
  joby, stav/spuštění onboardingové úlohy, platby, most IG vč. HTML mezistránek
  s `<html lang>`); `lib/auth-guard.ts` vyhazuje `AuthError` s `code` a zprávou
  v jazyce uživatele (`isAuthError` místo hledání textu); `humanizeErrorWith`
  (síťové/AI chyby onboardingu) v jazyce uživatele; důvody z `lib/subscription`
  lokalizuje `credit-guard` (`localizeReason`).
- Průběh generování: engine hlásí `agent_message` česky (zdroj); GenerateTab
  v jiném jazyce UI ukazuje popisek fáze podle `status`
  (`generate.progress.engine.*`). Hlášky zapsané cronem bez uživatele zůstávají
  české.
- Guard: `scripts/test-i18n.ts` (parita klíčů cs/en vč. ICU proměnných přes
  skutečný parser, registr nese klíče, každá sekce má text, `MIGRATED` bez
  češtiny natvrdo — komentáře, `console.*`, `i18n-ignore` řádky a bloky se
  nepočítají, každý blok uzavřený — zapojení plateb/dokladů/e-mailů); e2e aserce,
  které pinnovaly české texty UI, čtou `messages/cs/<ns>.json`.

### Platby, doklady, e-maily: hotovo v téhle větvi

- ComGate `lang` a Stripe `locale` = jazyk UI, ve kterém kupující platí
  (`paymentPageLanguage()` v `lib/i18n/server.ts`).
- Fakturoid `language` podle země fakturační adresy (`fakturoidLanguage`: CZ→cz,
  SK→sk, DE/AT/CH→de, PL→pl, jinak en) — u subjektu i dokladu.
- Layout e-mailu nese `locale` (`<html lang>`, patička, odhlášení);
  `sendNotification` a `renderTemplate` ho předávají. `lib/mail/i18n.ts`:
  `mailTranslator(locale)` (next-intl `createTranslator` nad `messages/<locale>/mail.json`,
  funguje i v cronech bez request kontextu) + `localeOfUser`. První lokalizovaný
  transakční e-mail: uvítání po potvrzení účtu (`app/auth/callback/route.ts`).

### Pošta zákazníkovi: hotovo v téhle větvi (vlna 4)

- `lib/mail/i18n.ts`: `mailTranslatorSync(locale, ns)` nad staticky
  naimportovanými zprávami (`mail`, `notices`, `worker`) — překladač jde postavit
  i synchronně, takže šablony zůstaly čisté funkce a jdou vyrenderovat v guardu
  bez `.env.local`. `localeOfUser(user)` a `localeOfClientOwner(clientId)`
  (nejnovější vazba `owner`, stejné řazení jako `getOwnerEmail`).
- Šablony: `build(vars, t, locale)`, `renderTemplate(…, locale)`, registr
  `render(vars, unsubscribeEmail, locale)` a `draft(vars, locale)` — bez `locale`
  čeština, takže volající, který jazyk nezná, dostane to co dřív. Migrované:
  transakční (uvítání, potvrzení platby, předání značky), předplatitelské
  (obnova, neúspěšná platba, konec, winback) a waitlistové.
- Zákaznická oznámení (`notices`): `buildCustomerNotice`, `buildLifecycleEmail`
  berou `t`/`locale`; jazyk zjišťuje odesílající funkce v okamžiku odeslání.
- Workery (`worker`): digest kampaně (datum přes `Intl` podle locale, počty přes
  ICU plural) a průběh onboardingových úloh (jazyk zadavatele z `uiLocale`
  v payloadu, jinak z účtu).
- Potvrzení plateb: dobití kreditů, rezervace konzultace i aktivace/obnova tarifu
  v jazyce vlastníka značky, včetně řádku s daňovým dokladem.
- Guard: aserce „zpráva s tagem se nevolá prostým t()" a „tagy v překladu sedí se
  zdrojem" — `<strong>` je pro next-intl ICU tag a `t()` na něm vyhodí za běhu
  `FORMATTING_ERROR`; tohle je jediná chyba téhle vlny, kterou typy nezachytí.

## Osa 2 — jazyk UI: co zbývá

Zbytek je buď rozhodnutí (obchodní, právní), nebo vědomý dluh s malým dopadem:

1. **Marketing a právní stránky** — landing (`components/Landing.tsx`), `/aplikace`,
   `/portfolio`, `/blog`, `/ukazka/<token>`, patička a hlavička webu, kontaktní
   formulář zůstávají české až do rozhodnutí o trhu (SK „téměř zadarmo", PL
   „skutečná práce" — `docs/BUSINESS_PLAN.md`); `app/terms`, `app/privacy`,
   `lib/legal.ts` (věta o DPH, identita, souhlasy) jsou vázané na jurisdikci —
   překlad je právní rozhodnutí. Anglický zákazník dnes vidí anglické UI a
   e-maily, ale české podmínky a českou větu o DPH v patičce e-mailu s cenou.
2. **Měna** zůstává CZK (ceník, kredity, doklady), dokud se neotevře ceník v EUR
   (`brain/GTM/Ceník.md`). Fakturoid dostává jazyk dokladu podle země odběratele,
   ale položka dokladu (`payments.label`, „Chrlit — dobití: …") je česká.
3. **Průběh dlouhých úloh** — hlášky enginu (`instagram/autopilot.ts`,
   orchestrátory, `plan-pipeline.ts`, `line-generator.ts`, `print-pipeline.ts`)
   jsou české; UI v jiném jazyce ukazuje popisek fáze podle `status`, u plánu,
   řad a tisku vidí smíšený text (hlášky akcí přeložené, hlášky pipeline české).
   Plná věrnost = engine hlásí klíč + parametry místo věty (33 míst `report(...)`)
   — udělat, až bude první cizojazyčný zákazník.
4. **E-maily správci a marketingové rozesílky** zůstávají české vědomě: ranní
   brief, incident watch, health check, weekly report, konzultační brief a
   nabídkové/novinkové šablony. Adminské popisky šablon (`label`, `fields`,
   `GROUP_LABELS`, `KIND_LABELS`) taky — čte je jen správce v Mailingu.
5. **Cron bez uživatele** — `campaign-worker`, `job-resume`, reaper: `agent_message`
   a `error` zapsané cronem jsou české (UI je v jiném jazyce nahradí popiskem fáze;
   `error` kampaně se ukáže česky). Rozhodnutí: jazyk vlastníka značky by šel
   dohledat (`localeOfClientOwner`), zatím to za tu cestu nestojí.
6. **Label mapy v `lib/`** (`STATUS_LABELS`, `REEL_LABELS`, `feed-pattern`,
   `subtitle-presets`, `fact-check-modes`, `photo-policy`, `credits`) zůstávají
   české; migrované taby je překládají podle hodnoty. Zbytek, který ještě proteče
   do UI česky: `recommendFeedPattern().label`, `describeRisks()` (zdraví klienta,
   admin), chyby mostu z `lib/channels/*`, `lib/handoff.ts`.
7. **Dokumenty pro zákazníka** — export produktového briefu (`lib/product-brief-docx.ts`)
   má české nadpisy a AI obsah v češtině (interní laboratoř produktů).
8. **Formát data v angličtině** — `useFormatter()` z next-intl dává pro `en`
   americké pořadí (měsíc/den), `UI_LOCALE_TAGS` říká en-GB; při prvním britském
   zákazníkovi předat `formats` do request configu.
9. **Odhlašovací stránka, výmaz dat, potvrzení z e-mailu správci**
   (`/api/email/unsubscribe`, `/api/data-deletion`, `/api/agent-approval`) —
   veřejné stránky bez cookie; jazyk by musel nést podepsaný odkaz.

Invariant pro každý krok: guard drží, `npm run build` zelený, čeština vypadá
stejně jako před krokem (zdrojový jazyk se nemění, jen se přesouvá do messages).

## Značka mimo český trh: co chybí mimo jazyk

Ověřeno spuštěním nad americkou značkou (13. 9. 2026). **Obsah v angličtině jede**:
onboarding jazyk pozná z webu (`<html lang>` → `og:locale` → diakritika → spojky),
`validateConfig()` ho udrží, copywriter dostane „Write in natural, modern,
conversational English…", svátky se přepnou na anglickou sadu (ověřeno: 26. 11. 2026
→ Thanksgiving, 25. 12. → Christmas Day). Čtyři věci ale zůstaly svázané s ČR a
značka mimo něj na ně narazí:

1. **Počasí se ptá jen na české město.** `instagram/signals/weather.ts` má v dotazu
   na geokódování natvrdo `,CZ` a v předpovědi `lang=cz` (výchozí město „Praha").
   Cizí město se nenajde, funkce vrátí `null` a kontextový agent o signál tiše
   přijde — degradace není vidět v UI, jen ve varování v logu.
2. **Plánovač počítá sloty v Praze.** `lib/schedule-planner.ts` odvozuje posun
   zóny z `Europe/Prague`, takže slot „9:00" znamená devět ráno v Praze. Pro
   americkou značku je to noc. Publikování proběhne správně, jen v nesmyslnou
   hodinu pro publikum.
3. **Americké svátky nejsou kompletní.** `INTL` kalendář v `instagram/signals/calendar.ts`
   má Thanksgiving, Black Friday a Cyber Monday, ale ne Independence Day (ověřeno:
   4. 7. 2026 vrátí prázdné `holidays`), Memorial Day ani Labor Day. `INTL` je
   schválně „anglicky mluvící obecně", ne US — konkrétní trh potřebuje vlastní sadu.
4. **Peníze jsou české.** Ceník i `lib/payments/checkout.ts` počítají v CZK, doklad
   jde z Fakturoidu podle české legislativy a obchodní podmínky existují jen česky.
   Zahraniční zákazník zaplatí kartou, ale uvidí částku v Kč. Navíc
   `instagram/product-generator.ts` má v popisu schématu příklad ceny „299-499 Kč",
   takže produktové nápady navrhují koruny i anglické značce.

**Tvar opravy pro body 1–3** (bod 4 je obchodní a právní rozhodnutí, ne technické):
`ClientConfig` dostane `country` a `timezone` s defaultem odvozeným z jazykového
balíčku (`languagePack(lang).country`) — nové pole potřebuje default ve
`validateConfig()`, jinak guard neprojde. Počasí pak bere zemi odtud místo `,CZ`
a jazyk popisů z `contentLanguage(config)`; plánovač bere zónu odtud místo
`Europe/Prague`; kalendář si podle `country` vybere sadu a `US` přibude vedle
CZ/SK/PL/DE/INTL. Země ≠ jazyk (rakouská značka, švýcarská) — proto pole na
konfiguraci, ne odvození z jazyka za běhu.
