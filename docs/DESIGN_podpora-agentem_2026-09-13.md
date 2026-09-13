# Zákaznická podpora agentem — návrh (13. 9. 2026)

ElevenLabs je v projektu od 12. 9. 2026, ale jen jako **hlas značky v reelech**
(`instagram/tts/elevenlabs.ts`). Klíč, měření spotřeby i retry jsou tím prověřené.
Tenhle dokument navrhuje druhé použití: **Agents Platform jako zákaznická podpora
v aplikaci** — a záměrně ho staví tak, aby první verze nemohla utratit peníze ani
sáhnout na tenanta.

Cíl: **odpovědět česky ve 21:00, v aplikaci, se znalostí konkrétního účtu.** Když
agent neví, předat to člověku s přepisem, aby nezačínal od „dobrý den, co se děje".
Není cílem telefonní linka ani odchozí prodejní volání (viz „Co tenhle návrh nedělá").

## Diagnóza z kódu

| Vrstva | Dnes | Důsledek |
|---|---|---|
| **Nápověda** | `FaqTab.tsx` — 360 řádků statického accordionu, 5 kategorií; ceny správně z `lib/pricing.ts` a `lib/credits.ts` | číst se dá, zeptat ne; `FAQ_CATEGORIES` je uvnitř komponenty, takže k datům se nedostane nic jiného než ta stránka |
| **Kontakt** | `app/actions/contact.ts` → tabulka `waitlist` → `lib/agents/sales/digest.ts` | kanál pro **zájemce**, ne pro platícího klienta; slibuje, že se ozve člověk |
| **Odchozí pošta** | `lib/agents/customer-notices.ts` — transakční, s dedupe klíčem | my oznamujeme, klient nemá kam odpovědět |
| **Konzultace** | `app/api/consultations/cal-webhook/route.ts` | domluvený termín, ne odpověď teď |
| **Hlas** | `instagram/tts/elevenlabs.ts` je **výchozí** poskytovatel; 12 rodilých českých hlasů v `lib/voice-library.ts`; casting per značka | infrastruktura hotová, interaktivně ji nic nepoužívá |
| **Schránka „čeká na tebe"** | `tasks` + `QUESTION_PREFIX` (`lib/tasks/question.ts`) + odznak `tasksAwaitingAnswer` v `nav.ts` | eskalace má kam padat; nová schránka se zavádět nemusí |
| **Zpracovatelé** | `SUBPROCESSORS` v `lib/legal.ts` | **ElevenLabs v seznamu není**, přitom už dnes zpracovává data pro reely — viz Fáze 0 |

## Mechanika (ověřeno v dokumentaci 13. 9. 2026)

- **Widget:** `<elevenlabs-convai agent-id="…">` + skript
  `https://unpkg.com/@elevenlabs/convai-widget-embed`. Atributy: `agent-id`,
  `signed-url`, `dynamic-variables='{"…":"…"}'`, `variant`, `dismissible`,
  `override-*`. Textový režim se zapíná v konfiguraci agenta (Channels → Widget →
  Interface).
- **Privátní agent:** `enable_auth: true` a podepsaná URL —
  `GET /v1/convai/conversation/get-signed-url?agent_id=…`, hlavička `xi-api-key`,
  **platnost 15 minut** (spojení musí v okně začít, hovor smí trvat dál).
  Alternativa je allowlist hostnamů (max 10, bez wildcards); **buď jedno, nebo druhé.**
- **Dynamické proměnné:** `{{jmeno}}` v systémovém promptu, první zprávě i
  parametrech nástrojů. Systémové mají prefix `system__`
  (`system__conversation_id`, `system__is_text_only`, `system__time`…).
- **Post-call webhook:** událost `post_call_transcription` — přepis, `duration_secs`,
  **cena v centech**, použité dynamické proměnné. Podpis v hlavičce
  `elevenlabs-signature` (HMAC + timestamp).
- **Ceník:** 0,08 USD/min nad rámec tarifu (0,16 USD/min při překročení concurrency),
  **textová zpráva 0,003 USD**. Pro (99 USD/měs.) zahrnuje 1 238 minut a 20
  souběžných hovorů. **LLM se účtuje navrch.**

⚠️ **Nejdůležitější důsledek: dynamické proměnné posílá prohlížeč.** Jsou dobré na
personalizaci řeči, **nikdy** jako identita pro akci. Je to přesně invariant
z CLAUDE.md „Tenant nikdy ze vstupu bez brány" — a LLM je taky vstup. Proto má
Fáze 3 vlastní podepsaný token a Fáze 1 nemá žádný nástroj se vedlejším účinkem.

Druhá past: `override-prompt` a `override-first-message` jdou z atributu widgetu.
V konfiguraci agenta musí být **overrides vypnuté**, jinak si prompt podpory
přepíše kdokoli z konzole prohlížeče.

## Co se ukázalo až při zapojení (13. 9. 2026)

Čtyři věci, které dokumentace neřekne dopředu a stálo to o ně pokus:

1. **Agent v jiném jazyce než angličtině musí mít TTS model `eleven_turbo_v2_5`
   nebo `eleven_flash_v2_5.`** Založení s `eleven_v3` skončí chybou „Non-english
   Agents must use turbo or flash v2_5". Podpora tedy mluví JINOU rodinou modelů
   než reely (`eleven_v3`), a je to kvalitativní rozdíl, se kterým se nic dělat
   nedá — Turbo je optimalizovaný na latenci konverzace, ne na přednes.
2. **Hlas z Voice Library se musí nejdřív přidat do workspace.** `voice_id`
   vybraný z katalogu vrátí `voice_not_found`, dokud ho někdo v konzoli nepřidá.
   Agent proto vznikl s výchozím hlasem workspace.
3. **Widget se lokalizuje sám** podle jazyka agenta — „Potřebujete pomoc?“,
   „Zahájit hovor“, „Zpráva“ přišly česky bez jediného nastavení.
4. **Nabízí text i hlas zároveň** (`text_only: false`, `supports_text_only: true`).
   Text-first tedy není výchozí stav, jen možnost, kterou klient vidí vedle hovoru.
   Vynutit jen text jde přes `text_only` v konfiguraci agenta.

## Fáze

Každá je samostatně nasaditelná. Fáze 0+1 je ten „80 % za 20 %" kus.
**Fáze 0 a 1 jsou hotové** (13. 9. 2026) — viz „Zbývá v konzoli" na konci.

### Fáze 0 — Znalostní báze ze zdrojů pravdy (2–3 h)

1. **`FAQ_CATEGORIES` ven z komponenty** do `lib/support/faq.ts` (client-safe,
   bez importů z `instagram/` a `supabase/`, stejný režim jako `lib/voice-library.ts`).
   `FaqTab.tsx` ho importuje, copy se nemění. Bez tohohle kroku musí bázi někdo
   opsat rukou — a to je chyba, kterou tenhle soubor už jednou udělal: natvrdo
   psané ceny v nápovědě přežily přecenění na v6 a lhaly zákazníkovi.
2. **`scripts/sync-support-kb.ts`** složí JEDEN markdown z:
   `lib/support/faq.ts`, `lib/pricing.ts` (`FALLBACK_PLANS`, `EXTRA_CREDIT_HALERU`),
   `lib/credits.ts` (`MEDIA_CREDITS`, `ACTION_CREDITS`), `docs/INSTAGRAM_SETUP_GUIDE.md`,
   `docs/POSTING_GUIDE.md`, obchodní podmínky (`lib/legal.ts` + `app/terms/page.tsx`)
   a `content/blog/*.md`. Nahraje ho jako jeden dokument znalostní báze a id si
   uloží do env (`ELEVENLABS_SUPPORT_KB_ID`).
3. **Guard `scripts/test-support-kb.ts`** (do řetězu v `package.json`): složený text
   **musí** obsahovat aktuální cenu každého tarifu z `FALLBACK_PLANS` a aktuální
   váhy kreditů. Když někdo přecení a bázi nesynchronizuje, spadne guard, ne
   zákazník.
4. **`ElevenLabs` do `SUBPROCESSORS`** v `lib/legal.ts`. Patří tam už dnes kvůli
   reelům; s podporou tam poputují i věty, které klient sám napíše nebo řekne.
   Logika je stejná, jakou si ten seznam u Stripu a Upload-Postu sám napsal:
   mlčet o zpracovateli, který může dostat data zákazníka, je porušení informační
   povinnosti. **Tohle je podmínka spuštění Fáze 1 na produkci, ne vývoje.**

### Fáze 1 — Agent a widget v Nápovědě (3–4 h)

1. **Agent** (workspace je dnes prázdný — ověřeno): jazyk `cs`, český hlas
   z `lib/voice-library.ts`, ale **záměrně jiný než hlasy castované značkám** —
   podpora Chrlitu nesmí znít jako klientova vlastní značka.
2. **Systémový prompt** česky: kdo jsme, co umíme, a hlavně co **nesmí** —
   nevymýšlet ceny ani lhůty (čísla jsou v bázi), neslibovat refund ani kredity
   (peníze řeší člověk), u pochybnosti nabídnout předání. Overrides vypnuté.
3. **Podepsaná URL ze serveru:** `app/actions/support-actions.ts` →
   `startSupportConversation(slug)` za `requireProjectAccess(slug)`; volá
   get-signed-url s `ELEVENLABS_API_KEY` (už existuje) a `ELEVENLABS_AGENT_ID`.
   Klíč nikdy do prohlížeče.
4. **Komponenta** `components/support/SupportAgent.tsx` (`"use client"`): skript
   z unpkg jednou, `signed-url` z akce, **textový režim jako výchozí**, hlas jako
   tlačítko, `dismissible`. Vizuál podle konvencí (`bg-[#050505]`,
   `border-white/5`, labely `uppercase tracking-widest`).
5. **Mount jen ve `FaqTab`**, ne globálně v `layout.tsx`. Jedno místo se dá
   pozorovat; globální plovoucí bublina se dá zapnout, až budou přepisy z týdne.
6. Env do tabulky v README. Ověření: deset skutečných otázek z FAQ hlasem
   i textem na testovacím tenantovi, přepisy přečtené v ElevenLabs.

### Fáze 2 — Agent ví, s kým mluví (2–3 h)

`SubscriptionState` ve `StudioContext` už drží všechno potřebné: `planName`,
`creditsRemaining`, `status`, `trialDaysLeft`, `billingState`, `cancelAtPeriodEnd`,
`allowedMedia`, `extraCreditPrice`. Předá se jako `dynamic-variables` a použije
v první zprávě i promptu.

Hodnota je nepoměrná k práci: nejčastější dotaz podpory bude „proč mi nejde
generovat" a odpověď je v `billingState` (`dunning`, `expired`, `grace`) nebo
v `creditsRemaining` — agent ji má hned, bez jediného nového API.

Pravidlo v promptu: **proměnné jsou kontext pro odpověď, ne podklad pro akci ani
slib.** Ověření na třech účtech — nulové kredity, `trialing`, `expired` — a kontrola,
že agent neslíbí kredity, které nemůže dát.

### Fáze 3 — Eskalace do Úkolů (1 den)

1. Nástroj agenta (webhook) `zaloz_dotaz` → `POST /api/support/escalate`.
2. **Autorizace není dynamická proměnná.** Server action z Fáze 1 vyrobí krátce
   platný HMAC token (`client_id` + expirace, podepsáno `SUPPORT_TOKEN_SECRET`)
   a ten pošle jako dynamickou proměnnou. Routa ověří podpis a expiraci a
   `client_id` bere **z payloadu tokenu, nikdy z těla požadavku**. Vzor je hotový
   v `app/api/payments/stripe/webhook/route.ts`: syrové tělo, ověřit, při
   neplatném podpisu nezpracovat vůbec.
3. **Podmíněný claim, ne insert fallback:** jeden dotaz na `system__conversation_id`.
4. **Cíl je `tasks`, ne nová tabulka**: `blocked_on` s `QUESTION_PREFIX`,
   `client_id` z tokenu, `source` rozšířit na `"support"` (dnes `"sheet" | "app"`).
   Odznak `tasksAwaitingAnswer` i sekce „Čeká na tvou odpověď" pak fungují bez
   jediného řádku UI. Druhá schránka by znamenala druhé místo, kam se zapomene
   podívat.
5. **Odpověď se musí vrátit klientovi.** `answerTaskQuestion()` dnes zapíše
   odpověď do vlákna úkolu, vynuluje `spec_at` a odblokuje `blocked_on` — to je
   smyčka mezi AI a týmem, klient o ní neví. U úkolů se `source: "support"` proto
   odpověď navíc odešle: nový `NoticeKind` `support_reply` v
   `lib/agents/notice-templates.ts`, adresát z `getOwnerEmail(clientId)`, cesta
   přes `requestAction` s tierem `transactional` (odchází samo, s dedupe klíčem
   = id úkolu). Bez tohohle kroku je eskalace jen schránka, do které klient mluví
   a nikdo mu neodpoví.
6. Guard `scripts/test-support-escalate.ts`: cizí a expirovaný token odmítnut,
   `client_id` z těla ignorováno, druhý claim téže konverzace nezaloží druhý úkol,
   odpověď na `source: "support"` úkol odešle právě jedno oznámení.

### Fáze 4 — Měření spotřeby (0,5 dne)

`POST /api/support/post-call`, ověřený podpis `elevenlabs-signature` ze syrového
těla → řádek do `ai_spend`: `operation: "support_agent"`, `ref_id` = conversation id,
`cost_usd` = centy z webhooku / 100, `breakdown` = `{ duration_secs, is_text_only,
messages }`, `client_id` z podepsaného tokenu (sloupec je nullable záměrně).

Proč to není volitelné: „Peníze nikdy potichu". Bez toho měří podpora nulu — přesně
jako reelový hlas do 8/2026, kdy Google účtoval 411 Kč týdně a log uměl vysvětlit
stovku. Cena z webhooku je pravda; **nepřepočítávat ji z minut** a `UnitKind`
v `lib/model-pricing.ts` nerozšiřovat — konverzace není volání modelu v generaci.
Řádek v `ai_spend` stačí a `lib/agents/weekly-report.ts` ho vidí sám.

### Fáze 5 — Telefon (později, jen když to čísla unesou)

Příchozí česká linka, předání na člověka, provozní hodiny. Pro cílovou skupinu
(malé firmy, které rády volají) je to silné, ale je to jiný řád práce a jiný
provozní režim. Ne dřív, než Fáze 0–4 poběží měsíc a budou z nich přepisy.

## Kolo učení

Eskalace není cíl, je to měření děr ve znalostní bázi. Dotaz, který se eskaluje
podruhé, není dotaz — je to chybějící odpověď: patří do `lib/support/faq.ts`,
`sync-support-kb.ts` bázi přesype a agent ho příště zvládne sám. Bez tohohle
kroku eskalací neubývá a podpora se stane druhou schránkou, do které nikdo
nechodí.

Je to stejný invariant jako u obsahu („Zpětné vazby jsou posvátné"): nový signál
bez konzumenta se přetrhne. Konzument signálu „klient se ptal a agent nevěděl"
je FAQ, ne poznámka v úkolu.

## Ekonomika

Tři oddělené měřiče — a jeden z nich úmyslně zůstane nulový.

| Kde | Co se platí | Kolik |
|---|---|---|
| **ElevenLabs** | hlasové minuty | 0,08 USD/min nad tarif (0,16 při překročení concurrency) |
| | textové zprávy | 0,003 USD/zpráva |
| | LLM agenta | navrch, podle spotřeby |
| **`ai_spend`** | týž náklad v našem účetnictví | `operation: "support_agent"`, `cost_usd` z webhooku |
| **Kredity klienta** | **nic** | viz níž |

| Scénář | Cena za konverzaci |
|---|---|
| Text, ~20 zpráv | ≈ 0,06 USD + LLM |
| Hlas, 5 minut | ≈ 0,40 USD + LLM |
| Týž dotaz e-mailem | 5–10 minut zakladatele |

Proto je widget **textový jako výchozí** a hlas je volba. Tarif Pro zahrnuje
1 238 minut, tedy ~240 pětiminutových hovorů měsíčně — při dnešním počtu klientů
není limitem concurrency ani minuty, ale LLM navrch.

**Podpora nestojí klienta kredity.** Kredity jsou za generování; účtovat je za
otázku znamená naučit lidi se neptat — a kdo se nezeptá, neodejde s odpovědí, ale
s výpovědí. Je to fixní náklad provozu, viditelný v `ai_spend` a v týdenní zprávě,
ne položka na faktuře klienta. Kdyby náklad někdy přerostl (masivní zneužití
hlasu), řeší se limitem minut na klienta, ne strháváním kreditů.

Jediné číslo, které dnes nejde pořádně odhadnout, je LLM: závisí na délce promptu
a velikosti báze. Až Fáze 1 agenta vytvoří, spočítá ho `agents_calculate_llm_usage`
přesně pro náš prompt a naši bázi.

## Co tenhle návrh záměrně nedělá

- **Agent nemá přístup do enginu.** Neumí generovat, refundovat ani měnit konfiguraci.
  Čte znalostní bázi, zná stav účtu, umí předat člověku. První verze podpory nesmí
  umět utratit peníze ani zapsat do tenanta.
- **LLM agenta žije v konfiguraci ElevenLabs, mimo `instagram/models.ts`.** Je to
  vědomá výjimka — není to enginový kód —, ale `getModel()` o něm neví, takže to
  patří do README, aby ho tam někdo nehledal.
- **Žádné klonování hlasu zakladatele pro podporu.** To je fáze 4 návrhu reelů v2
  a jiný souhlas.
- **Žádné odchozí prodejní volání.** Souhlas a telemarketing jsou riziko, a
  `lib/agents/sales/` už tohle dělá e-mailem s člověkem ve smyčce.

## Pořadí a odhad

| Fáze | Práce | Co přinese |
|---|---|---|
| 0 | 2–3 h | báze, která nemůže lhát o ceně; ElevenLabs v zpracovatelích |
| 1 | 3–4 h | ptát se česky v Nápovědě, hlasem i textem |
| 2 | 2–3 h | „vidím, že jste v dunningu" — z FAQ bota podpora |
| 3 | 1 den | co agent neumí, přistane v Úkolech s přepisem |
| 4 | 0,5 dne | podpora je vidět v `ai_spend` a v týdenní zprávě |

**0+1 je jeden den práce a většina hodnoty.** 2 je nejlepší poměr v celém návrhu.
3+4 zavírají smyčku a teprve po nich je to systém, ne demo.

## Komu se agent otevře

Brána je `canUseSupportAgent()` v `lib/subscription.ts` a má DVĚ podmínky, ne jednu:

- **tarif** — `features.support_agent` (migrace `20260913_podpora_agentem.sql`
  ho zapíná na Dominance a Impérium, vypíná na Start, Růst a trialu),
- **skutečná platba** — trial (`trial_v2`) a tarif zdarma od správce (`provider:
  "gift"`) nárok nemají, protože každá konverzace stojí minuty nebo zprávy.

Co bránu NEZAVÍRÁ: dunning, odklad obnovy (`grace`) ani výpověď ke konci období.
Komu selhala karta, ten podporu potřebuje nejvíc; zavřít mu ji je způsob, jak
z dočasného problému udělat odchod. Konec je jedině `expired` a `pending`.

Superadmin bránu obchází — jinak nejde agenta vyzkoušet na jiném než vlastním
platícím tenantovi.

**Agent se zatím neinzeruje.** Žádná odrážka v ceníku, žádná věta v obchodních
podmínkách — dokud je to test, není to prodejní slib a aserce 13.16/13.17 se ho
netýkají. Až se začne prodávat, je to jeden krok: odrážka, pole a věta
v podmínkách zároveň. `human_support` zůstává čistě o ČLOVĚKU (Impérium).

## Agent

**Luděk** — `agent_5501m2ct1vh6f9hb1n78h0y97782` (workspace Tomáš Pocar, štítky
`podpora`, `chrlit`). Do env jako `ELEVENLABS_AGENT_ID`; id není tajemství (je
v každém embedu), ale natvrdo do kódu nepatří — je to nasazovací konstanta.

Jméno si vyžádalo pravidlo navíc: **Luděk je jméno, ne přetvářka.** V promptu
stojí, že je AI, že to na dotaz přizná a že nepředstírá paměť z minulé
konverzace. Pojmenovaný agent, který se nechá považovat za zaměstnance, je lež
i tam, kde ji nikdo nevyslovil.

## Zbývá v konzoli ElevenLabs

Stav ověřený z konfigurace agenta 13. 9. 2026. Hotové odškrtnuté, zbytek jde jen
klikáním — část z toho nemá API ani MCP cestu:

- [x] **Overrides promptu a první zprávy jsou vypnuté** už z výroby
      (`overrides.agent.prompt.prompt: false`). Přepsat Luďkovi prompt
      z prohlížeče tedy nejde. Přepnout se smí jen `text_only`, což je
      neškodné — klient si vybere levnější režim.
- [ ] **Znalostní bázi nahrát a připojit** — `npx tsx scripts/sync-support-kb.ts --push`
      (lokálně, kde je `ELEVENLABS_API_KEY`), pak v Agents → Luděk → Knowledge
      base. Dnes je `knowledge_base: []`, takže Luděk nezná ceny ani nápovědu.
- [ ] **Zapnout RAG** (`rag.enabled` je dnes `false`). Báze má ~31 000 znaků;
      bez RAG by jela v promptu při každém tahu a platila se pořád dokola.
- [ ] **Zapnout `enable_auth`** (`auth.enable_auth: false`). Bez toho je agent
      dosažitelný pro každého, kdo si vezme `agent-id` z DOMu — brána
      v aplikaci by hlídala dveře, u kterých chybí zeď.
- [ ] **Přidat hlas do workspace a vybrat ho.** Doporučený „Daniel"
      (`e36pGtHFyzkf4HTb9rQG`) — v katalogu popsaný přímo pro zákaznickou
      podporu a NENÍ v `lib/voice-library.ts`, takže nemůže znít jako hlas cizí
      značky. **Hlas z Voice Library se nedá přiřadit, dokud není ve workspace**
      (`voice_not_found`), a přidat ho jde jedině v konzoli. Dnes na agentovi
      sedí výchozí hlas workspace (`cjVigY5qzO86Huf0OWal`), který není český.
- [ ] **`ELEVENLABS_AGENT_ID` do env** (Vercel i `.env.local`) — bez něj se
      widget nevykreslí a Nápověda zůstane statická.

Tři věci k rozhodnutí, ne k odklikání:

1. **LLM agenta je `gemini-2.5-flash`, temperature 0.** Pro odpovídání z báze to
   obstojí, ale zbytek produktu má invariant „na flash se nepadá". Stojí za
   poslech vedle Pro, než se Luděk pustí na platící klienty.
2. **Nahrávky a přepisy se drží navždy** (`record_voice: true`,
   `retention_days: -1`). U reelů odcházela vygenerovaná narace; tady jsou to
   věty zákazníka. Retenci je potřeba zvolit vědomě — je to údaj do zásad
   ochrany osobních údajů, ne detail.
3. **Žádný strop hovorů** (`agent_concurrency_limit: -1`, denní 100 000).
   Pro test je rozumné utáhnout to na číslo, u kterého se dá spát.
