-- Finální CTA na landingu — z „waitlistu" se stal kontakt pro obchod
-- ==================================================================
-- Tabulka se pořád jmenuje `waitlist`, protože na ní visí pozvánkový agent
-- (`lib/agents/waitlist-invite.ts`), admin sekce i mailingový segment.
-- Přejmenovat ji kvůli textu na tlačítku by znamenalo sáhnout na všechny tři
-- kvůli ničemu. Co se změnilo, je SLIB: dřív „dáme vědět, až otevřeme",
-- teď „ozveme se vám". Na to potřebuje obchod čím zavolat a čím se ozvat.
--
-- `contacted_at` je tu proto, že 8. 9. 2026 čekalo v tabulce šest skutečných
-- lidí — nejstarší od 18. 5. — a nikdo z nich neměl v datech stopu, že se mu
-- někdo ozval. Bez razítka nejde poznat vyřízený kontakt od zapomenutého,
-- takže ranní brief nemá co hlídat.

ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ;
-- `invited_at` v migracích nikdy nebylo, přestože v produkci žije a čte ho
-- pozvánkový agent. Doplněno, ať adresář migrací nelže.
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;

-- Fronta pro ranní brief: kdo zvedl ruku a ještě se mu nikdo neozval,
-- nejdéle čekající první.
CREATE INDEX IF NOT EXISTS waitlist_neosloveni_idx
    ON waitlist(created_at)
    WHERE contacted_at IS NULL AND invited_at IS NULL;

COMMENT ON TABLE waitlist IS 'Zájemci z landingu. Historický název; od 9/2026 je to kontakt pro obchod, ne pořadník.';
COMMENT ON COLUMN waitlist.contacted_at IS 'Kdy se člověku někdo ozval. NULL = pořád čeká, hlásí ranní brief.';
