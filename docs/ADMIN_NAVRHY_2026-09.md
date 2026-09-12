# Admin sekce — co je hotové a co navrhujeme dál

Zápis z průchodu celým admin menu (9/2026). První část je stav po téhle změně,
druhá je zásobník návrhů — každý s tím, proč a z jakých dat by vznikl.

## Hotovo v téhle změně

**Úkoly žijí v Supabase, ne v Google tabulce.**
Sync dvakrát týdně přepisoval název, poznámku a prioritu, takže co se v appce
upřesnilo, pondělní běh zahodil. Cron je pryč z `vercel.json`,
`lib/tasks/sheet-sync.ts` jen zakládá chybějící řádky a `app/api/cron/tasks-sync`
zůstává jako ruční import za `CRON_SECRET`. `source_key` se nezahazuje — sdílí
ho návrhy AI (`lib/tasks/propose.ts`).

**Záložka Úkoly je editor.**
`app/(dashboard)/dashboard/instagram/tabs/TasksTab.tsx` +
`app/actions/task-actions.ts`: inline úprava názvu, poznámky, priority, termínu
a klienta, ruční „čekám na… do kdy" (`setTaskBlocked`), zakládací panel
s termínem a klientem, mazání na dvě kliknutí, po „Projet AI" se seznam natáhne
sám. Sekce jdou podle pozornosti — *Čeká na tvou odpověď → Moje → Nezařazené →
Ostatní otevřené → Blokované → Hotové* — ne podle stavu.

**Navigace umí odznak.** `NavItem.badge` v `app/(dashboard)/nav.ts`, čísla drží
`StudioContext.navBadges`, čte je sidebar i spodní lišta. Dnes ukazuje počet
nezodpovězených otázek od AI.

**Sekce na sebe odkazují.** Titulek se bere z registru (`page.tsx`), existuje
deep-link `#tasks?id=…` (`StudioContext.deepLink`), z Firmy a z Obchodu se dá
jedním kliknutím otevřít studio klienta nebo založit úkol, Schválení otevírá
klienta a hlásí chyby inline.

**Ranní brief hlásí zaseklé úkoly.** `lib/agents/daily-brief.ts`, funkce
`buildTasks`: po termínu, prošlé `blocked_until`, otázka bez odpovědi > 2 dny.

---

## Návrhy — zásobník

Velikost: **S** ≈ půl dne, **M** ≈ 1–2 dny, **L** ≈ 3 a víc.

### C4 · Inbox „co čeká na člověka" — M/L

**Co:** jedna obrazovka místo pěti: otázky AI, čekající schválení, leady po
termínu, klienti v riziku, úkoly po termínu, nedokončené onboardingy.
**Proč:** dneska se ráno musí otevřít Úkoly, Schválení, Obchod a Firma, aby se
zjistilo, že nic nehoří. Čtyři obrazovky na odpověď „ne".
**Data už jsou:** `buildDailyBrief()` přesně tohle skládá do e-mailu — stačí
wrapper, který místo HTML vrátí položky s akcí.
**Soubory:** nový `tabs/InboxTab.tsx`, `app/actions/inbox-actions.ts` nad
`lib/agents/daily-brief.ts`, položka v `nav.ts` (rovnou s `badge`).

### C5 · Ranní brief v aplikaci — S

**Co:** tentýž brief jako v e-mailu, jen vykreslený v appce (a s datem, ke
kterému platí).
**Proč:** e-mail se nedá odkrokovat ani poslat zpětně; když se v něm něco
nezdá, neexistuje způsob, jak se podívat, z čeho vznikl.
**Data už jsou:** `buildDailyBrief()` je čistá funkce.
**Soubory:** `tabs/CompanyTab.tsx` (blok nad tabulkou) nebo sekce v C4.

### C9 · Kalendář termínů — M

**Co:** jeden měsíční pohled na `tasks.due_date`, `tasks.blocked_until`,
`leads.meeting_at`, `leads.next_contact_at`, obnovy předplatných a daňové
termíny z `lib/agents/compliance-calendar.ts`.
**Proč:** termíny jsou dnes ve třech frontách a žádná neví o zbylých dvou.
Kolize se pozná až v den, kdy nastane.
**Data už jsou:** všechny čtyři zdroje mají datumový sloupec; compliance
kalendář vrací hotové položky.
**Soubory:** nový `tabs/AgendaTab.tsx`, `app/actions/agenda-actions.ts`,
`nav.ts`.

### C10 · Náklady AI vs. tržby na klienta — M

**Co:** tabulka klient → útrata za modely (`ai_spend`) vs. zaplacené částky
(`payments`), za měsíc.
**Proč:** dnes se neví, jestli je konkrétní tarif ziskový. Rozhodnutí o ceně
se dělá odhadem.
**Data už jsou:** `ai_spend` se plní v `gemini-client.ts`, `payments` má částky
v haléřích; chybí jen společné okno a agregace.
**Pozor:** haléře, ne koruny — zaokrouhlovat až v renderu (viz
skill `payments-billing`).
**Soubory:** rozšíření `app/actions/company-actions.ts`, sloupce v `CompanyTab`.

### C11 · Hromadné akce nad úkoly a leady — S

**Co:** zaškrtávátka u řádků a dvě akce — „přiřadit" a „hotovo" (u leadů
„posunout stav").
**Proč:** po importu nebo po schůzce se přiřazuje deset úkolů po jednom.
**Data už jsou:** `assignTask` / `setTaskStatus` stačí volat ve smyčce; server
nic nového nepotřebuje.
**Soubory:** `tabs/TasksTab.tsx`, `tabs/LeadsTab.tsx`.

### Role „manager" s omezeným přístupem — L

**Co:** dnes je přístup binární — buď je e-mail v `SUPER_ADMIN_EMAILS` a vidí
všechno (Mailing, Waitlist, data všech zákazníků), nebo nevidí nic.
`team_members.role` existuje, ale schválně nic neuděluje.
**Proč:** obchod potřebuje Obchod, Úkoly a Firmu — ne rozesílání e-mailů
zákazníkům ani produkty. Dnešní stav znamená, že se buď dává plný admin, nebo
se data přeposílají ručně.
**Jak:** `requireTeamMember(role)` vedle `requireSuperAdmin()` v
`lib/auth-guard.ts`, `NavItem.minRole` v `nav.ts`, per-akce brána v
`app/actions/*`. **Nesmí to být jen skrytí položky v menu** — sekce jsou
dosažitelné hashem a rozhoduje brána v akci.
**Odhad L:** projít je potřeba každou adminskou akci, ne jen navigaci.
