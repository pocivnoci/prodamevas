-- Výkon produktů (zpětná vazba pro výběr produktu)
-- =================================================
-- Uzavírá invariant z CLAUDE.md pro POSLEDNÍ zdroj obsahu bez zpětné vazby:
-- „nový zdroj obsahu potřebuje performance_score + váženou selekci". Nápady,
-- recenze i formáty ho měly; produkty — jediný zdroj, jehož posty přímo
-- vedou na link_clicks — se vybíraly náhodně z pěti nejdéle nepoužitých
-- (autopilot: `candidates[Math.floor(Math.random() * 3)]`). `ig_posts.product_id`
-- přitom vazbu nesl od začátku a `propagateMetricsToSources` ho jen nečetl.
--
-- Stejný tvar jako 20260718_format_feedback.sql: průměr engagementu postů
-- s produktem, počet měřených použití. Píše `propagateMetricsToSources()`,
-- čte vážený výběr produktu v `instagram/autopilot.ts`.
--
-- Kód je na chybějící sloupce připravený (zápis i čtení skóre jsou best-effort
-- s varováním v logu), takže nasazení kódu před migrací nic nerozbije — jen se
-- produkty dál vybírají bez váhy, a v logu je proč.

ALTER TABLE ig_products ADD COLUMN IF NOT EXISTS performance_score numeric;
ALTER TABLE ig_products ADD COLUMN IF NOT EXISTS times_used_with_metrics integer DEFAULT 0;

COMMENT ON COLUMN ig_products.performance_score IS
    'Průměrný engagement postů s tímto produktem (likes + 3×comments + 5×saves); píše propagateMetricsToSources()';
COMMENT ON COLUMN ig_products.times_used_with_metrics IS
    'Kolik postů s metrikami do průměru vstoupilo; výběr produktu skóre váží až od 2';
