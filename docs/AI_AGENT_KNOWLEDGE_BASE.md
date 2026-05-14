# AI AGENT KNOWLEDGE BASE: Instagram Multi-Tenant Autopilot

**POZOR PRO VŠECHNY AI AGENTY A LLM MODELY**: Tento dokument slouží jako zdroj pravdy (Source of Truth) pro architektonická, obchodní a technická rozhodnutí platformy. Jste-li asistující AI, PŘEČTĚTE SI TENTO DOKUMENT jako první, než budete cokoliv modifikovat.

> [!CAUTION]
> **Po každé změně kódu MUSÍŠ aktualizovat tento dokument.** Checklist: `docs/AI_RULES.md`. Datum updatu vlož do hlavičky. Zastaralé docs = selhání.

*Last Updated: 2026-05-14 — v3.0 Interconnected Architecture*

---

## 🏗️ 1. Hlavní účel a Architektura systému

Tato platforma (`instagram/autopilot.ts`) je automatizovaný **Multi-Tenant Content Engine** určený ke generování Instagram příspěvků pro RŮZNÉ nezávislé klienty/značky. Běží na serverless stacku (Next.js 16, Vercel) a data ukládá do **Supabase** (PostgreSQL + Object Storage).

**Klíčová pravidla architektury:**
- **Multi-tenant by design**: Všechna specifika (barvy, weby, tone of voice) jsou izolovaná v klientské konfiguraci uložené v DB (`clients.config` JSONB sloupec).
- **Žádný hardcoding**: Databázová ID, buckety, admin emaily, URL — vždy z `ClientConfig` (DB) nebo ENV proměnných.
- **Konfigurace žije POUZE v Supabase DB** — v kódu existují pouze `configs/types.ts` a `configs/index.ts`.
- **Feedback loops jsou posvátné**: Každý agent předává data dalšímu. Nikdy nezkracujte zpětnovazební smyčky.

---

## 🤖 2. Multi-Agent Pipeline

Systém běží jako propojená síť agentů. **Každý agent předává data dalším.**

```
Researcher → Copywriter → Critic → Copywriter (repair) → Art Director → Renderer → Uploader
    ↑                        ↓                                                         ↓
Brand Memory ←────── ig_generation_log (critic_score) ─────────────── ig_posts ───────┘
    ↑                                                                      ↓
ig_post_ideas (weighted) ←──────────────── propagateMetricsToSources() ←─┘
ig_reviews (weighted) ←─────────────────── propagateMetricsToSources() ←─┘
buildSmartWeekPlan() ←──────────────────── performance.analyzePerformance() ←─────────┘
```

### Agent Role Assignment

| Agent | Funkce | Model |
|-------|--------|-------|
| **Researcher** | Vybere typ, nápad (weighted), recenzi (weighted), analyzuje výkon | — |
| **Copywriter** | Generuje caption/script/carousel z mega promptu | `gemini-3.1-pro-preview` |
| **Critic** | Hodnotí 1–10, vrací `keep[]` a `fix[]`, ukládá do logu | `gemini-3.1-pro-preview` |
| **Art Director** | Vylepšuje image prompt, injektuje vizuální pravidla z memory | `gemini-3.1-pro-preview` |
| **Renderer** | Generuje obrázek/video, přidává text overlay | Imagen 4 Ultra / Nano Banana Pro / Veo 3.1 |
| **Memory Agent** | Analyzuje vzorce z postů, zapisuje/updatuje `ig_brand_memory` | `gemini-3.1-pro-preview` |

---

## 📦 3. Průběh Pipeline (krok za krokem)

1. **UI volá `/api/ig-create-job`** → vytvoří záznam v `ig_jobs`, vrátí `jobId`
2. **UI začne pollovat `/api/ig-job-status?id=...`** každé 2s (vidí reálný progress)
3. **UI volá `/api/ig-run-job`** s `{ jobId }` — blokuje až 300s
4. **Uvnitř `generateOnePost()`:**
   - Researcher: vybere typ postu, nápad (`getWeightedIdeas()`), recenzi (`getWeightedReviews()`)
   - Brand Memory: `getBrandMemories(8)` → injektuje vzorce do mega promptu
   - Copywriter: `generateText(megaPrompt)` → JSON `{hook, body, cta, hashtags, imagePrompt}`
   - Dedup check: hook + body vs. posledních 30 postů (Levenshtein)
   - Critic: `scorePost()` → score 1–10, `keep[]`, `fix[]`
   - Pokud score < 7: targeted repair s instrukcemi co zachovat a co opravit
   - Art Director: `refineImagePrompt()` → vylepšený prompt
   - Renderer: `generateImage()` nebo `generateImageWithReferences()` nebo `generateVideo()`
   - Text overlay: Satori + resvg-js → gradient + hook text + logo
   - Upload: Supabase Storage → `createPost()` → `logGeneration(+ critic data)`
5. **`ig_jobs` se updatuje** `status=done`

---

## 🔄 4. Feedback Loop (klíčová novinka v3.0)

> [!IMPORTANT]
> Bez aktivace feedback loopu se systém neučí. Volat po zadání metrik.

### Spuštění: `POST /api/ig-learn { configName }`

Spustí 2 procesy:

**A) `propagateMetricsToSources()`** — Metrics → Ideas/Reviews
- Načte `ig_posts` s metrikami (likes, comments, saves)
- Vypočítá engagement score pro každý post
- Updatuje `ig_post_ideas.performance_score` dle průměrného engagement postů z daného nápadu
- Updatuje `ig_reviews.performance_score` stejným způsobem

**B) `analyzeAndLearn()`** — Metrics → Brand Memory
- Načte top posty (>1.5x průměr) a slabé posty (<0.5x průměr)
- Gemini extrahuje max 3 pravidla (pattern / preference / avoid)
- Ukládá/updatuje záznamy v `ig_brand_memory`
- Dedup přes `ilike` match prvních 3 slov pravidla

### Weighted Selection

```typescript
// Researcher bere nápady váženě:
getWeightedIdeas(3)   // score > avg*1.5 → 3x výběr, score > avg → 2x, ostatní 1x
getWeightedReviews(3) // stejný pattern

// Week plan se adaptuje:
buildSmartWeekPlan()  // pillar ratio × 1.5 (top performer) / × 0.5 (underperformer)
                      // normalizováno na součet 1.0
```

### Critic → Memory pipeline

Každé generování ukládá:
```typescript
logGeneration({
  criticScore: 8,
  criticKeep: ["hook je skvělý", "CTA je jasné"],
  criticFix: ["body je příliš dlouhé"]
})
```
→ `ig_generation_log.critic_score/keep/fix` — budoucí aggregace odhalí systémové problémy.

---

## 🔐 5. Bezpečnostní pravidla

### Supabase klienti — 3 typy

| Klient | Soubor | Kdy použít |
|--------|--------|-----------|
| **Browser** | `supabase/client.ts` | POUZE frontend komponenty (`"use client"`) |
| **Server** | `supabase/server.ts` | Server actions — má auth kontext (cookies) |
| **Admin** | `supabase/admin.ts` | Engine backend — service role key, obchází RLS |

> [!CAUTION]
> **NIKDY nepoužívat `supabase/client` v backendu.** Retry logika: importovat z `utils/retry.ts`, nikdy nekopírovat.

---

## 🗃️ 6. Databázová Struktura

| Tabulka | Klíčové sloupce | Poznámka |
|---------|----------------|---------|
| `clients` | `id`, `slug`, `config` (jsonb) | Multi-tenant root |
| `ig_post_ideas` | `performance_score`, `times_used_with_metrics` | **NOVÉ** — Idea Ranker |
| `ig_reviews` | `performance_score`, `times_used_with_metrics` | **NOVÉ** — Review Ranker |
| `ig_posts` | `idea_id`, `review_id`, `likes`, `saves`, `reach` | FK na ideas/reviews pro propagaci |
| `ig_generation_log` | `critic_score`, `critic_keep[]`, `critic_fix[]` | **NOVÉ** — Critic → Memory |
| `ig_brand_memory` | `memory_type` (pattern/preference/avoid/**visual**) | **ROZŠÍŘENO** — visual typ |
| `ig_jobs` | `status`, `progress`, `agent_message`, `result` | Progress tracking pro UI |

---

## 🤖 7. AI Modely

| Role | Model | Poznámka |
|------|-------|---------|
| Text gen (primary) | `gemini-3.1-pro-preview` | Flagship reasoning |
| Text gen (fallback) | `gemini-2.5-flash-lite` | Na 503/429 — **NE** 2.0-flash (deprecated!) |
| Image s referencemi | `gemini-3-pro-image-preview` | Nano Banana Pro, 4K |
| Image bez referencí | `imagen-4.0-ultra-generate-001` | Nejlepší text-to-image |
| Vision | `gemini-2.5-pro` | Logo placement detection |
| Video | `veo-3.1-generate-preview` / `veo-3.1-fast-generate-preview` | Reels 9:16 |

---

## 🧩 8. Záludnosti při úpravách

1. **2-step API**: Vždy nejdřív `ig-create-job` (vrátí jobId), pak `ig-run-job`. UI může pollovat od prvního requestu.
2. **Weighted selection**: Nové zdroje dat (nápady, recenze, produkty) musí mít `performance_score` + weighted selection funkci.
3. **Critic data**: Každý nový generační krok → uložit hodnocení do `ig_generation_log` nebo `ig_brand_memory`.
4. **Vercel timeouty**: `ig-create-job` = `maxDuration: 10`, `ig-run-job` = `maxDuration: 300`, `ig-learn` = `maxDuration: 60`.
5. **Fonty/assets na Vercelu**: Musí být v `outputFileTracingIncludes` v `next.config.ts`, jinak nejsou dostupné.
6. **Text v obrázcích**: Imagen NESMÍ generovat text — vždy přes Satori (`text-overlay.ts`).
7. **Memory Agent ilike**: `ig_brand_memory` nemá FTS index — používat `.ilike("content", `%keyword%`)`, ne `.textSearch()`.

---

## 📁 9. Adresářová Struktura

```
instagram/
├── autopilot.ts          # Core orchestrator — multi-agent pipeline
├── caption-generator.ts  # Mega prompt, schemas, quality gate, week plan
├── gemini-client.ts      # AI gateway (3.1-pro-preview + fallback)
├── memory-agent.ts       # Brand Memory — analyzeAndLearn, getBrandMemories
├── performance.ts        # Analytics — engagement, reach, conversion per pillar
├── service.ts            # DB access + Idea/Review Ranker + feedback loop
├── image-pipeline.ts     # Prompt refinement
├── text-overlay.ts       # Satori + resvg-js text rendering
├── product-generator.ts  # Product idea → design → mockup
├── types.ts              # Pipeline types
└── configs/
    ├── index.ts          # DB loader, RBAC, resolveClientId
    └── types.ts          # ClientConfig interface

app/api/
├── ig-create-job/route.ts  # Step 1: create job (fast)
├── ig-run-job/route.ts     # Step 2: run generation (300s)
├── ig-job-status/route.ts  # Progress polling
└── ig-learn/route.ts       # Feedback loop trigger

supabase/migrations/
├── 20260514_ig_jobs.sql         # Job tracking table
├── 20260514_ig_brand_memory.sql # Brand memory table
└── 20260514_feedback_loop.sql   # Performance scores + critic columns
```
