# iPhone: publikování na jedno klepnutí (Zkratka + „Publikovat hned")

Dvě cesty, jak z telefonu dostat post na Instagram. Přečti si rozdíl — jedna je „opravdu to zveřejní", druhá jen „připraví a otevře appku".

## TL;DR — co použít

| Chceš… | Použij | Otevře Instagram appku? |
|--------|--------|--------------------------|
| Image / carousel hned na profil, bez práce | **⚡ Publikovat hned** (v Příspěvcích → 📲) | **Ne** — publikuje přes API na serveru |
| Reels, nebo plnou kontrolu v Instagramu | **📲 Sdílet do Instagramu** (handoff) ± iOS Zkratka | Ano |

> **Důležité:** Instagram **nedovolí** zkratce (ani žádné automatizaci v telefonu) sama od sebe publikovat do feedu — nemá na to veřejné API. Zkratka tedy umí jen **připravit** (uložit obrázek, popisek do schránky) a **otevřít** Instagram; poslední „Sdílet" zmáčkneš ručně. Skutečné „zveřejni to za mě" dělá jen **⚡ Publikovat hned** (Graph API). Proto je zkratka volitelná — hlavně pro reels nebo když chceš postovat ručně.

---

## Cesta A (doporučená pro image/carousel): ⚡ Publikovat hned

Jakmile je chrlit účet propojený (viz `docs/INSTAGRAM_SETUP_GUIDE.md`):

1. **Příspěvky** → klepni na post → **📲 Publikovat na Instagram**.
2. V okně klepni **⚡ Publikovat hned**.
3. Hotovo — post jde na profil sám (do ~minuty), **bez otevírání Instagramu**. Okno ukáže „✅ Publikováno" + odkaz.

Funguje i z počítače. Reels zatím ne (ty přes Cestu B).

---

## Cesta B: iOS Zkratka v share sheetu (handoff)

Když klepneš **📲 Sdílet do Instagramu**, telefon otevře systémové sdílení. Tam se kromě Instagramu může objevit i **tvoje Zkratka** jako akce. Tady je, jak si ji vyrobit (~1 min):

### Vyrob Zkratku

1. Otevři appku **Zkratky** → **+** (nová) → pojmenuj např. „Chrlit → Instagram".
2. Nahoře **ⓘ** (nastavení zkratky) → zapni **Zobrazit ve sdílení** (*Show in Share Sheet*) → u **Typy příjmu** nech jen **Obrázky** (klidně i Text).
3. Přidej akce (v tomhle pořadí):
   - **Uložit do alba fotek** → vstup: *Vstup zkratky* (uloží sdílený obrázek do Fotek). *(volitelné)*
   - **Otevřít aplikaci** → **Instagram**. *(nebo akce „Otevřít URL" s `instagram://`)*
4. **Hotovo** (ulož).

### Použij ji

1. **Příspěvky** → 📲 → **Sdílet do Instagramu**.
2. V systémovém menu vyber **„Chrlit → Instagram"** (tvoji Zkratku) místo Instagramu.
3. Zkratka uloží obrázek + otevře Instagram. **Popisek už máš ve schránce** (tlačítko ho zkopírovalo) → v Instagramu podrž pole popisku → **Vložit**.

> Prebuildovaný `.shortcut` soubor ti nedáme (Apple ho podepisuje per-zařízení) — postav ji podle kroků výše, je to chvilka. Pak ji můžeš sdílet i přes iCloud odkaz na další zařízení.

---

## Proč zkratka nešetří klepnutí u feed postů

Když u **📲 Sdílet do Instagramu** vybereš rovnou **Instagram**, appka se otevře s obrázkem připraveným do feedu — to je už dost přímé. Zkratka, která obrázek nejdřív *uloží* a pak otevře Instagram, tě přinutí obrázek v IG zase *vybrat z alba* → spíš víc kroků. Proto:

- **Image/carousel** → **⚡ Publikovat hned** (nula práce, žádná appka).
- **Reels** nebo „chci to doladit v IG" → **📲 Sdílet do Instagramu** (a zkratku použij, jen pokud ti vyhovuje).

Reference: `docs/POSTING_GUIDE.md` (jak postovat), `docs/INSTAGRAM_SETUP_GUIDE.md` (propojení účtu).
