/**
 * Popadinec.cz — Client Configuration
 * =====================================
 * Brand: Popadinec.cz — rybářský eshop + kamenná prodejna
 * Web: popadinec.cz (Shoptet)
 * IG: @popadinec.cz
 * Vibe: Autentický rybářský obchůdek, kamarádský, odborný, komunita u vody
 */

import type { ClientConfig } from "./types"

export const config: ClientConfig = {
    id: "popadinec",
    name: "Popadinec.cz",
    website: "https://www.popadinec.cz",
    instagram: "@popadinec.cz",

    // ─── Brand Voice ────────────────────────────────────────

    brandVoice: {
        persona: `
Jsi voice rybářského eshopu Popadinec.cz — obchůdek pro rybáře s duší.
Za značkou stojí Richard Popadinec — vášnivý rybář, co ví, co prodává.
Máme kamennou prodejnu i eshop. Jsme specialisté na kaprařinu, feeder, lov sumců a dravců.
Styl komunikace: jako zkušenej kámoš-rybář co ti poradí u vody.
Odborný, ale ne nudný. Přátelský, ale ne laciný.
Rybáři jsou naše rodina — známe naše zákazníky osobně.
Cíl: Přivést rybáře na popadinec.cz, poradit s výběrem, prodat kvalitní vybavení.
        `.trim(),

        values: [
            "Autentická vášeň pro rybaření — nejsme jen eshop, jsme rybáři",
            "Odbornost a zkušenosti — dlouholeté know-how, poradíme s čímkoliv",
            "Komunita u vody — zákazníci jsou rodina, ne čísla",
            "Kvalita nad kvantitou — prodáváme jen to, za čím si stojíme",
            "Férovost — čestné ceny, rychlé dodání, osobní přístup",
        ],

        voiceTraits: [
            "Tykáme — jsme parta rybářů, ne korporát",
            "Hovorová čeština s rybářským slangem (záběr, nahodit, vytáhnout, kousek, šupoun)",
            "Odborný ale srozumitelný — víme o čem mluvíme, ale neblbnem z toho",
            "Nadšení pro rybaření — upřímná radost z úlovků a nového vybavení",
            "Krátké, úderné věty — jako u vody, ne esej",
            "Emoji střídmě — 🐟🎣 max 3 na post",
            "Sezónní relevance — jinak na jaře, jinak v zimě",
            "Osobní příběhy — vlastní zkušenosti s vybavením",
            "Čeština bez anglicismů — česky, rybářsky, autenticky",
        ],

        antiPatterns: [
            "❌ Korporátní jazyk: 'Optimalizujte svůj rybářský výkon'",
            "❌ Přehnaný hype: 'MEGA SUPER AKCE!!!!'",
            "❌ Vykání — nikdy",
            "❌ Generické stockové texty bez odbornosti",
            "❌ Anglicismy a marketingový bullshit",
            "❌ Negativita vůči konkurenci",
            "❌ Spam emojí — max 3",
            "❌ Obsah nesouvisející s rybaření",
        ],

        hookTemplates: [
            // KNOW-HOW / TIPY
            {
                pattern: "{{číslo}} věcí, co ti {{zlepší_rybaření}}",
                example: "3 věci, co ti zlepší záběry na feederu",
                bestFor: ["tip", "recenze"],
                trigger: "curiosity",
            },
            {
                pattern: "Tahle chyba stojí rybáře {{důsledek}}",
                example: "Tahle chyba stojí rybáře polovinu záběrů",
                bestFor: ["tip", "navod"],
                trigger: "fear",
            },
            {
                pattern: "Věděl jsi, že {{rybářský_fakt}}?",
                example: "Věděl jsi, že kapři cítí návnadu na 50 metrů?",
                bestFor: ["tip", "fakt"],
                trigger: "curiosity",
            },

            // PRODUKT
            {
                pattern: "Testovali jsme {{produkt}} — {{výsledek}}",
                example: "Testovali jsme Daiwa Ninja X — tady je verdikt 🎣",
                bestFor: ["recenze", "produkt"],
                trigger: "curiosity",
            },
            {
                pattern: "Novinka v obchůdku: {{produkt}} 🐟",
                example: "Novinka v obchůdku: signalizátory ZFISH Alarm AL2 🐟",
                bestFor: ["produkt", "novinka"],
                trigger: "curiosity",
            },

            // ENGAGEMENT
            {
                pattern: "Jaký je tvůj nejlepší {{rybářský_zážitek}}?",
                example: "Jaký je tvůj nejlepší úlovek sezóny? 🎣",
                bestFor: ["anketa", "komunita"],
                trigger: "empathy",
            },
            {
                pattern: "Tohle znáš — {{relatable_rybářský_moment}}",
                example: "Tohle znáš — alarm pípá, ty běžíš, a on... nic 😅",
                bestFor: ["meme", "komunita"],
                trigger: "humor",
            },

            // URGENCY
            {
                pattern: "Poslední kusy: {{produkt}} za {{cena}} 🔥",
                example: "Poslední kusy: Sportex Carat 12ft za 3 490 Kč 🔥",
                bestFor: ["akce", "produkt"],
                trigger: "urgency",
            },

            // SEZÓNA
            {
                pattern: "{{sezóna}} klepe na dveře — jsi připravenej?",
                example: "Kaprová sezóna klepe na dveře — jsi připravenej? 🎣",
                bestFor: ["sezona", "tip"],
                trigger: "hope",
            },
        ],

        ctaVariations: [
            // Push to eshop
            "Celej sortiment na popadinec.cz 🐟",
            "Koukni na popadinec.cz — poradíme ti",
            "Link v biu → popadinec.cz 🎣",
            "Objednávky na popadinec.cz — doručujeme po celé ČR",
            "Stav se v prodejně nebo objednej online 📦",

            // Engagement
            "Piš do komentáře svůj tip 👇",
            "Tagni rybáře, co tohle potřebuje 🎣",
            "Sdílej to kamarádovi, co taky rybaří",

            // Poradenství
            "Nejsi si jistej výběrem? Napiš nám — poradíme 🐟",
            "Zavolej nebo napiš — osobní poradenství zdarma",
        ],

        toneByPostType: {
            tip: { humorLevel: 2, urgencyLevel: 1, intimacyLevel: 4, educationalLevel: 5 },
            recenze: { humorLevel: 2, urgencyLevel: 2, intimacyLevel: 3, educationalLevel: 5 },
            produkt: { humorLevel: 1, urgencyLevel: 3, intimacyLevel: 3, educationalLevel: 3 },
            ulovek: { humorLevel: 3, urgencyLevel: 1, intimacyLevel: 5, educationalLevel: 2 },
            navod: { humorLevel: 1, urgencyLevel: 1, intimacyLevel: 3, educationalLevel: 5 },
            akce: { humorLevel: 1, urgencyLevel: 5, intimacyLevel: 3, educationalLevel: 2 },
            sezona: { humorLevel: 2, urgencyLevel: 3, intimacyLevel: 4, educationalLevel: 4 },
            komunita: { humorLevel: 3, urgencyLevel: 1, intimacyLevel: 5, educationalLevel: 1 },
            meme: { humorLevel: 5, urgencyLevel: 1, intimacyLevel: 4, educationalLevel: 1 },
        },
    },

    // ─── Content Pillars ────────────────────────────────────

    contentPillars: {
        vybaveni: {
            emoji: "🎣",
            label: "VYBAVENÍ",
            description: "Produkty, recenze, novinky, akce, srovnání",
            postTypes: ["produkt", "recenze", "akce"],
            ratio: 0.35,
            ctaStrategy: "hard",
            kpi: ["link_clicks", "profile_visits"],
            ideaPrompt: `## VYBAVENÍ PILÍŘ — Produkty, recenze, akce
Generuj nápady na posty co představují rybářské vybavení a ženou prodej.
Formáty: recenze produktu, novinka v nabídce, srovnání, akční nabídka, "top 3 pruty na kapry".
Klíč: odbornost, upřímné hodnocení, "testovali jsme to sami".

Příklady angle:
- "Test: Daiwa Ninja X vs ZFISH Kingstone — kdo vyhrál?" → srovnání
- "Nový prut Sportex Carat v nabídce — proč ho chceš" → novinka
- "Akce: Sada signalizátorů 3+1 za 15 990 Kč místo 19 280 Kč" → sleva`,
        },
        knowhow: {
            emoji: "📖",
            label: "KNOW-HOW",
            description: "Tipy, návody, rybářské triky, jak na to",
            postTypes: ["tip", "navod"],
            ratio: 0.30,
            ctaStrategy: "soft",
            kpi: ["saves", "shares", "reach"],
            ideaPrompt: `## KNOW-HOW PILÍŘ — Vzdělávání a tipy
Generuj nápady na edukativní obsah co rybáři uloží a sdílí.
Formáty: tip dne, carousel návod, častá chyba a jak ji opravit, sezónní rady.
Klíč: praktické rady co zlepší rybaření, "tenhle trik jsem se naučil po 10 letech".

Příklady angle:
- "5 chyb při feederu, co tě stojí ryby" → carousel vzdělávání
- "Jak správně nastavit clutch na navijáku" → návod
- "3 nástrahy na kapra, co fungují v únoru" → sezónní tipy`,
        },
        sezona: {
            emoji: "🌊",
            label: "SEZÓNA",
            description: "Sezónní obsah, počasí, kdy a kde lovit",
            postTypes: ["sezona"],
            ratio: 0.15,
            ctaStrategy: "medium",
            kpi: ["reach", "saves"],
            ideaPrompt: `## SEZÓNA PILÍŘ — Sezónní obsah a aktuálnost
Generuj nápady na sezónně relevantní obsah.
Formáty: sezónní příprava, monthly preview, co lovit teď, podmínky u vody.
Klíč: co zrovna frčí u vody, aktuální sezóna, příprava na další.

Příklady angle:
- "Únor u vody — kde hledat kapry v zimě?" → sezónní tip
- "Jarní příprava: checklist co zkontrolovat než vyrazíš" → příprava
- "Letní noční rybaření — kompletní průvodce" → sezónní návod`,
        },
        komunita: {
            emoji: "🤝",
            label: "KOMUNITA",
            description: "Úlovky zákazníků, příběhy, memes, engagement",
            postTypes: ["ulovek", "komunita", "meme"],
            ratio: 0.20,
            ctaStrategy: "none",
            kpi: ["comments", "shares"],
            ideaPrompt: `## KOMUNITA PILÍŘ — Rybářská rodina
Generuj nápady na obsah co buduje komunitu a engagement.
Formáty: zákaznické úlovky, rybářské memes, ankety, "váš nejlepší moment", behind the scenes.
Klíč: autenticita, lidskost, "jsme rybáři jako vy".

Příklady angle:
- "Zákazník Tomáš vytáhl 18kg kapra na prut od nás 💪" → UGC
- "Rybářský POV: kdy pípne alarm po 3 hodinách čekání" → meme
- "Anketa: feeder nebo klasika? Piš do komentáře" → engagement`,
        },
    },

    // ─── CTA Strategies ─────────────────────────────────────

    ctaStrategies: {
        soft: [
            "Piš svůj tip do komentáře 👇",
            "Tagni kamaráda rybáře 🎣",
            "Koukni na profil pro víc tipů",
            "Ulož si to na příště 📌",
        ],
        medium: [
            "Víc rybářskýho vybavení na popadinec.cz 🐟",
            "Celej sortiment na popadinec.cz",
            "Followni pro denní rybářský tipy 🎣",
            "Poradenství zdarma — napiš nám",
        ],
        hard: [
            "Objednej na popadinec.cz — rychlé doručení 📦",
            "Link v biu → popadinec.cz 🐟",
            "Poslední kusy — popadinec.cz",
            "Akce platí jen do {{datum}} → popadinec.cz",
        ],
        none: [
            "Co na to říkáš? 👇",
            "Petri heil! 🐟",
            "Piš svůj zážitek do komentáře",
        ],
    },

    // ─── Feed Aesthetic ─────────────────────────────────────

    feedAesthetic: {
        colorPalette: "Forest green (#2d5a27) base, dark blue (#1a3a5c) accents, warm amber (#d4a84b) highlights, white text",
        overlayOpacity: "45-55%",
        textPosition: "BOTTOM",
        font: "Inter — clean, readable, modern but not corporate",
        feel: "Příroda, u vody, autentické rybaření. Profesionální ale zemité — les, jezera, řeky, ranní mlha nad vodou. NOT corporate/sterile.",
        phoneModel: "none",
        fontOverride: "Inter",
        customInstructions: `
- Nature-first aesthetic — water, lakes, rivers, reeds, morning mist, sunset at the lake
- Color mood: greens, blues, earth tones, golden hour lighting
- Product shots: in natural context (rod by the water, reel on the bank, bait on the hook)
- Lifestyle: real fishing moments — casting, waiting, fighting a fish, trophy photo
- Avoid: studio/sterile product photos, stock imagery, urban settings
- Textures: water surface, grass, wood, gravel paths
- Fishing gear should look USED and AUTHENTIC — not pristine showroom
- IMPORTANT: Do NOT generate any text in the image! Text will be added programmatically.
- For product posts: show the product in fishing context, not on a white background
- Weather variety: misty mornings, sunny afternoons, rainy fishing, golden sunset
- Seasons matter: spring bloom, summer green, autumn colors, winter frost at the lake`,
    },

    // ─── Week Plan ──────────────────────────────────────────

    weekPlan: [
        // Pondělí — know-how + produkt
        "tip",
        "produkt",
        // Úterý — sezóna + komunita
        "sezona",
        "ulovek",
        // Středa — know-how + produkt
        "navod",
        "recenze",
        // Čtvrtek — komunita + meme
        "komunita",
        "meme",
        // Pátek — produkt + akce
        "produkt",
        "akce",
        // Sobota — tip + úlovek
        "tip",
        "ulovek",
        // Neděle — komunita + sezóna
        "komunita",
        "sezona",
    ],

    // ─── Hashtag Pools ──────────────────────────────────────

    hashtagPools: {
        core: ["#popadinec", "#popadineccz", "#rybarskypotrebycz"],
        niche: [
            "#ceskyrybar",
            "#kaprarina",
            "#feederrybaření",
            "#carpfishing",
            "#sumcarina",
            "#dravci",
            "#rybarenicz",
        ],
        broad: [
            "#rybareni",
            "#fishing",
            "#ryby",
            "#kapri",
            "#ulovek",
            "#príroda",
            "#uvody",
        ],
        trending: [
            "#fishinglife",
            "#carplife",
            "#bigfish",
            "#catchandrelease",
            "#tightlines",
        ],
        czech: [
            "#ceskyinstagram",
            "#ceskyrybar",
            "#madeincz",
            "#rybarenicesko",
        ],
    },

    // ─── Products (top sellers & key items) ─────────────────

    products: [
        // ─── Pruty ────────────────────────────────────────
        { name: "ZFISH COMBO 2x Prut Kingstone 3,60m/3lb + pouzdro", type: "prut", slug: "zfish-combo-2x-prut-kingstone-3-60m-3-5lb-pouzdro-zdarma-2", variants: 1, price: "1 990 Kč", description: "Sada dvou kaprových prutů s pouzdrem — ideální pro začínajícího kapraře." },
        { name: "Daiwa Ninja X Carp 12ft 3lb", type: "prut", slug: "daiwa-ninja-x-carp-12ft-3lb", variants: 1, price: "2 190 Kč", description: "Spolehlivý kaprový prut střední třídy od Daiwa." },
        { name: "NGT Carp Stalker 8ft", type: "prut", slug: "ngt-carp-stalker-8ft", variants: 1, price: "990 Kč", description: "Kompaktní stalking prut na menší vody." },
        { name: "Korum Omega Multi Feeder 12ft", type: "prut", slug: "korum-omega-multi-feeder-12ft", variants: 1, price: "4 490 Kč", description: "Prémiový feeder prut se 3 výměnnými špičkami." },
        // ─── Signalizátory & elektronika ──────────────────
        { name: "Sada 3+1 Alarm AL2 + Mikroalarm Sens + LED FL6+", type: "elektronika", slug: "sada-3-1-alarm-al2-mikroalarm-sens-led-svetlo-fl6", variants: 1, price: "16 345 Kč", description: "Kompletní sada signalizátorů záběru s LED světlem — spárováno." },
        // ─── Vlasce & šňůry ───────────────────────────────
        { name: "Vlasec Quantum Quattron Salsa", type: "vlasec", slug: "vlasec-quantum-quattron-salsa-0-69kc--1mt", variants: 1, price: "od 0,69 Kč/m", description: "Kvalitní kaprový vlasec v oranžové barvě." },
        // ─── Camping ──────────────────────────────────────
        { name: "Any Chair XS Two Rod Arm & Rests", type: "stojan", slug: "any-chair-xs-two-rod-arm-rests", variants: 1, price: "1 290 Kč", description: "Kompaktní stojan na pruty k židličce." },
        // ─── Obuv ─────────────────────────────────────────
        { name: "Demar Pánské kotníkové holínky AGRO LUX", type: "obuv", slug: "demar-panske-kotnikove-holinky-agro-lux-3922-zelena", variants: 1, price: "890 Kč", description: "Zelené kotníkové holínky — pohodlné a odolné." },
    ],

    postTypes: ["tip", "recenze", "produkt", "ulovek", "navod", "akce", "sezona", "komunita", "meme"],

    // ─── Content Focus ──────────────────────────────────────

    contentFocus: "O RYBAŘENÍ, rybářském vybavení, technikách lovu a rybářské komunitě. Tipy = jak lépe rybařit, recenze produktů, sezónní rady, úlovky zákazníků.",

    // ─── Logo ───────────────────────────────────────────────

    logoFile: "logo-popadinec.png",

    // ─── Overlay Gradient ────────────────────────────────────

    overlayGradient: {
        topColor: "#1a3a1a",
        midColor: "#1a3a5c",
        bottomColor: "#0a1a0a",
    },

    // ─── Image Instructions (per post type for mega prompt) ─

    imageInstructions: {
        _default: "Pozadí: příroda u vody, jezero, řeka, ranní mlha.\nText dole: headline.",
        tip: "TIP: Pozadí: lifestyle rybářská fotka — detail techniky, ruce s prutem, návnada na háčku.\nText dole: tipový headline.",
        recenze: "RECENZE: Pozadí: close-up produktu v přírodním kontextu — prut u vody, naviják na stojanu.\nText dole: název produktu + hodnocení.",
        produkt: "PRODUKT: Pozadí: produkt v rybářském prostředí, detail materiálu, profi prezentace u vody.\nText dole: název produktu + cena.",
        ulovek: "ÚLOVEK: Pozadí: rybář drží rybu, trophy shot, radostný moment.\nText dole: druh ryby + váha.",
        navod: "NÁVOD: Pozadí: step-by-step záběr techniky, rukavice, detail montáže.\nText dole: název návodu.",
        akce: "AKCE: Pozadí: produkt/sada s výrazným cenovým přeškrtnutím.\nText dole: 'AKCE' + cena.",
        sezona: "SEZÓNA: Pozadí: krajina u vody reflektující aktuální roční období.\nText dole: sezónní headline.",
        komunita: "KOMUNITA: Pozadí: skupinka rybářů, reálné fotky od zákazníků.\nText dole: příběh nebo citát.",
        meme: "MEME — VÝJIMKA: Žádný gradient overlay. Klasický meme formát, rybářský humor. Autentické, vtipné.",
    },

    // ─── Video Focus ────────────────────────────────────────

    videoFocus: "Rybářský lifestyle content (výpravy k vodě, unboxing nového vybavení, návody na techniky, záběry z lovu, produktové recenze v terénu)",

    // ─── Post Formats (per post type) ───────────────────────

    defaultFormat: { aspectRatio: "3:4", medium: "image", overlayStyle: "default" },

    postFormats: {
        // Edukativní — carousel
        tip: { aspectRatio: "3:4", medium: "image", overlayStyle: "default" },
        navod: { aspectRatio: "3:4", medium: "carousel", overlayStyle: "step" },
        recenze: { aspectRatio: "3:4", medium: "image", overlayStyle: "default" },

        // Produkt & akce
        produkt: { aspectRatio: "3:4", medium: "image", overlayStyle: "default" },
        akce: { aspectRatio: "3:4", medium: "image", overlayStyle: "cover" },

        // Komunita
        ulovek: { aspectRatio: "3:4", medium: "image", overlayStyle: "minimal" },
        komunita: { aspectRatio: "3:4", medium: "image", overlayStyle: "minimal" },
        sezona: { aspectRatio: "3:4", medium: "image", overlayStyle: "default" },

        // Meme — square, no overlay
        meme: { aspectRatio: "1:1", medium: "image", overlayStyle: "none" },
    },
}
