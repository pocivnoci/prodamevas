# Instagram propojení — kompletní setup od nuly (chrlit dogfood)

Krok-za-krokem návod, jak rozjet propojení Instagramu pro **vlastní účet chrlit** od čistého stolu (nový Meta účet na `info@chrlit.cz`). Po dokončení poběží: **stahování metrik** (learning loop) a **publikování** — 📲 handoff i **auto-publish** (cron sám postuje naplánované image/carousel posty).

> **Dobrá zpráva:** protože je to **náš vlastní** účet, **nepotřebuješ App Review ani Business Verification**. Ty řeší jen čtení *cizích* (tenant) účtů. Vlastní účet funguje pod **Standard Access** hned, jakmile appka existuje a účet je přidán jako tester. Celé je to ~30–45 min jednorázové práce.

**Legenda:** ⚠️ = jen ty, v Meta dashboardu (nemůžu za tebe) · 💻 = kód/env (umím i já) · ✅ = ověření

---

## Co budeš na konci mít

- Meta appku „Instagram API with Instagram login" vlastněnou pod `info@chrlit.cz`.
- 3 env proměnné nastavené (`META_APP_ID`, `META_APP_SECRET`, `IG_TOKEN_ENCRYPTION_KEY`).
- IG účet `@chrlit` (Business/Creator) přidaný jako tester a propojený přes Nastavení → Připojit Instagram.
- Funkční tlačítko **🔄 Načíst metriky z Instagramu** ve Výkonu + publikování.

---

## Část 1 — Meta účet + Business portfolio ⚠️

1. **Vytvoř Facebook účet** na `info@chrlit.cz` → [facebook.com](https://facebook.com) (Meta for Developers vyžaduje FB login; IG účet sám o sobě nestačí na *vytvoření* appky).
   - ⚠️ *Tip:* čerstvý FB účet Meta občas flagne. Pokud appku jen dogfoodíš, zvaž použít existující důvěryhodný FB účet jako admina appky a `info@chrlit.cz` přidat později. Ale fresh start na `info@chrlit.cz` jde taky — jen účet po vytvoření „zahřej" (potvrď e-mail, telefon).
2. **Potvrď e-mail a přidej telefon** (Meta často chce 2FA u dev účtů).
3. **Vytvoř Business portfolio** → [business.facebook.com](https://business.facebook.com) → *Create a business portfolio* → název „Chrlit", e-mail `info@chrlit.cz`.
   - ⚠️ Pokud tě to tlačí do **Business Verification**, teď to **přeskoč** (Later/Skip) — je potřeba až pro cizí účty (Advanced Access), ne pro vlastní dogfood.

## Část 2 — IG účet @chrlit musí být Business/Creator ⚠️

Osobní IG účty **nečtou insights**, tečka. Převeď `@chrlit` na profesionální:

1. Instagram app → Nastavení → **Účet** → *Přepnout na profesionální účet* → **Business** (nebo Creator).
2. ✅ Hotovo, když v profilu vidíš „Profesionální dashboard" / Insights.

> Facebook Page **není potřeba** — používáme „Instagram API **with Instagram Login**", což běží bez propojené stránky.

## Část 3 — Vytvoř Meta appku ⚠️

1. [developers.facebook.com](https://developers.facebook.com) → přihlas se FB účtem z Části 1 → *My Apps* → **Create App**.
2. Typ appky: **Business**.
3. Po vytvoření přidej produkt **Instagram** → vyber **„Instagram API setup with Instagram login"** (NE „with Facebook login").
4. Appka zůstane v **Development mode** — to je správně, Standard Access stačí na vlastní/tester účty.

> ⚠️ Meta dashboard svoje menu často mění. Pokud se popisky liší, drž se konceptu a oficiálních docs:
> [Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/).

## Část 4 — OAuth redirect URI ⚠️

V appce → **Instagram → API setup with Instagram login → Business login settings** (nebo „OAuth settings"):

1. Do **Valid OAuth Redirect URIs** vlož **přesně**:
   ```
   https://<TVUJ-PROD-DOMAIN>/api/ig-connect/callback
   ```
   - `<TVUJ-PROD-DOMAIN>` = hodnota `NEXT_PUBLIC_SITE_URL` (musí sedět **na znak**, jen HTTPS, žádný localhost).
   - 💻 Pošli mi prod doménu a vrátím ti přesnou URL k vložení.
2. Ulož.

## Část 5 — App ID + App Secret → env proměnné 💻

1. ⚠️ V appce → **App settings → Basic**: zkopíruj **App ID** a **App Secret** (Secret je za „Show").
2. 💻 Vygeneruj šifrovací klíč (běž v promptu přes `!`, ať secret zůstane u tebe):
   ```
   ! openssl rand -hex 32
   ```
3. 💻 Nastav **3 proměnné** na **dvou místech** (stejné hodnoty!):

   **a) Vercel** (Production + Preview): Vercel projekt → Settings → Environment Variables:
   | Klíč | Hodnota |
   |------|---------|
   | `META_APP_ID` | App ID z kroku 1 |
   | `META_APP_SECRET` | App Secret z kroku 1 |
   | `IG_TOKEN_ENCRYPTION_KEY` | hex z kroku 2 |

   **b) Lokálně** `.env.local` (pro `npm run dev`): stejné tři řádky.
   - ⚠️ `IG_TOKEN_ENCRYPTION_KEY` musí být **identický** lokálně i na Vercelu — jinak token zašifrovaný jedním klíčem nepůjde druhým dešifrovat.
4. Po nastavení na Vercelu **redeploy** (env se propíše až novým buildem).

## Část 6 — Přidej @chrlit jako Instagram testera ⚠️

Aby šel účet propojit pod Standard Access (bez App Review):

1. V appce → **App roles → Roles** (nebo přímo panel „Instagram API setup") → přidej **Instagram Tester** → zadej `@chrlit`.
2. V **Instagram appce** (`@chrlit`) → Nastavení → **Aplikace a weby** → **Pozvánky pro testery** → **Přijmout**.
3. ✅ Hotovo, když je tester ve stavu *Accepted*.

## Část 7 — DB migrace 💻✅

Tabulka `ig_connections` musí existovat:

1. Spusť migraci `supabase/migrations/20260619_ig_connections.sql` (přes tvůj Supabase setup — Management API query endpoint, ne `db push`).
2. ✅ Ověř: tabulka `ig_connections` existuje, RLS **zapnuté bez policies** (deny-all → jen service-role).
   - 💻 Tohle ti umím ověřit/spustit — řekni.

## Část 8 — Propoj účet ✅

> OAuth potřebuje HTTPS redirect → dělej to na **nasazené** (prod) appce, ne localhostu. Connect flow je už v produkci (z Keystone).

1. Dashboard → **Nastavení → Připojit Instagram** → autorizuj na Instagramu.
2. ✅ Vrátíš se zpět a vidíš `@chrlit` + expiraci (~60 dní).
3. ✅ V Supabase je jeden řádek `ig_connections`: `access_token` je **šifrotext** (tvar `iv:tag:data`, ne čitelný token), `status=connected`.

## Část 9 — Vyzkoušej to ✅

- **Metriky:** Dashboard → **Výkon** → **🔄 Načíst metriky z Instagramu** → zkontroluj počty `synced`/`matched` a že u publikovaných postů naskočily likes/saves/reach.
  - Nebo cron napřímo: `curl -H "Authorization: Bearer $CRON_SECRET" https://<prod-domain>/api/cron/ig-metrics-sync`
- **Publikování (hned):** Příspěvky → **📲 Publikovat na Instagram** (viz `docs/POSTING_GUIDE.md`).

---

## Co funguje hned vs. co chce navíc

| Funkce | Scope | Stav po tomto návodu |
|--------|-------|----------------------|
| **Stahování metrik** (learning loop) | `instagram_business_manage_insights` | ✅ Funguje (scope se už žádá v OAuth) |
| **Ruční publikace** (📲 handoff) | žádný | ✅ Funguje (jen sdílení + schránka) |
| **Auto-publish** (cron postuje sám) | `instagram_business_content_publish` | ✅ Scope **už je v OAuth requestu** → pro vlastní účet funguje pod Standard Access (propoj + naplánuj post přes `schedulePostAction`, `ig-publisher` cron ho vydá). Reels zatím ne (image+carousel). Pro **cizí** účty = 2. App Review před spuštěním Live. |

## Co tohle NEodemyká (až později, pro klienty)

- **Business Verification + App Review** — jen pro čtení/publikování na **cizích** (tenant) účtech (Advanced Access). Plán: `docs/META_APP_REVIEW_PLAN.md`.
- Privacy Policy (`/privacy` §10) + data-deletion endpoint jsou už hotové (pro tu pozdější submission).

## Troubleshooting

| Problém | Příčina / fix |
|---------|---------------|
| Tlačítko „Připojit Instagram" je šedé | `META_APP_ID`/`META_APP_SECRET` nejsou nastavené (nebo není redeploy). |
| `Invalid platform app` / redirect error | Redirect URI v Metě **nesedí přesně** s `NEXT_PUBLIC_SITE_URL` + `/api/ig-connect/callback`. |
| Po autorizaci `?ig=error` | Špatný App Secret, nebo IG účet není tester/Business. Zkontroluj Část 2 a 6. |
| `synced: 0` i po propojení | Účet nemá publikované posty, NEBO posty se nespárovaly (caption se neshoduje) → manuální zadání zůstává jako fallback. |
| Insights prázdné | IG účet je osobní (ne Business/Creator), nebo příliš čerstvý post (insights mají zpoždění). |
| Token nejde dešifrovat | `IG_TOKEN_ENCRYPTION_KEY` se liší mezi lokálem a Vercelem → sjednoť a propoj znovu. |

---

**Reference:** `docs/KEYSTONE_NEXT_STEPS.md` (původní setup), `docs/META_APP_REVIEW_PLAN.md` (App Review pro klienty), `docs/POSTING_GUIDE.md` (jak postovat), `docs/AI_AGENT_KNOWLEDGE_BASE.md` §27 + §4 (publishing + metrics loop).
