# Implement Feature

## Kontext
Uživatel chce přidat novou funkcionalitu do aplikace. Tento skill zajistí, že se nic nerozbije a výsledek je produkčně kvalitní.

## Kroky

### 1. Analýza dopadu
- Zjisti, které soubory a moduly jsou dotčeny (grep, list_dir)
- Identifikuj závislosti — kdo importuje co
- Zkontroluj, zda už existuje podobná funkcionalita (neduplikuj)
- Ověř, zda feature vyžaduje DB změny (nová tabulka/sloupec v Supabase)

### 2. Plánování
- Vytvoř implementation_plan.md s konkrétními soubory a změnami
- Rozděl práci na logické kroky (nejdřív backend, pak frontend)
- Identifikuj rizika a otevřené otázky
- Požádej uživatele o schválení PŘED implementací

### 3. Implementace — pravidla pro tento projekt
- **Server Actions**: Vždy v `app/actions/`, vždy s `'use server'`, vždy s `requireSuperAdmin()` z `@/lib/auth-guard`
- **Supabase**: Pro admin operace `supabaseAdmin` z `@/supabase/admin`, pro user-facing `createClient()` z `@/supabase/server`
- **AI volání**: Používej `generateText()` / `generateImage()` z `@/instagram/gemini-client` — NIKDY nevolej Google API přímo
- **Kredity**: Pokud feature spotřebovává AI, wrappuj přes `creditGuard()` z `app/actions/credit-guard.ts`
- **Error handling**: Vždy try/catch, vždy loguj do console, vždy vrať `{ success: boolean; error?: string }`
- **TypeScript**: Žádné `any` pokud to jde, typy do `instagram/configs/types.ts` nebo `instagram/types.ts`

### 4. Verifikace
- Spusť `npx tsc --noEmit` — MUSÍ projít bez chyb
- Pokud je to UI změna, otevři v browseru a vizuálně zkontroluj
- Pokud je to API/action, otestuj volání

### 5. Dokumentace
- Updatuj walkthrough.md s popisem co bylo uděláno
- Pokud se mění config schema, aktualizuj typy v `instagram/configs/types.ts`

## Anti-vzory
- ❌ Nekopíruj celé velké soubory — edituj chirurgicky
- ❌ Nepřidávej npm závislosti bez explicitního souhlasu uživatele
- ❌ Neměň existující funkce pokud to není nutné — přidávej nové
- ❌ Neodstraňuj komentáře a docstringy
