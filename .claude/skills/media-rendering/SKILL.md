---
name: media-rendering
description: >-
  Vizuální engine Chrlit Studia — návrh a render obrázků, karuselů, stories a reelů
  (native-only přes Nano Banana Pro), feed pattern, vision QA, ffmpeg post-processing
  a oddělený tiskový engine. Načti při práci s instagram/image-pipeline.ts,
  print-pipeline.ts, orchestrators/*, lib/feed-pattern.ts, format-clamps.ts, nebo když
  řešíš aspectRatio, overlayStyle, LAYOUT_ARCHETYPES, českou typografii v obraze, logo
  jako referenci, Seedance, reelový storyboard, voiceover, titulky, mockupy nebo
  tiskovou geometrii.
---

# Vizuální engine

Hlídají to aserce **§12, §13, §17** v `test-beta-e2e.ts` plus
`scripts/test-feed-pattern.ts`, `scripts/test-reel-pipeline.ts` a
`scripts/test-print-pipeline.ts` (`npm run guard`).

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

## Reely: audio-first, Seedance, nic potichu

Reel má dvě velikosti = dvě média v kreditové tabulce (`reel` ≤ 8 s / 5 kr.,
`reel_long` ≤ 20 s / 10 kr., `lib/reel-media.ts`). Na „je to reel?" se ptej
`isReelMedium()`, nikdy `=== "reel"`. Jediné rozlišení je 480p (720p by dlouhý
reel poslal mimo pásmo Kč/kredit).

Pipeline (`orchestrators/reel-orchestrator.ts`) je **od zvuku**:

1. Narrace = věty copywritera (prošly kritikem i faktickou bránou). Režisér ji
   **nepíše ani nepřepisuje** — smí ji jen zkrátit (`condenseNarration`), když se
   nevejde do stropu, beze změny významu a bez nových čísel.
2. `reel-audio.ts`: TTS po větách, délka z hlavičky WAV (bez ffmpegu), časová osa
   (`buildTimeline`: nájezd, mezery, dojezd, zrychlení do 1,15×, jinak `tooLong`).
   **Délka videa se odvozuje z řeči**, ne z configu. TTS mimo provoz =
   `QualityUnavailableError` = zaparkovat, a to DŘÍV, než se zaplatí vteřina videa.
   Rozpočty slov žijí v `lib/reel-media.ts` a **odečítají čas mimo řeč**: copywriter
   dostane `plannedNarrationWords` (česká řeč ~1,7 slova/s, ne 2,3), zkrácení míří na
   `narrationWordBudget` z NAMĚŘENÉHO tempa hlasu a zkouší se nejvýš dvakrát.
3. `reel-director.ts` (Claude Sonnet 5, fallback Gemini `textPro` ladder, stejný
   JSON): storyboard zarovnaný na osu, záběry ukazují na očíslované reference
   (brandové fotky z `pickBrandPhotos`, produkt, logo) a JEDEN anglický prompt.
   Čistá část je v `reel-storyboard.ts` (validátor: navazující záběry, indexy
   referencí, žádná URL při `!allowWebsite`). `finalizeVideoPrompt` doplňuje tvrdé
   zákazy — bez textu v obraze, bez řeči — bez ohledu na model.
4. Voiceover stopa se složí čistě v TS (`assembleVoiceoverWav`) a nahraje do bucketu
   klienta; pak se uloží **video checkpoint** (`ig_jobs.result.checkpoint.video`),
   zadá se úloha na Seedance (`seedance-client.ts`, BytePlus ModelArk) a checkpoint
   se uloží znovu s `taskId`. Účtování (`recordUnits(videoUnitKey(...), "seconds")`)
   je u zadání — resume nic neplatí dvakrát.
5. Polling má rozpočet z `deadlineAt` (`RENDER_BUDGET_MS` v `lib/job-park.ts`).
   Když video ještě běží, letí `VideoPendingError` → `parkJobForVideo` (2 min,
   kredit zůstává, `retry_count` se nemění, kola počítá `pollRounds`, strop
   `MAX_VIDEO_POLL_ROUNDS`). Přetížené Seedance = `QualityUnavailableError`.
   Tvar API ModelArk žije JEN v `buildTaskBody`/`parseTaskStatus`
   (`ARK_PARAMS_IN_PROMPT=1` = starší forma s parametry v textu).
6. `reel-compositor.ts` (ffmpeg-static, jeden průchod): atmosféra z videa se pod
   řečí **stlačuje** (`sidechaincompress`), němé video se ošetří (`probeHasAudio`),
   titulky jdou přes `ass` + `fontsdir` s bundlovaným `assets/fonts/Inter-Bold.ttf`
   (`drawtext` ve statické binárce **není**), `loudnorm` −14 LUFS. Titulky
   (`reel-subtitles.ts`) jsou krátké karty ≤ 2 × 18 znaků v bezpečné zóně IG,
   zalamované v kódu (`WrapStyle: 2`). Pád kompozice, videa nebo uploadu je
   **selhání jobu** (refund + Sentry `step: compose`), nikdy reel bez titulků.
7. Cover zůstává native (Nano Banana Pro + QA); `rethrowIfQualityUnavailable` platí
   i tady.

**CTA politika platí i na obraz** — `ctaPolicy` jde přes `RenderContext` do
režiséra; resolve v `autopilot.ts` **musí zůstat nad checkpoint větví**.
Binárka i font jsou připnuté v `next.config.ts` pro `ig-run-job`, `campaign-worker`
i `job-resume`. Bez `ARK_API_KEY` reel nejde vyrobit a orchestrátor to hlásí nahlas
(health-check hlídá `REELS_ENABLED=1` bez klíče). Čisté testy:
`scripts/test-reel-pipeline.ts`; živý test: `scripts/smoke-seedance.ts`.

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
