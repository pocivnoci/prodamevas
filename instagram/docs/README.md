# Instagram Engine — Stručná dokumentace

> Hlavní technická dokumentace je v `/docs/SYSTEM_KNOWLEDGE_BASE.md` a `/docs/AI_AGENT_KNOWLEDGE_BASE.md`.
> Toto je stručný přehled pro quick reference.

**Updated:** 2026-06-02

## Přehled

Config-driven AI engine pro generování Instagram obsahu. Config je v Supabase DB (`clients.config` JSONB) — v kódu jsou POUZE typy a loader.

## Pipeline

```
loadConfig() → validateConfig() → Context Agent → Brand Memory → buildMegaPrompt()
→ Gemini 3.5 Flash → JSON output → Critic (1–10) → Editorial Board (max 3 kola)
→ Art Director + Visual Memory → Nano Banana Pro (2K)
→ Satori text overlay + logo → Supabase Storage upload → ig_posts INSERT
```

## Klíčové soubory

| Soubor | LOC | Role |
|--------|-----|------|
| `autopilot.ts` | 1849 | Orchestrátor — `generateOnePost()`, `generateBatch()` |
| `caption-generator.ts` | 791 | Mega prompt, quality gate, overlay variant selection |
| `editorial-board.ts` | 777 | 6 AI agentů review (max 3 kola) |
| `text-overlay.ts` | 683 | Satori SVG → Sharp PNG overlay |
| `product-generator.ts` | 643 | Product ideas + design concepts |
| `service.ts` | 617 | DB access, weighted selection, feedback loop |
| `memory-agent.ts` | 459 | Brand memory, learning, postTypeBoosts |
| `gemini-client.ts` | 455 | AI gateway (text, image, edit, video, vision, TTS) |
| `image-pipeline.ts` | 346 | Art Director prompt refinement |
| `configs/index.ts` | — | `loadConfig()` → `validateConfig()` → safe defaults |

## Dashboard Integration

Engine je volaný přes API routes (ne CLI):
1. `POST /api/ig-create-job` — rate limit (10/h) → `ig_jobs` → `jobId`
2. `POST /api/ig-run-job` — spustí pipeline (300s max)
3. `GET /api/ig-job-status` — UI polluje progress

→ Hlavní docs: [`/docs/SYSTEM_KNOWLEDGE_BASE.md`](../docs/SYSTEM_KNOWLEDGE_BASE.md)
