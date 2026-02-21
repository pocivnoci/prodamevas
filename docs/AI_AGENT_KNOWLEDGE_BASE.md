# AI AGENT KNOWLEDGE BASE: Instagram Multi-Tenant Autopilot

**POZOR PRO VŠECHNY AI AGENTY A LLM MODELY**: Tento dokument slouží jako zdroj pravdy (Source of Truth) pro architektonická, obchodní a technická rozhodnutí platformy. Jste-li asistující AI, PŘEČTĚTE SI TENTO DOKUMENT jako první, než budete cokoliv modifikovat.

---

## 🏗️ 1. Hlavní účel a Architektura systému
Tato platforma (`instagram/autopilot.ts`) je automatizovaný **Multi-Tenant Content Engine** určený ke generování Instagram příspěvků pro RŮZNÉ nezávislé klienty/značky.
Aplikace běží na serverless stacku (Next.js, Vercel) a data ukládá do **Supabase** (PostgreSQL + Object Storage).

**Klíčová pravidla architektury:**
- **Multi-tenant by design**: Aplikace se nesmí chovat klientsky specificky. Všechna specifika (barvy, weby, tone of voice, hashtagy) jsou izolovaná v **Config** souborech (`instagram/configs/[klient].ts`).
- **Žádný hardcoding**: Ať jde o databázová ID, názvy bucketů nebo URL, vždy si je aplikace musí vytáhnout z inicializovaného `CLIENT_CONFIG`.

---

## 📦 2. Průběh The Pipeline (Od nápadu k hotovému postu)
Proces běží v `instagram/autopilot.ts` a je zásadní ho dodržovat v přesném pořadí (tzv. DAG - Directed Acyclic Graph). NIKDY nepřeskakujte validaci.

1. **Inicializace Configu**: Určí se aktivní klient přes `resolveClientId` a zavolá se `setActiveProject(UUID)`.
2. **Výběr typu postu**: Podle `weekPlan` (nebo `--type` v CLI) se vybere formát (např. `meme`, `product_drop`, `tip_nastaveni`).
3. **Výběr Nápadu (Idea)**: Z tabulky `ig_post_ideas` se vytáhne nejstarší nepoužitý nápad specifický pro klienta a daný pilar. Pokud nic není, Gemini nápady na pozadí dogeneruje.
4. **Mega-Prompt pro Gemini 3.1 Pro (Text)**: Skript poskládá prompt obsahující specifikaci (tone of voice, háčky, anti-patterny atd.) z `CLIENT_CONFIG` a nechá vygenerować Titulek (Caption). Očekává přesný formát JSON.
5. **Quality Gate (Autokritika AI)**: Další LLM dotaz funguje jako tvrdý redaktor. Pokud je text špatný (cringe, zapomenuté CTA, nebo se nehodí do brandu klienta), generování je zamítnuto nebo opraveno.
6. **Programmatické Sledování Obrázků a Fontů (Text Overlay Satori)**: 
   - Gemini (Imagen 4) **NESMÍ** v obrázku generovat žádný text (AI ho kazí, nechápe českou diakritiku atd.). Imagen 4.0 Ultra vygeneruje POUZE RAW POZADÍ.
   - Pro textové prvky je tu modul `text-overlay.ts`, který pomocí sítě Satori + resvg renderuje čisté OpenType/TrueType fonty jako průhledné vrstvy (`instagram/fonts/`) přímo na hotovou grafiku.
   - **Vercel Exception**: Při nasazení musí být Vercelu vynuceno nahrání fontů přes `outputFileTracingIncludes` (`next.config.ts`), jinak funkce spadne na neexistující cestě fontů. V případě Satori crashe (např. chybí font) funguje jako pádová záchrana zapsání pouhého čistého Raw obrázku, než aby skončil fatálem zápis pro celou Pipeline.
7. **Storage Upload a DB Sync**:
   - Obrázky se MUSÍ ukládat s využitím `storageBucket` z klientské konfigurace (fallback `audit-screenshots` je DEPRECATED!). 
   - NIKDY nepředpokládat, že storage bucket existuje – v případě nového klienta se provolá `create-client-buckets.ts` pro jeho public zřízení!
   - Klientská oprávnění v DB jsou chráněná Row Level Security (RLS) přes `client_id` (Type: UUID). Skripty běží přes `supabase/admin.ts` a musí mít zainjectovaný lokální `.env.local` pro service_role_key.

---

## 🗃️ 3. Databázová Struktura (Supabase)
Celý engine se opírá o vztahy s `clients` tabulkou jakožto Multi-Tenant pojistce (viz `client_id`).

### Nejdůležitější tabulky
1. **`clients`**: Registry klientů/tenantů. Každý má unikátní UUID a Slug (např. `mobilnamiru`).
2. **`ig_post_types`**: Jaké typy příspěvků (meme, reel, carousel) jsou aktivní pro dané `client_id`.
3. **`ig_post_ideas`**: Generátorem naplněná zásobárna nepoužitých nápadů. Řídí se flagem `used = false` a sloupcem `cooldown_until`.
4. **`ig_posts`**: Hotové finální příspěvky. Obsahují public URL obrázku, JSON s titulky a hashtagy. Stav: `draft` -> `approved` -> `published`.
5. **Storage Buckets**: Obrazový `ig-posts-{klientSlug}` musí být public.

### Co je třeba dodržovat při DB voláních z AI kontextů?
- Při importech do Node scriptů hlídat cestování modulů. `dotenv.config({ path: '.env.local' })` MUSÍ být hned nahoře u admin připojení (`supabase/admin.ts`), jinak zkolabuje inicializátor `SupabaseClient` chybou `supabaseUrl is required` dříve než se script vůbec stihne vykonat.
- Cizí klíče (FK) nepřelstíte: `client_id` v API je UUID, nejedná se o textový Slug (na rozdíl od načítání configů). Při předávání je nutno v aplikaci string resolvovat na UUID.

---

## 🎨 4. Přidání Nového Klienta do Autopilota
Když vás operátor požádá o "Přidání nové firmy":
1. Zduplikujte `instagram/configs/mobilnamiru.ts` jako `.ts` s Názvem projektu do složky `instagram/configs/` a zařaďte ho do index provideru `instagram/configs/index.ts`.
2. Do souboru `types.ts` v ClientConfig přihlížejte na `storageBucket` popertey, aby bylo dbáno budoucí škálování logiky Supabase (oddělení assetů).
3. Do proměnných specifikujte `characterDescription`, aby Imagen věděl pro `mega-prompt`, jakou drží stylovou konzistenci.
4. Připravte fotky produktů a logo přesně podle config složení!
5. Nového klienta musíte založit nejen v UI konfiguraci (složka `configs`), ale **ZÁROVEŇ MU VYTVOŘIT UUID a aktivovat ig_post_types PŘES SUPABASE ADMIN SQL nebo UI**. Config soubor není samonosný, appka hledá klientovo stringové config jméno a transformuje ho oproti DB v `resolveClientId()`.

---

## 🧩 5. Záludnosti při LLM úpravách (Co AI vždy pokazí a čemu se musí vyvarovat)
1. **Vercel vs. Statické Soubory**: Neignorujte Vercel architekturu u API Routes a Server Actions. Lokálně přečtený soubor filesystemem `fs.readFile()` funguje s cestami uložení na disku macbooku, ale rozbije generování na remote (Vercel Node / Edge functions), jelikož nevidí mimo bundle. Assety pro dynamický load jako fonty/obrázky nutno balit do `outputFileTracingIncludes` (`next.config.ts`).
2. **Carousel Fallback**: Někdy vypadávají ze smyčky chybové requesty, protože se obrázky požírají postupně do sliderů. Pokud zhavaruje obrázek číslo 2. Aplikace to ignorovala, čímž vznikl draft "ŽÁDNÝ OBRÁZEK" ale pipeline doběhla. Funkce textování to obaluje v try catch a vrací BaseImage generování fotky v případě pádu obálky Satori.
3. **Timeouty GenAI a Retry limit** - Ošetřuje `withRetry()` wrap funkce (`gemini-client.ts`). Gemini / Imagen často (na tier kreditech) hází `503 Service Unavailable / Overloaded`. Skript proto musí mít integrované 60s cooldown uspávání. Tím pádem, Vercel free HTTP API routa padne do 15 vteřin – proto backend generování musí fungovat s lokálními dlouhými jobami/cron hookem, NIKOLIV volat se z normálního UI komponentu asynchronně na 1 zátah! Vždy u úprav hlídat asynchronní Promise exekuci pro `setTimeout`.

---
*Last Updated / Verified: AutoPilot Multi-Client v1.1 Architecture*
