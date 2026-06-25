# Jak publikovat a plánovat posty

Praktický návod, jak dostat vygenerovaný post na Instagram **bez copy-paste pekla** a jak posty plánovat dopředu.

> **Proč to není plně automatické?** Auto-publish engine v aplikaci **existuje** (`/api/cron/ig-publisher` umí image + carousel), ale publikování na **cizí** účty potřebuje Meta App Review pro scope `instagram_business_content_publish` — to je běh na týdny (viz `docs/META_APP_REVIEW_PLAN.md`). Do schválení funguje auto-publish jen na našem testovacím účtu. **Tahle „handoff" cesta funguje hned, pro libovolný účet, a zvládne i reels.**

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
