---
tags: [gtm]
updated: 2026-06-11
---

# 🎯 GTM přehled — jedna stránka

> Strategie postavená na faktech z kódu (stav 2026-06-11, v4.1). Když se kód změní, aktualizuj nejdřív [[Ceník]] — ten na kódu závisí nejvíc.

## Teze

**Beachhead:** lokální služby s vizuálním byznysem (kavárny, salóny, fitness, vinařství) — viz [[ICP]].
**One-liner:** „Zadáte web. Dostanete měsíc Instagramu." — viz [[Pozicování]].
**Cena:** 490 Kč/měs (existující plán `chrlit`), trial = 3 posty zdarma bez kreditky (existující `trial_v2`) — viz [[Ceník]].
**Kanály (bez placených ads):** dogfooding IG účet, 1 spřátelený influencer, n8n outreach s personalizovaným demo postem, aktivace waitlistu — viz [[Kanály]].
**Cíl 90 dní:** 15–30 platících (≈ 7–15 k MRR), trial→paid konverze ≥ 15 % — viz [[Launch plán]] a [[Metriky]].

## Klíčová fakta z kódu (zkráceně)

| Fakt | Hodnota | Zdroj |
|---|---|---|
| COGS image post | ~$0.10 ≈ 2,3 Kč | `docs/SYSTEM_KNOWLEDGE_BASE.md` §10 |
| COGS carousel (5 slidů) | ~$0.37 ≈ 8,5 Kč | tamtéž |
| COGS reel (8 s) | ~$1.25 ≈ 29 Kč ⚠️ | tamtéž |
| Plán `chrlit` | 490 Kč: 30 plan postů + 30 kreditů na extras | `supabase/migrations/20260524_credit_model_v2.sql` |
| Trial `trial_v2` | content-gated: 3 plné posty + 27 zamčených, bez expirace | `lib/subscription.ts` |
| Extra kredit | 15 Kč/ks | `lib/subscription.ts` |
| Registrace | jen s invite code (trackovatelný `used_count`) | `app/register/actions.ts` |
| Odesílání emailů | **NEEXISTUJE** v kódu → waitlist sekvence přes n8n | grep celého repa |

Kurz USD/CZK počítán ~23 Kč [PŘEDPOKLAD, rozsah 22–24].

## ⚠️ Tři věci, které opravit před launchem

1. **Reels požírají marži** — reel stojí 29 Kč COGS, ale účtuje se 1 kredit jako post (výnos ~16 Kč/plan post). 30 reels = COGS 863 Kč na plánu za 490 Kč → **záporná marže**. Řešení v [[Ceník]].
2. **Landing lže o trialu** — `app/page.tsx` slibuje „7 dní zdarma", kód má content-gated trial (3 posty, bez času). Sjednotit na content-gated — je to i lepší prodejní mechanika.
3. **Landing vs. kód: kredity a projekty** — landing: „carousel 2 kredity" (kód: 1 kredit, typ postu nemá vlastní cenu) a „Neomezené projekty" (kód: `max_projects: 1`). Sjednotit.

## Největší rizika (a nejlevnější ověření)

1. **Kvalita výstupu není „publish-ready"** pro reálné SMB → celý funnel umře na trial→paid. *Test:* 10 lidí z waitlistu, ručně sledovat, kolik z 3 trial postů skutečně publikují bez úprav. Cena: 10 invite kódů + 1 hodina rozhovorů.
2. **Marže u reels / power-userů** → pár nadšenců do videa může spálit víc, než platí. *Test:* SQL dotaz na poměr typů postů u beta uživatelů, dřív než se zafixuje ceník.
3. **Outreach skončí ve spamu / influencer nekonvertuje** → zůstane jen waitlist. *Test:* 50 ručních (ne automatických) outreach emailů s demo postem v týdnu 3 — pokud reply rate < 5 %, neautomatizovat a překlopit energii do dogfooding IG.

## Mapa poznámek

- [[ICP]] — komu prodáváme, beachhead
- [[Pozicování]] — one-liner, úhly, srovnání s alternativami
- [[Ceník]] — plány, marže, trial, nutné změny v kódu
- [[Kanály]] — playbook pro 4 kanály
- [[Launch plán]] — 30/60/90 dní, max 3 úkoly/týden
- [[Metriky]] — 5 čísel + kill kritéria
