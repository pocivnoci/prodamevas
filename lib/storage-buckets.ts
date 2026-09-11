/**
 * Klientské buckety (`ig-posts-<slug>`) — co v nich smí ležet.
 * ===========================================================
 * Bucket nese celý příspěvek: obrázky, hotový reel (MP4) i dočasnou voiceover stopu
 * (WAV), kterou reelová pipeline nahrává PŘED zadáním videa, aby přežila parkování jobu.
 * Buckety zakládané jen s obrázkovými typy shodily živý test reelu 11. 9. 2026 na
 * „mime type audio/wav is not supported" — u všech značek, ne u jedné.
 */
export const CLIENT_BUCKET_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "video/mp4", "audio/wav"]

/** 50 MB — dvacetivteřinový reel v 480p má kolem 9 MB; 10 MB by byl strop na hraně. */
export const CLIENT_BUCKET_SIZE_LIMIT = 50 * 1024 * 1024
