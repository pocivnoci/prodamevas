---
tags: [decision, data-model]
status: accepted
date: 2026-06-10
area: posts
---

# link_type — revize vs A/B varianta

> [!summary] Rozhodnutí
> Přepsání postu i A/B varianta linkují na originál stejným sloupcem `revision_of`. Rozlišuje je `link_type` (`'revision'` / `'variant'`).

## Proč

Vznikly dvě věci, které „odkazují na jiný post": **revize** (přepsání z user feedbacku přes `revisePost`) a **A/B varianta** (`generatePostVariant`). Sdílí mechaniku linkování, ale chovají se jinak — A/B srovnání a učení z výběru vítěze se smí týkat jen variant, ne revizí.

## Co jsme zavrhli

- **Dva oddělené sloupce / tabulky** pro revize a varianty — duplikuje FK logiku.
- **Žádné rozlišení** — A/B srovnání by omylem počítalo i obyčejné revize do learningu.

## Co z toho plyne (pravidla)

- Při linkování postu **vždy nastav `link_type`**.
- A/B comparison modal (PostsTab) a `learnFromVariantSelection` filtrují na `link_type='variant'`.
- Vítěz varianty krmí memory learning — revize ne.

## Odkazy

- [[Glossary]] — link_type
- [[AI_AGENT_KNOWLEDGE_BASE]] §8 (bod 18)
- `app/actions/variant-actions.ts`
