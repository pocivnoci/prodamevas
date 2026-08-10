---
name: payments-billing
description: >-
  Platební brány, aktivace předplatného, daňové doklady a právní identita v Chrlit
  Studiu. Načti při jakékoli práci s lib/payments/on-paid.ts, lib/invoicing.ts,
  lib/fakturoid.ts, lib/legal.ts, app/api/payments/* (ComGate callback, Stripe
  webhook), app/actions/billing-actions.ts, tabulkami payments/invoices, obchodními
  podmínkami, IČO, DPH, haléři, souhlasem se zahájením plnění nebo obnovami
  předplatného.
---

# Platby a fakturace

Hlídají to aserce **§14 a §18** v `test-beta-e2e.ts` (`npm run guard`). Když měníš
chování, které aserce popisuje, oprav kód — ne aserci.

## Jedno jádro, adaptéry na okrajích

`lib/payments/on-paid.ts` je **jediné místo**, kde žije „co se stane, když platba
dojde": aktivace plánu, token pro obnovy, daňový doklad, potvrzovací e-mail.
ComGate callback i Stripe webhook ho volají — druhá brána proto **není druhá kódová
cesta**, a tedy ani druhé místo, kde se zapomene na doklad.

Dělicí čára respektuje to, co se mezi branami skutečně liší:

- **V routě zůstává** parsování, serverové ověření stavu a zabrání stavu — `payments`
  má pro každou bránu jiný lokátor.
- **V jádru je všechno po claimu.** Jádro nesmí importovat klienta konkrétní brány.

`finalizePaidPayment` běží **synchronně** (aktivaci plánu nelze odkládat),
`deliverPaidArtifacts` v `after()` (brána musí dostat ACK hned) a **nikdy nevyhazuje
výjimku**. Když aktivace selže, vrací `activated:false` a route musí skončit — řádek
zůstává PAID pro ruční opravu.

**Mock transId se nikdy nesmí uložit jako `recurring_trans_id`** — příští měsíc by se
na něj poslala skutečná platba. Guard je v ComGate routě; jádro token ukládá jen
u první platby, nikdy u obnovy.

## Doklad: INSERT je nárok na vystavení

`UNIQUE INDEX ON invoices(payment_id)` **je** ten nárok. INSERT předchází volání
Fakturoidu, konflikt znamená konec (`status:"duplicate"`), a **nikdy se nepřidává
insert fallback**: číselná řada je nevratná, duplicitu jde jen stornovat.

Celá cesta běží v `after()` a chyby polyká, ale **vždy je persistuje** jako
`status='failed'` — tichý `catch` = zákazník bez dokladu a nikdo o tom neví.

**Testovací platba nesmí sáhnout na ostrou řadu.** Sandbox guard patří *před* jakýkoli
dotyk Fakturoidu; druhá pojistka je `VERCEL_ENV !== "production"`. Záměrně nevystavený
doklad má `status='skipped'`, ne `'failed'` — fronta „chybí doklad, spravit" se nesmí
plnit testy.

Částky jsou v **haléřích** (`payments.amount`, `invoices.total_czk`); do Fakturoidu
smí jen přes `haleruToCzk()`.

## Právní identita má jediný zdroj

`lib/legal.ts` (jméno, IČO, adresa, režim DPH, `SUBPROCESSORS`). Obchodní podmínky,
zásady zpracování, patička i faktury ji jen vykreslují — **IČO se nikdy nepíše do
JSX**. Nevyplněné údaje nesou `"DOPLNIT"` a `scripts/check-legal-identity.ts` kvůli
nim končí **exit 1**: prodej s prázdným IČO je porušení informační povinnosti, ne
kosmetická vada.

Podmínky musí odpovídat kódu: trial je **obsahově omezený, ne 7denní**, kredity
propadají, předplatné se automaticky obnovuje. `recordInstantAccessConsent` ukládá čas
**i znění** souhlasu a zapisuje **podmíněně** (`.is(…, null)`), aby re-potvrzení
nepřepsalo původní razítko — bez záznamu souhlasu právo na odstoupení do 14 dnů trvá.

Reálný postup (živnost, identifikovaná osoba k DPH, ComGate, Fakturoid, GDPR) je
v `docs/LEGAL_SETUP.md`.

## Past, která už jednou naostro chytla

`VERCEL`, `VERCEL_ENV` a `VERCEL_URL` **nepatří do `.env.local`** — `vercel env pull`
je tam zatáhne a lokální běh se pak tváří jako produkce: `isMockPaymentMode()` vrátí
false a fakturační backstop na nonProd taky.
