-- Dokoupení kreditů
-- =================
-- Aplikace na čtyřech místech slibovala „dobijte si kredity za 49 Kč/ks",
-- ale cesta k nákupu neexistovala — platební routa uměla jen tarif. Slib, který
-- se nedá splnit, přichází přesně ve chvíli, kdy je zákazník zablokovaný
-- uprostřed práce a nejochotnější zaplatit.
--
-- Třetí druh platby vedle předplatného a služby. Rozlišení je nutné: každý
-- z nich dělá po zaplacení něco úplně jiného, ale doklad vzniká u všech stejně.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_kind_chk;
ALTER TABLE payments ADD CONSTRAINT payments_kind_chk
    CHECK (kind IN ('subscription', 'service', 'credits'));

-- Kolik kreditů platba koupila. Neodvozuje se z částky: ceník se může změnit
-- a doklad i připsané množství musí sedět s tím, co si zákazník tehdy koupil.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS credits_granted INTEGER;

-- Dobití je v účetní knize ZÁPORNÝ řádek s vlastní akcí. Vlastní akce je
-- podstatná: `getCreditsUsedThisPeriod` ořezává součet na nulu (aby refundace
-- nevyrobila zápornou spotřebu), takže kdyby se dobití počítalo jako spotřeba,
-- **přebytek nad měsíční příděl by se tiše ztratil** — vzali bychom peníze
-- a dali míň, než si člověk koupil. Proto se dobití sčítá zvlášť a přičítá
-- se k přídělu, ne odečítá od spotřeby.
--
-- Idempotenci drží `ux_credit_transactions_action_ref` (action, reference_id):
-- reference_id = id platby, takže replay webhooku kredity nepřipíše dvakrát.
COMMENT ON TABLE credit_transactions IS
    'Účetní kniha kreditů. Kladné = spotřeba, záporné = refundace (action jako u spotřeby) nebo dobití (action = credit_topup, sčítá se zvlášť).';
