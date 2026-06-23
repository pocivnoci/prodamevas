---
tags: [gtm]
updated: 2026-06-11
---

# 📊 Metriky & kill kritéria

5 čísel týdně. Všechna jdou vytáhnout SQL dotazem ze Supabase (`waitlist`, `invite_codes`, `subscriptions`, `ig_posts`, `credit_transactions`, `ig_jobs`) — žádný analytics nástroj není potřeba. V týdnu 7 si nechat postavit automatický report ([[Launch plán]]).

## 5 týdenních čísel

1. **Trial aktivace** = % registrovaných, kteří dogenerovali všechny 3 trial posty (`subscriptions.plan_posts_unlocked = 3`). Měří, jestli onboarding a kvalita výstupu drží. *Tohle je číslo č. 1 celé strategie.*
2. **Trial → paid konverze** = % aktivovaných trialů s `status='active'` do 14 dnů. Měří, jestli 27 zamčených postů + cena prodávají.
3. **Počet platících / MRR** (počítáno z `subscriptions`, ne z pocitu). Jediná „výsledková" metrika.
4. **COGS na platícího** = Gemini spend / počet platících + poměr typů postů (reels %). Hlídá marži z [[Ceník]] — jeden reel-power-user se pozná tady.
5. **Kanálová účinnost** = registrace a konverze **per invite kód** (`invite_codes.used_count` → subscriptions join). U outreache navíc reply rate (ručně z mailboxu).

Vědomě vynecháno: followers @chrlit.cz, impressions, návštěvnost webu, velikost waitlistu — vanity. Dogfooding účet se měří nepřímo přes registrace s jeho kódem.

## Kill kritéria po fázích

| Fáze | Podmínka | Pokud nesplněno → změna |
|---|---|---|
| **Den 30** | Trial aktivace ≥ 50 % (z registrovaných) | Problém není marketing, ale produkt/onboarding. STOP akvizice, 2 týdny jen oprava onboardingu podle rozhovorů z týdne 4. |
| **Den 30** | Outreach reply rate ≥ 5 % (z 50 ručních) | Neautomatizovat n8n pipeline. Přepsat zprávu/segment, otestovat dalších 30 ručně. Pokud ani pak ne → kanál zabít, energii do dogfoodingu + influencera. |
| **Den 60** | Trial → paid ≥ 10 % | Cena/nabídka problém: otestovat variantu 290 Kč / 15 postů [PŘEDPOKLAD, že bariéra je cena — ověřit nejdřív 5 rozhovory s neplatícími trialy]. |
| **Den 60** | ≥ 10 platících | Beachhead nevalidován. Než pivot segmentu: zkontrolovat per-kód data — pokud jeden kanál konvertuje a ostatní ne, je to kanálový, ne segmentový problém. |
| **Den 90** | Churn 2. měsíce < 30 % a MRR ≥ 7 000 Kč | Pokud churn > 30 %: produkt je „jednorázová dávka obsahu", ne předplatné → zvážit pivot na kreditové balíčky bez subscription (jiný payment model, Comgate one-off už existuje v `payments/create`). |
| **Den 90** | Reels % < 20 % vygenerovaných postů | Pokud víc: reels jsou tahák → přeceň je poctivě (8 kreditů) a udělej z nich upsell, ne díru — [[Ceník]]. |

## Provozní pravidlo

Metriky se čtou **1× týdně v neděli, 30 min, a jinak nikdy** — denní koukání na čísla v takhle malých objemech je šum a žere rozhodovací kapacitu (ADHD constraint z [[00 GTM přehled]]). Jediná výjimka: reply na outreach a support, ty denně 20 min.

Souvisí: [[Launch plán]] (checkpointy), [[Ceník]] (marže), [[Kanály]] (per-kód měření).
