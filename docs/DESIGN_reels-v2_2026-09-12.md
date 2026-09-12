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

## Co se NEMĚNÍ

Audio-first pořadí (délka videa z řeči), checkpointy a parkování, titulky v kódu,
faktická brána nad narrací, `getModel()` jako jediný zdroj ID modelů, Pro→Pro
fallbacky. Nová služba se do toho zapojuje jako poskytovatel, ne jako obchvat.
