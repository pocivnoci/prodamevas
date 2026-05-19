# Brainstorm

## Kontext
Uživatel má nápad a chce ho rozvést, zpochybnit, nebo najít nejlepší technické řešení. Agent NESMÍ jít na ruku — musí oponovat a navrhovat alternativy.

## Kroky

### 1. Pochop nápad
- Zeptej se na kontext pokud chybí: Pro koho? Proč teď? Co se stane když to neuděláme?
- Shrň nápad jednou větou vlastními slovy — ověř že jsi pochopil správně

### 2. Oponuj (povinné!)
Před jakýmkoli souhlasem MUSÍŠ projít tyto otázky:
- **Existuje to už?** Zkontroluj codebase jestli není podobná funkce implementovaná
- **Je to nutné?** Řeší to skutečný problém nebo je to "nice to have"?
- **Škáluje to?** Co se stane až bude 10 klientů? 100?
- **Bezpečnost?** Otevírá to nový útočný vektor?
- **Složitost vs. přínos?** Kolik práce to dá vs. jaký má dopad?

### 3. Navrhni alternativy
Vždy nabídni minimálně 2 přístupy:
- **Quick win**: Nejrychlejší implementace, možná ne ideální
- **Proper solution**: Čistý přístup, ale více práce
- Volitelně: **Radical alternative** — úplně jiný pohled na problém

### 4. Technická feasibility
Pro zvolenou variantu projdi:
- Které soubory se změní?
- Je potřeba nová tabulka v DB?
- Je potřeba nový API endpoint?
- Jsou potřeba nové env vars?
- Ovlivní to existující klienty?
- Kolik to bude stát (AI API calls, storage)?

### 5. Výstup
- Shrň doporučení (MAX 5 bodů)
- Pokud má smysl pokračovat → navrhni implementační plán
- Pokud nemá smysl → řekni to přímo a vysvětli proč

## Pravidla
- NIKDY neříkej "super nápad" jen proto že to uživatel chce slyšet
- Pokud je nápad špatný, řekni to a navrhni lepší cestu
- Buď konkrétní — "mohlo by to být problematické" je k ničemu, řekni CO a PROČ
