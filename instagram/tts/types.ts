/**
 * Rozhraní poskytovatele TTS.
 * ===========================
 * Jediný kontrakt mezi reelovou pipeline a tím, kdo mluví. Reel se staví od zvuku
 * (`instagram/reel-audio.ts`): délku videa určuje naměřená řeč, takže poskytovatel
 * musí vrátit **hotový WAV** — ne PCM, ne MP3, ne URL. `wavInfo()` z něj čte délku
 * bez ffmpegu a `assembleVoiceoverWav()` klipy slepuje; cokoli jiného než RIFF/WAVE
 * by tuhle cestu rozbilo (přesně to dělal Gemini, než se hlavička začala dolepovat).
 *
 * Tvar rozhraní je schválně chudý: žádné modely, žádné retry, žádné účtování —
 * to všechno si řeší implementace uvnitř, protože se poskytovatel od poskytovatele
 * liší. Nahoru jde jen „tenhle text, tímhle hlasem, v jazyce značky".
 */

import type { TtsProviderId } from "../../lib/voice-library"
import type { ContentLanguage } from "../language"

export type { TtsProviderId }

export interface TtsSynthesizeOptions {
    /** ID hlasu v katalogu poskytovatele (`lib/voice-library.ts`). */
    voiceId: string
    /** Volitelný styl přednesu značky („klidně a věcně") — konstantní přes celý reel. */
    style?: string
    /** Tagy přednesu pro tuhle větu (`instagram/tts/delivery.ts`), např. ["warm"]. */
    tags?: string[]
    /** Jazyk textu = jazyk značky (`ClientConfig.language`). Poskytovatel, který jazyk
     *  neumí přijmout jako parametr (Gemini, ElevenLabs v3), si ho odvodí z textu —
     *  ale pole je povinné, aby volající musel vědět, čím značka mluví. */
    language: ContentLanguage
}

export interface TtsProvider {
    readonly id: TtsProviderId
    /** Vrací přehratelný WAV (RIFF/WAVE). Vyhazuje, když se nepovedlo ani s fallbackem —
     *  volající to překlápí na `QualityUnavailableError` a job PARKUJE, nedodá reel bez hlasu. */
    synthesize(text: string, opts: TtsSynthesizeOptions): Promise<Buffer>
}
