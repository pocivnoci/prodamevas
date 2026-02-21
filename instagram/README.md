# Instagram Content Engine — Multi-Client Platform

> **AI-powered Instagram autopilot** — Gemini 3 Pro (text) + Imagen 4 Ultra (images) + Veo 3.1 (video)

## Quick Start

```bash
# Default client (mobilnamiru)
npx tsx instagram/autopilot.ts --dry-run

# Specific client
npx tsx instagram/autopilot.ts --config=hanzfans --dry-run

# Generate a week of content
npx tsx instagram/autopilot.ts --config=mobilnamiru --week
```

## Architecture

```
instagram/
├── autopilot.ts          ← Engine (ZERO brand data — reads everything from config)
├── gemini-client.ts      ← Gemini 3 Pro + Imagen 4 Ultra + Veo 3.1 API wrapper
├── text-overlay.ts       ← Canvas-based text overlay on images (Czech diacritics support)
├── product-generator.ts  ← AI-powered product idea + design concept generator
├── service.ts            ← Supabase CRUD for posts, ideas, reviews, calendar
├── types.ts              ← TypeScript types for DB tables, brand voice, hooks
├── index.ts              ← Module exports
│
├── configs/
│   ├── types.ts          ← ClientConfig, ContentPillar, FeedAesthetic interfaces
│   ├── index.ts          ← Config loader (loadConfig → dynamic import)
│   ├── mobilnamiru.ts    ← 📱 Mobil na míru — phone audit service
│   └── hanzfans.ts       ← 👕 HanzFans / MRDKE GANG® — streetwear merch
│
└── output/
    ├── images/           ← Generated post images
    ├── videos/           ← Generated Reels
    └── designs/          ← Product design concepts
```

## Adding a New Client

**1 file + 1 line** — zero changes to the engine:

### 1. Create `configs/novyklient.ts`

```typescript
import type { ClientConfig } from "./types"

export const config: ClientConfig = {
    id: "novyklient",
    name: "Nový Klient",
    website: "https://novyklient.cz",
    instagram: "@novyklient",

    brandVoice: {
        persona: "...",        // Who is the brand?
        values: [...],         // Core brand values
        voiceTraits: [...],    // How the brand talks
        antiPatterns: [...],   // What to NEVER do
        hookTemplates: [...],  // Hook formulas
        ctaVariations: [...],  // CTA text options
        toneByPostType: {...}, // Tone matrix per post type
    },

    contentPillars: {
        reach:   { emoji: "🔥", label: "REACH",   ratio: 0.4, ctaStrategy: "soft",   ... },
        value:   { emoji: "📚", label: "VALUE",   ratio: 0.3, ctaStrategy: "medium", ... },
        convert: { emoji: "💰", label: "CONVERT", ratio: 0.2, ctaStrategy: "hard",   ... },
        connect: { emoji: "🤝", label: "CONNECT", ratio: 0.1, ctaStrategy: "none",   ... },
    },

    ctaStrategies: {
        soft: [...],
        medium: [...],
        hard: [...],
        none: [...],
    },

    feedAesthetic: {
        colorPalette: "...",
        overlayOpacity: "30-40%",
        textPosition: "BOTTOM",
        font: "...",
        feel: "...",
        phoneModel: "iPhone 17 Pro Max",
    },

    weekPlan: ["tip", "meme", "edukace", ...],

    hashtagPools: { core: [...], niche: [...], broad: [...], trending: [...], czech: [...] },

    products: [...],     // Optional — for merch/eshop brands
    postTypes: [...],    // Available post types for this client
}
```

### 2. Register in `configs/index.ts`

```typescript
case "novyklient":
    return (await import("./novyklient")).config
```

### 3. Run

```bash
npx tsx instagram/autopilot.ts --config=novyklient --dry-run
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `--dry-run` | Preview only, no DB writes |
| `--week` | Generate week plan (from config's `weekPlan`) |
| `--count=N` | Generate N posts |
| `--type=meme` | Force specific post type |
| `--generate-ideas` | AI idea generation (per pillar) |
| `--generate-ideas --pillar=reach --count=20` | Ideas for specific pillar |
| `--product-idea` | Brainstorm new product ideas |
| `--product-idea --count=5 --theme="summer"` | Themed product ideas |
| `--design --theme="neon"` | Generate design concept + Imagen 4 Ultra visual |
| `--stats` | Performance analytics + pillar breakdown |
| `--feedback` | Record post performance metrics |
| `--help` | Full help |

All commands accept `--config=NAME` (default: `mobilnamiru`).

## Config Structure (`ClientConfig`)

| Field | Type | Purpose |
|-------|------|---------|
| `id` | `string` | DB `project_id`, CLI config name |
| `name` | `string` | Display name in logs/admin |
| `website` | `string` | Brand URL (used in CTA) |
| `instagram` | `string` | IG handle |
| `brandVoice` | `BrandVoiceConfig` | Persona, hooks, CTA, tone matrix |
| `contentPillars` | `Record<string, ContentPillar>` | Growth strategy pillars |
| `ctaStrategies` | `Record<"soft"\|"medium"\|"hard"\|"none", string[]>` | CTA texts per intensity |
| `feedAesthetic` | `FeedAesthetic` | Visual identity for images |
| `weekPlan` | `string[]` | Static post schedule (fallback) |
| `hashtagPools` | `object` | Hashtag groups |
| `products?` | `ProductInfo[]` | Product catalog (eshop brands) |
| `postTypes?` | `string[]` | Available post types |

## Generation Pipeline

```
1. Select post type (from week plan or pillar ratios)
    ↓
2. Pick unused idea (90-day cooldown) or review
    ↓
3. Build mega prompt (brand voice + type-specific rules + performance learning)
    ↓
4. Generate text (Gemini 3 Pro) — hook, body, CTA, hashtags, image prompt
    ↓
5. Quality gate (score 1-10, regenerate if < 7)
    ↓
6. Refine image prompt (feed cohesion from config.feedAesthetic)
    ↓
7. Generate image (Imagen 4 Ultra 2K) or video (Veo 3.1)
    ↓
8. Text overlay (Canvas — hook + subtext in Czech)
    ↓
9. Save to Supabase (ig_posts) + local files
```

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `GEMINI_API_KEY` | ✅ | Google AI Studio API key |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase admin key |

## Database Tables

| Table | Purpose |
|-------|---------|
| `ig_posts` | Generated posts (caption, image, status, metrics) |
| `ig_post_types` | Post type definitions (name, emoji, description) |
| `ig_post_ideas` | AI-generated idea bank (90-day cooldown) |
| `ig_reviews` | Customer reviews for content |
| `ig_content_calendar` | Scheduled content calendar |
| `ig_generation_logs` | Generation audit trail |

All tables support `project_id` for multi-tenant isolation.

## Admin Dashboard

Available at `/admin/instagram` — project selector in header filters by client.

Tabs: Posts | Generate | Ideas | Reviews | Logs
