-- Ukázková kampaň smí vzniknout jen jednou na klienta
-- ═══════════════════════════════════════════════════════════════════════════
-- PROBLÉM
--
-- `startOnboardingBootstrap()` (app/onboarding/actions.ts) zakládá kampaň
-- s `options.adminBypass = true`, tedy tři plnohodnotné příspěvky, které se
-- NEÚČTUJÍ — worker u nich přeskočí kontrolu kreditů i odpočet. To je správně
-- pro první tři příspěvky po onboardingu; ty prodávají.
--
-- Je to ale exportovaná server action chráněná jen `requireProjectAccess()`.
-- Kdo vlastní projekt, může ji zavolat kolikrát chce, a pokaždé dostane tři
-- příspěvky za 23–55 Kč naší útraty u Googlu. Denní strop onboardingů
-- (`ONBOARDING_DAILY_CAP`) sedí na úkolu `onboarding_analyze`, tedy na VSTUPU
-- do průvodce — tuhle cestu nehlídá vůbec.
--
-- OPRAVA
--
-- Jedinečnost se vynucuje v databázi, ne v `if`u před insertem: souběžná dvě
-- volání by kontrolu „už nějakou má?" prošla obě. Aplikace konflikt (23505)
-- čte jako „už je hotovo" a vrací existující kampaň.
--
-- Bezpečné opakovaně. Duplicity v datech k 10. 9. 2026 nejsou (4 kampaně,
-- 4 klienti), takže index projde bez čištění.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS ux_ig_campaigns_showcase
    ON ig_campaigns (client_id)
    WHERE (options->>'showcase') = 'true';

COMMENT ON INDEX ux_ig_campaigns_showcase IS
  'Jedna ukázková (neúčtovaná) kampaň na klienta — brání opakovanému volání startOnboardingBootstrap.';
