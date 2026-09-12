-- ═══════════════════════════════════════════════════════════════
-- Migration: zdrojové artefakty reelu (`ig_posts.video_source`)
-- ═══════════════════════════════════════════════════════════════
-- Titulky reelu jsou VYPÁLENÉ do videa — Instagram Graph API bere u reelu jen
-- `video_url` + `caption` + `cover_url`, žádnou titulkovou stopu. „Upravit
-- titulek" tedy znamená složit kompozici znovu. Do 9/2026 to nešlo vůbec:
--
--   • surové video ze Seedance drží orchestrátor jen jako Buffer v paměti,
--   • voiceover WAV se po kompozici z bucketu mazal,
--   • časová osa (věty + časy) žila jen ve `VideoCheckpoint`
--     (`ig_jobs.result.checkpoint.video`), který úspěšný job přepsal výsledkem.
--
-- Po pádu lambdy tak po reelu nezbylo nic, z čeho by se dal znovu vyrenderovat.
-- Jediná oprava překlepu v titulku pak stála celý reel znovu (5–10 kreditů,
-- nové Seedance video, nový voiceover) a vrátila JINÉ video.
--
--   PŘED   ig_posts: image_url = "video|cover", jinak nic; raw MP4 zahozené, WAV smazaný
--   PO     ig_posts: + video_source jsonb — kde leží raw MP4 a voiceover WAV,
--          jaká byla časová osa, karty, tempo a styl titulků
--          → job `reel_recompose` přerenderuje titulky za 0 kreditů,
--            bez volání Seedance i bez TTS (`instagram/reel-recompose.ts`)
--
-- Tvar (TypeScript `ReelVideoSource` v lib/types/database.ts — tam je zdroj pravdy):
--   { bucket, rawVideoPath, voiceoverPath, timeline: [{text,start,end}],
--     cards: [{text,start,end}], atempo, durationSeconds,
--     subtitleStyle: {preset,position,size,color,accent}, storyboard, mode }
--
-- NULL = reel vyrobený před touhle migrací (nebo surové video nad kvótou
-- bucketu). Takový reel se přerenderovat NEDÁ a UI to musí říct nahlas —
-- backfill neexistuje, ta data jsou nenávratně pryč.
--
-- Run: Supabase Management API / SQL editor. Bezpečné re-run (IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE ig_posts ADD COLUMN IF NOT EXISTS video_source jsonb;

COMMENT ON COLUMN ig_posts.video_source IS
  'Zdrojové artefakty reelu pro přerenderování titulků bez nového videa: cesty na surové MP4 ze Seedance a na voiceover WAV v bucketu značky, časová osa vět, titulkové karty, atempo, délka, styl titulků a storyboard. Plní reel-orchestrator po úspěšné kompozici, čte job reel_recompose (0 kreditů, žádné volání modelu). NULL = reel před 9/2026 nebo surové video nad kvótou bucketu — takový reel jde jen vygenerovat znovu.';

-- Částečný index: jediný dotaz nad sloupcem je „má tenhle reel z čeho
-- přerenderovat?" u řádků, které zdroj mají. Obrázkové posty (drtivá většina
-- tabulky) do indexu nepatří.
CREATE INDEX IF NOT EXISTS idx_ig_posts_video_source
  ON ig_posts (client_id, created_at DESC)
  WHERE video_source IS NOT NULL;
