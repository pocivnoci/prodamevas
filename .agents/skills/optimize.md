# Optimize

## Kontext
Něco je pomalé, drahé, nebo neefektivní. Cíl: identifikovat bottleneck a vyřešit ho.

## Kroky

### 1. Identifikace bottlenecku
Nejdřív zjisti CO je pomalé:

| Symptom | Pravděpodobná příčina | Kde hledat |
|---------|----------------------|------------|
| Dashboard se načítá pomalu | Příliš mnoho Server Actions volaných najednou | Dashboard komponenty |
| Generování postu trvá >2 min | AI model latence, velké obrázky | `autopilot.ts`, `gemini-client.ts` |
| Upload selhává | Velký soubor, Supabase timeout | `brand-images-action.ts` |
| API timeout na Vercel | Funkce překročila 300s | Route handler, `maxDuration` |
| Vysoké náklady na AI | Zbytečné retry, velké prompty | `gemini-client.ts`, `withRetry` |

### 2. Měření
- Přidej `console.time()` / `console.timeEnd()` kolem podezřelých bloků
- Zkontroluj velikost payloadů (JSON, obrázky)
- Podívej se na Supabase query plány (jsou indexy na `client_id`?)

### 3. Typické optimalizace v tomto projektu

#### AI náklady
- Používej `gemini-2.5-flash-lite` místo `gemini-2.5-pro` kde stačí (jednoduché úlohy)
- Zkrať prompty — odstraň redundantní instrukce
- Cache výsledky kde to dává smysl (brand memories, config)
- Snižuj počet retry pokusů pro non-critical operace

#### Obrázky
- Vždy komprimuj před uploadem: `sharp(buffer).webp({ quality: 85 }).toBuffer()`
- Nastav `cacheControl: "31536000"` na Supabase storage
- Nedownloaduj brand reference images znovu při každém generování — cachuj v paměti

#### Supabase dotazy
- Vyber pouze potřebné sloupce: `.select("id, caption, status")` místo `.select("*")`
- Přidej `.limit()` na všechny list dotazy
- Kombinuj související dotazy do jednoho kde to jde
- Indexy na `client_id` + `created_at` (DESC) pro rychlé řazení

#### Next.js
- Používej `revalidatePath()` místo `router.refresh()` pro invalidaci cache
- Server Components pro data fetching, Client Components pouze pro interaktivitu
- Lazy importy pro těžké moduly: `const { sharp } = await import("sharp")`

### 4. Výstup
- Konkrétní čísla: "bylo X ms, teď Y ms" nebo "bylo X KB, teď Y KB"
- Pokud optimalizace vyžaduje trade-off (kvalita vs. rychlost), řekni to

## Pravidla
- ❌ Neoptimalizuj předčasně — nejdřív MĚŘJ
- ❌ Neobětuj čitelnost kódu kvůli mikrooptimalizaci
- ✅ Největší gains jsou vždy v architektuře, ne v kódu
