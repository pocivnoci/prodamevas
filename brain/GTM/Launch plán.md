---
tags: [gtm]
updated: 2026-06-11
---

# 🚀 Launch plán 30/60/90

Pravidla: **max 3 úkoly/týden, každý ≤ 2 h nebo delegovaný na agenta.** 🧑 = founder ručně (ideálně 17–20h špička), 🤖 = běží automaticky / Claude Code / n8n. Metriky a kill kritéria → [[Metriky]].

## Fáze 1 — dny 1–30: opravit loď, první vlna

**Týden 1 — pravda na landingu + reels záplata**
1. 🤖 Opravit landing: „3 posty zdarma bez kreditky" místo „7 dní", carousel 1 kredit, stáhnout „neomezené projekty" (zadání pro Claude Code z [[Pozicování]]). *Výstup: landing nelže. Metrika: —*
2. 🤖 Reels limit dle [[Ceník]] varianta b (4/měs v plánu, trial bez reels). *Výstup: marže chráněná.*
3. 🧑 Založit @chrlit.cz IG + vygenerovat první dávku 5 postů (2 h). *Výstup: živý účet. Metrika: publikováno 4+/týden.*

**Týden 2 — dogfooding rytmus + první vlna waitlistu**
1. 🧑 Domluvit 1 souhlasící firmu pro před/po koncepty (kamarád/waitlist) (1 h).
2. 🧑 Vlna 1: ručně poslat invite kód 15 lidem z waitlistu — obyčejný osobní email, žádná automatizace (1,5 h). *Metrika: registrace/odeslané.*
3. 🤖 Týdenní dávka IG obsahu (founder jen schválí a naplánuje, 45 min).

**Týden 3 — ruční outreach test (NEautomatizovat)**
1. 🧑 Vybrat 50 leadů (kavárny/salóny v jednom městě s mrtvým IG) — může předžvýkat agent, founder schválí (1 h).
2. 🤖 Vygenerovat 50 demo postů skriptem přes CLI (~115 Kč COGS).
3. 🧑 Odeslat 50 outreach emailů ručně po 10–15/den, šablony A/B/C z [[Kanály]] (2 h celkem). *Metrika: reply rate per šablona.*

**Týden 4 — vyhodnotit a druhá vlna**
1. 🧑 Zavolat/napsat každému z vlny 1, kdo nedokončil 3 trial posty (1–2 h). *Výstup: seznam frikcí v onboardingu.*
2. 🧑 Vlna 2 waitlistu (20 lidí) + spustit n8n waitlist sekvenci z [[Kanály]] (sestaví agent, founder schválí copy).
3. 🤖 IG dávka + zadat metriky postů zpět do Chrlitu (feedback loop).

**Checkpoint den 30:** ≥ 25 trialů, ≥ 3 platící, znám hlavní frikci onboardingu. Kill kritéria viz [[Metriky]].

## Fáze 2 — dny 31–60: automatizace toho, co fungovalo

**Týden 5**
1. 🤖 n8n outreach pipeline (leady → demo post → email) — jen pokud ruční reply rate ≥ 5 %. Postavit nechat Claude Code, founder review.
2. 🧑 Influencer: domluvit deal (barter + 30% rev-share, brief z [[Kanály]]) (1 h schůzka).
3. 🤖 IG dávka.

**Týden 6**
1. 🤖 Outreach běží automaticky 20–30/den, founder jen odpovídá na reply (denně 20 min v špičce).
2. 🧑 Vlna 3 waitlistu — zbytek seznamu přes hotovou n8n sekvenci (30 min spuštění).
3. 🧑 2 case studies z reálných trial uživatelů (souhlas + screenshoty) (2 h).

**Týden 7 — influencer týden**
1. 🧑 Influencer publikuje (kód CHRLIT-{JMÉNO}, max 30 použití). Founder ten týden jen: support + odpovídání (špička večer).
2. 🤖 IG dávka tematicky sladěná s influencer kampaní.
3. 🤖 Denní SQL report do Telegramu/mailu: registrace, trialy, konverze per kód (jednorázově postaví agent).

**Týden 8 — vyhodnocení**
1. 🧑 Vyhodnotit kanály per invite kód: CAC úsilí vs. konverze. Vybrat 1 vítězný kanál pro fázi 3 (1 h).
2. 🧑 Cenový sanity check: SQL na poměr typů postů (reels!) a COGS/uživatele — viz [[Ceník]].
3. 🤖 IG dávka.

**Checkpoint den 60:** ≥ 80 trialů kumulativně, ≥ 10 platících, trial→paid ≥ 10 %, marže na uživatele > 60 %.

## Fáze 3 — dny 61–90: zdvojit vítěze, připravit druhou vlnu ICP

**Týden 9–10**
1. 🤖 Škálovat vítězný kanál (víc měst v outreachi / druhý influencer / public registrace bez kódu — podle dat).
2. 🧑 Rozhovory s 5 platícími: proč zaplatili, co skoro chybělo (2 h). *Výstup: podklad pro [[Pozicování]] v2.*
3. 🤖 IG dávka + follow-up influencer post („po měsíci s Chrlitem").

**Týden 11–12**
1. 🤖 Pokud retence 2. měsíce drží (viz [[Metriky]]): postavit plán Agentura (změny v kódu dle [[Ceník]] — `upgradeTrialToPaid` parametrizace, `max_projects`).
2. 🧑 Oslovit 10 freelance SMM ze segmentu C ručně (FB skupiny) s nabídkou založícího klubu Agentura plánu (2 h).
3. 🤖 IG dávka.

**Týden 13 — uzávěrka kvartálu**
1. 🧑 90denní retrospektiva proti [[Metriky]] — rozhodnutí: škálovat / pivotovat segment / pivotovat cenu (2 h).
2. 🤖 Aktualizovat tenhle vault (GTM poznámky) podle reality.
3. 🧑 Oslava, pokud MRR > 7 000 Kč. Povinná. 🍺

**Checkpoint den 90 (cíl):** 15–30 platících ≈ 7–15 k MRR, trial→paid ≥ 15 %, churn 2. měsíce < 30 %.

Souvisí: [[Kanály]] (jak), [[Metriky]] (kdy přestat), [[00 GTM přehled]].
