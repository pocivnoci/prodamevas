# Reely v2 — návrh: hlas, scénář, formáty (12. 9. 2026)

Stav po prvních dvou živých videích (#122, #124): pipeline funguje end-to-end,
výsledek je odhadem na 20 %. Hlavní stížnost: **voiceover zní nerealisticky a je
u všech klientů stejný**. Druhá: reel nevyužívá, co o klientovi víme, a scénář je
generický. Tenhle dokument říká, proč to tak je (z kódu), a navrhuje pořadí zásahů.

## Cíl reelu

Reel/short má jediný účel: **zastavit palec a udržet pozornost do CTA**. Metriky, na
kterých to jde měřit z Instagram API: přehrání (plays), dosah, uložení, sdílení,
komentáře — retenci po vteřinách API nedává, takže „hook drží" se pozná nepřímo
(plays vs. reach, uložení). Vše ostatní (hlas, střih, scénář) je prostředek k tomu.

## Diagnóza z kódu

| Vrstva | Dnes | Důsledek |
|---|---|---|
| **Hlas** | Gemini 3.1 Flash TTS, jediný preset `Kore` pro všechny (`config.ttsVoice \|\| "Kore"`, `reel-orchestrator.ts`), `mood: "professional"` natvrdo; `ttsVoice` nikdo v onboardingu nenastavuje | stejný, anglicky laděný hlas u kavárny i izolatéra; česká prozodie slabá |
| **Video** | Seedance 2.5 přes ModelArk, 480p, `generate_audio` = jen atmosféra; prompt výslovně zakazuje řeč a lip-sync (`finalizeVideoPrompt`) | lidé v obraze nikdy nemluví; hlas je vždy „vypravěč nad obrazem" |
| **Scénář** | Narraci píše copywriter (Gemini Pro) v tomtéž mega promptu jako feedové posty, s kostrou HOOK → VALUE → CTA; režisér (Claude Sonnet 5) řeší jen obraz a narraci nesmí měnit | scénář je vedlejší produkt textového postu; žádný specialista na video, žádný hook systém, žádná zpětná vazba z výkonu reelů |
| **Data o klientovi** | Režisér i copywriter dostávají brand kit, fakta, produkt, brandové fotky, paměť | co chybí: historie vlastního IG (co klientovi fungovalo), recenze v hlasu zákazníka, výkon předchozích reelů, oborový profil (nově `industryVisual`) |
| **Formát** | Vždy voiceover + titulky | žádný „text-only" reel s hudbou, žádný mluvící člověk |
| **Ekonomika** | krátký reel ≈ 1,10 USD, dlouhý ≈ 2,30 USD (Seedance 0,10 USD/s); TTS 0,02 USD | rezerva na dražší hlas i dražší scénář je (5 kr ≈ 245 Kč) |

## Návrh — čtyři fáze, každá samostatně nasaditelná

### Fáze 1 — Hlas (největší vnímaná vada, 2–3 dny)

1. **Abstrakce poskytovatele TTS** (`instagram/tts/`): rozhraní
   `synthesize(text, { voiceId, language: "cs", style }) → WAV` a dva poskytovatelé:
   `gemini` (dnešní kód z `gemini-client.ts`) a **`elevenlabs`** (nový; model
   `eleven_v3` nebo `eleven_multilingual_v2`, čeština je podporovaná, výstup
   `pcm_24000`, aby zůstala cesta přes `wavInfo` a `buildTimeline` beze změny).
   ID modelů do `instagram/models.ts` (`tts.primary = elevenlabs:eleven_v3`,
   `fallback = gemini`), sazba do `lib/model-pricing.ts` (ElevenLabs účtuje za znak;
   reel má ~150–300 znaků → jednotky centů). Env `ELEVENLABS_API_KEY`.
   Fallback na Gemini **není tichý**: `ig_generation_log.voice_provider` + log,
   a když je ElevenLabs mimo provoz a klient má vybraný hlas, raději zaparkovat
   (`QualityUnavailableError`) než dodat cizí hlas.
2. **Hlas patří značce, ne enginu**: `ClientConfig.voice = { provider, voiceId,
   style, pace }` s defaultem ve `validateConfig()`. **Casting hlasu v onboardingu**:
   kurátorská knihovna 8–12 českých hlasů (`lib/voice-library.ts`: pohlaví, věk,
   temperament, tempo, „hodí se pro" obory) a deterministický výběr z
   `brandVoice.persona` + oboru + publika. Stejná značka = stejný hlas v každém
   reelu; různé značky = různé hlasy. V Nastavení přehrávač: poslechnout, vybrat.
3. **Přednes**: mapa nálad scén (`scenes[].mood`) → ElevenLabs v3 audio tagy
   (`[warm]`, `[excited]`, `[pause]`), místo dnešního `[professional][golden hour]`
   předřazeného textu.
4. **Klonování hlasu majitele** (volitelné, až po 1–3): ElevenLabs Instant Voice
   Clone z 1–3 min nahrávky; v Nastavení upload + výslovný souhlas (uložit
   `voice.consentAt`), text souhlasu do obchodních podmínek (`lib/legal.ts`).
   Bez souhlasu klonovat nejde — je to hlas konkrétního člověka.

Ověření: `scripts/smoke-reel-voice.ts` — stejné tři věty přes Gemini i všechny
hlasy knihovny do bucketu, poslech vedle sebe; pak 2 živé reely na `chrlit`
(kavárna vs. řemeslo) proti prvním dvěma videím.

### Fáze 2 — Scénář (vyšší model, data o klientovi, 3–4 dny)

1. **Samostatný scenárista reelů** (`instagram/reel-scriptwriter.ts`) na
   **Claude Opus 5** (`models.ts`: `reelScript.primary = claude-opus-5`,
   `fallback = claude-sonnet-5` — Pro→Pro, nikdy flash), jiná rodina než copywriter.
   Copywriter dál dodá námět, caption a hashtagy; **narraci, hook a beaty pro reel
   píše scenárista**. Vstupy: brand fakta, produkt, popisy brandových fotek (co
   reálně existuje k natočení), recenze, `brandVoiceExamples`, oborový vizuální
   profil, `industryRiskFamily`, signály (svátky/počasí), **historie vlastního IG**
   (`ig-scraper`: nejlépe fungující posty klienta), **výkon předchozích reelů**
   (`engagementScore`) a posledních N reelů kvůli anti-repeat.
2. **Hook systém**: knihovna hook vzorů (POV, před/po, mýtus vs. realita, „3 věci",
   příběh zákazníka, otázka, kontrast) s váženou selekcí podle výkonu
   (`performance_score`, invariant z `content-engine`) — ne náhodně, ne pořád stejně.
   Hook musí být vysloven i zobrazen v první 1,5 s (titulková karta).
3. Výstup: strukturovaný scénář (hook, beaty s narrací, b-roll záměr, zvuk, CTA,
   textové karty) → prochází **kritikem i faktickou bránou** jako dnes (narrace se
   nesmí obejít); režisér dál řeší obraz. Náklad Opusu ~0,10–0,20 USD/reel.
4. Test: 10 reelů stejných námětů „copywriter" vs. „scenárista Opus", slepé
   hodnocení (my + 2 klienti) a po publikaci metriky.

### Fáze 3 — Formáty: ne vždy voiceover (2 dny + pilot)

- **Režim B — textový reel s hudbou**: bez TTS, textové karty (titulkový engine
  `reel-subtitles.ts` už umí ASS karty) v rytmu hudby, hlas žádný. Levnější, rychlejší,
  a u řady oborů (móda, gastro, interiéry) přirozenější. Scenárista volí režim.
- **Hudba**: Seedance dává jen atmosféru. Potřebujeme licencovaný podklad — buď
  vlastní malá knihovna (licencované tracky v bucketu, výběr podle nálady), nebo
  generativní (ElevenLabs Music / obdoba). **Otevřená otázka: licence.**
- **Režim C — mluvící člověk** (spike, 1 den, až po fázi 1): ověřit tři cesty
  (a) Seedance 2.5 s promptem na řeč + náš hlas do lip-syncu přes specializovanou
  službu (Sync Labs / Hedra), (b) HeyGen-typ avatar s klonovaným hlasem, (c) Veo s
  nativní řečí. Kritérium: český lip-sync bez „uncanny" efektu. Bez průkazného
  výsledku do produktu nejde — falešně mluvící člověk škodí značce víc než vypravěč.

### Fáze 4 — Kvalita a učení (průběžně)

- **Reelový kritik**: vision QA na 3 snímcích (hook/střed/CTA) + audio kontrola
  (délka, ticho, hlasitost −14 LUFS už je) + Claude posudek scénáře proti cíli
  („zastaví to palec v první sekundě?"). Slabý reel se přegeneruje, ne dodá.
- **Zpětná vazba**: `ig-metrics-sync` → `performance_score` reelů → váhy hook vzorů
  a hlasových stylů. Bez toho se učicí smyčka přetrhne (invariant).
- Dashboard: u reelu ukázat hlas, hook vzor, režim — aby šlo poznat, co funguje.

## Hlas — stav implementace a checklist poslechu (12. 9. 2026)

**Hotovo v kódu** (balík R2): poskytovatelé TTS jsou za rozhraním
`instagram/tts/` (`TtsProvider.synthesize(text, { voiceId, style, tags, language })
→ WAV`), Gemini je jediný zapojený, ElevenLabs má v registru jen TODO. Hlas značky
žije v `ClientConfig.voice = { provider, voiceId, style }`; default ve
`validateConfig()` je **deterministický casting** `castVoice()` z persony, oboru,
publika a jména značky nad knihovnou 30 hlasů (`lib/voice-library.ts`). Staré
`ttsVoice` se migruje a je `@deprecated`. Přednes už nejde z popisu světla:
`scenes[].mood` → `deliveryTags()` (`instagram/tts/delivery.ts`). V Nastavení je
sekce „Hlas značky" s ukázkou (`previewVoice`, cache v bucketu `voice-samples/`,
sdílená napříč klienty).

**Vědomě NEimplementováno**: ElevenLabs (rozhodnutí — nejdřív poslech), klonování
hlasu majitele, `ig_generation_log.voice_provider`.

### Checklist: čeština přímo ze Seedance (spike)

Spouští se ručně s `.env.local`; nic z toho nevisí na produkční cestě.

| Skript | Co ověřuje |
|---|---|
| `scripts/smoke-seedance-dialogue.ts` | nativní dialog: tři české věty v uvozovkách, `generate_audio: true`, 8 s/480p, bez zákazu řeči. `--lang=en` je kontrolní vzorek |
| `scripts/smoke-seedance-audio-ref.ts` | audio reference: náš WAV z veřejné URL + „[Audio1] lip-sync". Tvar pole je odhad (`ARK_AUDIO_TYPE`), při 4xx se vypíše celé tělo chyby |
| `scripts/smoke-reel-voice.ts` | tytéž tři věty přes všech 30 hlasů do `voice-samples/` — tabulka URL a délek |

Hodnotí se poslechem, ano/ne u každého bodu:

- [ ] **Je to čeština?** Slova jsou česká, ne fonetická napodobenina.
- [ ] **Přízvuk.** Slyšet cizí přízvuk (anglický, slovanský „obecný")? Kde přesně?
- [ ] **Prozodie.** Věta má českou melodii a přízvuk na první slabice, nebo stoupá
      na konci po anglicku?
- [ ] **Diakritika a délky.** „ř", „ě", „ou", dlouhé samohlásky — přežily?
- [ ] **Přirozenost.** Zní to jako člověk v místnosti, nebo jako hlasový asistent?
- [ ] **Lip-sync.** Sedí rty na zvuk po celou dobu (ne jen první vteřinu)? Není to
      „uncanny"?
- [ ] **Konzistence.** Dva běhy stejného promptu = srovnatelný hlas, nebo pokaždé
      jiný člověk?
- [ ] **Délka a tempo.** Vejde se řeč do 8 s bez zrychlování? Kolik slov reálně?
- [ ] **Srovnání.** Je to lepší než dnešní Gemini voiceover nad obrazem? Kdyby ne,
      zůstává vypravěč a spike končí.

Rozhodovací pravidlo: **mluvící člověk jde do produktu jen tehdy, když projdou
čeština, přirozenost i lip-sync.** Falešně mluvící člověk poškodí značku víc než
vypravěč nad obrazem. Když projde jen část, zapiš ke každému bodu, co se stalo, a
vyhodnoť z toho ElevenLabs (fáze 1, bod 1) jako alternativu.

## Pořadí a odhad

| Fáze | Co | Odhad | Závislosti |
|---|---|---|---|
| 1 | ElevenLabs + hlas per značka + casting | 2–3 dny | účet ElevenLabs (Creator ≈ 22 USD/měs. stačí na start; klonování Pro), klíč |
| 2 | Scenárista na Opus 5 + hook systém + data klienta | 3–4 dny | fáze 1 kvůli srovnání |
| 3 | Textový režim + hudba; spike mluvící člověk | 2 dny + 1 den spike | licence hudby |
| 4 | Reelový kritik + zpětná vazba | 2 dny | metriky z IG |

## Rozhodnutí, která potřebujeme od zakladatelů

1. ElevenLabs: založit účet a dát klíč (a jaký plán — klonování hlasu vyžaduje vyšší).
2. Klonování hlasu majitele: ano/ne, a kdo píše text souhlasu.
3. Opus 5 na scénář: náklad ~0,15 USD/reel je přijatelný? (ano, doporučujeme)
4. Textový režim bez hlasu: chceme ho jako rovnocenný formát?
5. Hudba: koupit licencovanou knihovnu, nebo generovat?

## Scénář — co je hotové (12. 9. 2026)

Fáze 2 je nasazená. Narraci reelu už nepíše copywriter, ale **samostatný scenárista**
(`instagram/reel-scriptwriter.ts`) na **Claude Opus 5** (`models.ts` → `reelScript`,
fallback Claude Sonnet 5, pak Gemini `textPro` Pro ladder se stejným JSON schématem;
flash nikdy, `QualityUnavailableError` parkuje job). Sazba Opusu je v
`lib/model-pricing.ts` (5/25/0,50 USD za MTok, ověřeno 12. 9. 2026), odhad v
`COSTS.reelScript` = 0,15 USD/reel. Kill switch: `REEL_SCRIPTWRITER=off`.

**Co scenárista dostane:** úhel, hook a caption od copywritera, ověřená fakta
(`buildFactsSection`), živý katalog produktů (`getCatalogProducts`), popisy brandových
fotek (co reálně existuje k natočení), ukázky hlasu značky, schválené recenze, oborový
vizuální profil (`industryVisual`), rizikovou rodinu oboru (`industryRiskFamily`),
signály kontextového agenta, posledních 8 reelů (hook + vzor + naměřená síla přes
`engagementScore`) a rozpočet slov z `lib/reel-media.ts`.

**Hook systém:** `lib/hook-patterns.ts` — 10 pojmenovaných vzorů (POV, před/po, mýtus,
„3 věci", příběh zákazníka, otázka, „nikdo vám neřekne", proces, konkrétní číslo, častá
chyba), každý s návodem a ukázkami ze dvou oborů. Výběr je **vážený podle výkonu**
(`hookPatternWeights`: nevyzkoušený 2×, nadprůměrný 2×, výrazně nadprůměrný 3×, slabší
1× — táž mechanika jako `getWeightedIdeas`), s **anti-repeat** na vzory posledních tří
reelů. Zvolený vzor se ukládá do `ig_posts.design_brief.hookPattern` (reel jiný design
brief nemá) a nese se přes caption checkpoint, takže smyčka drží i po resume.

**Výstup** je JSON `{ hookPattern, hook, mode, beats[{narration|card, visual, camera,
mood, sfx}], cta, onScreenHook }`, ručně validovaný (`validateReelScript`) na známý
vzor, rozpočet slov, délku titulkové karty (≤ 2 × 18 znaků) a politiku CTA; jedno
opravné kolo jako u režiséra. Autopilot ho vkládá **po copywriterovi a před kritikem,
redakcí i faktickou bránou** — narrace prochází přesně týmiž branami jako dřív; caption
a hashtagy zůstávají copywriterovi.

**Co zatím chybí:** historie vlastního IG (`lib/ig-scraper.ts`) se do promptu nedostává —
HikerAPI se nikam neukládá (cron `growth-snapshot` bere jen počet sledujících), takže by
to byl živý placený request na každý reel; nepřímo ji zastupují `brandVoiceExamples`
seedované z top postů při onboardingu. Režim `mode: "text"` scenárista už volí, ale
orchestrátor ho zatím nezpracuje — `scriptToScenes` dočasně mapuje `card` → `narration`,
aby pipeline dojela (TODO pro R4).

## Titulky — co je hotové (12. 9. 2026)

Titulky se už nedají „odepsat" jen přegenerováním celého reelu. Po kompozici zůstává
`ig_posts.video_source` (surové MP4 ze Seedance, voiceover WAV, časová osa, karty,
`atempo`, délka, styl) a job `reel_recompose` z toho složí nové video s novými titulky
— **bez Seedance, bez TTS, za 0 kreditů**. Cover se nemění. V detailu příspěvku jde
přepsat text karet (časy sedí na řeči, a proto se needitují) a přepnout preset;
krok se ukládá do `edit_history` a jde vrátit zpět.

Vzhled titulků je nově `ClientConfig.subtitleStyle` — preset `classic | cards |
minimal`, pozice, velikost a barvy, s defaultem ve `validateConfig()`. `classic` je
dnešní vzhled, takže značka bez nastavení nic nepozná. Preset `cards` (velké písmo
v plném boxu) je zároveň to, co bude potřebovat **textový režim** z fáze 3.

## Textový režim — co je hotové (12. 9. 2026)

Fáze 3, režim B je nasazený. Když scenárista vrátí `mode: "text"`, jede reel touž
pipeline, jen **bez zvuku z naší strany**:

- **Přenos režimu.** `scriptToScenes()` nechává text karty v `scenes[].narration`
  (prochází tedy kritikem, redakcí i faktickou bránou úplně stejně jako mluvená
  věta) a přidává `textOnly: true`. Autopilot posílá `captionData.reelMode` a
  `captionData.onScreenHook` do orchestrátoru; obojí je součástí caption
  checkpointu, takže to přežije resume. Orchestrátor si režim čte **z video
  checkpointu přednostně** — resume nesmí reel přepnout uprostřed.
- **Časová osa ze čtení, ne z řeči.** `buildTextTimeline()`
  (`instagram/reel-text-timeline.ts`) — 3 slova/s čtecího tempa, minimum 1,2 s na
  kartu, týž nájezd/mezery/dojezd jako u řeči (`REEL_TIMELINE`), clamp na
  `REEL_LIMITS`. Co se nevejde, se zkracuje přes `condenseNarration` (nejvýš dvě
  kola) — zrychlit čtení nejde, takže `atempo` je vždy 1. Délku videa určuje osa,
  stejně jako u voiceoveru.
- **Žádné TTS.** Textová větev je samostatná funkce `prepareTextTimeline()` a
  guard hlídá, že v jejím těle není `synthesizeNarration` ani `COSTS.ttsVoiceover`.
- **Zvuk dodává Seedance.** Režisér dostane osu jako karty (ne repliky) a
  instrukci „no narration; the on-screen text cards carry the message"; prompt si
  říká o **nativní hudbu a atmosféru podle nálady** (`audioMood`). Text v obraze
  zůstává zakázaný — karty vypaluje náš ASS engine. `composeReel` běží bez
  `voiceoverWav` (loudnorm, žádný sidechain) a `ambientLevel` jede na 1,0 místo
  0,6, protože není co potlačovat.
- **Titulky.** Výchozí preset textového reelu je `cards` (velké písmo v boxu) —
  přepíše se jen globální default `classic`, vlastní volba značky platí dál.
  `onScreenHook` je první karta. `video_source.mode = "text"`, `voiceoverPath`
  chybí, a rekompozice (`reel_recompose`, 0 kreditů) s tím počítá.
- **Cena se nemění.** Textový reel stojí tolik co mluvený (5 / 10 kreditů); levnější
  je jen pro nás — chybí TTS. V detailu reelu ho značí štítek „Textový reel (bez hlasu)".
- **Povolení.** `ClientConfig.reelModes` (default **obojí** ve `validateConfig()`,
  přepínač „Povolit reely bez hlasu" v Nastavení) se propisuje do promptu
  scenáristy i do validátoru: zakázaný režim se vůbec nenabídne.

**Otevřená otázka zůstává hudba.** Zatím je to jen to, co vygeneruje Seedance —
atmosféra a podkres, ne skladba, a nemáme nad tím kontrolu ani licenční papír na
konkrétní track. Licencovaná knihovna (vlastní tracky v bucketu vybírané podle
nálady) nebo generativní hudba je pořád nerozhodnutá — viz „Rozhodnutí, která
potřebujeme od zakladatelů", bod 5.

Co zůstává nehotové (fáze 3): hudba jako licencovaný podklad a režim C (mluvící
člověk).

## Co se NEMĚNÍ

Audio-first pořadí (délka videa z řeči), checkpointy a parkování, titulky v kódu,
faktická brána nad narrací, `getModel()` jako jediný zdroj ID modelů, Pro→Pro
fallbacky. Nová služba se do toho zapojuje jako poskytovatel, ne jako obchvat.
