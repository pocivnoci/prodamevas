# Jak publikovat a plánovat posty

Praktický návod, jak dostat vygenerovaný post na Instagram **bez copy-paste pekla** a jak posty plánovat dopředu.

> **Proč to není plně automatické?** Auto-publish engine v aplikaci **existuje** (`/api/cron/ig-publisher` umí image + carousel), ale publikování na **cizí** účty přes *naši* Meta appku potřebuje App Review pro scope `instagram_business_content_publish` — běh na týdny (viz `docs/META_APP_REVIEW_PLAN.md`). **Tahle „handoff" cesta funguje hned, pro libovolný účet, a zvládne i reels.**

> **Dvě cesty připojení účtu.** Studio umí publikovat dvěma trubkami a zákazník mezi nimi nepozná rozdíl — v Nastavení vidí pořád jen „Připojit Instagram":
>
> | Transport | Co to je | Kdy |
> |---|---|---|
> | `meta` | naše vlastní Meta appka, Graph API napřímo | cílový stav; pro cizí účty čeká na 2. App Review |
> | `uploadpost` | most přes upload-post.com, který schválenou Meta appku už má | funguje pro cizí účty **hned**; stojí peníze za profil |
>
> Kterou trubku připojený účet používá, je zapsané na řádku `ig_connections.transport` a **nikdy se nehádá**. Publisher ji čte až v okamžiku odeslání, takže přepnutí zákazníka z mostu na naši appku naplánované posty nijak nerozhodí. Nabídku pro nepřipojené tenanty řídí `ClientConfig.publishTransport` (default z `UPLOADPOST_DEFAULT_TRANSPORT`).
>
> **Most nejen publikuje, ale i měří** — statistiky příspěvků tečou přes stejný adaptér zpátky do učicí smyčky (`instagram/metrics-sync.ts`), takže se engine učí i u tenantů, kteří na App Review nečekají.
>
> ⚠️ Most je **neověřený, dokud neproběhne Fáze 0** (`npx tsx scripts/spike-uploadpost.ts`) — hlavně podpora carouselu a zpoždění metrik. Nezapínej ho platícímu zákazníkovi před tím.

> **Když je účet propojený:** v okně publikace svítí **⚡ Publikovat hned** — zveřejní image/carousel rovnou, bez otevírání Instagramu.

> **Když je účet propojený** (viz `docs/INSTAGRAM_SETUP_GUIDE.md`): v okně publikace navíc svítí **⚡ Publikovat hned** — zveřejní image/carousel **rovnou přes API, bez otevírání Instagramu** (do ~minuty). Pro reels použij dál ruční sdílení. Telefon — Publikovat hned vs. iOS Zkratka: `docs/IOS_SHORTCUT_HANDOFF.md`.

---

## TL;DR — nejrychlejší cesta (z telefonu)

1. Otevři Studio **na telefonu** (přidej si ho na plochu — viz [Tip](#tip-studio-na-ploše-telefonu)).
2. Sekce **Příspěvky** 📸 → klepni na post.
3. **📲 Publikovat na Instagram** → **Sdílet do Instagramu** → v systémovém menu vyber **Instagram**.
4. V Instagramu podrž pole popisku → **Vložit** (popisek už je v schránce).
5. Publikuj. Vrať se do Studia → **✓ Označit jako publikováno**.

To je celé. ~3 klepnutí místo přenášení obrázku a přepisování textu.

---

## Publikování krok za krokem

### Z telefonu (doporučeno)

Každý post má tlačítko **📲** (na kartě i v detailu). Otevře okno **Publikovat na Instagram**:

- **📲 Sdílet do Instagramu** — hlavní tlačítko. Najednou:
  1. zkopíruje popisek + hashtagy do schránky,
  2. stáhne obrázek(y),
  3. otevře systémové **sdílení** → vyber **Instagram**.

  Instagram se otevře s připraveným obrázkem. Popisek vložíš podržením pole popisku → **Vložit**.
  *(Instagram přes sdílení nepřebírá text automaticky — proto ho dáváme do schránky.)*

- **📋 Kopírovat popisek** — kdyby ses ke vkládání potřeboval vrátit.
- **⬇️ Uložit obrázek / Uložit slidy** — uloží obrázek(y) do telefonu (záloha, když nechceš sdílení).
- **✓ Označit jako publikováno** — po publikaci klepni; post se v aplikaci posune do stavu *Publikováno*, aby seděly přehledy.

### Carousel (více slidů)

Sdílení pošle **všechny slidy**. Pokud Instagram vezme jen první, zbylé ulož přes **Uložit slidy** a přidej je v Instagramu ručně (pořadí podle čísel v názvu souboru).

### Z počítače

Web Share na desktopu neumí přímé sdílení do appky, takže okno nabídne **Kopírovat popisek** + **Uložit obrázek**. Dvě možnosti:

- **Jednodušší:** udělej krok publikace rovnou **z telefonu** (viz výše). Generovat a schvalovat můžeš v klidu na počítači.
- **Nouzově:** ulož obrázek + zkopíruj popisek, přenes do telefonu, nahraj ručně.

---

## Plánování postů

Posty si připrav dopředu a publikuj podle plánu.

### Týdenní plán (AI)

**Plán** 📅 → záložka **Kalendář** → **📅 Naplánuj týden**.
AI zohlední počasí, svátky a výkon značky a rozvrhne ~5 postů na týden (nastaví datum, čas a stav **Připraveno**). V záložce **Feed náhled** 📱 uvidíš, jak bude profil vypadat.

### Workflow

```
Naplánuj (Plán → Kalendář)  →  Zkontroluj drafty (Příspěvky)  →  Schval (✅ Připraveno)  →  Publikuj (📲)
```

- **Generuj dopředu** — naplánovaný týden ti dá zásobu draftů.
- **Schvaluj v klidu** — v **Příspěvcích** filtruj podle stavu (Koncepty / Připravené / Publikované).
- **Publikuj rychle** — když máš chvíli, projdi *Připravené* a každý odbav přes **📲**.

---

## Tip: Studio na ploše telefonu

Aby byl posting jen pár klepnutí, přidej si Studio na plochu:

- **iPhone (Safari):** Sdílet → **Přidat na plochu**.
- **Android (Chrome):** ⋮ → **Přidat na plochu / Nainstalovat aplikaci**.

Přihlásíš se jednou a pak otevřeš jedním klepnutím.

---

## Co se chystá (plná automatizace)

Až projde **Meta App Review** + **ověření firmy** (`docs/META_APP_REVIEW_PLAN.md`):

- Naplánované **image/carousel** posty se budou publikovat **samy** přes `ig-publisher` cron — stačí post naplánovat (stav *Naplánováno*) a připojit Instagram v **Nastavení → Připojit Instagram**.
- **Reels** a automatické **metriky** navazují později (roadmap step 3).
- Handoff (📲) zůstane jako univerzální cesta — hlavně pro **reels** a pro účty bez schválení.

*Možné budoucí vylepšení: QR kód na desktopu, který otevře konkrétní post rovnou na telefonu (zatím neimplementováno — místo toho otevři Studio na telefonu a najdi post v Příspěvcích).*
