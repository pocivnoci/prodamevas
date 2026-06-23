# Audit formátů příspěvků (carousel / image / reel)

**Datum:** 2026-06-23
**Spouštěč:** „Najednou jsou všechny posty carousely a mají špatné formáty pro Instagram."
**Závěr:** Jde o kombinaci včerejšího reel kill-switche + chybějícího clampu poměru stran. Carousely se renderují v poměru **9:16** (Stories/Reels), který Instagram ve feedu tvrdě ořezává.

---

## TL;DR — co je špatně

| # | Závažnost | Problém | Kde |
|---|-----------|---------|-----|
| 1 | 🔴 KRITICKÉ | Reel→carousel clamp nechá `aspectRatio: "9:16"` → carousel v poměru Stories | `instagram/autopilot.ts:352` |
| 2 | 🟠 Vysoké | Default formát je `3:4` místo IG-friendly `4:5`/`1:1` | `instagram/caption-generator.ts:45` |
| 3 | 🟠 Vysoké | Onboarding LLM smí každému typu přiřadit `9:16`/`16:9`/`4:3` — i carouselu/image | `app/onboarding/core.ts:684,711` |
| 4 | 🟡 Střední | Typ `AspectRatio` povoluje feed-neplatné poměry bez jakéhokoli guardu | `instagram/configs/types.ts:112` |
| 5 | 🟡 Střední | Žádná normalizace „carousel musí mít carousel-legální poměr" před renderem ani publikací | celý pipeline |

---

## 1. 🔴 Kořenová příčina — reel kill-switch nechá poměr 9:16

Včerejší commit `5d98f0e0` (Veo off) clampuje každý reel na carousel:

```ts
// instagram/autopilot.ts:352
if (process.env.REELS_ENABLED !== "1" && format.medium === "reel") {
    format.medium = "carousel"
    if (format.overlayStyle === "none") format.overlayStyle = "cover"
    // ❌ format.aspectRatio zůstává "9:16" !
}
```

Reely vznikají z `getPostFormat` (`caption-generator.ts:51`):

```ts
if (typeName.startsWith("reel_"))
    return { aspectRatio: "9:16", medium: "reel", overlayStyle: "none" }
```

**Řetězec:** reel typ → `9:16` → kill-switch přepne `medium` na carousel, ale **poměr 9:16 nechá** → carousel-orchestrator pošle `aspectRatio: "9:16"` do generátoru obrázků (`carousel-orchestrator.ts:117`) → všechny slidy se vyrenderují jako **vertikální 9:16 (1080×1920)**.

**Proč to je problém na Instagramu:** feed/carousel podporuje **1:1**, **4:5** (a landscape 1.91:1). Carousel uzamkne poměr podle prvního slidu a vše ořízne na max **4:5**. Obrázek 9:16 (0.5625) je výrazně užší než 4:5 (0.8) → IG ořízne horní a dolní ~30 % → uřízne se nadpis/logo na coveru. Vizuálně „rozbité" carousely.

**Proč to vypadá, že jsou _všechny_ posty carousely:** configy jsou reel-heavy, takže drtivá většina typů byla reel → po kill-switchi všechny spadly na carousel (a navíc se špatným poměrem).

### Fix (1 řádek)
Při clampu resetuj i poměr na carousel-legální:

```ts
if (process.env.REELS_ENABLED !== "1" && format.medium === "reel") {
    format.medium = "carousel"
    format.aspectRatio = "4:5"          // ← doplnit: 9:16 není feed-legální
    if (format.overlayStyle === "none") format.overlayStyle = "cover"
}
```

(`4:5` = maximální vertikální plocha ve feedu, doporučený poměr pro carousely. Alternativa `1:1`, pokud chceme čtverec.)

---

## 2. 🟠 Default formát je `3:4`

```ts
// caption-generator.ts:45
const DEFAULT_FORMAT: PostFormat = { aspectRatio: "3:4", medium: "image", overlayStyle: "default" }
```

`3:4` (0.75) je _vyšší_ než `4:5` (0.8). Single foto IG dnes (grid 3:4) toleruje, ale:
- carousely IG ořezává na 4:5 → 3:4 slidy se _taky_ ořežou.
- Doporučený univerzální default pro feed je **`4:5`** (max plocha, bezpečné napříč carousel/image).

**Doporučení:** default → `4:5`.

---

## 3. 🟠 Onboarding LLM smí generovat neplatné poměry

Prompt ukazuje LLM jen `1:1 | 4:5 | 9:16` (`core.ts:684`), ale post-processing přijme **všech 6** poměrů a nepárová je s mediem:

```ts
// core.ts:711
const RATIOS = ["1:1", "4:5", "3:4", "4:3", "9:16", "16:9"]
aspectRatio: (RATIOS.includes(d.aspectRatio) ? d.aspectRatio : "4:5")
```

→ LLM může klidně vrátit `carousel` + `9:16` nebo `image` + `16:9`. Žádný guard „medium ↔ poměr" neexistuje. Tyhle vadné páry se uloží do `ig_post_types` a táhnou se dál.

**Doporučení:** normalizovat při ukládání podle media:
- `reel` → `9:16`
- `carousel`/`image` → povolit jen `{1:1, 4:5, 3:4}`, jinak fallback `4:5`.

(Pozn.: logika je duplikovaná v `actions.ts` i `core.ts` — viz memory „onboarding-config-twin-duplication". Opravit na obou místech.)

---

## 4. 🟡 Typ `AspectRatio` je moc volný

```ts
// configs/types.ts:112
export type AspectRatio = "1:1" | "4:5" | "3:4" | "4:3" | "9:16" | "16:9"
```

`4:3` a `16:9` jsou landscape — ve feed-carouselu plýtvají plochou a působí cize. Typ je v pořádku jako _vstup_ (reel potřebuje 9:16), ale chybí **centrální normalizační funkce** (např. `carouselSafeRatio(format)`), která by před renderem i před publikací zaručila feed-legální poměr podle media.

---

## 5. 🟡 Žádná normalizace před renderem/publikací

`carousel-orchestrator.ts` vezme `format.aspectRatio` jak je (řádky 117–118, 312, 343) a pošle ho do Gemini bez kontroly. Publisher (`ig-publisher`) taky neověřuje poměr proti IG specifikaci. → jediná pojistka by měla být jeden clamp na jednom místě.

**Doporučení:** přidat helper a volat ho v `generateOnePost` hned po výpočtu `format`:

```ts
const CAROUSEL_SAFE: AspectRatio[] = ["1:1", "4:5", "3:4"]
if (format.medium !== "reel" && !CAROUSEL_SAFE.includes(format.aspectRatio)) {
    format.aspectRatio = "4:5"
}
```

Tím se zacelí #1, #3 i #4 jednou pojistkou bez ohledu na to, odkud vadný poměr přitekl (config / kategorie / onboarding / user override).

---

## Referenční IG specifikace (pro kontext)

| Formát | Poměr | Rozměr | Pozn. |
|--------|-------|--------|-------|
| Square | 1:1 | 1080×1080 | bezpečné všude |
| Portrait | 4:5 | 1080×1350 | **doporučeno pro feed/carousel** — max plocha |
| Portrait (grid) | 3:4 | 1080×1440 | single foto OK, carousel ořezává na 4:5 |
| Landscape | 1.91:1 | 1080×566 | málokdy |
| Reel/Story | 9:16 | 1080×1920 | **jen reels/stories, ne feed carousel** |

**Pravidlo carouselu:** všechny slidy musí mít stejný poměr; IG uzamkne carousel podle 1. slidu. Náš pipeline naštěstí používá jeden `format.aspectRatio` pro všechny slidy → konzistence je OK, problém je jen ve _zvolené hodnotě_.

---

## Priorita oprav

1. **Hned (1 řádek):** `autopilot.ts:352` — doplnit `format.aspectRatio = "4:5"` do kill-switche. Odstraní 9:16 carousely okamžitě.
2. **Krátkodobě:** centrální `CAROUSEL_SAFE` clamp v `generateOnePost` (pojistka #5).
3. **Default:** `DEFAULT_FORMAT` 3:4 → 4:5.
4. **Onboarding:** normalizace medium↔poměr v `core.ts` + `actions.ts`.
