# Návod: Přidání nového klienta

Kompletní step-by-step guide na přidání nového klienta do Instagram engine.

---

## Krok 1: Vytvořit konfigurační soubor

Vytvoř nový soubor `instagram/configs/{nazev-klienta}.ts`:

```typescript
import type { ClientConfig } from "./types"

export const config: ClientConfig = {
    // ... viz šablona níže
}
```

## Krok 2: Registrovat v loaderu

Přidej řádek do `instagram/configs/index.ts`:

```diff
 const CONFIGS: Record<string, () => Promise<{ config: ClientConfig }>> = {
     mobilnamiru: () => import("./mobilnamiru"),
     hanzfans: () => import("./hanzfans"),
+    novyklient: () => import("./novyklient"),
 }
```

## Krok 3: Přidat post typy do DB

Pokud klient používá vlastní post typy, přidej je do tabulky `ig_post_types`:

```sql
INSERT INTO ig_post_types (name, label, description, emoji, pillar)
VALUES 
    ('product_drop', 'Product Drop', 'New product announcement', '🔥', 'convert'),
    ('outfit_inspo', 'Outfit Inspo', 'Styling inspiration', '👕', 'reach');
```

## Krok 4: Logo watermark (optional)

Pokud klient chce logo watermark na obrázcích:
1. Přidej PNG soubor do `instagram/fonts/logo-{klient}.png`
2. Nastav `logoFile: "logo-{klient}.png"` v configu
3. Doporučené: průhledné pozadí, bílý/světlý text, ~300×72px

## Krok 5: Otestovat

```bash
# Dry run — ověří že config funguje
npx tsx instagram/autopilot.ts --config=novyklient --dry-run

# Plný test s generováním obrázku
npx tsx instagram/autopilot.ts --config=novyklient --count=1
```

---

## Kompletní šablona konfigurace

Každý klient MUSÍ mít všechna povinná pole. Optional pole jsou označena `?`.

### Základní identifikace

```typescript
export const config: ClientConfig = {
    // ─── POVINNÉ ────────────────────────────────────────
    id: "novyklient",                    // Unikátní ID (= project_id v DB)
    name: "Název Značky",               // Zobrazovaný název
    website: "https://novyklient.cz",    // Web — používá se v CTA
    instagram: "@novyklient",            // IG handle
```

### Brand Voice (POVINNÉ)

Definuje jak AI píše za značku.

```typescript
    brandVoice: {
        // Kdo je značka — AI prompt (čím detailnější, tím lepší výstup)
        persona: `
Popis značky, její hodnoty, tón komunikace, cílová skupina.
Konkrétní příklady stylu psaní. Co dělá značku unikátní.
Jak se liší od konkurence.
        `.trim(),

        // Základní hodnoty značky
        values: [
            "Hodnota 1 — popis",
            "Hodnota 2 — popis",
        ],

        // Jak značka mluví
        voiceTraits: [
            "Tykáme / Vykáme",
            "Styl jazyka (hovorový / formální / vtipný)",
            "Délka vět",
            "Emoji strategie",
        ],

        // Co nikdy nedělat
        antiPatterns: [
            "Žádné clickbaity bez hodnoty",
            "Neprodávat agresivně",
            "Nepoužívat generické fráze",
        ],

        // Šablony hooků (min 3-5)
        hookTemplates: [
            {
                pattern: "{{číslo}} lidí dělá {{chybu}}",
                example: "80% lidí dělá tuhle chybu s WiFi",
                bestFor: ["tip_nastaveni", "statistika"],
                trigger: "curiosity",  // curiosity | fear | hope | humor | urgency | empathy
            },
            {
                pattern: "Tohle ti {{nikdo/nikdy}} neřekl o {{téma}}",
                example: "Tohle ti nikdo neřekl o screen time",
                bestFor: ["edukace"],
                trigger: "curiosity",
            },
        ],

        // CTA variace
        ctaVariations: [
            "Odkaz v bio ☝️",
            "Koukni na web.cz",
            "DM pro víc info",
        ],

        // Tón per post type — stupnice 1-5
        toneByPostType: {
            tip: {
                humorLevel: 2,        // 1=seriózní, 5=hodně vtipný
                urgencyLevel: 3,      // 1=klidný, 5=urgentní
                intimacyLevel: 4,     // 1=formální, 5=osobní
                educationalLevel: 5,  // 1=zábava, 5=hluboká edukace
            },
            meme: {
                humorLevel: 5,
                urgencyLevel: 1,
                intimacyLevel: 5,
                educationalLevel: 1,
            },
        },
    },
```

### Content Pillars (POVINNÉ)

Pilíře obsahu — poměry MUSÍ dávat dohromady 1.0.

```typescript
    contentPillars: {
        reach: {
            emoji: "📈",
            label: "Dosah",
            description: "Obsah pro maximální reach a nové sledující",
            postTypes: ["meme", "trending"],      // Jaké post typy patří pod pilíř
            ratio: 0.30,                            // 30% obsahu
            ctaStrategy: "soft",                    // soft | medium | hard | none
            kpi: ["reach", "shares"],
            ideaPrompt: "Volitelný prompt pro generování nápadů v tomto pilíři",
        },
        value: {
            emoji: "🎓",
            label: "Hodnota",
            description: "Edukační obsah a tipy",
            postTypes: ["tip", "edukace", "carousel_tips"],
            ratio: 0.30,
            ctaStrategy: "medium",
            kpi: ["saves", "shares"],
        },
        convert: {
            emoji: "🛒",
            label: "Konverze",
            description: "Obsah s CTA na web/prodej",
            postTypes: ["product_drop", "before_after"],
            ratio: 0.20,
            ctaStrategy: "hard",
            kpi: ["clicks", "conversions"],
        },
        connect: {
            emoji: "💬",
            label: "Komunita",
            description: "Engagement a interakce",
            postTypes: ["anketa", "behind_scenes"],
            ratio: 0.20,
            ctaStrategy: "none",
            kpi: ["comments", "DMs"],
        },
    },
```

> **Důležité:** `ratio` všech pilířů musí dávat dohromady `1.0`. Názvy pilířů mohou být libovolné (reach/value/convert je jen konvence).

### CTA Strategies (POVINNÉ)

Texty pro call-to-action podle intenzity:

```typescript
    ctaStrategies: {
        soft: [
            "Odkaz v bio ☝️",
            "Víc na webu 👆",
        ],
        medium: [
            "Mrkni na novyklient.cz 🔗",
            "Všechno najdeš na novyklient.cz",
        ],
        hard: [
            "🔥 Objednej teď na novyklient.cz!",
            "⚡ Poslední kusy — novyklient.cz",
        ],
        none: [
            "Co si o tom myslíš? 👇",
            "Jak to máte vy?",
        ],
    },
```

### Feed Aesthetic (POVINNÉ)

Vizuální identita pro konzistentní feed:

```typescript
    feedAesthetic: {
        colorPalette: "Popis barevné palety, např. 'Dark black (#0a0a0a) to neon purple (#7b2fff) gradient'",
        overlayOpacity: "30-40%",
        textPosition: "BOTTOM",
        font: "Popis fontu, např. 'Bold sans-serif (Impact, Oswald)'",
        feel: "Celkový vizuální pocit, např. 'Dark, edgy, streetwear aesthetic'",
        phoneModel: "iPhone 17 Pro Max",  // Pro konzistenci v obrázcích

        // Detailní instrukce pro Imagen prompt (optional)
        customInstructions: `
- Fotorealistická kvalita
- Ostré zaostření
- Moderní estetika
- Specifické instrukce pro značku...
        `.trim(),
    },
```

### Week Plan (POVINNÉ)

Statický týdenní plán — pole názvů post typů (2 per den, Po-Ne = 14 slotů):

```typescript
    weekPlan: [
        // Pondělí
        "tip", "meme",
        // Úterý
        "edukace", "product_drop",
        // Středa
        "meme", "carousel_tips",
        // Čtvrtek
        "before_after", "anketa",
        // Pátek
        "trending", "behind_scenes",
        // Sobota
        "product_drop", "tip",
        // Neděle
        "meme", "anketa",
    ],
```

### Hashtag Pools (POVINNÉ)

Engine automaticky míchá hashtagy z těchto poolů:

```typescript
    hashtagPools: {
        core: ["#novyklient"],                               // Brand hashtag (vždy přidaný)
        niche: ["#oborovy1", "#oborovy2", "#oborovy3"],      // Oborové hashtagy
        broad: ["#streetwear", "#fashion", "#lifestyle"],     // Široké hashtagy
        trending: ["#2026vibes", "#trending"],                // Aktuální trendy (občas obnovit)
        czech: ["#ceskyinstagram", "#ceskybrand"],            // České komunity
    },
```

### Content Focus (POVINNÉ)

Jednořádkový popis ČEMU se obsah věnuje — AI to vidí v promptech:

```typescript
    contentFocus: "O PRODUKTECH, streetwearu a lifestyle. Tipy = styling, outfit inspirace.",
```

### Post Types (OPTIONAL)

Jaké typy postů klient používá. Pokud chybí, engine použije defaultní sadu:

```typescript
    postTypes: ["meme", "product_drop", "tip", "behind_scenes", "carousel_tips", "anketa"],
```

> **Důležité:** Všechny post typy MUSÍ existovat v tabulce `ig_post_types` v Supabase!

### Overlay Gradient (OPTIONAL)

Barvy gradientu přes obrázky. Pokud chybí, použije se neutrální `#111111`:

```typescript
    overlayGradient: {
        topColor: "#0a0a0a",    // Horní barva (hex)
        midColor: "#1a0a2e",    // Střední barva (hex)
        bottomColor: "#0a0a0a", // Spodní barva (hex)
    },
```

### Logo File (OPTIONAL)

Watermark logo. Pokud chybí, logo se nepřidává:

```typescript
    logoFile: "logo-novyklient.png",  // Soubor v instagram/fonts/
```

### Image Instructions (OPTIONAL)

Per-post-type instrukce pro obrázek. `_default` se použije jako fallback:

```typescript
    imageInstructions: {
        _default: "Pozadí: relevantní lifestyle fotka.\nText dole: headline.",
        meme: "MEME — VÝJIMKA: Žádný gradient. Raw meme format.",
        product_drop: "PRODUCT DROP: Produkt na tmavém pozadí, neon světla.",
    },
```

### Video Focus (OPTIONAL)

Popis vizuálního zaměření pro video Reels:

```typescript
    videoFocus: "Streetwear lifestyle content (outfit reveals, product unboxing)",
```

### Products (OPTIONAL)

Produktový katalog — pro eshop klienty, používá `product-generator.ts`:

```typescript
    products: [
        {
            name: "Triko Classic",
            type: "triko",
            variants: 3,                // Počet barevných variant
            price: "499 Kč",
            description: "Základní branded tričko v černé, bílé a šedé.",
        },
    ],
```

---

## Checklist pro nového klienta

```
[ ] 1. Vytvořit configs/{klient}.ts s VŠEMI povinnými poli
[ ] 2. Registrovat v configs/index.ts
[ ] 3. Přidat custom post typy do DB (pokud má vlastní)
[ ] 4. Logo watermark PNG do fonts/ (pokud chce)
[ ] 5. Dry-run test: npx tsx instagram/autopilot.ts --config={klient} --dry-run
[ ] 6. Plný test: vygenerovat 1 post a ověřit vizuál + caption
[ ] 7. Ověřit že posty mají správné project_id v Supabase
```

## FAQ

**Q: Můžu mít jiné názvy pilířů než reach/value/convert/connect?**
A: Ano, názvy jsou libovolné. Engine je čte dynamicky z configu.

**Q: Co když klient nemá produkty?**
A: Pole `products` je optional. Engine bude generovat lifestyle obsah bez produktových referencí.

**Q: Jak mění barvy gradientu?**
A: Nastav `overlayGradient` v configu. Barvy jsou hex hodnoty pro horní/střed/spodní gradient.

**Q: Kolik post typů může klient mít?**
A: Neomezeně. Každý post type musí existovat v DB tabulce `ig_post_types`.

**Q: Co znamená `contentFocus`?**
A: Jednořádkový text který AI vidí v promptu. Říká AI *čemu* se obsah věnuje — "O TELEFONECH" vs "O MERCHI" vs "O FITNESS".
