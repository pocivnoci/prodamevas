---
tags: [decision, rendering]
status: accepted
date: 2026-07-01
area: rendering
supersedes: "[[Text v obrázcích přes Satori]]"
---

# Nativní rendering — text i logo z Nano Banana Pro

> [!summary] Rozhodnutí
> Kompletní post včetně **české typografie a loga** vyrenderuje přímo image model (Nano Banana Pro) podle design briefu. **Overlay vrstva (Satori) už neexistuje.** Ruší [[Text v obrázcích přes Satori]].

## Proč

Modely mezitím dozrály — Nano Banana Pro píše čitelný český text s diakritikou a umí zakomponovat logo jako referenční obrázek. Overlay engine (Satori → Sharp) byl navíc druhý zdroj pravdy o layoutu, křehký na fontech a bránil AI Designerovi rozhodovat o kompozici. Nativní render = jedna vrstva, konzistentnější a bohatší vizuál.

## Co jsme zavrhli

- **Satori/Sharp overlay** — smazáno včetně `text-overlay.ts`, `renderImageOverlay`/`renderCarouselOverlay`, `reviewOverlayComposition` a deps satori + @resvg. Historie: [[Text v obrázcích přes Satori]].
- **Text-stamped fallback** — když QA neprojde, radši publikuj nejlepší nativní pokus, ne orazítkovanou fotku.

## Co z toho plyne (pravidla)

- Pipeline: `generateDesignBrief` (AI Designer, `image-pipeline.ts`) → design brief → Nano Banana Pro (text+logo) → `verifyNativeImage` vision QA → korektivní edit → jeden čerstvý regen.
- **Ship-best-native:** když nic neprojde QA čistě, orchestrátor publikuje nejlíp skórující nativní buffer (`qaScore`, `qa_status: "native_forced"`) — **nikdy** text-stamp, **nikdy** prázdný post. Skutečný infra fail (generace hodila výjimku) vrátí žádný obrázek.
- Logo se předává jako **labeled reference image**, ne přes overlay.
- `overlayStyle` je teď **jen poradní** (layout rozhoduje AI Designer), pořád editovatelný per-format v SettingsTab. `overlayStyle: "none"` je platné **jen pro reels**; `renderImage` ho u obrázku překlopí na `"default"`.
- Pro tier (`designer`/`visionQA`) běží na aliasu `gemini-pro-latest` — nikdy nepinuj preview image ID (ty se shutují).

## Odkazy

- [[Text v obrázcích přes Satori]] — nahrazené rozhodnutí (historie)
- [[Content pipeline - durable kampaně a zásobník témat]]
- [[Glossary]]
- [[AI_AGENT_KNOWLEDGE_BASE]]
- `instagram/image-pipeline.ts`
