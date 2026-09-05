-- Telegramový kanál: paměť skupinové konverzace
-- ═══════════════════════════════════════════════════════════════════════════
-- Agent ve skupině (zakladatel + manažer + investor + bot) potřebuje tři věci,
-- které z Bot API samotného nedostane:
--
--  1. **Kontext.** Telegram doručí JEDNU zprávu bez historie. Bez uložených
--     předchozích zpráv by agent na „a kolik to bylo minulý týden?" odpovídal
--     do prázdna.
--  2. **Dedupe.** Když webhook neodpoví do timeoutu, Telegram tentýž update
--     pošle znovu. `update_id` je unikátní klíč — druhý průchod se zahodí,
--     místo aby agent odpověděl dvakrát (nebo dvakrát schválil).
--  3. **Doklad.** Ze skupiny se dá schvalovat reálná práce. Kdo co řekl a kdy
--     musí zůstat i po tom, co někdo v Telegramu zprávu smaže.
--
-- Spustit v SQL editoru Supabase / přes Management API query endpoint,
-- NIKDY `db push`. Bezpečné opakovaně.

CREATE TABLE IF NOT EXISTS telegram_messages (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Telegramovo pořadové číslo updatu. UNIQUE = celý dedupe; zápis řádku je
    -- zároveň claim na zpracování (viz „podmíněný claim" v CLAUDE.md).
    update_id    bigint NOT NULL UNIQUE,

    chat_id      bigint NOT NULL,
    message_id   bigint,

    -- Kdo mluvil. NULL u zpráv, které poslal bot sám.
    tg_user_id   bigint,
    -- Jméno a role se ukládají TAK, JAK PLATILY V TU CHVÍLI. Když se složení
    -- týmu změní, starý zápis nesmí zpětně přepsat, kdo tehdy co schválil.
    author       text,
    team_role    text,

    is_bot       boolean NOT NULL DEFAULT false,
    text         text,

    -- Odpověděl na tuhle zprávu agent? Krmí to rate limit „nebuď ukecaný"
    -- a je z toho vidět, kolik nevyžádaných vstupů agent za den udělal.
    replied      boolean NOT NULL DEFAULT false,
    reply_reason text,

    created_at   timestamptz NOT NULL DEFAULT now()
);

-- Načítání kontextu je vždy „posledních N v tomhle chatu".
CREATE INDEX IF NOT EXISTS telegram_messages_chat_time
    ON telegram_messages (chat_id, created_at DESC);

-- Rate limit se ptá „kdy agent naposled promluvil sám od sebe".
CREATE INDEX IF NOT EXISTS telegram_messages_bot_time
    ON telegram_messages (chat_id, is_bot, created_at DESC);

-- Doktrína projektu: RLS zapnuté, ŽÁDNÉ policy = deny-all. Čte a zapisuje jen
-- service role přes supabase/admin.ts. Tahle tabulka drží interní firemní
-- konverzaci tří lidí — je to nejcitlivější obsah v DB po `leads`.
ALTER TABLE telegram_messages ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE telegram_messages IS
  'Paměť + audit skupinového kanálu (zakladatel/manažer/investor + agent). update_id UNIQUE = dedupe Telegramových retryů. RLS deny-all — jen service role.';
COMMENT ON COLUMN telegram_messages.team_role IS
  'Role v době zápisu, ne dnešní. Doklad o tom, kdo směl schvalovat tehdy.';
