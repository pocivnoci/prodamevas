-- Zhlédnutí příspěvku.
--
-- Adaptéry ho čtou už dnes (ChannelMetrics.views; upload-post ho vrací pro každý
-- příspěvek), ale nebylo kam ho uložit, takže se tiše zahazovalo. U statického
-- příspěvku to nevadilo; u reelu jsou zhlédnutí HLAVNÍ metrika, takže bez tohohle
-- sloupce by se reely nedaly poměřovat vůbec.
--
-- Meta přejmenovala `impressions` na `views`; držíme jedno pole, ne obojí.
--
-- Aditivní a bezpečné. Spustit přes Management API query endpoint, ne `db push`.

ALTER TABLE ig_posts
  ADD COLUMN IF NOT EXISTS views INTEGER;

COMMENT ON COLUMN ig_posts.views IS
  'Zhlédnutí příspěvku (Meta: views, dříve impressions). Do performance_score záměrně NEVSTUPUJE — je to veličina o řád jinde než lajky a sečtením by skóre přebila.';
