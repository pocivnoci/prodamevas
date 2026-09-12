/**
 * PCM → WAV: jedna hlavička pro všechny poskytovatele.
 * ====================================================
 * Poskytovatel TTS musí vrátit hotový WAV (`types.ts`), jenže modely vracejí holé
 * PCM: Gemini `audio/L16;rate=24000`, ElevenLabs `pcm_24000`. Hlavička se do
 * 12. 9. 2026 skládala dvakrát (gemini-client a reel-audio) — dvě kopie se dřív
 * nebo později rozejdou (třeba v `byteRate`) a vadný WAV odmítne až ffmpeg při
 * kompozici, po zaplacení videa. Proto jediné místo, bez závislostí, aby ho mohl
 * importovat poskytovatel i `reel-audio.ts` bez kruhového importu.
 */

/** Holé 16bit PCM → přehratelný WAV (RIFF/WAVE, 44bajtová hlavička). */
export function pcmToWav(pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
    const blockAlign = (channels * bitsPerSample) / 8
    const header = Buffer.alloc(44)
    header.write("RIFF", 0, "latin1")
    header.writeUInt32LE(36 + pcm.length, 4)
    header.write("WAVE", 8, "latin1")
    header.write("fmt ", 12, "latin1")
    header.writeUInt32LE(16, 16)          // délka fmt bloku
    header.writeUInt16LE(1, 20)           // 1 = nekomprimované PCM
    header.writeUInt16LE(channels, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(sampleRate * blockAlign, 28)
    header.writeUInt16LE(blockAlign, 32)
    header.writeUInt16LE(bitsPerSample, 34)
    header.write("data", 36, "latin1")
    header.writeUInt32LE(pcm.length, 40)
    return Buffer.concat([header, pcm])
}
