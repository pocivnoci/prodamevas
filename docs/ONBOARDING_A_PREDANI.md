# Onboarding nového klienta a předání účtu

> Odpověď na dvě otázky z backlogu: **„postup při onboardingu a registraci nového
> klienta"** a **„musí se klient registrovat, nebo jak se přihlásí do účtu?"**
>
> Krátká odpověď na tu druhou: **ano, účet si zakládá klient sám.** My mu ho
> založit nemůžeme a nechceme — potvrzení e-mailové adresy a souhlas s podmínkami
> musí udělat on. My mu jen pošleme odkaz, který má všechno předvyplněné.

## Celý postup na pěti řádcích

1. **Onboarduješ značku z adminu** — Studio → *Onboarding*. Klient u toho být nemusí.
2. Značka vznikne **pod tvým účtem** (vlastníkem je ten, kdo průvodce spustil).
3. **Předáš ji na e-mail klienta** — Nastavení → *Správa* → *Předání značky*.
4. Klient dostane e-mail: **existující účet** → značku vidí hned; **žádný účet** →
   pozvánka s odkazem na registraci.
5. Po jeho **prvním přihlášení** je značka jeho. Ty se do ní jako správce dostaneš dál.

---

## 1. Onboarding

Studio → *Onboarding* (záložka jen pro správce). Dvě cesty:

| Cesta | Kdy | Co se stane |
|---|---|---|
| **Mám web** | klient má fungující web | AI web přečte, vytáhne tón, barvy a produkty, doptá se na pár věcí |
| **Nemám web** | e-shop na Instagramu, nová firma | vyplníš pár otázek a AI z nich složí konfiguraci |

Na konci průvodce značka **není prázdná**: dostane plán příspěvků, zásobník nápadů
a tři ukázkové příspěvky (`startOnboardingBootstrap`). To je schválně — klient se
má po prvním přihlášení dívat na hotovou práci, ne na prázdný dashboard.

**Kolik jich denně jde:** `ONBOARDING_DAILY_CAP` (výchozí 20). Každý nový účet
spustí generování, takže strop je pojistka proti účtu u Googlu, ne šikana.

## 2. Komu značka patří

`user_clients` říká, kdo značku vidí ve svém přepínači projektů. Onboarding tam
zapíše **toho, kdo průvodce spustil** — tedy tebe. Klient ji zatím nevidí.

Správce se přitom dostane do **každého** projektu i bez téhle vazby
(`SUPER_ADMIN_EMAILS`), takže předání nikdy neznamená ztrátu přístupu pro nás.

## 3. Předání

**Nastavení → Správa → Předání značky.** Karta ukazuje, kdo dnes na značku vidí,
co čeká na registraci, a pole na e-mail. Předat jde kdykoli později — nemusí se to
stihnout v průvodci.

Zaškrtávátko **„Odpojit dosavadní vlastníky"** nechá značku jen novému e-mailu.
Hodí se, když se značka předává z jednoho člověka na druhého; u prvního předání
zákazníkovi ho většinou nechceš (zůstaneš u projektu i jako vlastník).

### Klient už účet má

Vazba vznikne hned. Klientovi přijde e-mail *„Značka je ve vašem účtu"* a najde ji
v přepínači projektů při dalším přihlášení. **Nic dalšího nedělá.**

### Klient účet nemá

Uloží se **slib předání** a klientovi odejde pozvánka:

- jednorázový **přístupový kód** (beta je na pozvánky),
- odkaz na registraci, který má **předvyplněný kód i e-mail**.

Klient si na té adrese založí účet (heslem, nebo přes Google), potvrdí e-mail —
a **při prvním přihlášení se mu značka připíše sama**.

> **Musí to být tentýž e-mail.** Slib se páruje podle adresy. Když se klient
> zaregistruje na jinou, značka se nepřipíše a musíš předání zopakovat na tu novou.

Slib je v kartě vidět (*„Čeká na registraci"*), jde **zrušit** a jde z něj
**zkopírovat odkaz** — když e-mail spadne do spamu, pošleš ho klientovi sám
(WhatsApp, SMS, telefonem nadiktovat kód).

## 4. Co klient vidí po přihlášení

Hotovou značku: konfiguraci, plán, zásobník nápadů a tři ukázkové příspěvky.
Nic nenastavuje znovu. Co si řeší sám:

- **Tarif** — Nastavení, sekce s ceníkem (bez tarifu má tři příspěvky zdarma).
- **Připojení Instagramu** — Nastavení → *Publikování*. Do té doby se obsah
  generuje, ale nikam neodchází.
- **Automatické publikování** — přepínač, který si zapne, až bude chtít.

## Co nedělat

- **Nezakládat účet za klienta.** Obešlo by to potvrzení adresy i souhlas
  s podmínkami. Pozvánka je jediná správná cesta.
- **Nepsat do `user_clients` ručně.** Od toho je předání v Nastavení; ruční zápis
  obejde slib i evidenci, kdo komu co předal.
- **Neposílat kód pozvánky dál.** Je jednorázový a po vyzvednutí se sám zneplatní.

## Kde to žije v kódu

| Co | Kde |
|---|---|
| Průvodce onboardingem | `app/onboarding/core.ts`, `OnboardTab.tsx` |
| Předání a sliby | `app/actions/admin-actions.ts` (`transferClientToUser`), `lib/handoff.ts` |
| Vybrání slibu při přihlášení | `app/login/actions.ts`, `app/auth/callback/route.ts` |
| Brána bety | `lib/invite-gate.ts` (razítko `HANDOFF`) |
| E-maily | `lib/mail/templates/transactional.ts` (`client_handoff`, `client_handoff_done`) |
