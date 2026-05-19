# Refactor

## Kontext
Kód je nepřehledný, příliš velký, nebo se opakují vzory. Cíl: vyčistit bez rozbití funkčnosti.

## Kroky

### 1. Diagnóza
- Změř velikost souboru (řádky, bytes)
- Identifikuj logické celky v souboru (hledej komentářové sekce `// ───`)
- Spočítej exportované funkce (`grep "export async function"`)
- Najdi duplicitní vzory (copy-paste kód)

### 2. Strategie rozdělení
Velké soubory v tomto projektu a jak je dělit:

| Soubor | Řádků | Doporučení |
|--------|-------|------------|
| `autopilot.ts` | 1280 | Už je částečně rozdělený — nerozebírej dál pokud uživatel nechce |
| `admin-actions.ts` | 1060 | Rozděl podle domény: posts, config, images, insights |
| `caption-generator.ts` | ~700 | Schemas + prompt builder + quality gate |

### 3. Bezpečný postup
1. **Nikdy** nemazej starý soubor — nejdřív vytvoř nový
2. Re-exportuj ze starého umístění pro zpětnou kompatibilitu:
   ```ts
   // admin-actions.ts (starý soubor, zachováno pro kompatibilitu)
   export { getIGPostsList, updateIGPostStatus } from './admin-posts-actions'
   export { getClientConfig, updateClientConfig } from './admin-config-actions'
   ```
3. Ověř importy: `grep -r "from.*admin-actions" app/`
4. Spusť `npx tsc --noEmit` po KAŽDÉM kroku
5. Teprve když vše funguje, odstraň re-exporty a updatuj importy

### 4. Co extrahovat
- **Shared helpery** → `utils/` nebo `lib/`
- **Typy a interfaces** → `types.ts` v příslušném modulu
- **Konstanty** → na začátek souboru nebo do `constants.ts`
- **Validační logiku** → do dedicated validator funkce

### 5. Co NEDĚLAT
- ❌ Nerefaktoruj více souborů najednou
- ❌ Neměň API (signatury exportovaných funkcí) bez souhlasu
- ❌ Nepřejmenovávej soubory které jsou importované z 10+ míst
- ❌ Neodstraňuj "mrtvý kód" bez ověření že je opravdu mrtvý
