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

## Fáze

Každá je samostatně nasaditelná. Fáze 0+1 je ten „80 % za 20 %" kus.

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
5. Guard `scripts/test-support-escalate.ts`: cizí a expirovaný token odmítnut,
   `client_id` z těla ignorováno, druhý claim téže konverzace nezaloží druhý úkol.

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

## Ekonomika

| Scénář | Cena za konverzaci |
|---|---|
| Text, ~20 zpráv | ≈ 0,06 USD + LLM |
| Hlas, 5 minut | ≈ 0,40 USD + LLM |
| Týž dotaz e-mailem | 5–10 minut zakladatele |

Proto je widget **textový jako výchozí** a hlas je volba. Tarif Pro zahrnuje
1 238 minut, tedy ~240 pětiminutových hovorů měsíčně — při dnešním počtu klientů
není limitem concurrency ani minuty, ale LLM navrch.

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
