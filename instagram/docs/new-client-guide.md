# Návod: Přidání nového klienta

Kompletní step-by-step guide na přidání nového klienta do Chrlit Studio.

**Updated:** 2026-06-02

---

## Krok 1: Vytvořit klienta v Supabase

```sql
-- 1. Vytvořit klienta
INSERT INTO clients (slug, name, config) 
VALUES ('novyklient', 'Název Značky', '{}'::jsonb);

-- 2. Přiřadit uživatele
INSERT INTO user_clients (user_id, client_id, role)
SELECT 'USER_UUID', id, 'admin' FROM clients WHERE slug = 'novyklient';
```

Nebo použij script: `npx tsx scripts/setup-user.ts`

## Krok 2: Nastavit config

Config je JSONB v `clients.config`. Edituje se v dashboard UI (**Settings tab**) nebo přímo v Supabase.

`validateConfig()` automaticky doplní safe defaults pro neúplný config — nový klient necrashne.

### Povinná pole (TypeScript: `ClientConfig` v `instagram/configs/types.ts`)

```typescript
{
    brandVoice: {
        persona: "Popis značky, hodnoty, tón komunikace, cílová skupina...",
        values: ["Hodnota 1", "Hodnota 2"],
        voiceTraits: ["Tykáme", "Hovorový styl", "Krátké věty"],
        antiPatterns: ["Žádné clickbaity", "Neprodávat agresivně"],
        hookTemplates: [
            {
                pattern: "{{číslo}} lidí dělá {{chybu}}",
                example: "80% lidí dělá tuhle chybu s WiFi",
                bestFor: ["tip"],
                trigger: "curiosity"  // curiosity | fear | hope | humor | urgency | empathy
            }
        ],
        ctaVariations: ["Odkaz v bio ☝️", "Koukni na web.cz"],
        toneByPostType: {
            tip: { humorLevel: 2, urgencyLevel: 3, intimacyLevel: 4, educationalLevel: 5 },
            meme: { humorLevel: 5, urgencyLevel: 1, intimacyLevel: 5, educationalLevel: 1 },
        }
    },

    contentPillars: {
        reach:   { emoji: "📈", label: "Dosah",    ratio: 0.30, ctaStrategy: "soft",   postTypes: ["meme", "trending"],   kpi: ["reach", "shares"] },
        value:   { emoji: "🎓", label: "Hodnota",  ratio: 0.30, ctaStrategy: "medium", postTypes: ["tip", "edukace"],     kpi: ["saves", "shares"] },
        convert: { emoji: "🛒", label: "Konverze", ratio: 0.20, ctaStrategy: "hard",   postTypes: ["product_drop"],       kpi: ["clicks"] },
        connect: { emoji: "💬", label: "Komunita", ratio: 0.20, ctaStrategy: "none",   postTypes: ["anketa"],             kpi: ["comments"] },
    },

    ctaStrategies: {
        soft:   ["Odkaz v bio ☝️", "Víc na webu 👆"],
        medium: ["Mrkni na novyklient.cz 🔗"],
        hard:   ["🔥 Objednej teď na novyklient.cz!"],
        none:   ["Co si o tom myslíš? 👇"],
    },

    feedAesthetic: {
        colorPalette: "Dark black (#0a0a0a) to neon purple (#7b2fff) gradient",
        overlayOpacity: "30-40%",
        textPosition: "BOTTOM",
        font: "Bold sans-serif",
        feel: "Dark, edgy aesthetic",
    },

    hashtagPools: {
        core: ["#novyklient"],
        niche: ["#oborovy1", "#oborovy2"],
        broad: ["#lifestyle"],
        trending: ["#2026vibes"],
        czech: ["#ceskyinstagram"],
    },

    weekPlan: ["tip", "meme", "edukace", "product_drop", "meme", "carousel_tips", "before_after", "anketa", "trending", "behind_scenes", "product_drop", "tip", "meme", "anketa"],

    // Jednořádkový popis čemu se obsah věnuje (povinné)
    contentFocus: "O PRODUKTECH, streetwearu a lifestyle. Tipy = styling, outfit inspirace.",
}
```

### Volitelná pole

| Pole | Typ | Účel |
|------|-----|------|
| `industry` | `string` | Obor pro context agent (např. "gastronomie", "e-commerce") |
| `city` | `string` | Město pro počasí + lokální kontext (např. "Praha") |
| `overlayGradient` | `{topColor, midColor, bottomColor}` | Barvy gradientu přes obrázky (hex) |
| `logoFile` | `string` | Logo watermark (soubor v `instagram/assets/`) |
| `imageInstructions` | `Record<string, string>` | Per-post-type instrukce pro obrázek (`_default` = fallback) |
| `videoFocus` | `string` | Vizuální zaměření pro reels |
| `products` | `ProductInfo[]` | Produktový katalog (@deprecated → preferuj `ig_products` tabulku) |
| `productCooldownDays` | `number` | Cooldown v dnech pro produkt (default: 14) |
| `audiencePersonas` | `AudiencePersona[]` | Persony cílové skupiny |
| `storageBucket` | `string` | Název Supabase bucketu (fallback: "audit-screenshots") |
| `postTypes` | `string[]` | Povolené post typy (pokud chybí → default sada) |
| `postFormats` | `Record<string, PostFormat>` | Per-type format (aspect ratio, medium, overlay style) |
| `defaultFormat` | `PostFormat` | Default formát když není per-type override |
| `characterDescription` | `string` | Popis osoby pro konzistentní generování v obrázcích |
| `brandReferenceImages` | `(string \| BrandImage)[]` | Brand reference fotky (z onboardingu nebo upload) |
| `ttsVoice` | `string` | Hlas pro TTS voiceover (default: "Kore") |
| `fontOverride` | v `feedAesthetic` | Override fontu pro overlay ("Inter" / "BebasNeue") |
| `accentColor` | v `feedAesthetic` | Accent barva pro zvýrazněné slova v overlay (hex) |
| `textAlign` | v `feedAesthetic` | Zarovnání textu ("left"/"center"/"right") |
| `headlineScale` | v `feedAesthetic` | Velikost headline multiplikátor (default: 1.0) |

> **Poznámka:** Pilíře (`contentPillars`) mohou mít vnořené `categories: PillarCategory[]` — sub-kategorie s vlastním `weight`, `medium`, `overlayStyle`, `aspectRatio`.

## Krok 3: Post typy v DB

Pokud klient používá vlastní post typy:

```sql
INSERT INTO ig_post_types (client_id, name, display_name, emoji, pillar, frequency)
SELECT id, 'product_drop', 'Product Drop', '🔥', 'convert', 0.15
FROM clients WHERE slug = 'novyklient';
```

## Krok 4: Logo watermark (optional)

1. Přidej PNG do `instagram/assets/logo-{klient}.png`
2. Nastav `logoFile: "logo-{klient}.png"` v config JSONB
3. Doporučení: průhledné pozadí, bílý text, ~300×72px

## Krok 5: Storage bucket

```bash
npx tsx scripts/create-client-buckets.ts
```

Nebo ručně v Supabase: vytvořit bucket `ig-{slug}` (public).

## Krok 6: Onboarding

Nový klient může projít onboarding wizardem:
1. `/onboarding` — zadá web URL
2. AI analyzuje web → vygeneruje config
3. Showcase: vygeneruje 3 ukázkové posty (90s timeout per post)
4. Config se uloží do `clients.config`

## Krok 7: Ověření

V dashboard:
1. Přepni projekt v sidebar dropdownu
2. Jdi do **Settings** → ověř config
3. Jdi do **Generate** → vygeneruj 1 testovací post
4. Ověř vizuál + caption + hashtagy

---

## Config validace

`loadConfig()` automaticky volá `validateConfig()` — safe defaults:

| Pole | Default pokud chybí |
|------|---------------------|
| `id` | Slug klienta |
| `name` | Slug klienta |
| `website` | Prázdný string |
| `instagram` | Prázdný string |
| `brandVoice` | `{ persona: "Přátelský poradce", hookTemplates: [], ...}` |
| `contentPillars` | Prázdný objekt `{}` |
| `ctaStrategies` | `{ soft: [], medium: [], hard: [], none: [] }` |
| `feedAesthetic` | `{ colorPalette: "Neutrální", font: "Inter", feel: "Moderní a čistý", phoneModel: "iPhone 16 Pro" }` |
| `weekPlan` | Prázdné pole `[]` |
| `hashtagPools` | `{ core: [], niche: [], broad: [], trending: [], czech: [] }` |
| `contentFocus` | `config.name \|\| slug` |

> **Pozor:** Optional pole (`imageInstructions`, `overlayGradient`, `audiencePersonas`, `postFormats`, ...) NEMAJÍ default v `validateConfig()` — zůstanou `undefined`. Engine je zpracuje s graceful fallbacky.

Nový klient s prázdným `{}` configem **necrashne** — ale výstupy budou generické.

---

## FAQ

**Q: Můžu mít jiné názvy pilířů než reach/value/convert/connect?**
A: Ano, názvy jsou libovolné. Engine je čte dynamicky z configu.

**Q: Co když klient nemá produkty?**
A: `products` je optional. Engine generuje lifestyle obsah bez produktových referencí.

**Q: Jak změnit barvy gradientu?**
A: Nastav `overlayGradient` v Settings tabu nebo přímo v DB.

**Q: Kolik post typů může klient mít?**
A: Neomezeně. Musí existovat v DB `ig_post_types` s odpovídajícím `client_id`.

**Q: Co je `contentFocus`?**
A: Jednořádkový popis čemu se obsah věnuje — "O TELEFONECH" / "O MERCHI" / "O FITNESS". AI to vidí v promptu.
