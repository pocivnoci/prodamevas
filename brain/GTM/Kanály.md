---
tags: [gtm]
updated: 2026-06-11
---

# 📡 Kanálový playbook

4 kanály, žádné placené ads. Společný princip: **produkt je demo sám sebe** — každý kanál končí ukázkou výstupu na míru, ne argumentem. Měření přes invite kódy per kanál (viz [[Ceník]] — `invite_codes.used_count`).

---

## 1. Dogfooding IG — @chrlit.cz (povinný, běží pořád)

Chrlit generuje obsah Chrlitu. Super-admin bypass (`SUPER_ADMIN_EMAILS`) = žádné kredity, COGS ~2,3 Kč/post. Současně je to QA: founder uvidí každou slabinu výstupu dřív než zákazník.

- **Frekvence:** 4 posty/týden + 1 carousel. Reels max 1/týden (COGS 29 Kč — viz [[Ceník]]). Generování dávkou 1× týdně ~30 min, publikace přes plánovač.
- **Radikální transparentnost:** každý post v captionu přizná „vygenerováno Chrlitem za 3 minuty a 2,30 Kč". To je hook, který nikdo jiný v ČR nemá.
- **Pilíře:** (1) před/po ukázky, (2) vzdělávání „IG pro živnostníky", (3) produkt/feature, (4) memy o content peklu (showcase-2 styl už existuje).

**5 konkrétních „před/po" konceptů:**
1. **Kavárna:** screenshot nudného webu kavárny → vedle hotový post (latte vizuál v jejích barvách + caption). Caption: „Tohle vzniklo z jejich webu. Bez zadání. 3 minuty."
2. **Salón:** mobilní fotka interiéru → product-scene edit do profi vizuálu. „Stejná fotka. Jiný Instagram."
3. **E-shop:** produktovka na bílém pozadí → lifestyle scéna (funkce `editExistingImage`). „Z katalogu do feedu jedním klikem."
4. **Carousel:** „5 důvodů, proč váš IG vypadá mrtvě (a co s tím)" — celý carousel vygenerovaný Chrlitem, poslední slide: „I tenhle carousel je z Chrlitu."
5. **Time-lapse reel:** screen-recording celé pipeline (progress bar jobu, editorial board log, finální post) zrychlený na 30 s. „Takhle vypadá 30 hodin práce za 15 minut."

U konceptů 1–3: použít **souhlasící** reálnou firmu (z waitlistu/známé), ne náhodnou — jinak je to právně i eticky šedé. Win-win: firma dostane posty zdarma, Chrlit case study.

- **Kdo to dělá:** generování = Chrlit (automaticky), výběr a publikace = founder (~45 min/týden, ideálně v 17–20h špičce). Metriky postů zpětně zadat do Chrlitu → krmí vlastní feedback loop = dogfooding na druhou.

---

## 2. Influencer (1 spřátelený)

- **Struktura dealu — barter + rev-share, ne flat:** roční plán Chrlit zdarma (hodnota 5 880 Kč, COGS pár stovek) + **30 % z prvních 3 měsíců** každého zákazníka přes jeho kód (tj. ~441 Kč/konverze). Flat fee nedávat — žádný budget a žádná data o jeho konverzi; rev-share srovná zájmy. Při 20 konverzích si vydělá ~8 800 Kč — pro spřáteleného člověka férové.
- **Formát:** 1 reel + 3 stories během jednoho týdne, pak 1 follow-up po měsíci („co mi to vygenerovalo za měsíc").
- **Brief — co přesně má říct (vlastními slovy, ne skript):**
  1. Problém: „Vím, že mám postovat, ale nesnáším to / nestíhám to."
  2. Demo na kameru: zadá web (svůj nebo kamarádovy kavárny), ukáže 3 vygenerované posty. Bez střihu na výsledku — autenticita > dokonalost.
  3. Cena kotvou: „Agentura by si řekla o patnáct tisíc. Tohle je 490 a můžeš to zrušit kdykoliv."
  4. CTA: „Kód CHRLIT-{JMÉNO} — prvních 30 lidí dostane 3 posty zdarma, bez karty."
- **Landing flow:** kód = invite code s `max_uses: 30`. Registrace ho vyžaduje, takže atribuce je 100% přesná bez UTM. Volitelné vylepšení: `/register?code=CHRLIT-X` předvyplnění (malá změna v `app/register/page.tsx` — ověřit, zda už neumí).
- **Měření:** `used_count` kódu (registrace) → kolik z nich má `subscriptions.status='active'` (konverze) → rev-share výplata. Jednoduchý SQL, žádný nástroj.
- **Limitovanost kódu (30 použití) je zároveň urgence** — content-gated trial časovou urgenci nemá, tohle ji dodá.

---

## 3. AI agent outreach (n8n + Claude Code headless)

Killer move: **personalizace = skutečný vygenerovaný post pro jejich firmu** (CLI: `npx tsx instagram/cli.ts --config=<slug>`, COGS 2,3 Kč/lead). Nikdo jiný nepošle do mailu hotový post s jejich logem a barvami.

**Pipeline (n8n):**
1. **Zdroj leadů:** Google Maps API / Firmy.cz pro beachhead kategorie (kavárny, salóny, fitness) ve vybraném městě. Filtr: má web + má IG s < 1 postem za poslední měsíc (HikerAPI už je ve stacku — `HIKERAPI_KEY`).
2. **Enrichment:** Claude Code headless zhodnotí web (je to aktivní firma? jaký tón?) a vyřadí nesedící leady.
3. **Generace dema:** skript založí dočasný client config z jejich webu (onboarding `analyzeWebsite()` logika existuje) → vygeneruje 1 post → uloží PNG + caption.
4. **Email:** osobní first-line (z webu, ne šablona) + obrázek postu v příloze + invite code kanálu. Odesílání přes Resend/SMTP z **vyhrazené domény** (např. `chrlit.email`), ne z hlavní.
5. **Follow-up:** 1 jediný, po 4 dnech, jen pokud neotevřeno. Pak konec — žádné „jen se připomínám" potřetí.

**3 šablony první zprávy (česky, krátké — celé pod 90 slov):**

> **A (čas):** Dobrý den, koukal jsem na váš web {firma} — a všiml si, že Instagram trochu spí (poslední post {měsíc}). Nechal jsem naši AI vygenerovat jeden post přímo z vašeho webu — je v příloze, klidně ho použijte, je váš. Pokud byste takhle chtěli mít nachystaný celý měsíc, prvních X firem z {město} má 3 posty zdarma: chrlit.cz, kód {KÓD}. — Tomáš, chrlit.cz

> **B (peníze):** Dobrý den, vygenerovali jsme pro {firma} ukázkový instagramový post (příloha) — z vašeho webu, vašimi barvami. Agentura by za měsíc obsahu chtěla 10–15 tisíc. Chrlit to dělá za 490 Kč. Jestli zní dobře „měsíc Instagramu za odpoledne", vyzkoušejte 3 posty zdarma s kódem {KÓD} na chrlit.cz. — Tomáš

> **C (výloha):** Dobrý den, zákazníci si {firma} před návštěvou projíždějí na Instagramu — a ten váš teď působí, že máte zavřeno. V příloze posílám post, který naše AI vytvořila z vašeho webu za 3 minuty. Je zdarma a váš. Dalších 30 takových: chrlit.cz, kód {KÓD}. — Tomáš

**Limity, ať to nespadne do spamu (tvrdé):**
- Max **20–30 emailů/den**, nová doména s 2–3 týdny warm-upu, SPF/DKIM/DMARC.
- Vždy pravdivý odesílatel + fyzická adresa + funkční opt-out věta („Nechcete-li už nic, stačí odpovědět NE").
- B2B oslovení na veřejné firemní adresy = oprávněný zájem, ale **žádný scraping osobních emailů** a vést suppression list. Jednorázový follow-up, ne sekvence.
- **Týden 3: prvních 50 ručně** (founder, ne automat). Pokud reply rate < 5 %, pipeline nestavět a ladit zprávu — viz [[Metriky]].

---

## 4. Waitlist aktivace

Kód žádné emaily neumí (NEEXISTUJE — ověřeno grepem), takže: export `waitlist` tabulky → n8n + Resend. Posílat **po vlnách 15–20 lidí** (rate limit 10 jobů/h/klient a kapacita founderu na support).

**Sekvence 3 emailů:**
1. **Den 0 — „Jste na řadě":** osobní tón od foundera, 2 věty o produktu, invite code vlny (`max_uses` = velikost vlny), jasný first step: „Zadejte svůj web, za 3 minuty máte první post." Limitovanost kódu = urgence.
2. **Den 3 — „Takhle to dopadlo ostatním":** 1 před/po case study (z dogfooding účtu, koncept 1–3), znovu kód. Posílat jen těm, kdo se neregistrovali.
3. **Den 7 — „Zavíráme vlnu":** poslední připomínka, kód platí do konce týdne (pak `is_active: false` — mechanika existuje v `toggleInviteCodeActive`). Kdo nevyužil, padá do další vlny.

Registrovaným, kteří nedokončili 3 trial posty, žádný automat — je jich zprvu málo, founder napíše **ručně osobní email** („na čem to u vás zadrhlo?"). To je nejcennější research za nula korun.

Souvisí: [[Launch plán]] (kdy co spustit), [[Metriky]] (reply rate, konverze per kód).
