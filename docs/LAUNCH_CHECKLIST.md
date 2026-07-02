# 🚀 Production Launch Checklist (beta, bez reálných plateb)

> Stav kódu: v4.1 (2026-06-10) — tenant isolation, credit charge/refund, stuck-job reaper, Sentry, env validace. Reálné platby jsou ODLOŽENÉ — viz sekce "Před zapnutím plateb".

## 1. Supabase (produkční projekt)

- [ ] Aplikovat nové migrace (SQL editor nebo supabase CLI):
  - `supabase/migrations/20260610_credit_idempotency.sql` — unique index pro idempotentní charge/refund
    - ⚠️ Pokud index spadne na duplicitách, nejdřív dedup (viz komentář v migraci)
  - `supabase/migrations/20260610_link_type.sql` — `ig_posts.link_type` + backfill
- [ ] Buckety existují (`npx tsx scripts/create-bucket.ts <name>` podle configů klientů)

## 2. Vercel env (Production)

Povinné (deploy bez nich spadne — `lib/env.ts`):
- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `GEMINI_API_KEY`
- [ ] `SUPER_ADMIN_EMAILS` (comma-separated)
- [ ] `NEXT_PUBLIC_SITE_URL` = produkční doména (auth callback + redirecty)

Volitelné:
- [ ] `HIKERAPI_KEY` — IG scraping v onboardingu (bez něj se přeskočí)
- [ ] `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` — error monitoring
- [ ] **`COMGATE_MOCK` NENASTAVOVAT** (na produkci je stejně ignorován) a Comgate creds nechat prázdné — platby v betě nejsou

## 3. Supabase Auth

- [ ] Redirect URLs v Auth nastavení obsahují produkční doménu (`/auth/callback`)
- [ ] Platné invite kódy v `invite_codes` pro beta uživatele

## 4. Smoke test na preview deployi

- [ ] Registrace s invite kódem → e-mail confirm → onboarding (web scan + IG handle)
- [ ] Vygenerovat post (sleduj progress + editorial log) → kredit odečten při startu
- [ ] Vynutit selhání (nesmyslný config) → job failed + kredit vrácen (`credit_transactions`)
- [ ] A/B varianty → výběr vítěze → `ig_brand_memory` přibude preference
- [ ] Uložit metriky (+10 likes) → log `📊 Metrics propagated` / `🧠 Learning triggered`
- [ ] Druhý (non-admin) účet: pokus o cizí `projectSlug` → „Nemáte přístup k tomuto projektu."

## 5. Před zapnutím reálných plateb

- [ ] Comgate creds na Vercelu (`COMGATE_MERCHANT_ID`, `COMGATE_SECRET`, `COMGATE_TEST=false`)
- [x] Callback idempotence — replay `PAID` callbacku je no-op (podmíněný status-claim UPDATE, v6.9)
- [x] Callback NIKDY nevěří payloadu — server-side `getPaymentStatus()` (+ mock jen mimo produkci)
- [x] Media-weighted kredity (image 1 / carousel 3 / reel 5) + plan re-budget 20/45/110 — migrace `20260702_media_weighted_credits.sql` aplikována
- [x] Recurring billing kód: `initRecurring` token, denní `/api/cron/billing-worker` (renewal + dunning + grace 3 dny), migrace `20260702_recurring_billing.sql` aplikována
- [ ] **U Comgate smluvně aktivovat „opakované platby"**, pak nastavit `COMGATE_RECURRING=1` (bez toho běží manuální obnova s e-mail remindery)
- [ ] `RESEND_API_KEY` na Vercelu (billing e-maily: reminder / selhaná platba / expirace)
- [ ] Malá testovací platba end-to-end (vč. ověření, že se uložil `subscriptions.recurring_trans_id`)
- [ ] Po nasazení: `REELS_ENABLED=1` (kredity už reels zpoplatňují správně — 5 kreditů)
