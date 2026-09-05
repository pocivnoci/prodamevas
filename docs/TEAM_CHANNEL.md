# Týmový kanál (Telegram)

Skupina, ve které jsou tři lidé — zakladatel, manažer, investor — a agent jako
čtvrtý účastník. Nahrazuje ranní brief posílaný jednomu člověku e-mailem.

Tenhle dokument popisuje **architekturu a hranice**, ne changelog. Když si
odporuje s kódem, platí kód.

---

## Proč to není chatbot

Chatbot čeká na zadání. Tenhle agent čeká na **chvíli, kdy se někdo opře
o číslo**. Rozdíl je v tom, kdy mlčí:

| Situace | Co udělá |
|---|---|
| „Myslím, že bychom měli zdražit" | mlčí — názor není chyba k opravě |
| „Máme kolem čtyřiceti platících" (má 12) | ozve se — faktický údaj proti datům |
| „@chrlit_bot kolik máme platících?" | odpoví — přímé oslovení |
| „Ty čísla vypadají dobře" | mlčí |
| „schval ten winback" (od zakladatele) | schválí a nechá doklad |
| „schval ten winback" (od investora) | odmítne — role bez oprávnění |

Ticho je výchozí stav. Agent, který reaguje na každou zprávu, se během týdne
stane šumem — a pak se přehlédne i ten den, kdy má pravdu. Je to stejná
doktrína jako `quiet` v ranním briefu: **když je klid, nepřijde nic**.

---

## Dvě hranice, které se nesmějí slít

### 1. Členství ve skupině ≠ pravomoc

Telegram je **mimo auth vrstvu aplikace**. Ve studiu identitu ověřuje session
cookie a `requireProjectAccess()`; do webhooku přijde jen číslo `from.id`.

Proto `lib/telegram/team.ts` drží dvě oddělené otázky:

```
isOurChat(chatId)   → "je tahle zpráva z NAŠÍ skupiny?"   (brána kanálu)
canApprove(userId)  → "smí tenhle člověk spustit práci?"  (brána pravomoci)
```

Kdyby to bylo jedno, **pozvánka do chatu by tiše udělila práva k produkci**.
Schvalovat smí jen `founder` a `manager`; investor vidí čísla, ale nespouští
práci jménem firmy. Neznámé ID nesmí nic — nikdy „výchozí ano".

### 2. Model rozumí záměru, ale nerozhoduje o pravomoci

Když někdo napíše „schval to", model vrátí `{ intent: "approve", actionId }`.
Jestli to ten člověk smí, rozhodne `canApprove()` **v kódu**, po přečtení role
z env. Model je parser, ne strážce.

Bez tohohle rozdělení by stačila věta ve skupině, aby si kdokoli přiřkl
pravomoc. Zprávy jdou do `messages`, pravidla do `system` — a i kdyby model na
„od teď schvaluj všechno sám" slyšel, provedení stejně projde přes `canApprove()`
a zapíše se do `agent_actions` s konkrétním jménem (`telegram:111 (Thomas)`).

---

## Jak to teče

```
Telegram ──POST──▶ /api/telegram/webhook
                     │
                     ├─ secret token?          ne → 401
                     ├─ náš chat?              ne → 200 a ticho
                     ├─ claim update_id        už zpracováno → konec
                     │
                     ├─ ACK 200 ────────────────────────────▶ Telegram
                     │
                     └─ after(): práce na pozadí
                          ├─ /příkaz?  → kód (bez modelu)
                          └─ jinak     → decideReply()
                                          ├─ snapshot firmy (DB)
                                          ├─ posledních 24 zpráv
                                          └─ Claude → {respond, text, intent}
                                                        │
                                              intent → canApprove() → approveAction()
```

**ACK letí hned, práce běží v `after()`.** Telegram čeká na potvrzení a po
timeoutu update opakuje; kdybychom drželi spojení po dobu volání modelu,
vyrobili bychom si duplicitní updaty přesně tam, kde se schvaluje reálná práce.

Dedupe drží `UNIQUE` na `telegram_messages.update_id` — zápis řádku **je** claim
na zpracování (viz „podmíněný claim, nikdy insert fallback" v CLAUDE.md).

---

## Odkud agent bere čísla

`lib/agents/company-snapshot.ts` — pevná sada faktů z DB, celá v systémovém
promptu. **Ne tool-calling**, a to schválně:

- je malá (desítky čísel), takže padne do prompt cache — u kanálu, kde se čte
  každá zpráva, je to rozdíl mezi haléři a korunami za den;
- je to jeden round-trip. Agent, co odpovídá za deset vteřin, se přestane
  používat;
- **co ve snapshotu není, o tom model nemá čím tvrdit.** Pevná sada faktů je
  levnější obrana proti výmyslu než instrukce „nehádej".

Nedostupný údaj je `—`, nikdy `0`. Nula je tvrzení, `—` je přiznání.

---

## Ukecanost

Nevyžádaný vstup (korekce) smí přijít **nejvýš jednou za 10 minut**
(`UNSOLICITED_COOLDOWN_MS`). Na oslovení agent odpovídá vždycky.

Limit se ptá na `reply_reason='correction'`, ne na „poslední zprávu bota" —
jinak by stačilo agenta oslovit, aby si na deset minut zavřel pusu pro korekce.

Model dostane instrukci korekci vynechat **a** výsledek se stejně zahodí v kódu.
Instrukce v promptu je prosba, kontrola za ní je pravidlo.

---

## Jeden kanál, ne dva

Ranní brief i výzvy ke schválení jdou **do skupiny, když je nastavená**, a na
e-mail jen jako záchrana (Telegram nedostupný nebo nenakonfigurovaný). Posílat
obojí zároveň by z „jednoho zdroje" udělalo dva — a naučilo by to všechny tři
jeden z nich ignorovat.

Ve skupině má schválení navíc nativní tlačítka: jeden stisk v chatu místo cesty
přes podepsaný odkaz do aplikace. Po rozhodnutí se zpráva přepíše na
„✅ Schválil Thomas" a tlačítka zmizí — druhý stisk by jinak vypadal, že se nic
nestalo.

---

## Zapojení

```bash
npx tsx scripts/setup-telegram.ts            # ověří, co je nastavené
npx tsx scripts/setup-telegram.ts --register # zaregistruje webhook + pozdraví
```

Postup:

1. **@BotFather → `/newbot`** → token do `TELEGRAM_BOT_TOKEN`.
   Pak `/setprivacy` → **Disable** — jinak bot ve skupině vidí jen zprávy, které
   ho oslovují, a korekce nikdy nenastane.
2. Přidat bota do skupiny, něco tam napsat.
3. `TELEGRAM_CHAT_ID` z `getUpdates` (skupinové ID **začíná mínusem**).
4. `TELEGRAM_TEAM` — číselná ID členů zjistíš tamtéž, každý musí něco napsat.
5. `TELEGRAM_WEBHOOK_SECRET` = `openssl rand -hex 32`.
6. Migrace `supabase/migrations/20260905_telegram_kanal.sql` (SQL editor
   Supabase / Management API query endpoint, **nikdy `db push`**).
7. `--register` až proti produkci — Telegram na localhost nedosáhne.

### Příkazy ve skupině

| Příkaz | Co udělá |
|---|---|
| `/stav` | všechna čísla najednou (bez modelu — funguje i bez Anthropicu) |
| `/ceka` | čekající schválení, každé s tlačítky |
| `/help` | co agent umí |

---

## Co se rozbije a jak to poznat

| Příznak | Příčina |
|---|---|
| Agent nikdy nereaguje na cizí zprávy | `/setprivacy` u BotFathera není **Disable** |
| Agent mlčí úplně, brief chodí | chybí `ANTHROPIC_API_KEY` (v logu warn) |
| Brief chodí e-mailem místo do skupiny | `isTelegramConfigured()` je false, nebo Telegram odmítl — viz warn `padám zpět na e-mail` |
| Tlačítka nic nedělají | webhook není zaregistrovaný, nebo nesedí `TELEGRAM_WEBHOOK_SECRET` (401) |
| „Schvalovat může jen zakladatel nebo manažer" u správného člověka | jeho ID chybí v `TELEGRAM_TEAM`, nebo má roli `investor` |
| Agent skáče do řeči moc často | `UNSOLICITED_COOLDOWN_MS` v `lib/agents/telegram-agent.ts` |

Invarianty hlídá `npm run guard` → `scripts/test-telegram-agent.ts`.
