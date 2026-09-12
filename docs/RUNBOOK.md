# Runbook — co dělat, když se něco pokazí

> Psáno 2. 9. 2026. Určeno pro chvíli, kdy je něco rozbité a není čas číst kód.
> Postupy jsou seřazené podle toho, co bolí nejvíc: **peníze → publikování →
> generování**. Každý začíná tím, jak poznat, že jde právě o tenhle problém.
>
> Bus factor projektu je 1. Tenhle soubor je první krok k tomu, aby nebyl.

## Než začneš cokoli

```bash
npm run guard     # ~30 s, statické aserce invariantů — musí být zelené
npm run build     # de facto typecheck
npx tsx scripts/spend-report.ts 7    # kam tekly peníze za posledních 7 dní
```

Produkční logy: Vercel → projekt `prodamevas` → Logs. Chyby: Sentry.
Databáze: Supabase → SQL editor (**nikdy `db push`**).

---

## 1. „Zákazník zaplatil a nemá plán"

**Nejhorší stav, jaký umíme mít.** Peníze na účtu, produkt nedodán.

### Jak to poznáš
- E-mail „Zaplaceno, plán NEAKTIVOVÁN" (zakládá `proposeRepairActivation`).
- V `agent_actions` řádek s `task_type = 'repair_activation'`.
- V logu `🚨 activatePaidPlan SELHALO`.

### Co se stalo
Platba prošla claimem (`payments.status = PAID`), ale aktivace tarifu spadla.
Řádek **zůstává PAID schválně**, aby šla oprava provést ručně.

### Postup
1. Najdi platbu: `select * from payments where id = '<paymentId>'`.
2. Ověř, že u brány je skutečně zaplacená (Stripe dashboard → Payments).
3. Schval návrh v aplikaci (Studio → Schválení) — aktivaci provede systém.
4. Když návrh chybí, aktivuj ručně a **zkontroluj, že vznikl doklad**:
   `select * from invoices where payment_id = '<paymentId>'`.

### Co NEDĚLAT
Neměň `payments.status` na PENDING „ať to proběhne znovu". Claim je jednorázový
a opakování by mohlo vystavit **druhý doklad** do nevratné číselné řady.

---

## 2. „Zákazníkovi se strhlo dvakrát"

### Jak to poznáš
Dva řádky v `payments` na totéž období, nebo stížnost zákazníka.

### Nejčastější příčina
Zákazník změnil tarif a **staré předplatné u Stripu se nezrušilo**. Od 2. 9. 2026
to `activatePaidPlan()` dělá automaticky; když selže, je v logu
`🚨 Staré Stripe předplatné … se NEPODAŘILO zrušit`.

### Postup
1. Stripe dashboard → Customers → najdi zákazníka → **zruš přebytečné předplatné**.
2. Vrať peníze přes Studio → Admin → vrácení platby. Refundace u Stripu proběhne
   automaticky; **dobropis ve Fakturoidu vystav ručně** (připomínka přijde e-mailem
   s číslem dokladu).
3. Ověř, že v `subscriptions` zůstalo živé právě jedno:
   `select id, status, provider_ref from subscriptions where client_id = '<id>'`.

---

## 3. „Obnovy se nestrhávají"

### Jak to poznáš
`current_period_end` v minulosti a `status` pořád `active`.

### Rozhodovací strom
- **Stripe předplatné** (`subscriptions.provider = 'stripe'`) → obnovu účtuje
  Stripe sám a náš cron ho **záměrně přeskakuje**. Hledej problém ve webhooku:
  Stripe dashboard → Developers → Webhooks → jsou tam chyby doručení?
- **ComGate** → obnovu strhává `/api/cron/billing-worker` (04:00 UTC) a potřebuje
  `COMGATE_RECURRING=1` **a** uložený `recurring_trans_id`. Bez obojího jen posílá
  upomínky k ruční obnově.

### Ověření cronu
Vercel → Logs → filtr `billing-worker`. Hledej řádek
`💳 billing-worker: N charged, … skippedStripe`.

---

## 4. „Příspěvky se nepublikují"

### Jak to poznáš
`ig_posts.status = 'failed'` s vyplněným `publish_error`, nebo příspěvky visí
ve `scheduled` s časem v minulosti.

### Postup
1. `select status, publish_error, publish_attempts from ig_posts where id = '<id>'`.
2. **`publish_attempts >= 4`** → publisher to vzdal (backoff do 30 min, max 4 pokusy).
   Po odstranění příčiny použij ve Studiu „Zkusit znovu" — vynuluje čítač.
3. **„Instagram není připojený"** → token vypršel nebo zákazník odebral přístup.
   Zákazník se musí připojit znovu v Nastavení.
4. **Stories se nepublikují automaticky** — je to známé omezení, ne porucha.
   Vyloučené v `auto-publish.ts`. Zbývá ruční sdílení.
   **Reels se publikují** (od #54, agent i „Publikovat hned"). Když se nepublikují,
   nejde o tohle omezení: buď reel nemá video (`Tenhle reel nemá video…`), nebo
   není nastavené `REELS_ENABLED=1` a engine ho překlopil na carousel dřív, než vznikl.

### Když nefunguje publikování nikomu
Zkontroluj strop profilů u prostředníka (upload-post). Na bezplatném tarifu jsou
**2 profily** a překročení se projeví chybou od cizího API, ne varováním u nás.

---

## 5. „Účet u Googlu vyskočil"

### Postup
```bash
npx tsx scripts/spend-report.ts 30
```
Přehled ukazuje útratu po operacích, po dnech **i po klientech** (od 2. 9. 2026)
s porovnáním proti ceně tarifu.

### Na co se dívat
- **Jeden klient výrazně nad ostatními** → podívej se, jestli mu sedí kredity.
  Od 2. 9. 2026 se rezervují dopředu pod zámkem, takže přečerpat by neměl jít;
  když ano, ověř, že migrace `20260902_atomicka_rezervace_kreditu.sql`
  **skutečně proběhla** (bez ní kód degraduje na starou, závodivou cestu a hlásí
  to do logu).
- **Řádek „mimo zákazníky"** → obchodní agent generuje ukázky za 18 Kč pro každý
  kvalifikovaný lead. Přiškrtí se `SALES_PREVIEW_MIN_SCORE`.
- **Varování „N běhů bez ceny"** → některý model nemá sazbu v `lib/model-pricing.ts`.
  Součet je pak **nižší než skutečnost**.

---

## 6. „Generování se zaseklo"

Úlohy běží přes `agent_tasks` a cron `/api/cron/job-resume` (každou minutu).

1. `select id, type, status, attempts, scheduled_for from agent_tasks
    where status <> 'done' order by created_at desc limit 20`
2. Zaseklá úloha s vypršelým `worker_lease` se sebere sama při dalším tiku.
3. **Dvojí běh není retry.** Když se úloha objeví dvakrát, hledej reclaim lease —
   účtování je idempotentní přes `(action, reference_id)`, ale generování ne.

---

## 7. Obnova databáze

Supabase → Database → Backups. **Obnovu si aspoň jednou vyzkoušej nanečisto**,
než ji budeš potřebovat doopravdy — netestovaná záloha není záloha.

Před jakýmkoli ručním zásahem do `payments`, `invoices` nebo `credit_transactions`
si ulož výsledek dotazu stranou. Číselná řada dokladů je nevratná.

---

## 8. Opuštění klienti: deaktivace → karanténa → smazání/anonymizace

Tři kroky, každý ručně a s dry runem. Zásady zpracování slibují smazání nebo
anonymizaci údajů účtu **30 dní po zrušení**, u daňových dokladů naopak ~10 let —
proto se klient s platbou nebo fakturou nikdy nemaže, jen anonymizuje.

### Krok 1 — najdi a deaktivuj

```bash
npx tsx scripts/neaktivni-klienti.ts                # jen výpis
npx tsx scripts/neaktivni-klienti.ts --deaktivuj    # is_active=false + deactivated_at
```

Kandidát = > 90 dní bez obsahu ∧ bez `active`/`trialing` předplatného ∧ nikdy
nezaplatil ∧ není výloha. Krok je vratný: `is_active = true` značku oživí.

### Krok 2 — karanténa

`deactivated_at` (migrace `20260912_karantena_klientu.sql`, pouští se v SQL
editoru) je začátek 30denní lhůty. Během ní se nic nemaže — je to jediné okno,
ve kterém jde omyl prvního kroku ještě opravit.

### Krok 3 — smazat, nebo anonymizovat

```bash
npx tsx scripts/smazat-opustene-klienty.ts          # dry run, počty per tabulka
npx tsx scripts/smazat-opustene-klienty.ts --yes    # provede
```

Kandidát = `is_active=false` ∧ `deactivated_at` starší než `--dny` (30)
∧ není výloha/reference ∧ nemá připojený Instagram. Pak:

| Stav klienta | Co se stane |
|---|---|
| Má řádek v `invoices` nebo `payments` | **Anonymizace** — smaže se obsah a bucket, řádek `clients` zůstane s neutrálními údaji (`config.anonymizedAt`). Doklady, platby a předplatné se nedotýkají. |
| Nemá ani jedno | **Smazání** — bucket, profil u upload-postu, obsahové tabulky a nakonec `DELETE FROM clients`. |

### Co NEDĚLAT

1. **Nemazat `DELETE FROM clients` ručně u platícího klienta.** `invoices.client_id`
   i `payments.client_id` kaskádují — doklady zmizí a číselná řada se nevrátí.
2. **Nevyprazdňovat `audit-screenshots`.** Je to sdílený bucket značek bez vlastního
   `storageBucket`; skript ho proto odmítá.
3. **Nemazat uživatele v `auth.users`.** Jeden člověk může mít víc značek.

---

## Čísla, která se hodí znát

| Věc | Hodnota | Kde |
|---|---|---|
| Strop běhu funkce | 800 s | Vercel Fluid Compute |
| Pokusů o publikaci | 4, backoff do 30 min | `ig-publisher/route.ts` |
| Dunning | `MAX_BILLING_FAILURES`, pak expirace | `lib/subscription.ts` |
| Strop tempa kreditů | 12/min, 400/den na klienta | `CREDIT_BURST_PER_MINUTE`, `CREDIT_ACTIONS_PER_DAY` |
| Kreditové okno | vždy měsíční, i u ročního tarifu | `rollLapsedCreditWindows` |
| Cena příspěvku | obrázek 7,6 · karusel 18,2 · reel 27,6 · dlouhý reel 48,8 Kč | `docs/UNIT_ECONOMICS_AND_PRICING.md` |
