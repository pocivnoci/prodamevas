---
name: localization
description: >-
  Dvě jazykové osy Chrlit Studia — jazyk OBSAHU značky (config.language,
  instagram/language.ts, svátky po trhu, TTS, typografie v obraze) a jazyk UI
  uživatele (next-intl, messages/*.json). Načti při práci s instagram/language.ts,
  signals/calendar.ts, jakýmkoli promptem, který zmiňuje jazyk („česky", „Czech",
  diakritika), při přidávání jazyka, překladu dashboardu, e-mailů, dokladů nebo
  platební brány, nebo když řešíš onboarding cizojazyčné značky.
---

# Lokalizace: jazyk značky ≠ jazyk uživatele

Hlídají to aserce **§42** v `test-beta-e2e.ts` a sekce **L** v
`scripts/test-prompt-assembly.ts` (`npm run guard`). Architektura a stav rozjezdu:
`docs/DESIGN_lokalizace_2026-09-12.md`.

## Dvě osy

| Osa | Čí vlastnost | Kde žije | Co řídí |
|---|---|---|---|
| **Jazyk obsahu** | značky (tenant) | `ClientConfig.language` (`cs`/`sk`/`en`/`de`/`pl`), clamp ve `validateConfig()` | texty postů, hashtagy, text v obraze, narrace, titulky, tisk **a všechno, co si AI o značce ukládá** (brand memory, formáty, persony, popisky fotek, výtky kritika) |
| **Jazyk UI** | uživatele | cookie + `user_metadata.locale`, `lib/i18n`, `messages/<locale>.json` | chrome dashboardu, landing, auth, e-maily uživateli, onboardingové **otázky** (rozhovor s uživatelem), platební stránka |

Česká agentura může spravovat německou značku: dashboard česky, posty německy,
brand memory německy (kopírovat ji čte copywriter jako kontext — čím blíž jazyku
výstupu, tím líp přenáší). Jediná výjimka z pravidla „co AI říká o značce, je
v jazyce značky" jsou onboardingové otázky: to je rozhovor s uživatelem.

## Jazyk obsahu — jak s ním pracovat

- **Prompty zůstávají psané česky.** Model je vícejazyčný a jedna kopie mega
  promptu je jediná, která se dá udržet. Mění se **výstupní** jazyk: každé místo,
  kde prompt dřív říkal „česky"/„Czech"/vypisoval českou diakritiku, bere frázi z
  balíčku (`instagram/language.ts`):
  - `contentLanguage(config)` → `LanguagePack` (`const L = …`)
  - `L.adverbCs` („slovensky") do českých vět; `writeRuleCs(L)` = celá věta
    „Piš …, moderní hovorovou …" + nativní kotva v cílovém jazyce
  - `languageSectionCs(L)` = sekce JAZYK mega promptu (u češtiny beze změny, jinak
    navíc výčet, CO všechno má být v jazyce publika — jinak model nechá hashtagy
    nebo titulky v jazyce promptu)
  - `L.englishName`, `exactTextRule(L)`, `verbatimRule(L)`, `diacriticsClause(L)` do
    anglicky psaných promptů (obrazový model, vision QA, režisér reelu, tisk)
  - `languagePack(code)` tam, kde je jen kód; `languageForClient(clientId)`
    (`instagram/configs/language-lookup.ts`) tam, kde je jen UUID klienta
- **Nikdy „česky" natvrdo** ani v novém promptu — §42.3 skenuje soubory promptů
  řádek po řádku. Nový soubor s promptem přidej do seznamu v 42.2/42.3.
- **Pole s příkladem v češtině** (`e.g. 'Krok 1: Otevři Nastavení'`) dávej jen pro
  `L.code === "cs"` — cizí značce je český příklad matoucí.
- **Svátky** jsou vlastnost trhu, ne jazyka: `getDayContext(date, language)` bere
  tabulku podle `L.country` (`CZ`, `SK`, `PL`, `DE`, `INTL`). Názvy svátků jsou
  v jazyce trhu (vlastní jména), sezóna a dny v týdnu zůstávají česky (kontext
  do českého promptu). Pohyblivé svátky se **počítají** (`easterSunday`,
  `nthWeekday`), ne odhadují pevným datem.
- **TTS** dostává `language` povinně (`TtsSynthesizeOptions`); poskytovatel, který
  ho neumí poslat, si ho odvodí z textu, ale volající musí vědět, čím značka mluví.
  Ukázka hlasu v Nastavení je katalogová (`VOICE_SAMPLE_SENTENCE`, česky) — není
  to obsah značky.
- **Onboarding** odhadne jazyk z webu (`detectContentLanguage`: `<html lang>` →
  `og:locale` → diakritika → anglické spojky → čeština) a zapíše ho do
  `config.language` **z analýzy, ne z výstupu modelu**. Uživatel ho přepne
  v Nastavení → Základní informace.
- **`hashtagPools.czech`** = lokální hashtagy v jazyce/trhu značky. Klíč zůstává
  kvůli uloženým configům; v UI je „Lokální".

## Přidání jazyka obsahu

1. `CONTENT_LANGUAGES` + záznam v `PACKS` (`instagram/language.ts`): `englishName`,
   `adverbCs`, `localCs`, `marketCs`, `styleCs`, `nativeRule` (věta v jazyce
   samotném), `diacritics` (jen znaky, které obrazový model musí kreslit přesně),
   `country`.
2. Kalendář trhu v `instagram/signals/calendar.ts` (`CountryCalendar`: `fixed`,
   `marketing`, `movable`, `namedays`) + zápis do `CALENDARS`.
3. Heuristika v `detectLanguageFromText`, pokud má jazyk unikátní znaky.
4. Guard: doplň kód do 42.7 a přidej řádek do testu kalendáře v sekci L.
5. Ověř živě jeden post + jeden reel: typografie v obraze (diakritika), TTS
   výslovnost, hashtagy. Rychlost řeči (`SPOKEN_WORDS_PER_SECOND`) je zatím
   společná — u jazyka s výrazně jinou hustotou slov ji parametrizuj.

## Co zůstává česky záměrně

- **Interní agenti** (`lib/agents/*`, `lib/tasks/*`, obchodní preview) — mluví
  k provozovateli Chrlitu, ne ke značce.
- **Ukázkové/portfoliové značky** (`showcase-kits.ts`, `portfolio-data.ts`).
- **Právní texty** (`app/terms`, `app/privacy`, `lib/legal.ts`) — jsou vázané na
  jurisdikci, ne na jazyk; překlad je právní rozhodnutí, ne technické.
- **Onboardingové otázky** jdou po jazyku UI (`uiLocale` v payloadu úlohy) — jsou
  pro uživatele, ne pro publikum.

## Jazyk UI

Zdrojový jazyk je čeština; texty žijí v `messages/cs/<soubor>.json` (zdroj pravdy)
a překladech `messages/en/<soubor>.json`; seznam souborů je `MESSAGE_FILES`
v `lib/i18n/messages.ts`. `next-intl` běží bez prefixu v URL (dashboard je hash-SPA,
prefix by rozbil hluboké odkazy). Locale se řeší v `lib/i18n`: cookie `NEXT_LOCALE`
→ `Accept-Language` → `cs`; přihlášení, OAuth callback a registrace opisují
`user_metadata.locale` do cookie. Navigační registr (`app/(dashboard)/nav.ts`)
nese klíče, ne texty. Počty přes ICU plural v messages (`lib/plural.ts` zůstává jen
pro nemigrovaný kód).

Kde se který překladač bere:

| Kontext | Překladač | Jazyk |
|---|---|---|
| Klientská komponenta | `useTranslations("<ns>")` | `UiLocaleProvider` (cookie) |
| Serverová komponenta | `await getTranslations("<ns>")` | request config |
| Server action, API routa | `await actionTranslator("<ns>")` (`lib/i18n/actions.ts`), uvnitř funkce; mimo request spadne na češtinu | cookie requestu |
| HTML mezistránka z routy | `actionTranslator("api")` + `resolveUiLocale()` pro `<html lang>` | cookie / Accept-Language |
| E-mail, cron, agent | `mailTranslatorSync(locale, "mail" \| "notices" \| "worker")` (`lib/mail/i18n.ts`) | jazyk PŘÍJEMCE: `localeOfUser(user)`, `localeOfClientOwner(clientId)` |
| Kořenový layout (statický, bez provideru) | přímý import `messages/<locale>/core.json` podle cookie (`CookieConsent`) | cookie |

## Hlášky ze server actions a API rout

- `const t = await actionTranslator("<ns>")` v každé exportované akci (ne na úrovni
  modulu — request je per volání). `"use server"` soubor smí exportovat jen async
  funkce. Namespace po doménách: `actionsPlan`, `actionsContent`, `actionsAccount`,
  `actionsAdmin`, `api` (routy).
- Překládá se jen to, co doletí do UI: `error`, `message`, `warning`, hozené `Error`,
  které klient zobrazí, `agent_message` zapsané z requestu. Nepřekládá se: prompt pro
  model (blok `// i18n-ignore-start: prompt` … `// i18n-ignore-end`), sentinel v datech
  (`startsWith("Nový post")`, `source: "od klienta"` — řádkový `// i18n-ignore: <důvod>`),
  deník kreditů, audit `agent_actions`, logy, e-maily správci.
- Chyby z `lib/auth-guard.ts` jsou `AuthError` s `code` a lokalizovanou zprávou —
  rozhoduj přes `isAuthError(err)`, nikdy podle textu zprávy.
- Onboarding: `humanizeErrorWith(error, t)` (`app/onboarding/types.ts`) překládá
  síťové a AI chyby (`onboarding.humanized.*`); `humanizeError` je česká varianta
  pro kód bez překladače.
- Průběh dlouhých úloh: engine hlásí `agent_message` česky (zdroj). GenerateTab
  v jiném jazyce UI ukazuje popisek fáze podle `status` (`generate.progress.engine.*`).
  Hlášky zapsané cronem bez uživatele (campaign-worker, job-resume) zůstávají české;
  onboardingové úlohy berou jazyk zadavatele (`requested_by`).

## E-maily v jazyce příjemce

- Šablony `lib/mail/templates/*` jsou čisté funkce `build(vars, t, locale)`; registr
  `render(vars, unsubscribeEmail, locale)` — bez `locale` čeština. Transakční,
  předplatitelské a waitlistové jdou v jazyce příjemce; marketingové rozesílky
  (news, offer, promo) a e-maily správci (daily brief, incident watch, health check,
  weekly report) zůstávají česky — rozhodnutí, ne dluh.
- Zákaznická oznámení (`lib/agents/notice-templates.ts`, `lifecycle-templates.ts`)
  a digest kampaně (`renderCampaignDigest`) berou `t` z `mailTranslatorSync(locale, ns)`;
  jazyk zjišťuje odesílající funkce (`localeOfClientOwner`, `localeOfUser`).
- Potvrzení plateb (`lib/payments/on-paid.ts`) jde v jazyce vlastníka značky —
  plátce nemusí být přihlášený, takže `localeOfClientOwner` je jediný spolehlivý
  zdroj. Položka dokladu (`payments.label`) a zápisy do deníku kreditů zůstávají
  české: doklad jde po zemi odběratele, ne po jazyku UI.
- Layout e-mailu nese `locale` (`<html lang>`, patička, odhlášení); ComGate/Stripe
  dostávají jazyk kupujícího (`paymentPageLanguage()`), Fakturoid jazyk podle země
  odběratele (`fakturoidLanguage`). Měna zůstává CZK.

## Tučné a odkazy ve zprávě: `t.markup`, nikdy `t`

`<strong>…</strong>` v textu zprávy **není text, je to ICU tag**. Prosté
`t("klíč")` na takové zprávě vyhodí za běhu `FORMATTING_ERROR` — e-mail
neodejde, tab spadne, a typy to nezachytí. Tag skládá handler:

```ts
const strong = (chunks: string) => `<strong>${chunks}</strong>`   // HTML e-mail
t.markup("onPaid.plan.activated", { plan, strong })
```

```tsx
t.rich("brief.intro", { em: chunks => <span className="text-white/50">{chunks}</span> })
```

Odkaz do zprávy nepatří (URL není překlad): zpráva má `{link}`, kód dosadí
hotové `<a href="…">{t("…linkLabel")}</a>`. Hlídá to aserce „zpráva s tagem se
nevolá prostým t()" v `scripts/test-i18n.ts` — a aserce „tagy v překladu sedí
se zdrojem", aby překlad tag neztratil.

## Guard

`scripts/test-i18n.ts` (součást `npm run guard`): parita klíčů cs/en, platnost ICU
a shoda proměnných, registr navigace nese klíče, `MIGRATED` (soubory bez češtiny
mimo komentáře a bloky `i18n-ignore`; každý `i18n-ignore-start` má `end`; značka
`i18n-ignore` platí i v komentáři za kódem), zapojení plateb, dokladů a e-mailů.
Nový migrovaný soubor patří do `MIGRATED`, nový soubor zpráv do `MESSAGE_FILES`.

## Migrace tabu na messages (postup pro každý soubor)

Texty jsou v `messages/<locale>/<namespace>.json` — **jeden soubor na tab**,
namespace = jméno souboru = top-level klíč (`{ "settings": { … } }`). Soubor musí
být zapsaný v `MESSAGE_FILES` (`lib/i18n/messages.ts`) a v `MIGRATED`
(`scripts/test-i18n.ts`), jinak ho guard neuvidí.

1. **Čeština je zdroj.** Každý český text z JSX, `aria-label`, `placeholder`,
   `title`, tooltipů, hlášek `setMessage(...)`, popisků selectů a tabulek jde do
   `messages/cs/<ns>.json` **beze změny znění** a do `messages/en/<ns>.json`
   jako překlad. Klíče strukturuj podle komponenty/sekce (`settings.basic.name`),
   ne podle pořadí; stejný text na dvou místech = jeden klíč.
2. **Komponenta:** `"use client"` → `const t = useTranslations("<ns>")`; hooky jen
   uvnitř funkčních komponent (u vnořených komponent v témž souboru každá vlastní
   `t`). Serverové komponenty: `await getTranslations("<ns>")`.
3. **Proměnné a počty** přes ICU, ne skládáním řetězců:
   `"{count, plural, one {# příspěvek} few {# příspěvky} other {# příspěvků}}"`
   (čeština má tvary one/few/other, angličtina one/other). `lib/plural.ts`
   v migrovaném souboru nepoužívej.
4. **Data, datumy, čísla:** `useFormatter()` z next-intl (má locale i zónu
   Europe/Prague), ne `toLocaleDateString("cs-CZ")`.
5. **Label mapy v `lib/`** (`STATUS_LABELS`, názvy tarifů, médií…) se v `lib/`
   NEMĚNÍ — čtou je i e-maily a server. V tabu je nahraď klíčem podle hodnoty:
   `t(\`status.${status}\`)` s položkami v namespace tabu.
6. **Co se nepřekládá:** hlášky vrácené ze server actions (`result.error` — jdou
   z `app/actions`, další krok), názvy značek/produktů/hooků (data), hashtagy,
   texty, které jdou do promptu nebo na Instagram (jazyk značky, ne UI), kód
   a klíče v logu (`console.log`).
7. **Ověření:** `npx tsc --noEmit -p tsconfig.json` (chyby jen ve svém souboru),
   `npx tsx scripts/test-i18n.ts` (parita klíčů cs/en, ICU proměnné, žádná
   čeština mimo komentáře v migrovaných souborech), na konci `npm run guard`.
   Komentáře v kódu smí zůstat česky — kontrola je jen nad kódem.
