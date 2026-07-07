---
tags: [decision, rendering]
status: superseded
date: 2026-05-14
superseded_date: 2026-07-01
superseded_by: "[[Nativní rendering - text i logo z Nano Banana Pro]]"
area: rendering
---

# Text v obrázcích přes Satori

> [!warning] Superseded (2026-07-01)
> Tohle už **neplatí.** Overlay engine (Satori → Sharp, `text-overlay.ts`) byl smazán — text i logo teď renderuje nativně Nano Banana Pro. Aktuální rozhodnutí: [[Nativní rendering - text i logo z Nano Banana Pro]]. Ponecháno jako historie *proč* to kdysi bylo takhle.

> [!summary] Rozhodnutí (historické)
> Image modely **nesměly renderovat text**. Veškerý text (hook, watermark) se vkládal overlay přes Satori → Sharp v `text-overlay.ts`.

## Proč (tehdy)

Generativní image modely psaly text nespolehlivě — překlepy, zkomolená diakritika, nečitelné fonty. Satori (HTML/CSS → SVG) → Sharp (SVG → PNG) dával pixel-perfect deterministický text s vlastními fonty. **Co se změnilo:** Nano Banana Pro mezitím dozrál, píše čitelný český text i komponuje logo → overlay vrstva odpadla (viz nástupce).

## Co jsme zavrhli (tehdy)

- **Text přímo z image modelu** — tehdy nečitelné a neopravitelné. *(Právě tenhle předpoklad nástupce obrátil.)*
- **Post-process OCR korekce** — křehké a drahé.

## Odkazy

- [[Nativní rendering - text i logo z Nano Banana Pro]] — nástupce
- [[Glossary]] — Satori → Sharp (pojem už jen historický)
