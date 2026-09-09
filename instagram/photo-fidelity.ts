/**
 * Photo Fidelity — deterministická pravidla věrnosti reálným referenčním fotkám.
 *
 * Problém: image model umí vzít fragment reálné fotky (např. zahradní židle z fotky
 * ubytování) a zbytek scény si domyslet → vznikne falešný obraz reálného místa, který
 * uvádí zákazníka v omyl. Model musí pochopit, KDY si reinterpretaci může dovolit
 * (generický / ilustrační koncept) a kdy NE (skutečné, identifikovatelné místo nebo
 * produkt značky).
 *
 * Záměrně bez AI volání: vrací řízený blok pravidel odvozený z TAGŮ reálných fotek
 * značky (`BrandImage.tags`), který se vkládá do briefu Art Directora
 * (`generateDesignBrief` v image-pipeline.ts). Aktivuje se jen když značka reálné
 * fotky místa/produktu skutečně má — jinak vrací "" (tvůrčí volnost).
 *
 * Návazný (hlubší) krok — vázat pravidla přímo na konkrétní fotky přiložené k danému
 * postu v orchestrátoru — je zaparkovaný v brain/Ideas.md.
 */

import { getConfigBrandImageObjects, type ClientConfig } from "./configs/types"

/** Tagy označující SKUTEČNÉ, identifikovatelné místo/prostor značky. */
const REAL_PLACE_TAGS = ["exterior", "interior", "bedroom", "bathroom", "kitchen", "living", "pool", "restaurant", "lobby", "garden"]
/** Tagy označující konkrétní produkt/jídlo značky. */
const PRODUCT_TAGS = ["product", "food"]

/**
 * Konkrétní člověk značky. Vlastní pravidlo, ne položka v REAL_PLACE_TAGS: u místa
 * jde o to nedomýšlet si scénu, u člověka o to nevyměnit mu obličej. Model jinak
 * ochotně nasadí fotobankovou tvář, protože „člověk v kavárně" je pro něj generický
 * rekvizit — jenže zákazník pozná, že to není on.
 */
const PERSON_TAGS = ["person"]

/**
 * Pravidlo pro značku, která fotorealistickou scénu vymýšlet nechce.
 *
 * `hasBasePhoto` říká, jestli k TOMUHLE renderu opravdu leží reálná fotka jako
 * základ. Bez ní zbývají u `only-real` dvě poctivé cesty — typografie nebo grafika;
 * vymyslet fotku „ve stylu značky" je přesně to, co si zákazník zakázal.
 */
function buildPhotoPolicySection(config: ClientConfig, hasBasePhoto: boolean): string {
    if (config.photoPolicy !== "only-real" || hasBasePhoto) return ""
    return `

## 🚫 JEN VLASTNÍ FOTKY (povinné):
Tahle značka si vymyšlené fotografie nepřeje a pro tenhle post žádná její reálná fotka není k dispozici.
- NEVYMÝŠLEJ fotorealistickou scénu, produkt ani interiér — ani „ve stylu značky".
- Postav post na TYPOGRAFII nebo GRAFICE: designovaný typ, barevná pole, tvary, ilustrační abstrakce.
- Abstraktní textura nebo barevný podklad jsou v pořádku. Vymyšlený obraz konkrétní věci, místa nebo člověka není.`
}

export function buildPhotoFidelitySection(config: ClientConfig, hasBasePhoto = false): string {
    const policySection = buildPhotoPolicySection(config, hasBasePhoto)
    const imgs = getConfigBrandImageObjects(config)
    if (imgs.length === 0) return policySection

    const tags = new Set(imgs.flatMap((i) => (i.tags || []).map((t) => t.toLowerCase())))
    const realPlace = REAL_PLACE_TAGS.filter((t) => tags.has(t))
    const product = PRODUCT_TAGS.filter((t) => tags.has(t))
    const hasPerson = PERSON_TAGS.some((t) => tags.has(t))

    const personSection = hasPerson
        ? `

## 🧑 TVÁŘ ZNAČKY (povinné):
Značka má referenční fotku KONKRÉTNÍHO člověka (tag: person).
- Když kompozice ukazuje člověka reprezentujícího tuhle značku, musí to být TENHLE člověk podle referenční fotky — stejný obličej, účes, typ postavy.
- NIKDY ho nenahrazuj fotobankovým modelem ani „podobným typem". Zákazník pozná, že to není on, a celý příspěvek tím ztratí důvěryhodnost.
- Když scéna konkrétního člověka nepotřebuje, řeš ji BEZ tváře (ruce, záda, odstup, detail činnosti) — to je vždycky lepší než cizí obličej.`
        : ""

    if (realPlace.length === 0 && product.length === 0) return personSection + policySection // jen generické/nature fotky → jinak tvůrčí volnost

    const what = [
        realPlace.length ? "skutečného prostoru/místa" : "",
        product.length ? "konkrétních produktů" : "",
    ].filter(Boolean).join(" a ")

    return `

## 📸 VĚRNOST REÁLNÝM FOTKÁM (povinné):
Tahle značka má reálné referenční fotky ${what} (tagy: ${[...realPlace, ...product].join(", ")}).
- Když kompozice zobrazuje SKUTEČNÉ místo nebo produkt téhle značky, musí zůstat VĚRNÁ referenční fotce.
- NIKDY neslepuj fragment reálné fotky (např. zahradní židle) do jinak vymyšlené scény — vznikl by falešný obraz reálného místa, který uvede zákazníka v omyl.
- Buď A) použij reálný prostor/produkt VĚRNĚ, NEBO B) jdi jasně do generického/ilustračního konceptu (nálada, lifestyle, abstraktní detail) — ale NIKDY klamavý hybrid mezi tím.${personSection}${policySection}`
}
