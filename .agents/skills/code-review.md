# Code Review

## Kontext
Uživatel chce zkontrolovat kvalitu kódu — najít bugy, bezpečnostní díry, výkonnostní problémy a navrhnout vylepšení.

## Kroky

### 1. Scope
- Zeptej se CO chce uživatel zkontrolovat (soubor, modul, celou app?)
- Pokud neřekne, zkontroluj soubor který má otevřený

### 2. Security check
- [ ] Jsou všechny Server Actions chráněné `requireSuperAdmin()`?
- [ ] Nepoužívá se `supabaseAdmin` bez auth guardu?
- [ ] Jsou API routes (`app/api/`) ověřené?
- [ ] Nelogují se citlivá data (API klíče, hesla, emaily) do console?
- [ ] Není v kódu hardcoded API klíč nebo secret?
- [ ] Validují se vstupy od uživatele (formData, query params)?

### 3. Bug hunt
- [ ] Jsou všechny async operace správně awaited?
- [ ] Jsou ošetřeny null/undefined hodnoty z Supabase dotazů?
- [ ] Funguje error handling — chytá se error VŽDY a vrací se smysluplná zpráva?
- [ ] Nejsou v kódu race conditions (např. parallel writes do stejného záznamu)?
- [ ] Jsou ID parametry validované před použitím v DB dotazu?

### 4. Kvalita kódu
- [ ] Opakuje se logika, která by měla být v shared helperu?
- [ ] Jsou typy správné nebo se používá `any` zbytečně?
- [ ] Jsou importy čisté (žádné nepoužívané)?
- [ ] Je soubor příliš velký? (>500 řádků = červená vlajka)

### 5. Performance
- [ ] Dělají se zbytečné DB dotazy v loopu? (N+1 problém)
- [ ] Stahují se `select('*')` kde stačí konkrétní sloupce?
- [ ] Jsou velké operace (fetch, sharp, AI) v try/catch s timeoutem?
- [ ] Komprimují se obrázky před uploadem? (sharp → webp)

### 6. Report
- Vypiš nalezené problémy seřazené podle závažnosti: 🔴 kritické → 🟡 důležité → 🟢 nice-to-have
- U každého problému navrhni konkrétní fix (ne jen "je to špatně")
- Zeptej se jestli má uživatel zájem o automatický fix
