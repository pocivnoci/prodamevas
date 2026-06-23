---
tags: [gtm]
updated: 2026-06-11
---

# 🎙️ Pozicování & nabídka

Cílí na beachhead z [[ICP]] (lokální vizuální služby). Současný landing (`app/page.tsx`) už míří správně — „CHRLÍME OBSAH. Ale kvalitní." + úspora 30 h → 15 min. Tohle ho zpřesňuje, ne nahrazuje.

## One-liner

> **„Zadáte web. Dostanete měsíc Instagramu."**

Varianta s cenovou kotvou (pro outreach a influencera):
> „Měsíc Instagramu za cenu jednoho postu od grafika."

Žádné „AI-powered", žádný „autopilot pro váš brand". Sloveso + výsledek + čas.

## 3 messaging úhly k otestování

Každý úhel = série dogfooding postů + varianta první zprávy v outreach (viz [[Kanály]]). Měří se reply rate / engagement, ne pocit.

1. **ČAS — „30 hodin → 15 minut"**
   Už na landingu. Funguje na majitele, který obsah dělá sám po večerech. Důkaz: time-lapse reel celého generování.
2. **PENÍZE — „Agentura 15 000. Freelancer 800 za post. Chrlit 490 za měsíc."**
   Kotva na reálné alternativy (rozsahy níže). Funguje na racionálního živnostníka, který už si cenu agentury zjišťoval a lekl se.
3. **DŮVĚRA/KONZISTENCE — „Mrtvý Instagram = zavřená výloha"**
   Zákazník si vás před návštěvou projede na IG. Poslední post v lednu? Jdou jinam. Chrlit neudělá virál, udělá *živý profil*. Nejméně obvyklý úhel — možná nejsilnější, protože neslibuje growth, ale řeší stud.

## Srovnání proti reálným alternativám

| | Cena/měs | Čas majitele | Kvalita/konzistence | Slabina vůči Chrlitu |
|---|---|---|---|---|
| **Agentura** | 10–25 k [PŘEDPOKLAD] | ~0 h | vysoká, ale generická šablona | cena 20–50× vyšší; smlouvy, závazky |
| **Freelancer** | 3–8 k (500–1 500 Kč/post) [PŘEDPOKLAD] | 2–4 h (zadávání, schvalování) | kolísá podle člověka | kapacita, dovolené, odchody |
| **Canva + ChatGPT ručně** | ~0–500 Kč | 10–30 h | kolísá, vyžaduje vkus a promptování | právě těch 30 h; žádné učení z výsledků |
| **Nedělat nic** | 0 | 0 | mrtvý profil | úhel č. 3 — tohle je skutečný konkurent č. 1 |
| **Chrlit** | 490 Kč | ~1 h (review + publikace) | konzistentní brand styl, učí se z metrik | nepublikuje za vás (zatím), IG-only |

Pozor na poctivost: Chrlit **nepublikuje** na Instagram (FAQ to říká správně — žádný přístup k účtu). V messagingu to rámovat jako benefit („vaše heslo nikdy nepotřebujeme, máte poslední slovo"), ne skrývat.

## Co sjednotit na landingu (nesoulad kód vs. text)

- „7 dní zdarma" → nahradit „**3 posty zdarma. Bez kreditky. Bez časového limitu.**" (odpovídá `trial_v2` a je to silnější promise)
- „carousel 2 kredity" → v kódu carousel stojí 1 kredit jako každý post (`ACTION_CREDITS.post`); buď upravit text, nebo zavést cenu — rozhodnutí v [[Ceník]]
- „Neomezené projekty" → plán má `max_projects: 1`; stáhnout z featur listu, dokud nebude plán Agentura

Souvisí: [[Ceník]] (kotvy a cena), [[Kanály]] (kde který úhel testovat).
