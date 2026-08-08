-- Doklad, který se ZÁMĚRNĚ nevystavil, není selhání.
-- =================================================
-- Testovací a sandboxové platby nesmí sahat na ostrou číselnou řadu Fakturoidu
-- (je nevratná — duplicitu jde jen stornovat). Dosud takový případ skončil jako
-- status='failed', tedy ve stejné frontě jako doklad, který se vystavit MĚL
-- a nepovedlo se to — a tu frontu někdo ručně řeší. Tím se pravé selhání
-- utopilo v testovacím šumu.
--
-- 'skipped' = nárok na doklad je zabraný (unikátní index na payment_id drží dál,
-- takže tatáž platba nemůže doklad dostat později omylem podruhé), ale k
-- poskytovateli se vědomě nešlo. Důvod je v `error`.

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('pending', 'issued', 'failed', 'skipped'));

-- Fronta „doklad chybí a někdo to musí spravit" se nesmí plnit testy.
DROP INDEX IF EXISTS idx_invoices_failed;
CREATE INDEX IF NOT EXISTS idx_invoices_failed
  ON invoices (updated_at DESC) WHERE status = 'failed';

COMMENT ON COLUMN invoices.status IS
  'pending = nárok zabrán, vystavuje se | issued = doklad existuje | failed = mělo se vystavit a nepovedlo se (řeší člověk) | skipped = záměrně se nevystavovalo (test/sandbox/nekonfigurováno)';
