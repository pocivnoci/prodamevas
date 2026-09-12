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
  `lib/i18n/server.ts` (`resolveUiLocale`, `syncLocaleCookieFromUser`),
  `app/actions/locale-actions.ts` (`setUiLocale` = cookie + `user_metadata.locale`).
- `components/i18n/UiLocaleProvider` obaluje dashboard a auth stránky; kořenový
  layout zůstává statický, `<html lang>` nastavuje `HtmlLang` v prohlížeči.
- `messages/cs.json` (zdroj) + `messages/en.json`: `common`, `nav`, `sections`,
  `shell` (horní lišta, chybová obrazovka, pruh předplatného, instalace), `auth`.
- Migrováno: registr navigace (klíče), sidebar/sheet, spodní lišta, mobilní lišta,
  nadpisy a popisky sekcí, chybová obrazovka, pruh předplatného, instalační pruh,
  přihlášení / registrace / obnova hesla / nové heslo; přepínač jazyka v navigaci
  studia i na auth stránkách; jazyk účtu se opisuje do cookie při přihlášení,
  OAuth callbacku a registraci.
- Guard: `scripts/test-i18n.ts` (parita klíčů cs/en vč. ICU proměnných, registr
  nese klíče, každá sekce má text, migrované soubory bez češtiny natvrdo, zapojení).

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

## Osa 2 — jazyk UI: co zbývá

Pořadí je dané tím, co vidí platící zákazník nejdřív a co se nejhůř přepisuje
zpětně:

1. **Taby dashboardu** — po jednom (Generate, Posts, Plan, Settings jsou největší),
   každý tab vlastní namespace v messages, hlášky ze server actions přes
   `getTranslations()`; guard aserce, které pinnují české labely (např. §9
   „Instrukce pro obrázky"), se přesměrují na `messages/cs.json`.
2. **E-maily uživateli** — obsah šablon (`lib/mail/templates/*`, zprávy agentů
   v `lib/agents/*-templates.ts`) přes `mailTranslator(localeOfUser(...))`;
   transakční (aktivace, obnova, faktura) nejdřív; jazyk příjemce se bere z účtu
   (`user_clients` → `auth.admin.getUserById` → `user_metadata.locale`).
   Marketingové broadcasty zůstávají česky, dokud není cizojazyčná báze zákazníků.
3. **Měna** zůstává CZK, dokud se neotevře ceník v EUR (obchodní rozhodnutí, viz
   `brain/GTM/Ceník.md`).
4. **Marketing** — landing a `/aplikace` až s rozhodnutím o trhu (SK „téměř
   zadarmo", PL „skutečná práce" — `docs/BUSINESS_PLAN.md`). `lib/plural.ts`
   (české tvary počtů) zůstává pro nemigrované taby; migrovaný text používá ICU
   plural v messages.

Invariant pro každý krok: guard drží, `npm run build` zelený, čeština vypadá
stejně jako před krokem (zdrojový jazyk se nemění, jen se přesouvá do messages).
