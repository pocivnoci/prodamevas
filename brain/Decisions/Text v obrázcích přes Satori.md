---
tags: [decision, rendering]
status: accepted
date: 2026-05-14
area: rendering
---

# Text v obrázcích přes Satori

> [!summary] Rozhodnutí
> Image modely **nesmí renderovat text**. Veškerý text (hook, watermark) se vkládá overlay přes Satori → Sharp v `text-overlay.ts`.

## Proč

Generativní image modely píšou text nespolehlivě — překlepy, zkomolená diakritika, nečitelné fonty. Pro brandové posty s českým textem je to nepoužitelné. Satori (HTML/CSS → SVG) → Sharp (SVG → PNG) dává **pixel-perfect, deterministický** text s vlastními fonty.

## Co jsme zavrhli

- **Text přímo z image modelu** — nečitelné, nekonzistentní, neopravitelné.
- **Post-process OCR korekce** — křehké a drahé.

## Co z toho plyne (pravidla)

- Image prompt explicitně zakazuje text v obrázku.
- Hook text, gradient a logo watermark jdou přes `text-overlay.ts`.
- Fonty (Inter, BebasNeue) musí být na Vercelu v `outputFileTracingIncludes` (`next.config.ts`), jinak overlay spadne.
- Po overlayi běží vision check `reviewOverlayComposition()`.

## Odkazy

- [[Glossary]] — Satori → Sharp
- [[AI_AGENT_KNOWLEDGE_BASE]] §8 (body 9, 10)
- `instagram/text-overlay.ts`
