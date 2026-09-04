# Unit ekonomika a ceník

> Přepsáno 2. 9. 2026 na ceník **v6** (Start 999 · Růst 2 999 · Dominance 4 999 ·
> Impérium 8 999 Kč). Předchozí verze tohoto souboru popisovala ceník v4
> (490/990/1990) a sama sebe označovala za neplatnou — což z ní dělalo past pro
> každého, kdo si ji otevřel. Historie je v gitu.
>
> **Zdroje čísel a jejich stáří jsou uvedené u každé tabulky.** Kde sazbu neznáme,
> stojí „neověřeno" — ne odhad.

## Odkud se čísla berou

| Údaj | Zdroj | Ověřeno |
|---|---|---|
| Sazby modelů (USD/M tokenů, za obrázek, za vteřinu videa) | `lib/model-pricing.ts` | ai.google.dev, 10. 8. 2026 |
| Skladba volání na jeden příspěvek | `COSTS` v `instagram/caption-generator.ts` | odhad provozovatele |
| Kurz 21,2 Kč/USD | `lib/model-pricing.ts` | 15. 7. 2026 |
| Ceník tarifů a kredity | `20260901_pricing_v6_kredity.sql`, `lib/pricing.ts` | v prod DB |
| Skutečná útrata | `ai_spend` + `ig_generation_log` → `npx tsx scripts/spend-report.ts` | živé |

**Sazebník má jediné místo.** Do 9/2026 držel engine vlastní kopii cen za video,
která se s `model-pricing.ts` rozešla (Veo Fast 0,15 vs 0,12 USD/s). Teď se čte
přes `unitRate()` a `npm run guard` hlídá, že každý model z registru má sazbu.

---

## 1. Cena jednoho příspěvku

Zahrnuje celou pipeline: copywriter → kritik → editorial board → art director →
render → vision QA, plus cross-family judge (Claude Sonnet 5).

| Krok | Model | USD |
|---|---|---|
| 3× text (copywriter, kritik, editor) | Gemini Pro | 0,075 |
| Kontextový agent (svátky, počasí) | Gemini Flash | 0,025 |
| Designer brief | Gemini 3.1 Pro | 0,030 |
| Render obrázku | Nano Banana Pro | 0,134 |
| Vision QA | Gemini Flash vision | 0,010 |
| Judge | Claude Sonnet 5 | 0,010 |
| **Celkem** | | **0,284** |

| Formát | USD (podlaha) | USD (reálně) | Kč | Kreditů | Kč/kredit |
|---|---|---|---|---|---|
| Obrázek | 0,28 | 0,36 | **7,63** | 1 | 7,63 |
| Story | 0,57 | 0,57 | **12,08** | 2 | 6,04 |
| Karusel | 0,76 | 0,86 | **18,23** | 3 | 6,08 |
| Reel | 1,22 | 1,51 | **32,01** | 5 | 6,40 |

„Reálně" připočítává editorial rounds a občasnou korektivní editaci obrazu.
Reel počítá Veo 3.1 Fast, 8 s.

---

## 2. Proč jsou kredity vážené

Kredity nejsou počet příspěvků, ale **jednotka nákladu** (`lib/credits.ts`):
obrázek 1 · story 2 · karusel 3 · reel 5.

Bez vážení stál reel jeden kredit stejně jako obrázek, takže zákazník, který
dělá jen reely, spotřeboval čtyřnásobek nákladu za tutéž cenu. Vážením drží
Kč/kredit v pásmu **6,0–7,6 Kč** napříč formáty — a tím je **nejhorší případ
ohraničený konstrukcí**: žádná kombinace chování nemůže tarif potopit.

Důsledek pro plánování: horší poměr pro nás má paradoxně **obrázek** (7,63 Kč/kredit),
ne reel (6,40). Reel je drahý absolutně, ale spotřebuje pětinásobek kreditů.

---

## 3. Marže tarifů při plném vyčerpání

Počítáno na 6,5 Kč/kredit (běžný mix) a 51 Kč měsíčně za profil u mostu na Instagram.

| Tarif | Cena | Kreditů | AI | Most | Hrubý zisk | Marže |
|---|---|---|---|---|---|---|
| Start | 999 | 20 | 130 | 51 | 818 | **82 %** |
| Růst | 2 999 | 70 | 455 | 51 | 2 493 | **83 %** |
| Dominance | 4 999 | 130 | 845 | 51 | 4 103 | **82 %** |
| Impérium | 8 999 | 260 | 1 690 | 51 | 7 258 | **81 %** |

Žebřík Kč/kredit klesá celým ceníkem a každý krok nahoru vyjde levněji než
dobití (49 Kč/kredit) — hlídá `npm run guard`, aserce 25.3c.

### Co v téhle tabulce není

- **Onboarding nového zákazníka** — měřený v `ai_spend` (`onboarding_analyze`,
  `onboarding_config`), ale nesečtený do čísla na hlavu.
- **Obchodní agent** — 18 Kč za osloveného, generuje ukázku *předem*, před
  odpovědí. Roste s objemem oslovení, ne s konverzí.
- **Fixní provoz** — Vercel, Supabase, Resend, Sentry, Fakturoid, účetní.

**Skutečná marže na zákazníka se zjistí jedním příkazem:**

```bash
npx tsx scripts/spend-report.ts 30
```

Sekce „po klientech" ukazuje útratu přepočtenou na 30 dní proti ceně tarifu.

---

## 4. Příspěvky v ceně: pole, které nic nedělá

Tarify nesou `plan_posts_limit: 30`, ale `activatePaidPlan()` nastaví čítač
`plan_posts_unlocked` rovnou na 30 a brána zní `planPostsUnlocked < planLimit`.
Podmínka je u placeného tarifu **vždy nepravdivá** — platí se kredity za každý
příspěvek. UI to zákazníkovi neslibuje (kreditový pruh; kvóta příspěvků se
zobrazuje jen u trialu).

**Marže výše na tomhle stavu stojí.** Kdyby se aktivace „opravila" na nulu,
každý tarif rozdá 30 příspěvků zdarma — u Startu ~229 Kč nákladu proti 999 Kč
tržby. Hlídá `npm run guard`, aserce 25.3d.

---

## 5. Jak ceník měnit

1. Migrace do `subscription_plans` (zdroj pravdy je DB).
2. Statická záloha pro landing v `lib/pricing.ts` — `npm run guard` porovnává obojí.
3. Přepočítat tabulku v §3 a ověřit žebřík Kč/kredit.
4. Nikdy nepsat cenu do textu aplikace — hlídá aserce 25.3b.

Související: `docs/AI_PROVIDER_STRATEGY.md` (výběr modelů),
`docs/audit-stav-projektu.md` (stav produktu a rizika).
