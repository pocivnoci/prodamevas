---
name: post-editing
description: >-
  Cílená úprava hotového příspěvku v Chrlit Studiu — retuš existujícího vizuálu místo
  přegenerování. Načti při práci s app/actions/post-edit-actions.ts, editPost,
  revertPostEdit, buildPostEditPrompt, editExistingImage, ig_posts.edit_history, nebo
  když uživatel chce „posunout nadpis", „zkrátit text", „změnit barvu" a obecně malou
  opravu už vygenerovaného postu.
---

# Úprava příspěvku ≠ přegenerování

Hlídají to aserce **§15** v `test-beta-e2e.ts` a `scripts/test-post-edit-prompt.ts`
(`npm run guard`).

`editPost` (`app/actions/post-edit-actions.ts`) je **retuš hotového vizuálu, ne nový
návrh**: stáhne publikovaný obrázek (`fetchImageBuffer`), pošle **ten buffer** do
`editExistingImage` s uživatelovou instrukcí a ochrannou klauzulí, a výsledek zapíše
**na tentýž řádek**. Přesně vzor, který roky funguje u tisku (`editPrintDesign`).

Proč to vzniklo: `revisePost` odpovídal na „posuň nadpis" voláním `renderImage()` →
`generateDesignBrief()` vymyslel nový koncept, archetyp, fotku i layout. Hotový
obrázek nikdy neviděl žádný model, takže každá drobná poznámka vrátila jiný příspěvek.

## Čtyři pravidla, která to drží

- **`post-edit-actions.ts` nesmí importovat `renderImage` ani `generateDesignBrief`.**
  To je cesta k novému návrhu; „malá oprava", která se k nim dostane, je ta chyba, ne
  fallback.
- **Po uživatelské úpravě se nikdy neregeneruje od nuly.** Nejvýš **jeden** korektivní
  edit, a jen při `qa.severity === "severe"` (rozbitá/nečitelná typografie). Po textové
  úpravě je očekávaný text z `design_brief` schválně neaktuální, takže kosmetický
  nesoulad se ignoruje — soudce je uživatel. Čerstvá regenerace by zahodila návrh,
  který si uživatel nechává.
- **Poměr stran ze skutečných pixelů** (`sharp().metadata()` → `nearestAspectRatio`),
  nikdy z formátu post typu. Jiný `aspectRatio` než má vstup = model překomponuje celý
  snímek (tak `revisePost` cpal 9:16 story do 4:5). A `mimeType: "image/webp"` —
  uložené obrázky jsou WebP, `editExistingImage` má default `image/jpeg`.
- **In-place + historie, žádný insert fallback.** Předchozí stav se odloží do
  `ig_posts.edit_history` (max 10) pro `revertPostEdit`. `revision_of`/`link_type`
  patří revizím a variantám — nesahej na ně. Publikovaný příspěvek (`posted`/`posting`)
  se needituje, rozešel by se s `ig_media_id`.

## Rozsah omezují tři páky z UI

1. Přepínač text / obrázek / obojí.
2. Označená oblast (normalizovaná 0..1; `buildPostEditPrompt` z ní udělá procenta
   **i** slovní kvadrant).
3. Pole „nesahej na".

Textová úprava jede přes `reviseCaption({ keepHook: true })` — vynutí **kódem** hook
vypálený v obrázku a smaže `imagePrompt` z výstupu; jeho povinnost ve schématu byla
důvod, proč i „zkrať text" spustilo re-roll.

## Účtování

Úprava obrázku stojí 1 kredit (`post_edit`, plochý — jedno volání modelu), textová je
zdarma. `revisePost` zůstává jako **vědomé** „vygenerovat úplně znovu" a má vlastní
credit guard (do v8.6 to byla jediná neúčtovaná plná generace v produktu).

## Co úprava neumí

`editExistingImage` bere **jen jeden vstupní obrázek** — logo ani produktovou referenci
nelze přiložit, takže **špatný produkt úprava neopraví**; to patří přegenerování.
Stejný důvod, proč `image-orchestrator.ts` při `productAccurate === false` regeneruje
místo editu.
