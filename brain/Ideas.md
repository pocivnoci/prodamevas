---
tags: [ideas, chrlit, inbox]
updated: 2026-06-15
---

# 💡 Ideas

Backlog nápadů. **Sem to dumpni, ať to není v hlavě.** Žádné třídění, žádné priority — jen ven z hlavy. Roztřídí se to později (nebo o to požádáš Claude přes [[Jak Claude používá tenhle vault]]).

## Inbox

### 2026-06-15 — nápady na zítra

- **Agent „Psycholog"** — připojit do generační pipeline. Aplikuje prodejní / spotřebitelskou psychologii na captiony (persuaze, emoce, CTA), aby posty víc prodávaly, ne jen popisovaly.
	- ✅ **2026-06-15 — prompt-vrstva hotová** (`instagram/psychologist.ts` → `buildMegaPrompt`, gated `config.psychologist`, build + 64/64 e2e zelené). Zbývá zvážit *živý review-agent* (AI přepíše hotový caption po napsání) — parkoviště.
	- *Kam to sahá:* `instagram/caption-generator.ts` (`buildMegaPrompt` už nese persona pain-points / triggers / CTA-styl) nebo jako samostatný reviewer vedle Critic / Editorial Board v `instagram/autopilot.ts`.
- **Agent „Zprávy & trendy z internetu"** — sleduje aktuální dění a trendy a krmí je do nápadů na obsah (newsjacking, aktuálnost, sezónní vlny).
	- *Kam to sahá:* nový zdroj do Context Agenta (`instagram/signals/`, dnes holiday/weather), feeduje Researcher / weighted idea selection.
- **Refaktor používání fotek, co Chrlit dostane + pravidla použití.** Jádro: model musí **pochopit, KDY si fotku může domyslet a kdy ne**.
	- ✅ **2026-06-15 — pravidla v Art Director briefu hotová** (`instagram/photo-fidelity.ts` → `generateDesignBrief`, odvozeno z `BrandImage.tags`, build + 64/64 e2e). Zbývá *hlubší enforcement* — vázat pravidla na konkrétní fotky přiložené k danému postu v orchestrátoru.
	- *Problém:* u ubytování nejde vzít jen kus zahrady (židle z reálné fotky) a zbytek scény si vymyslet jinak — vznikne **falešný obrázek reálného místa**.
	- *Pravidlo fidelity:* reálné prostory / produkty / konkrétní místa = **věrnost** (nehallucinovat okolí); generické / ilustrační / lifestyle = volnost reinterpretace. Model musí poznat, do které kategorie daná fotka patří.
	- *Kam to sahá:* předávání referenčních fotek do Nano Banana v `instagram/image-pipeline.ts` + `instagram/orchestrators/`; možná „fidelity mode" na úrovni `ClientConfig` nebo per-foto metadata (real vs. ilustrační).
- **Doporučení stylu komunikace na konkrétního klienta** — ne obecné rady, ale konkrétní tón / styl, který dává smysl pro daného klienta (obor, publikum, značka).
	- ✅ **2026-06-15 — hotovo** (konec onboardingu → `generateConfigCore` vygeneruje na míru, read-only panel v review kroku `app/onboarding/page.tsx`, uloženo do `ClientConfig.communicationStyle`; build + 64/64 e2e).
	- *Kam to sahá:* rozšířit brand learning v onboardingu (`analyzeWebsite`, `app/onboarding/`) → konkrétní doporučení do `ClientConfig.brandVoice` / `audiencePersonas` místo generického defaultu.
- **Agent „AI trendy"** — sleduje vývoj v oblasti AI a sám navrhuje (a ideálně implementuje) další funkce produktu. Meta-agent na sebezlepšování Chrlitu.

## Rozpracované

- 

## Parkoviště (možná někdy)

- 

> [!tip]
> Nápad, který dozraje v rozhodnutí → přesuň do `Decisions/` přes [[_template]].
