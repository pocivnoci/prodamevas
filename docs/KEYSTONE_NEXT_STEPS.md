# Keystone — next steps (pick up here)

**Status:** Step 1 code is **done & merged-ready** (OAuth connect, encrypted `ig_connections`,
refresh cron, Settings "Připojit Instagram", Privacy §10, data-deletion endpoint). Build passes,
new files lint clean. What's left is **config + Meta-dashboard work + a real end-to-end test** —
none of it is code. Do these in order.

---

## 1. Provision secrets (5 min)

- [ ] Generate the token key: `openssl rand -hex 32`
- [ ] Set on Vercel (Production + Preview) **and** in local `.env.local`:
  - `IG_TOKEN_ENCRYPTION_KEY=<the hex above>`
  - `META_APP_ID=<from Meta app>`  *(get in step 3)*
  - `META_APP_SECRET=<from Meta app>`  *(get in step 3)*
- [ ] Confirm `CRON_SECRET` and `NEXT_PUBLIC_SITE_URL` are already set (they are, per env docs).

## 2. Apply the DB migration (2 min)

- [ ] Supabase SQL Editor → run `supabase/migrations/20260619_ig_connections.sql`.
- [ ] Sanity check: table `ig_connections` exists; RLS is ON with **no policies** (deny-all).

## 3. Create the Meta app (Meta dashboards — only you can) (20–30 min)

- [ ] business.facebook.com → create/locate the **Chrlit Business portfolio**.
- [ ] developers.facebook.com → **Create app → Business** → add **Instagram** product →
      "Instagram API setup with Instagram login".
- [ ] In the Instagram login settings, set the **OAuth Redirect URI** to:
      `https://<your-prod-domain>/api/ig-connect/callback`
      (must match `NEXT_PUBLIC_SITE_URL` exactly; HTTPS only).
- [ ] Copy **App ID** + **App secret** into the env vars from step 1, redeploy.
- [ ] Add your own IG **Business/Creator** account as a role/tester on the app (Standard Access —
      no review needed to test).

## 4. Start Business Verification NOW (slowest gate, runs in background)

- [ ] Meta Business Manager → Security Center / Business Info → start **Verification**.
- [ ] Upload entity docs — legal name + address must **exactly** match (the #1 rejection cause).
- [ ] Then forget about it; it clears independently while you keep working.

## 5. End-to-end test on the DEPLOYED URL (not localhost — IG needs HTTPS redirect)

- [ ] Dashboard → Nastavení → Správa → **Připojit Instagram** → authorize on Instagram.
- [ ] Land back on Settings showing `@handle` + token expiry (~60 days).
- [ ] In Supabase, confirm one `ig_connections` row: `access_token` is **ciphertext** (has
      `iv:tag:data` shape, not a raw token), `token_expires_at` ≈ 60 days out, `status=connected`.
- [ ] **Disconnect** in the UI → row is deleted.
- [ ] Refresh cron smoke: `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/ig-token-refresh`
      → `{ refreshed, failed }`; on a fresh token nothing refreshes (expires >7 days out) — that's correct.
- [ ] ⚠️ **Verify the data-deletion match key:** confirm the `user_id` in Meta's `signed_request`
      equals what `/me` returns (what we store as `ig_user_id`). If they differ for IG Login,
      adjust the match in `app/api/data-deletion/route.ts`.

## 6. App Review submission prep (once verified + flow proven)

- [ ] Public **Privacy Policy** URL → `/privacy` (§10 already written).
- [ ] **Data Deletion** callback URL → `/api/data-deletion` (done).
- [ ] App icon, name, category, business email.
- [ ] **Screencast per permission** on the live app: connect IG → status shows. For
      `instagram_business_manage_insights`, the insights demo lands in **step 3 (metrics)** — you
      may want to ship that first, or record a minimal insights call.
- [ ] Submit `instagram_business_basic` + `instagram_business_manage_insights` for Advanced Access.

---

## NOT in this step (next roadmap items)
- **Step 2 — Publishing:** media container → publish + scheduling cron.
- **Step 3 — Metrics → learning:** `syncPostMetrics(clientId)` → existing `updateIGPostMetrics()`.
  This is what makes the insights screencast (step 6) trivial — consider doing it before submitting.

References: `docs/META_APP_REVIEW_PLAN.md` (full gate plan), `~/.claude/plans/1-keystone-clever-honey.md`
(the implementation plan), memory `ig-golive-roadmap`.
