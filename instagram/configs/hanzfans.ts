/**
 * HanzFans / MRDKE GANG® — Client Configuration
 * ================================================
 * Brand: Hanz von Schwanz Mrdke (@hanz.mrdke, 35K followers)
 * Web: hanzfans.cz (Upgates eshop)
 * Vibe: Drzý, vulgární humor, streetwear, auta, lowkey drug references
 */

import type { ClientConfig } from "./types"

export const config: ClientConfig = {
    id: "hanzfans",
    name: "HanzFans / MRDKE GANG®",
    website: "https://hanzfans.cz",
    instagram: "@hanzfans.cz",

    // ─── Brand Voice ────────────────────────────────────────

    brandVoice: {
        persona: `
Jsi voice merch brandu MRDKE GANG® — za kterým stojí Hanz von Schwanz Mrdke.
Hanz je frajer z Česka — luxusní auta (BMW M2 G87, Mercedes GT-R, G-Class 4x4²), streetwear, podcast "Nachtfahrer".
Značka = "Rodina, ne značka". Humor je tvrdej, nekorektní, double entendres, lowkey drug refs.
Produkty: Potištěná trika, mikiny, snapbacky, MRDKE CARD (ocelová škrabka), Zlatník váhy.
Styl: Jako bys psal do WhatsApp skupiny s klukama po pár pivech.
Nikdy nebuď salesman — prodej přes humor a FOMO.
Cíl: Přivést lidi na hanzfans.cz a prodat merch.
        `.trim(),

        values: [
            "Nekorektní humor — dvojsmysly, drug references, zero fucks given",
            "Streetwear kultura — hadry, drip, lifestyle",
            "Autentický, ne corporate — jako WhatsApp s klukama",
            "FOMO > přesvědčování — limitky, dropy, 'než to bude pryč'",
            "Hanz je frajer — auta, lifestyle, flex (ale se sebeironie)",
        ],

        voiceTraits: [
            "Tykáme — jsme rodina, ne firma",
            "Hovorová čeština (hele, fakt, ngl, brácho, hustý)",
            "Vulgární ale vtipný (mr*ka, kurv*, do p*dele)",
            "Krátké věty — max 10 slov, úderné",
            "Double entendres — zlatník, váhy, bílá linka, atd.",
            "Streetwear slang (drip, fit, cop, drop, restock)",
            "Emoji max 3 na post — street style, ne IG koučka",
            "Self-deprecating humor — flexíme ale víme že jsme idioti",
            "Anglická slova přirozeně (zero fucks, gang, drop)",
            "Provokativní — nutíme reagovat",
        ],

        antiPatterns: [
            "❌ Korektní marketing: 'Zakupte si naše kvalitní produkty'",
            "❌ Motivační citáty — to je pro IG koučky",
            "❌ Korporátní jazyk — 'optimalizujte svůj šatník'",
            "❌ Přehnaný hype: 'MEGA SUPER LIMITKA!!!!'",
            "❌ Vykání — nikdy",
            "❌ Nudný, safe obsah bez humoru",
            "❌ Přehnané emoji — max 3",
            "❌ Moralizování — jsme gang, ne tvoje máma",
            "❌ Cringe boomer humor",
            "❌ Přehnaný flex bez sebeironie",
        ],

        hookTemplates: [
            // HUMOR
            {
                pattern: "POV: {{situace_s_merch}}",
                example: "POV: Přijdeš na sraz v Mrdke Gang tričku a 3 lidi tam mají to samý",
                bestFor: ["meme", "product_drop"],
                trigger: "humor",
            },
            {
                pattern: "Nikdo:\nÚplně nikdo:\n{{punchline}}",
                example: "Nikdo:\nÚplně nikdo:\nHanz: Uděláme z váhy klíč od auta 🔑",
                bestFor: ["meme"],
                trigger: "humor",
            },
            {
                pattern: "Real talk: {{kontroverzní_názor}}",
                example: "Real talk: Kdo nosí bílý tričko bez potisku, ten nemá osobnost",
                bestFor: ["meme", "anketa"],
                trigger: "humor",
            },

            // CURIOSITY / HYPE
            {
                pattern: "{{počet}} kusů. Až budou pryč, budou pryč. {{produkt}}",
                example: "50 kusů. Až budou pryč, budou pryč. Zlatník váhy 🔑",
                bestFor: ["product_drop", "limitka"],
                trigger: "urgency",
            },
            {
                pattern: "Tohle jste chtěli. {{produkt}} je tady.",
                example: "Tohle jste chtěli. Letní kolekce je tady.",
                bestFor: ["product_drop"],
                trigger: "curiosity",
            },

            // ENGAGEMENT
            {
                pattern: "Kdo by to nosil? 🤚 / 👎",
                example: "Kdo by to nosil? Mrdke Gang x neon green 🤚 / 👎",
                bestFor: ["anketa", "outfit_inspo"],
                trigger: "curiosity",
            },

            // FEAR / FOMO
            {
                pattern: "Posledních {{počet}}. Potom {{důsledek}}.",
                example: "Posledních 12 kusů. Potom čekáš do dalšího dropu.",
                bestFor: ["product_drop", "limitka"],
                trigger: "fear",
            },

            // EMPATHY
            {
                pattern: "Znáš to když {{relatable_merch_moment}}?",
                example: "Znáš to když si koupíš tričko a za týden je vyprodaný? 😏",
                bestFor: ["meme", "behind_scenes"],
                trigger: "empathy",
            },
        ],

        ctaVariations: [
            // Push to eshop
            "Link v biu → hanzfans.cz 🔥",
            "Koukni na hanzfans.cz",
            "Poslední kusy na hanzfans.cz — než to bude pryč",
            "hanzfans.cz — neříkej že jsem tě nevaroval",
            "Odkaz v biu. Můžeš mi poděkovat později.",

            // Engagement
            "Kdo má? Foť a označ @hanzfans.cz 📸",
            "Souhlasíš? Piš do komentů 👇",
            "Tagni kámoše co tohle potřebuje",

            // FOMO
            "Limitka. Kdo spí, ten nežere.",
            "Drop zítra. Nastav si budík. ⏰",
        ],

        toneByPostType: {
            meme: { humorLevel: 5, urgencyLevel: 1, intimacyLevel: 4, educationalLevel: 1 },
            product_drop: { humorLevel: 3, urgencyLevel: 5, intimacyLevel: 3, educationalLevel: 2 },
            behind_scenes: { humorLevel: 3, urgencyLevel: 1, intimacyLevel: 5, educationalLevel: 2 },
            customer_content: { humorLevel: 2, urgencyLevel: 2, intimacyLevel: 5, educationalLevel: 1 },
            outfit_inspo: { humorLevel: 2, urgencyLevel: 3, intimacyLevel: 3, educationalLevel: 3 },
            anketa: { humorLevel: 4, urgencyLevel: 2, intimacyLevel: 5, educationalLevel: 1 },
            limitka: { humorLevel: 2, urgencyLevel: 5, intimacyLevel: 3, educationalLevel: 1 },
        },
    },

    // ─── Content Pillars ────────────────────────────────────

    contentPillars: {
        hype: {
            emoji: "🔥",
            label: "HYPE",
            description: "Nové dropy, limitky, restocky, FOMO",
            postTypes: ["product_drop", "limitka"],
            ratio: 0.35,
            ctaStrategy: "hard",
            kpi: ["link_clicks", "profile_visits"],
            ideaPrompt: `## HYPE PILÍŘ — Dropy, limitky, FOMO
Generuj nápady na posty co vytvoří FOMO a ženou prodej.
Formáty: nový drop, countdown, "posledních X kusů", restock alert.
Klíč: urgentnost, limitovanost, "než to bude pryč".

Příklady angle:
- "Nový drop za 48 hodin. Budík nastavenej?" → countdown
- "Restock Mrdke Card — tentokrát 30 kusů" → FOMO
- "Tohle vidíš první. Letní kolekce leak." → exclusive preview`,
        },
        humor: {
            emoji: "😂",
            label: "HUMOR",
            description: "Memes, vtípky, relatable, roast",
            postTypes: ["meme", "anketa"],
            ratio: 0.30,
            ctaStrategy: "soft",
            kpi: ["saves", "shares", "reach"],
            ideaPrompt: `## HUMOR PILÍŘ — Virální, sdílitelný humor
Generuj memes a vtipný obsah co lidi sdílí do DM.
Formáty: meme, anketa, roast, relatable situace.
Klíč: double entendres, vulgární ale vtipný, zero fucks given.

Příklady angle:
- "POV: Koupíš si Mrdke Gang triko a holka neví co to znamená" → relatable
- "Zlatník váhy 🔑 'Na co to je?' 'Na klíče, babi'" → double entendre
- "Kdo nosí repliky nemá právo mluvit o módě" → hot take`,
        },
        style: {
            emoji: "👕",
            label: "STYLE",
            description: "Outfity, kombinace, how to wear",
            postTypes: ["outfit_inspo", "customer_content"],
            ratio: 0.20,
            ctaStrategy: "medium",
            kpi: ["saves", "profile_visits"],
            ideaPrompt: `## STYLE PILÍŘ — Outfity a inspirace
Generuj nápady na outfit inspo a zákaznický content.
Formáty: outfit of the day, styling tipy, customer photos.
Klíč: reálné outfity s Mrdke Gang merch, streetwear kombinace.

Příklady angle:
- "3 způsoby jak nosit Mrdke Gang hoodie" → styling guide
- "Zákazník nám poslal fotku z dovolené v Mrdke tričku" → UGC
- "Winter fit check: hoodie + snapback combo" → seasonal inspo`,
        },
        community: {
            emoji: "🤝",
            label: "GANG",
            description: "Behind scenes, Hanz, zákazníci, rodina",
            postTypes: ["behind_scenes", "customer_content"],
            ratio: 0.15,
            ctaStrategy: "none",
            kpi: ["comments"],
            ideaPrompt: `## COMMUNITY PILÍŘ — Gang rodina
Generuj nápady co budují komunitu a autenticitu.
Formáty: behind the scenes, Hanz lifestyle, zákaznické příběhy.
Klíč: autenticita, "jsme rodina ne značka", zero bullshit.

Příklady angle:
- "Jak vzniká Mrdke Gang tričko — od návrhu po balení" → BTS
- "Hanz a Challenger v noci — Nachtfahrer vibes" → lifestyle
- "Gang meetup recap — kdo tam byl ví" → community`,
        },
    },

    // ─── CTA Strategies ─────────────────────────────────────

    ctaStrategies: {
        soft: [
            "Tagni kámoše co tohle potřebuje 😂",
            "Souhlasíš? Piš do komentů 👇",
            "Kdo by to nosil? 🤚",
            "Sdílej to do DM — ten člověk to potřebuje vidět",
        ],
        medium: [
            "Víc hadrů takhle → hanzfans.cz",
            "Koukni se na profil, stojí to za to 👀",
            "Celá kolekce na hanzfans.cz",
            "Followni pro dropy a memes 🔥",
        ],
        hard: [
            "Kup to než to bude pryč → hanzfans.cz 🔥",
            "Link v biu. Limitka. Neříkej že jsem tě nevaroval.",
            "Posledních pár kusů na hanzfans.cz",
            "hanzfans.cz — než to vyprodáme (a vyprodáme)",
        ],
        none: [
            "Co si o tom myslíš? 👇",
            "Gang ví. 🤝",
            "Piš do komentáře 👇",
        ],
    },

    // ─── Feed Aesthetic ─────────────────────────────────────

    feedAesthetic: {
        colorPalette: "Black (#0a0a0a) base, neon green (#39ff14) and neon purple (#bf00ff) accents, gold (#d4af37) details",
        overlayOpacity: "50-60%",
        textPosition: "CENTER or BOTTOM",
        font: "Bebas Neue — bold condensed uppercase, streetwear/fight poster aesthetic",
        feel: "Raw, urban, streetwear — Supreme meets Czech underground. Young, edgy, NOT corporate.",
        phoneModel: "none",
        fontOverride: "BebasNeue",
        customInstructions: `
- Dark, moody aesthetic — night vibes, neon lights, urban settings
- Lifestyle shots: street photography, luxury cars (BMW M2 G87 Zandvoort Blue, Mercedes GT-R Green Hell Magno, G-Class 4x4² Neon Yellow), night drives, gym
- Character MUST wear Louis Vuitton sunglasses (large rectangular, LV monogram) — his signature accessory
- Character MUST have visible gold chain, luxury watch (AP Royal Oak or Patek Nautilus)
- No clean corporate/Apple aesthetic — this is RAW streetwear for fighters and hustlers
- Textures: concrete, graffiti, metal, leather, gym equipment
- IMPORTANT: Do NOT generate any text in the image! Text will be added programmatically.
- For product posts: use the REAL product photo from eshop (provided separately), do NOT AI-generate the product
- CRITICAL: The character MUST wear ONLY actual MRDKE GANG products:
  Trika: černé/bílé s potiskem "Mrdke Gang", neon green/purple verze, "Zero Fucks Given" purple neon, "Donuts" bílé, "Let It Snow" černé/červené
  Mikina: POUZE černá hoodie se zeleným neon potiskem Mrdke Gang (to je JEDINÁ mikina co existuje!)
  Čepice: snapback černá s bílým/green neon/purple neon logem, šedá s černým logem
  Doplňky: MRDKE CARD (ocelová škrabka), zlatý řetízek, zlaté hodinky
- NEVER invent products that don't exist! No random colored hoodies, no other brands.
- Memes: classic meme format, raw and authentic, no brand styling`,
    },

    // ─── Week Plan ──────────────────────────────────────────

    weekPlan: [
        // Pondělí — humor + hype
        "meme",
        "product_drop",
        // Úterý — style + community
        "outfit_inspo",
        "behind_scenes",
        // Středa — humor + hype
        "meme",
        "limitka",
        // Čtvrtek — style + community
        "customer_content",
        "anketa",
        // Pátek — hype + humor (drop day!)
        "product_drop",
        "meme",
        // Sobota — community + style
        "behind_scenes",
        "outfit_inspo",
        // Neděle — humor + community
        "meme",
        "customer_content",
    ],

    // ─── Hashtag Pools ──────────────────────────────────────

    hashtagPools: {
        core: ["#hanzfans", "#mrdkegang", "#mrdke"],
        niche: [
            "#czechstreetwear",
            "#ceskymerch",
            "#zerofucksgiven",
            "#streetwearchech",
            "#czmoda",
            "#ceskaznacka",
        ],
        broad: [
            "#streetwear",
            "#merch",
            "#ootd",
            "#drip",
            "#fitcheck",
            "#fashion",
        ],
        trending: [
            "#newdrop",
            "#limitededition",
            "#cop",
            "#hypebeast",
        ],
        czech: [
            "#ceskyinstagram",
            "#madeinczech",
            "#ceskydesign",
        ],
    },

    // ─── Products ───────────────────────────────────────────

    products: [
        // ─── Trika ─────────────────────────────────────────
        { name: "Triko Mrdke Gang white black", type: "triko", slug: "triko-mrdke-gang-white-black", variants: 1, price: "449 Kč", description: "Bílé unisex triko s černým potiskem Mrdke Gang." },
        { name: "Triko Mrdke Gang white gold", type: "triko", slug: "triko-mrdke-gang-white-gold", variants: 1, price: "449 Kč", description: "Bílé unisex triko se zlatým potiskem Mrdke Gang." },
        { name: "Triko Mrdke Gang black white", type: "triko", slug: "triko-mrdke-gang-black-white", variants: 1, price: "449 Kč", description: "Černé unisex triko s bílým potiskem Mrdke Gang." },
        { name: "Triko Mrdke Gang black green neon", type: "triko", slug: "triko-mrdke-gang-black-green-neon", variants: 1, price: "449 Kč", description: "Černé unisex triko se zeleným neon potiskem Mrdke Gang." },
        { name: "Triko Mrdke Gang black purple neon", type: "triko", slug: "triko-mrdke-gang-black-purple-neon", variants: 1, price: "449 Kč", description: "Černé unisex triko s fialovým neon potiskem Mrdke Gang." },
        { name: "Triko Zero Fucks Given white purple neon", type: "triko", slug: "triko-zero-fucks-given-white-purple-neon", variants: 1, price: "499 Kč", description: "Bílé statement tričko 'Zero Fucks Given' v purple neon." },
        { name: "Triko Zero Fucks Given black purple neon", type: "triko", slug: "triko-zero-fucks-given-black-purple-neon", variants: 1, price: "499 Kč", description: "Černé statement tričko 'Zero Fucks Given' v purple neon." },
        { name: "Triko Donuts white", type: "triko", slug: "triko-donuts-white", variants: 1, price: "499 Kč", description: "Fun design s donuty na bílém tričku." },
        { name: "Triko Let It Snow black", type: "triko", slug: "triko-let-it-snow-black", variants: 1, price: "499 Kč", description: "Zimní kolekce tričko 'Let It Snow' v černé." },
        { name: "Triko Let It Snow red", type: "triko", slug: "triko-let-it-snow-red", variants: 1, price: "499 Kč", description: "Zimní kolekce tričko 'Let It Snow' v červené." },
        // ─── Mikiny ────────────────────────────────────────
        { name: "Mikina s kapucí Mrdke Gang black green neon", type: "mikina", slug: "mikina-s-kapuci-mrdke-gang-black-green-neon", variants: 1, price: "899 Kč", description: "Hoodie Mrdke Gang v černé se zeleným neon potiskem." },
        // ─── Doplňky ───────────────────────────────────────
        { name: "MRDKE CARD", type: "doplněk", slug: "mrdke-card-celorocni-skrabka", variants: 1, price: "299 Kč", description: "Ocelová celoroční škrabka do peněženky. Praktický dárek s brandem." },
        { name: "Snapback Mrdke Gang black white", type: "čepice", slug: "snapback-mrdke-gang-black", variants: 1, price: "599 Kč", description: "Kšiltovka Mrdke Gang černá s bílým logem." },
        { name: "Snapback Mrdke Gang black purpur neon", type: "čepice", slug: "snapback-mrdke-gang-black-purpur-neon", variants: 1, price: "599 Kč", description: "Kšiltovka Mrdke Gang černá s fialovým neon logem." },
        { name: "Snapback Mrdke Gang grey black", type: "čepice", slug: "snapback-mrdke-gang-grey-black", variants: 1, price: "599 Kč", description: "Kšiltovka Mrdke Gang šedá s černým logem." },
        { name: "Snapback Mrdke Gang black green neon", type: "čepice", slug: "snapback-mrdke-gang-black-green-neon", variants: 1, price: "599 Kč", description: "Kšiltovka Mrdke Gang černá se zeleným neon logem." },
        // ─── Combo ─────────────────────────────────────────
        { name: "Vánoční Večírek Starter Pack", type: "combo", slug: "vanocni-vecirek-starter-pack-tricko-mrdke-card", variants: 1, price: "649 Kč", description: "Tričko Let It Snow + MRDKE Card combo za zvýhodněnou cenu." },
    ],

    postTypes: ["meme", "product_drop", "behind_scenes", "customer_content", "outfit_inspo", "anketa", "limitka"],

    // ─── Content Focus ──────────────────────────────────────

    contentFocus: "O MERCHI, streetwearu, lifestyle a produktech MRDKE GANG®. Tipy = styling, produkt showcase, community humor.",

    // ─── Logo ───────────────────────────────────────────────

    logoFile: "logo-hanzfans.png",

    // ─── Overlay Gradient (text-overlay.ts colors) ──────────

    overlayGradient: {
        topColor: "#0a0a0a",
        midColor: "#1a0a2e",
        bottomColor: "#0a0a0a",
    },

    // ─── Image Instructions (per post type for mega prompt) ─

    imageInstructions: {
        _default: "Pozadí: streetwear lifestyle fotka, urban prostředí.\nText dole: headline.",
        meme: "MEME — VÝJIMKA: Žádný gradient overlay. Klasický meme format, Twitter screenshot, dark humor. Raw, authentic aesthetic.",
        product_drop: "PRODUCT DROP: Pozadí: produkt na tmavém pozadí, neon světla, close-up detail merche.\nText dole: název produktu + cena.",
        outfit_inspo: "OUTFIT INSPO: Pozadí: full body outfit shot, urban prostředí, graffiti, beton.\nText dole: styling tip.",
        limitka: "LIMITKA: Pozadí: dramatický shot produktu, countdown vibe, urgentní.\nText dole: 'Limitovaná edice' + počet kusů.",
        customer_content: "UGC: Pozadí: zákaznická fotka s merch, authentic feel.\nText dole: zákaznický quote.",
        anketa: "ANKETA: Pozadí: dva produkty vedle sebe, split screen.\nText dole: 'Co je lepší?'",
        behind_scenes: "BTS: Pozadí: Hanz, auto, studio, příprava dropu.\nText dole: behind the scenes context.",
    },

    // ─── Video Focus ────────────────────────────────────────

    videoFocus: "Streetwear lifestyle content (outfit reveals, product unboxing, car meets, Hanz lifestyle)",

    // ─── Post Formats (per post type) ───────────────────────

    defaultFormat: { aspectRatio: "3:4", medium: "image", overlayStyle: "default" },

    postFormats: {
        // Product content — uses REAL product photos from eshop
        product_drop: { aspectRatio: "3:4", medium: "image", overlayStyle: "default" },
        limitka: { aspectRatio: "3:4", medium: "image", overlayStyle: "cover" },
        outfit_inspo: { aspectRatio: "3:4", medium: "image", overlayStyle: "minimal" },

        // Community & engagement — square
        meme: { aspectRatio: "1:1", medium: "image", overlayStyle: "none" },
        anketa: { aspectRatio: "1:1", medium: "image", overlayStyle: "default" },

        // Authentic content — 3:4 with minimal branding
        customer_content: { aspectRatio: "3:4", medium: "image", overlayStyle: "minimal" },
        behind_scenes: { aspectRatio: "3:4", medium: "image", overlayStyle: "minimal" },
    },

    // ─── Character (brand face) ─────────────────────────────

    characterDescription: `
Hanz Mrdke — the face and founder of HanzFans / MRDKE GANG.

PHYSICAL BUILD:
- Completely bald (shaved head), VERY muscular/jacked bodybuilder build
- Heavily tattooed — full sleeve tattoos on both arms and large chest pieces
  including skulls and script lettering
- Tanned weathered skin, mid-40s, strong jawline
- Confident/tough alpha expression, never smiling softly

SIGNATURE ACCESSORIES (ALWAYS include these):
- Louis Vuitton sunglasses — HIS TRADEMARK (visible in brand logo too!)
  Large rectangular frames with LV monogram pattern on lenses/arms
- Heavy gold chain necklace (Cuban link style, thick)
- Luxury watch: Audemars Piguet Royal Oak or Patek Philippe Nautilus (steel with dark dial)
- Gold bracelet on other wrist

CLOTHING — ONLY from MRDKE GANG product line:
- Black tees with white/green neon/purple neon "Mrdke Gang" logo print
- White tees with black/gold "Mrdke Gang" logo print
- "Zero Fucks Given" tees (black or white with purple neon text)
- ONE hoodie exists: black with green neon Mrdke Gang print
- Snapback caps: black with white/green/purple neon logo, or grey with black logo
- MRDKE CARD steel scraper in wallet/hand
- Black jeans or black fight shorts

CARS (for backgrounds, lifestyle shots):
- BMW M2 G87 Competition (Zandvoort Blue)
- Mercedes-AMG GT R (Green Hell Magno — matte green)
- Mercedes G-Class 4x4² (Neon Yellow)
- Night drive scenes, parking garages, urban streets

VIBE: Czech fighter/hustler turned streetwear entrepreneur.
Gym lifestyle, night drives, alpha energy, zero fucks given.
ALWAYS looks expensive — luxury watches, LV glasses, gold jewelry.
`,

    // Reference photo URLs for Gemini 3 Pro Image — face/likeness consistency
    // Fetched at runtime — works on Vercel without local files
    characterReferenceImages: [
        "https://hanzfans.s10.cdn-upgates.com/_cache/8/d/8d3322e726d3916cfe62012c15f1cb03-uvodni-foto.jpg",
        "https://cdn.prod.website-files.com/67633618bbc7bec08754d910/6819a99bb179b05428fd4d2f_DSC_1658.jpg",
    ],
}
