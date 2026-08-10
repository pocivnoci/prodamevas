---
name: media-rendering
description: >-
  Vizuální engine Chrlit Studia — návrh a render obrázků, karuselů, stories a reelů
  (native-only přes Nano Banana Pro), feed pattern, vision QA, ffmpeg post-processing
  a oddělený tiskový engine. Načti při práci s instagram/image-pipeline.ts,
  print-pipeline.ts, orchestrators/*, lib/feed-pattern.ts, format-clamps.ts, nebo když
  řešíš aspectRatio, overlayStyle, LAYOUT_ARCHETYPES, českou typografii v obraze, logo
  jako referenci, Veo, voiceover, titulky, mockupy nebo tiskovou geometrii.
---

# Vizuální engine

Hlídají to aserce **§12, §13, §17** v `test-beta-e2e.ts` plus
`scripts/test-feed-pattern.ts` a `scripts/test-print-pipeline.ts` (`npm run guard`).

## Native-only: žádný overlay engine neexistuje

AI Designer (`generateDesignBrief` v `image-pipeline.ts`) vyrobí design brief → Nano
Banana Pro vyrenderuje **kompletní post včetně české typografie a loga** (logo se
předává jako označený referenční obrázek) → `verifyNativeImage` vision QA → korektivní
edit → jedna čerstvá regenerace.

**Satori/overlay engine byl odstraněn** — legacy `visualEngine` config, `text-overlay.ts`,
`renderImageOverlay`/`renderCarouselOverlay` a `reviewOverlayComposition` jsou pryč
(satori i @resvg vyhozené ze závislostí). Nevracej je a neslibuj je v promptu.

**Ship-best-native:** když žádný pokus neprojde QA čistě, orchestrátor publikuje
**nejlépe hodnocený** native buffer (`qaScore`, `qa_status: "native_forced"`) — nikdy
obrázek s razítkovaným textem, nikdy prázdný post. Skutečné infra selhání (generace
vyhodila výjimku) vrací žádný obrázek. `qa_status` (pass/retry_pass/native_forced) se
loguje do `ig_generation_log`.

`overlayStyle: "none"` je **platný jen pro reely** — `renderImage` ho na vstupu
překlápí na `"default"`, aby reelový formát sražený na obrázek (vypnuté reely) nemohl
poslat holou fotku bez textu. Jinak je `overlayStyle` už jen poradní (layout určuje
AI Designer), pořád editovatelný per-formát v SettingsTab.

## Feed pattern: mřížka rozhoduje o rodině archetypů

`config.feedPattern` (`lib/feed-pattern.ts`: `none | checkerboard | rows | columns |
diagonal`) dává postu podle pozice v mřížce **vizuální mód** (photo/typography/graphic),
který mapuje na skupinu z `LAYOUT_ARCHETYPES`.

- Pattern vybírá **rodinu**; zákaz rotace archetypů platí *uvnitř* ní a pattern vyhrává,
  kdyby zákaz rodinu vyprázdnil.
- `PHOTO-FIRST`/`NO EMPTY VOIDS` jsou **podmíněné slotem** — na typografický/grafický
  slot je nikdy neaplikuj, zakázaly by přesně to, o co slot žádá.
- `slotIntent` se rozhoduje **v čase plánu**, veze se na řádku plánu a worker ho
  **nikdy nepřepočítává** (resumovaný post by překlopil mód uprostřed mřížky).
- Jednotlivé posty ho odvozují z `countFeedPosts(clientId)`, jehož filtr musí zůstat
  identický s mřížkou ve FeedTab (`image_url IS NOT NULL`), jinak lžou duchové buňky.
- `feedPattern` potřebuje clamp ve `validateConfig()` — enginový kód indexuje
  `ARCHETYPE_GROUPS[mode]`.

## Reely: kvalita na Pro ladderu, degradace nahlas

`refineVideoPrompt` (`image-pipeline.ts`) je **jediný kreativní krok mezi copywriterem
a Veo** — přepisuje celý scénář do jednoho promptu. Běží proto na `textPro` ladderu
přes `generateTextQuality` (`json: false`, výstup je próza), ne na flash. Když jsou oba
Pro tiery vyčerpané, propadne na surový scénář a **zaloguje to**.

**CTA politika platí i na obraz.** Prompt dřív vypaloval `config.website` do posledních
vteřin videa natvrdo, takže reel z REACH/CONNECT pilíře porušoval vlastní `CtaPolicy`
tam, kam textový kritik nevidí. `refineVideoPrompt` bere `ctaPolicy` a při
`!allowWebsite` zakazuje URL kdekoli ve videu; cesta vede přes `RenderContext.ctaPolicy`.
Resolve `ctaPolicy` v `autopilot.ts` **musí zůstat nad checkpoint větví** — resume
z caption checkpointu přeskakuje copywritera, ale média renderuje.

**FFmpeg:** binárka `ffmpeg-static` se do build trace dostane i bez
`outputFileTracingIncludes` (změřeno 2026-08-07); záznam v `next.config.ts` je
**pojistka, ne oprava**. Reálný problém byl, že chybějící binárka mizela potichu:
`getFfmpegPath()` existenci ověřuje a hází diagnostikovatelnou chybu, pád
post-processingu jde do Sentry (`step: ffmpeg-postprocess`). Surové video se pořád
publikuje, ale reel za 5 kreditů bez voiceoveru a titulků nesmí být k nerozeznání
od úspěchu.

## Stories

Story je čtvrté médium, ne varianta postu: `MediumType` je odvozený z kreditové
tabulky, clampy pinují vertikální média na 9:16, formát musí přežít reload configu,
copywriter emituje frames a autopilot vynucuje hook doslova, designér i QA nesou
**story safe zone**. Publikuje se jako `media_type=STORIES`, at-most-once na frame.
Stories jsou **vyloučené z feed mřížky** (`countFeedPosts` i FeedTab). Auto-publish
je přeskakuje a zároveň respektuje legacy NULL řádky.

## Tisk je jiný engine než Instagram

`instagram/print-pipeline.ts` produkuje **plochou grafiku, nikdy produktovou
fotografii**. Odstraněný `generateDesignConcept` selhával už na úrovni promptu —
vynucoval „Product photography, studio lighting, photorealistic", takže mockup krok
lepil fotku trička na jiné tričko.

- Geometrie jde z `ig_product_categories` (`artwork_kind`/`aspect_ratio`/
  `print_size_mm`/`panels`/`bleed`), **nikdy z hardcodovaného poměru**.
- QA zrcadlí `verifyNativeImage` (přesná česká diakritika, plochost, integrita loga,
  safe area) a posílá nejlepší pokus.
- `finalizePrintFile` škáluje přes **`cover`, nikdy `fill`** — model renderuje jen pět
  pevných poměrů, takže výplň by stlačila etiketu 75×160 mm o ~17 % a zdeformovala
  typografii, kterou QA právě ověřilo.
- Výstup je **návrh pro tiskaře** (RGB, upscalovaný z ~1024 px), ne rozlišením
  nezávislá produkční data — UI i FAQ to musí říkat dál.
- `editPrintDesign` **edituje** existující grafiku, nikdy neroluje znovu.
- Výběr A/B vítěze (`selectDesignWinner`) zapisuje `visual` brand memory, takže
  tiskové rozhodnutí doputuje i k instagramovému art directorovi.
