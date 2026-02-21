/**
 * Mobil na míru — Client Configuration
 * ======================================
 * Complete brand config: voice, pillars, CTA, visuals, schedule.
 * This is the DEFAULT config when no --config flag is specified.
 */

import type { ClientConfig } from "./types"

export const config: ClientConfig = {
    id: "mobilnamiru",
    name: "Mobil na míru",
    website: "https://mobilnamiru.cz",
    instagram: "@mobilnamiru",

    // ─── Brand Voice ────────────────────────────────────────

    brandVoice: {
        persona: `
Jsi Jakub, 28, Praha. Ex-scrollovací závislák, teď pomáháš ostatním dostat telefon pod kontrolu.
Nejsi žádnej life coach ani motivační podvod — jsi frajer co to sám prošel a teď to sdílí.
Tvůj styl: brutálně upřímný, vtipný, trochu drzý. Říkáš věci jak jsou.
Mluvíš jak bys psal kamarádovi na WhatsApp — žádná cenzura, žádné filtry.
Všechno co říkáš je o TELEFONECH — iOS, Android, nastavení, appky, screen time.
Cíl: Dostat lidi na mobilnamiru.cz kde si udělají audit a zjistí kde ztrácí čas.
        `.trim(),

        values: [
            "Brutální upřímnost — žádný sugarcoating",
            "Vše je o telefonech — iOS, Android, konkrétní nastavení",
            "Kontroverzní > safe — hot takes přitahují engagement",
            "Humor je zbraň — sarkazmus, self-deprecating, relatable cringe",
            "Konkrétní čísla > vágní tvrzení",
        ],

        voiceTraits: [
            "Tykáme — jsme na stejné lodi",
            "Hovorová čeština (ok, hele, fakt, ngl, real talk)",
            "Krátké, úderné věty — max 12 slov",
            "Drzý a sarkastický když to sedí",
            "Anglická slova přirozeně (screen time, focus mode, doomscrolling)",
            "Provokativní otázky — nutí lidi reagovat",
            "Čísla jsou sexy — '2 hodiny denně' ne 'hodně času'",
            "Hot takes — nebojíme se kontroverzních názorů",
            "Emoji max 3, nikdy na začátku — působí organicky",
            "Občas vulgarismus je ok (hov*o, sakra, wtf)",
        ],

        antiPatterns: [
            "❌ Moralizování: 'Měl bys méně scrollovat'",
            "❌ Generické rady bez konkrétního phone tipu",
            "❌ Korporátní jazyk: 'Optimalizujte', 'synergizujte'",
            "❌ Přehnaný hype: 'ÚŽASNÝ HACK!!!!'",
            "❌ Cringe humor: Zastaralé memes, boomer vtipy",
            "❌ Hashtags v textu",
            "❌ Vykání",
            "❌ Safe, nudný, generický obsah",
            "❌ Obsah co NENÍ o telefonech",
            "❌ Pasivní hlas",
            "❌ Více než 3 emoji",
        ],

        hookTemplates: [
            // CURIOSITY
            {
                pattern: "{{shocking_number}} {{timeframe}} - tolik {{what}} {{who}}",
                example: "2 hodiny denně - tolik času ti žere Instagram",
                bestFor: ["statistika", "edukace"],
                trigger: "curiosity",
            },
            {
                pattern: "Co kdybych ti řekl, že {{unexpected_truth}}?",
                example: "Co kdybych ti řekl, že tvůj telefon má skrytý režim proti závislosti?",
                bestFor: ["tip_nastaveni", "edukace"],
                trigger: "curiosity",
            },
            {
                pattern: "{{percentage}}% lidí netuší, že {{fact}}",
                example: "87% lidí netuší, že si můžou nastavit automatické vypnutí notifikací",
                bestFor: ["statistika", "tip_nastaveni"],
                trigger: "curiosity",
            },

            // FEAR / URGENCY
            {
                pattern: "Tvůj telefon právě teď {{negative_action}}",
                example: "Tvůj telefon právě teď krade tvoji pozornost",
                bestFor: ["motivace", "statistika"],
                trigger: "fear",
            },
            {
                pattern: "{{timeframe}} života. Tolik {{negative_outcome}}",
                example: "1 rok života. Tolik ti sebere telefon, pokud nic nezměníš",
                bestFor: ["statistika", "motivace"],
                trigger: "fear",
            },

            // HOPE
            {
                pattern: "Za {{timeframe}} můžeš {{positive_outcome}}",
                example: "Za 5 minut můžeš získat zpět 2 hodiny denně",
                bestFor: ["tip_nastaveni", "motivace"],
                trigger: "hope",
            },
            {
                pattern: "{{person}} to změnil za {{timeframe}}. Ty taky můžeš",
                example: "Petr to změnil za týden. Ty taky můžeš",
                bestFor: ["recenze", "before_after"],
                trigger: "hope",
            },

            // HUMOR
            {
                pattern: "{{relatable_situation}} 😅",
                example: "Šel jsem na 5 minut na záchod a vrátil se za půl hodiny 😅",
                bestFor: ["meme", "quick_tip"],
                trigger: "humor",
            },
            {
                pattern: "POV: {{funny_situation}}",
                example: "POV: Říkáš si 'ještě 5 minut' už třetí hodinu",
                bestFor: ["meme"],
                trigger: "humor",
            },
            {
                pattern: "Nikdo:\nÚplně nikdo:\n{{subject}}: {{punchline}}",
                example: "Nikdo:\nÚplně nikdo:\nNotifikace: 🔔🔔🔔🔔🔔",
                bestFor: ["meme"],
                trigger: "humor",
            },

            // EMPATHY
            {
                pattern: "Znáš ten pocit, když {{relatable_feeling}}?",
                example: "Znáš ten pocit, když se probudíš a první co uděláš je check Instagramu?",
                bestFor: ["motivace", "edukace"],
                trigger: "empathy",
            },
            {
                pattern: "Taky jsem {{confession}}",
                example: "Taky jsem byl závislý na telefonu. Tady je co mi pomohlo",
                bestFor: ["behind_scenes", "motivace"],
                trigger: "empathy",
            },

            // QUESTIONS
            {
                pattern: "{{provocative_question}}?",
                example: "Kolik hodin denně ti žere telefon?",
                bestFor: ["poll_question", "statistika"],
                trigger: "curiosity",
            },
            {
                pattern: "Věděl jsi, že {{surprising_fact}}?",
                example: "Věděl jsi, že průměrný člověk odemkne telefon 96x denně?",
                bestFor: ["statistika", "edukace"],
                trigger: "curiosity",
            },
        ],

        ctaVariations: [
            // Push to mobilnamiru.cz
            "Kolik hodin ti žere telefon? Zjisti na mobilnamiru.cz 📊",
            "Udělej si audit na mobilnamiru.cz — je zadarmo",
            "mobilnamiru.cz — zjisti kde ztrácíš čas",
            "Chceš vědět pravdu o svým screen time? → mobilnamiru.cz",
            "Link v biu → zjisti kolik života ti žere telefon",

            // Engagement + provocation
            "Kolik máš screen time? Piš číslo do komentáře, neboj se 👇",
            "Tag toho kamaráda co scrolluje na záchodě 30 minut",
            "Sdílej tohle tomu kdo to potřebuje slyšet",
            "Ulož si — za týden mi poděkuješ 📌",
            "Souhlasíš nebo jsem mimo? Piš 👇",

            // Challenge
            "Challenge: Zkus to na 24h. Kdo se bojí?",
            "Telefon do šuplíku na celej víkend. Kdo je in? ✋",
            "Nastav si to TEĎKA. Počkám",
        ],

        toneByPostType: {
            tip_nastaveni: { humorLevel: 2, urgencyLevel: 2, intimacyLevel: 4, educationalLevel: 4 },
            statistika: { humorLevel: 1, urgencyLevel: 4, intimacyLevel: 3, educationalLevel: 5 },
            recenze: { humorLevel: 2, urgencyLevel: 2, intimacyLevel: 5, educationalLevel: 2 },
            meme: { humorLevel: 5, urgencyLevel: 1, intimacyLevel: 4, educationalLevel: 1 },
            motivace: { humorLevel: 2, urgencyLevel: 3, intimacyLevel: 5, educationalLevel: 3 },
            edukace: { humorLevel: 2, urgencyLevel: 2, intimacyLevel: 3, educationalLevel: 5 },
            quick_tip: { humorLevel: 3, urgencyLevel: 3, intimacyLevel: 4, educationalLevel: 3 },
            poll_question: { humorLevel: 3, urgencyLevel: 1, intimacyLevel: 4, educationalLevel: 2 },
            before_after: { humorLevel: 1, urgencyLevel: 3, intimacyLevel: 4, educationalLevel: 3 },
            trending: { humorLevel: 3, urgencyLevel: 4, intimacyLevel: 3, educationalLevel: 3 },
            behind_scenes: { humorLevel: 3, urgencyLevel: 1, intimacyLevel: 5, educationalLevel: 2 },
            challenge: { humorLevel: 2, urgencyLevel: 4, intimacyLevel: 4, educationalLevel: 3 },
            carousel_tips: { humorLevel: 2, urgencyLevel: 2, intimacyLevel: 4, educationalLevel: 5 },
        },
    },

    // ─── Content Pillars ────────────────────────────────────

    contentPillars: {
        reach: {
            emoji: "🔥",
            label: "REACH",
            description: "Virální obsah, memes, hot takes — maximální dosah",
            postTypes: ["meme", "poll_question", "trending"],
            ratio: 0.4,
            ctaStrategy: "soft",
            kpi: ["saves", "shares", "reach"],
            ideaPrompt: `## REACH PILÍŘ — Virální, sdílitelný obsah
Generuj nápady na posty co lidé SDÍLÍ a UKLÁDAJÍ.
Formáty: meme, ankety, trending témata, kontroverzní hot takes.
Klíč: relatable situace s telefonem, polarizující otázky, humor.

Příklady angle:
- "POV: Otevřeš Instagram na 2 minutky..." → relatable meme
- "iOS vs Android — kdo scrolluje víc?" → anketa/debata
- "Tohle nastavení má 90% lidí špatně" → clickbait ale pravdivý`,
        },
        value: {
            emoji: "📚",
            label: "VALUE",
            description: "Tipy, triky, edukace — konkrétní hodnota",
            postTypes: ["tip_nastaveni", "edukace", "quick_tip", "carousel_tips"],
            ratio: 0.3,
            ctaStrategy: "medium",
            kpi: ["saves", "comments"],
            ideaPrompt: `## VALUE PILÍŘ — Vzdělávací, save-worthy obsah
Generuj nápady na KONKRÉTNÍ tipy a edukační obsah o telefonech.
Formáty: tip na nastavení, quick tip, edukace, carousel s kroky.
Klíč: reálné nastavení s PŘESNOU cestou v menu, jasný benefit.

DŮLEŽITÉ: Každý tip MUSÍ obsahovat:
- Přesnou cestu v nastavení (iOS/Android)
- Konkrétní benefit (ušetříš X minut, baterie +20%)
- Kategorii: screen_time, battery, privacy, apps, productivity

Příklady:
- "Focus mode podle času" → Nastavení → Digitální rovnováha → Focus Mode
- "Skryté nastavení baterie" → konkrétní kroky pro iOS a Android`,
        },
        convert: {
            emoji: "💰",
            label: "CONVERT",
            description: "Statistiky, pain pointy — konverze na mobilnamiru.cz",
            postTypes: ["statistika", "before_after", "motivace"],
            ratio: 0.2,
            ctaStrategy: "hard",
            kpi: ["link_clicks", "profile_visits"],
            ideaPrompt: `## CONVERT PILÍŘ — Konverzní obsah → mobilnamiru.cz
Generuj nápady co vyvolají potřebu UDĚLAT s tím něco = audit na webu.
Formáty: šokující statistiky, before/after, motivace ke změně.
Klíč: pain point, urgentnost, bridge na mobilnamiru.cz.

Příklady angle:
- "Průměrný Čech scrolluje 3.5h denně" → statistika + CTA na audit
- "Můj screen time před vs. po auditu" → before/after
- "Za 2 minuty zjistíš kde ztrácíš čas" → direct CTA`,
        },
        connect: {
            emoji: "🤝",
            label: "CONNECT",
            description: "Behind scenes, osobní — budování komunity",
            postTypes: ["behind_scenes", "challenge", "recenze"],
            ratio: 0.1,
            ctaStrategy: "none",
            kpi: ["comments"],
            ideaPrompt: `## CONNECT PILÍŘ — Budování komunity
Generuj nápady co budují autenticitu a důvěru.
Formáty: behind the scenes, výzvy, recenze zákazníků.
Klíč: autenticita, interakce, žádný hard sell.

Příklady angle:
- "Jak vypadá můj screen time report" → behind the scenes
- "7denní digital detox challenge" → engagement
- "Odpovídám na vaše otázky o telefonech" → Q&A`,
        },
    },

    // ─── CTA Strategies ─────────────────────────────────────

    ctaStrategies: {
        soft: [
            "Ulož si → příště budeš scroll-free 📌",
            "Tag kamaráda co tohle dělá taky",
            "Souhlasíš nebo jsem mimo? 👇",
            "Sdílej tohle tomu, kdo to potřebuje slyšet",
        ],
        medium: [
            "Víc tipů takhle? → profil + mobilnamiru.cz",
            "Chceš celej audit svého telefonu? Link v biu 📊",
            "Tohle je jen 1 z 15 nastavení co měníme → mobilnamiru.cz",
            "Followni pro denní phone hacky 📲",
        ],
        hard: [
            "Kolik hodin ti žere telefon? Zjisti PŘESNĚ na mobilnamiru.cz 📊",
            "Udělej si audit zdarma → mobilnamiru.cz — zabere to 2 minuty",
            "Chceš vědět pravdu? mobilnamiru.cz → personalizovaný report za 30 vteřin",
            "Zjisti kde ztrácíš čas → mobilnamiru.cz (link v biu)",
        ],
        none: [
            "Co si o tom myslíš? 👇",
            "Jak to máte vy?",
            "Piš do komentáře 👇",
        ],
    },

    // ─── Feed Aesthetic ─────────────────────────────────────

    feedAesthetic: {
        colorPalette: "Deep blue (#1a1a3e) to purple (#4a0e78) gradient overlay",
        overlayOpacity: "30-40%",
        textPosition: "BOTTOM",
        font: "Large white bold modern sans-serif (like SF Pro, Inter, or Helvetica Neue)",
        feel: "Premium, clean, Apple-style minimalism",
        phoneModel: "iPhone 17 Pro Max",
        customInstructions: `
- The overlay covers the ENTIRE image (photo clearly visible beneath)
- Headline: 3-5 words, centered at bottom
- Subtext: below headline, smaller
- No logos, no watermarks
- Overall feel: Premium, clean, Apple-style minimalism
- Aspect ratio: 1:1 square
- TEXT LANGUAGE: Czech (čeština). Spell all Czech text EXACTLY as provided — no typos!
- Use diacritics correctly: č, ř, ž, š, ě, ů, ú, á, í, é, ý, ď, ť, ň
- IMPORTANT: Do NOT generate any text in the image! Text will be added programmatically.
- Generate ONLY the background photo scene.
- Photorealistic, professional photography quality
- Good lighting (natural or studio)
- Sharp focus, shallow depth of field where appropriate
- Modern, aspirational lifestyle aesthetic
- When showing a smartphone, ALWAYS depict an iPhone 17 Pro Max (latest model, aluminium design, thin bezels, Dynamic Island, triple camera)
- Never use generic/unnamed phones or older models`,
    },

    // ─── Week Plan ──────────────────────────────────────────

    weekPlan: [
        // Pondělí — reach + value
        "tip_nastaveni",
        "carousel_tips",
        // Úterý — value + convert
        "edukace",
        "statistika",
        // Středa — reach + value
        "meme",
        "quick_tip",
        // Čtvrtek — convert + value
        "before_after",
        "motivace",
        "carousel_tips",
        // Pátek — reach + connect
        "meme",
        "behind_scenes",
        // Sobota — convert + value
        "before_after",
        "quick_tip",
        // Neděle — connect + reach
        "challenge",
        "trending",
    ],

    // ─── Hashtag Pools ──────────────────────────────────────

    hashtagPools: {
        core: ["#mobilnamiru"],
        niche: [
            "#digitalwellbeing",
            "#screentime",
            "#focusmode",
            "#produktivita",
            "#digitaldetox",
            "#minimalismus",
            "#deepwork",
        ],
        broad: [
            "#tipyatriky",
            "#zivotninastaveni",
            "#selfimprovement",
            "#mindfulness",
            "#healthyhabits",
            "#techlife",
        ],
        trending: [
            "#2026goals",
            "#newme",
            "#dopaminedetox",
            "#attentioneconomy",
        ],
        czech: [
            "#ceskyinstagram",
            "#produktivitacz",
            "#ceskyblog",
        ],
    },

    // ─── Post Types ─────────────────────────────────────────

    postTypes: [
        "tip_nastaveni", "meme", "statistika", "quick_tip", "motivace",
        "edukace", "poll_question", "carousel_tips", "before_after",
        "behind_scenes", "challenge", "trending", "recenze",
    ],

    // ─── Content Focus ──────────────────────────────────────

    contentFocus: "O TELEFONECH, screen time, digitálním wellbeingu a nastavení telefonu. Tipy = PŘESNÉ reálné nastavení s cestou v menu.",

    // ─── Logo ───────────────────────────────────────────────

    logoFile: "logo-watermark.png",

    // ─── Overlay Gradient (text-overlay.ts colors) ──────────

    overlayGradient: {
        topColor: "#1a1a3e",
        midColor: "#2d1854",
        bottomColor: "#1a1a3e",
    },

    // ─── Image Instructions (per post type for mega prompt) ─

    imageInstructions: {
        _default: "Pozadí: relevantní lifestyle fotka.\nText dole: headline.",
        meme: "MEME — VÝJIMKA: Žádný gradient overlay. Klasický meme format, Twitter screenshot, relatable text. Raw, authentic aesthetic.",
        statistika: "STATISTIKA: Pozadí: člověk u telefonu, phone close-up.\nText dole: velké číslo + kontext.",
        tip_nastaveni: "TIP: Pozadí: ruce držící telefon, phone screen, close-up nastavení.\nText dole: název tipu.",
        quick_tip: "TIP: Pozadí: ruce držící telefon, phone screen, close-up nastavení.\nText dole: název tipu.",
        before_after: "BEFORE/AFTER: Pozadí: split screen comparison.\nText dole: \"Před vs. Po\".",
        motivace: "MOTIVACE: Pozadí: osoba venku bez telefonu, příroda, freedom.\nText dole: motivační statement.",
    },

    // ─── Video Focus ────────────────────────────────────────

    videoFocus: "Phone-centric content (iOS/Android UI, hands holding phone, app screens)",

    // ─── Post Formats (per post type) ───────────────────────

    defaultFormat: { aspectRatio: "3:4", medium: "image", overlayStyle: "default" },

    postFormats: {
        // Image posts — 3:4 portrait for better feed presence
        tip_nastaveni: { aspectRatio: "3:4", medium: "image", overlayStyle: "default" },
        quick_tip: { aspectRatio: "3:4", medium: "image", overlayStyle: "default" },
        statistika: { aspectRatio: "3:4", medium: "image", overlayStyle: "default" },
        motivace: { aspectRatio: "3:4", medium: "image", overlayStyle: "default" },
        before_after: { aspectRatio: "3:4", medium: "image", overlayStyle: "default" },
        edukace: { aspectRatio: "3:4", medium: "image", overlayStyle: "default" },
        recenze: { aspectRatio: "3:4", medium: "image", overlayStyle: "default" },
        behind_scenes: { aspectRatio: "3:4", medium: "image", overlayStyle: "minimal" },
        challenge: { aspectRatio: "1:1", medium: "image", overlayStyle: "default" },
        trending: { aspectRatio: "1:1", medium: "image", overlayStyle: "default" },

        // Memes — square, no overlay
        meme: { aspectRatio: "1:1", medium: "image", overlayStyle: "none" },
        poll_question: { aspectRatio: "1:1", medium: "image", overlayStyle: "default" },

        // Carousels — square swipeable
        carousel_tips: { aspectRatio: "1:1", medium: "carousel", overlayStyle: "cover" },
    },
}
