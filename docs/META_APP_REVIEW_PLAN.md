# Meta App Review + Business Verification — One-Time Setup Plan

**Goal:** get Chrlit's Meta app to **Advanced Access** for Instagram insights, so we can read metrics from **tenant** Instagram accounts (not just our own) and auto-feed `updateIGPostMetrics()`.

**Target API surface:** Instagram API with Instagram Login (`instagram_business_*` scopes, no Facebook Page required). Decided 2026-06-17.

**Key mindset:** This is a **one-time bureaucratic gate per app**, not per tenant. It runs in the background; the manual `MetricsInputForm` keeps the learning loop alive the whole time, so we are never blocked.

---

## The two gates (and why they're separate)

| Gate | What it proves | Blocks what | Typical time |
|------|----------------|-------------|--------------|
| **Business Verification** | Chrlit is a real legal business | Advanced Access to most permissions | Hours–days (faster with clean docs) |
| **App Review** | Each permission is used legitimately in-app | Calling the permission on accounts you don't own | Days–weeks per submission |

**Standard Access** (no review) already works for accounts that have a **role on the app** (you/test users) — that's enough to build and prove the integration *before* either gate clears.

---

## Phase A — Prep (do first, in parallel with dev)

- [ ] **Create/locate a Meta Business portfolio** (business.facebook.com) for Chrlit. The app must live inside it.
- [ ] **Create the Meta app** (developers.facebook.com) — type **Business** → add the **Instagram** product → "Instagram API setup with Instagram login".
- [ ] Gather Business Verification documents: legal entity name, registered address, business phone, official website, and a verification doc (business registration / utility bill / tax doc matching the entity). Mismatched address/name is the #1 rejection cause.
- [ ] Decide the **least-privilege scope set** for the first submission:
  - `instagram_business_basic` (identity + media)
  - `instagram_business_manage_insights` (the metrics — our actual goal)
  - *(defer `instagram_business_content_publish` and `..._manage_comments` to a later submission — asking for too much up front gets you rejected)*

## Phase B — Business Verification

- [ ] In Meta Business Manager → **Security Center** (or Business Settings → Business Info) → start **Verification**.
- [ ] Submit entity details + upload the doc. Ensure name/address **exactly** match the document.
- [ ] Wait for approval. (Independent of code — start ASAP.)

## Phase C — Build & test under Standard Access (no review needed)

This is the dev work; it proves the flow to reviewers and ships value immediately.

- [ ] **App-side OAuth connect flow** — `/api/ig-connect/start` + `/api/ig-connect/callback` (each `requireAuth()`). Exchange code → short-lived → **long-lived (60-day) token**.
- [ ] **Encrypted token storage** — new `ig_connections` table (`client_id`, `ig_user_id`, `access_token` encrypted, `token_expires_at`, `status`). Accessed **only** via `supabase/admin.ts`, never the browser client. Tokens are credentials — not in `clients.config` JSONB.
- [ ] **Token refresh cron** — long-lived tokens don't auto-refresh; add a job to `vercel.json` `crons` (pattern already used for `/api/cron/growth-snapshot`) that refreshes every connected tenant ~every 50 days.
- [ ] **`syncPostMetrics(clientId)`** — for each posted `ig_posts` with a media id, GET media insights → map to `{likes, comments, saves, reach, ...}` → call the **existing** `updateIGPostMetrics()` (do NOT rebuild the learning cascade). Reconcile media id at publish time or by matching recent media to our posts by permalink/timestamp.
- [ ] **Test against your own IG business account** (added as a role on the app) end-to-end under Standard Access. Confirm real numbers land and `analyzeAndLearn`/`propagateMetricsToSources` fire.

## Phase D — App Review submission prerequisites

Reviewers will reject instantly if these are missing:

- [ ] **Privacy Policy URL** (public) describing IG data use.
- [ ] **Data Deletion** — callback URL or documented instructions.
- [ ] App **icon, name, category**, and business email.
- [ ] **Test Instagram business account** + **app login credentials** + a step-by-step script so a reviewer can reproduce the connect → sync flow.
- [ ] **Screencast per permission** showing the permission used in the *real* app UI: user connects IG → metrics appear in PostsTab/PerformanceTab. For `instagram_business_manage_insights`, show insight numbers populating from the API.
- [ ] **Use-case write-up per permission** — plain-language: "We read media insights so the brand owner sees post performance and our engine learns from it."

## Phase E — Submit & roll out

- [ ] Submit the 2 permissions for **Advanced Access**. Address any reviewer follow-ups (they often ask for a clearer screencast).
- [ ] On approval: flip the metrics **source** from manual → API (same `updateIGPostMetrics()` target — tenants notice nothing).
- [ ] Add the **"Connect Instagram"** CTA to onboarding/Settings so tenants authorize.
- [ ] Keep `MetricsInputForm` as the fallback for unconnected accounts.

---

## Who does what

- **You (owner) — must be done in Meta dashboards (I can't):** create business portfolio + app, Business Verification, submit App Review, record the final screencast on the live app.
- **Claude (me) — code + assets I can build:** OAuth routes, `ig_connections` migration + encryption, refresh cron, `syncPostMetrics()`, the Settings "Connect IG" UI, Privacy Policy + Data Deletion endpoint, and a written screencast script.

## Sequencing (critical)

1. **Start Business Verification immediately** (Phase B) — slowest, gates everything, independent of code.
2. **Build Phase C in parallel** — testable on your own account, no approval needed.
3. **Prep Phase D assets** while verification clears.
4. **Submit (Phase E)** once verified + screencast ready.

Throughout: manual metrics entry keeps the loop learning, so there is **no downtime**.

## Hard facts (from Meta docs, 2026-06-17)

- IG account must be **Business/Creator** — personal accounts can't read insights, period.
- Tokens: short-lived (1h) → long-lived (60 days), **no auto-refresh**.
- Rate limit: ~200 calls/user/hour, scales with connected users — fine for daily syncs.
- Old `business_*` scope values were **deprecated 2026-01-27**; use the `instagram_business_*` names.

Sources: [Instagram API with Instagram Login (Meta)](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/) · [Phyllo IG API Integration Guide](https://www.getphyllo.com/post/instagram-api-integration-101-for-developers-of-the-creator-economy)
