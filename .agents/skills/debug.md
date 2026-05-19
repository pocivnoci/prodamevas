# Debug

## Kontext
Něco nefunguje. Cíl: systematicky najít příčinu a opravit.

## Kroky

### 1. Reprodukce
- Kde přesně se chyba projevuje? (UI, console, Vercel log, API response)
- Je to konzistentní nebo intermitentní?
- Fungovalo to dříve? Pokud ano — co se od té doby změnilo? (`git log -5 --oneline`)

### 2. Izolace — diagnostický strom

```
Chyba
├── Build error?
│   └── `npx tsc --noEmit` → oprav TypeScript chyby
├── Runtime error na serveru?
│   ├── Server Action? → zkontroluj app/actions/
│   ├── API Route? → zkontroluj app/api/
│   └── Middleware? → zkontroluj middleware.ts
├── Runtime error na klientu?
│   ├── Hydration mismatch? → hledej `useEffect` vs SSR rozdíly
│   ├── Missing provider? → zkontroluj layout.tsx wrappery
│   └── Import error? → zkontroluj 'use client' vs server component
├── AI generování selhalo?
│   ├── GEMINI_API_KEY nastavený? → .env.local / Vercel env
│   ├── Kvóta vyčerpaná? → 429/503 error v logu
│   ├── Model nedostupný? → fallback chain funguje?
│   └── JSON parse error? → AI vrátil špatný formát
├── Supabase error?
│   ├── RLS blocking? → zkontroluj policies
│   ├── Foreign key constraint? → chybí related záznam
│   ├── Storage full? → scripts/check-db-size.ts
│   └── Auth error? → refresh token expired? middleware.ts handling
└── Vercel-specific?
    ├── Timeout? → maxDuration v route.ts (max 300s)
    ├── Env vars? → dashboard → Settings → Environment Variables
    └── Cold start? → první request po deploy je pomalý
```

### 3. Diagnostické příkazy

```bash
# TypeScript check
npx tsc --noEmit

# Poslední git změny
git log -10 --oneline

# Hledej error v kódu
grep -r "console.error" app/actions/ --include="*.ts" -l

# DB diagnostika
npx tsx scripts/check-db.ts

# Storage
npx tsx scripts/check-db-size.ts

# Test AI
npx tsx scripts/test-imagen.ts
```

### 4. Oprava
- Oprav JEDNU věc najednou
- Po každé opravě ověř: `npx tsc --noEmit`
- Pokud oprava vyžaduje změnu v DB, řekni to uživateli explicitně

### 5. Prevence
- Po opravě se zamysli: jak zabránit stejné chybě v budoucnu?
- Přidej lepší error message? Validaci vstupu? Try/catch?

## Anti-vzory
- ❌ Nehádej — vždy OVĚŘ (přečti soubor, spusť příkaz)
- ❌ Neopravuj symptom místo příčiny
- ❌ Neříkej "zkus restartovat" — najdi ROOT CAUSE
