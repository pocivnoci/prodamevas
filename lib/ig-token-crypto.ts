/**
 * IG access-token encryption at rest (AES-256-GCM).
 * ==================================================
 * Instagram long-lived tokens are credentials — they live in the ig_connections
 * table encrypted, never in plaintext and never in clients.config JSONB.
 *
 * Key: process.env.IG_TOKEN_ENCRYPTION_KEY — a 32-byte key, hex (64 chars) or
 * base64. Generate one with:  openssl rand -hex 32
 *
 * Format on disk: "iv:authTag:ciphertext" (all base64). The 96-bit IV is random
 * per encryption, so the same token encrypts to different ciphertexts each time.
 */

import crypto from "crypto"

const ALGO = "aes-256-gcm"
const IV_BYTES = 12 // 96-bit nonce, the GCM standard

/** Resolve and validate the 32-byte key from env (hex or base64). Throws if bad. */
function getKey(): Buffer {
    const raw = process.env.IG_TOKEN_ENCRYPTION_KEY
    if (!raw) {
        throw new Error(
            "IG_TOKEN_ENCRYPTION_KEY není nastavený — nelze šifrovat IG tokeny. Vygeneruj: openssl rand -hex 32",
        )
    }
    // Accept hex (64 chars) or base64; both must decode to exactly 32 bytes.
    let key: Buffer
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
        key = Buffer.from(raw, "hex")
    } else {
        key = Buffer.from(raw, "base64")
    }
    if (key.length !== 32) {
        throw new Error(
            `IG_TOKEN_ENCRYPTION_KEY musí být 32 bajtů (256 bitů); dekódováno ${key.length} bajtů. Použij: openssl rand -hex 32`,
        )
    }
    return key
}

/** Encrypt a plaintext token → "iv:authTag:ciphertext" (base64 parts). */
export function encryptToken(plain: string): string {
    const key = getKey()
    const iv = crypto.randomBytes(IV_BYTES)
    const cipher = crypto.createCipheriv(ALGO, key, iv)
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
    const authTag = cipher.getAuthTag()
    return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":")
}

/** Decrypt a "iv:authTag:ciphertext" string back to the plaintext token. */
export function decryptToken(stored: string): string {
    const key = getKey()
    const parts = stored.split(":")
    if (parts.length !== 3) {
        throw new Error("Neplatný formát zašifrovaného tokenu (očekáváno iv:authTag:ciphertext).")
    }
    const [ivB64, tagB64, dataB64] = parts
    const iv = Buffer.from(ivB64, "base64")
    const authTag = Buffer.from(tagB64, "base64")
    const ciphertext = Buffer.from(dataB64, "base64")
    const decipher = crypto.createDecipheriv(ALGO, key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}
