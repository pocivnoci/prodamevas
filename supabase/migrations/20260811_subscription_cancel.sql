-- Zákazník musí mít jak odejít
-- ============================
-- Dosud neexistovala žádná cesta, jak předplatné zrušit. Jediný způsob, jak
-- odejít, bylo nechat kartu selhat — což (a) trvá tři dny dunningu a pošle
-- zákazníkovi tři e-maily o „selhané platbě", které nikdo nechtěl, a (b) navždy
-- znemožní odlišit dobrovolný odchod od problému s kartou. Každá metrika retence
-- postavená nad takovými daty lže.
--
-- Proč BOOLEAN a ne `status = 'cancelled'`:
-- `getClientSubscription` selectuje jen `('active','trialing','pending','expired')`.
-- Přepnutí na `cancelled` by zaplacenému zákazníkovi sebralo přístup OKAMŽITĚ,
-- uprostřed období, které si zaplatil. Předplatné proto zůstává `active`, jen je
-- označené jako „na konci období skonči"; billing-worker ho pak místo strhnutí
-- nechá doběhnout a označí `expired`.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN subscriptions.cancel_at_period_end IS
  'Zákazník vypověděl: běží do current_period_end, pak expired. Nikdy nestrhávat.';

-- Denní běh billing-workeru hledá splatná předplatná; výpovědi jsou mezi nimi.
CREATE INDEX IF NOT EXISTS idx_subscriptions_cancel_pending
  ON subscriptions(current_period_end)
  WHERE cancel_at_period_end = TRUE;
