-- Pátý auto-tier: `transactional`
-- ================================
-- Odchozí pošta zákazníkovi se dosud dělila jen na „outbound" (čeká na člověka).
-- Jenže faktická oznámení — blíží se stržení, platba selhala, předplatné končí,
-- naplánovaný příspěvek nevyšel — se zadržet NESMÍ: zadržet je je horší než je
-- poslat. Billing-worker to dosud řešil tím, že `requestAction` úplně obešel,
-- takže po dunning e-mailech nezůstával žádný audit řádek — a bez něj není
-- dedupe klíč („neposílej dvakrát") ani zdroj pro sekci ranního briefu
-- „co jsem udělal sám".
--
-- Dělicí čára:
--   transactional = pevná šablona + fakt, který nastal nebo je smluvně jistý
--   outbound      = cokoli, co přemlouvá (pobídka, winback, drip) → čeká
--
-- `outbound` se z ručení člověka NIKDY nesmí vyjmout; hlídá to `npm run guard`.

ALTER TABLE agent_actions DROP CONSTRAINT IF EXISTS agent_actions_risk_tier_check;

ALTER TABLE agent_actions ADD CONSTRAINT agent_actions_risk_tier_check
  CHECK (risk_tier IN ('reversible', 'internal', 'transactional', 'outbound', 'spending', 'irreversible'));

COMMENT ON COLUMN agent_actions.risk_tier IS
  'reversible|internal|transactional běží samy; outbound|spending|irreversible čekají na schválení člověkem.';
