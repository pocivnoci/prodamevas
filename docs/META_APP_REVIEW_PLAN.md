# Meta App Review + Business Verification — One-Time Setup Plan

**Goal:** get Chrlit's Meta app to **Advanced Access** for Instagram insights, so we can read metrics from **tenant** Instagram accounts (not just our own) and auto-feed `updateIGPostMetrics()`.

**Target API surface:** Instagram API with Instagram Login (`instagram_business_*` scopes, no Facebook Page required). Decided 2026-06-17.

**Key mindset:** This is a **one-time bureaucratic gate per app**, not per tenant. It runs in the background; the manual `MetricsInputForm` keeps the learning loop alive the whole time, so we are never blocked.

> ## ⚠️ Tenants are no longer blocked on this plan
>
> Publishing to a **tenant's** account (and reading its metrics) now has a second
> route: the **upload-post transport**, which rides that vendor's already-approved
> Meta app. See `docs/POSTING_GUIDE.md`. It exists because the `content_publish`
> submission below is the *slow* half, and a paying customer should not wait on it.
>
> **This plan does not stop.** The bridge costs money per profile and puts a third
> party between us and our customers' accounts; our own app stays the target. When
> Advanced Access lands, a tenant reconnects through our OAuth, `ig_connections.transport`
> flips to `meta`, and nothing else changes — the publisher reads the transport per
> post at send time, so scheduled posts are untouched.

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
  - *(the App Review **submission** still defers `instagram_business_content_publish` + `..._manage_comments` — asking for too much up front gets you rejected. **NOTE:** the OAuth flow now **requests** `content_publish` so the chrlit dogfood account can auto-publish under Standard Access — that's separate from the submission and safe in dev mode where only app-role accounts can connect. Before going **Live** for tenants, either get `content_publish` approved too or drop it from the request for non-role accounts.)*

## Phase B — Business Verification

- [ ] In Meta Business Manager → **Security Center** (or Business Settings → Business Info) → start **Verification**.
- [ ] Submit entity details + upload the doc. Ensure name/address **exactly** match the document.
- [ ] Wait for approval. (Independent of code — start ASAP.)

## Phase C — Build & test under Standard Access (no review needed)

This is the dev work; it proves the flow to reviewers and ships value immediately.

> **Status (2026-06-19, "Keystone" step):** OAuth connect flow, encrypted token storage and
> refresh cron are **built**. `syncPostMetrics` stays deferred to roadmap step 3 (metrics→learning);
> Keystone only proves the connection. Test end-to-end on the deployed Vercel URL (IG requires an
> HTTPS redirect URI — localhost won't complete the exchange).

- [x] **App-side OAuth connect flow** — `/api/ig-connect/start` (`requireProjectAccess`) + `/api/ig-connect/callback` (validates a signed `state` instead of a cookie). Exchange code → short-lived → **long-lived (60-day) token** in `instagram/ig-connection.ts`.
- [x] **Encrypted token storage** — `ig_connections` table (`supabase/migrations/20260619_ig_connections.sql`): `client_id`, `ig_user_id`, `ig_username`, `access_token` (AES-256-GCM via `lib/ig-token-crypto.ts`), `token_expires_at`, `status`. RLS deny-all → service-role only. Not in `clients.config`.
- [x] **Token refresh cron** — `/api/cron/ig-token-refresh` (daily in `vercel.json`), mirrors `growth-snapshot`; refreshes connections expiring within 7 days, marks `expired` on failure.
- [x] **Settings "Připojit Instagram" UI** — connection card in `SettingsTab.tsx` (Správa) + `app/actions/ig-connection-actions.ts` (`getConnectionStatus`/`disconnectInstagram`).
- [x] **Publishing (roadmap step 2)** — `instagramAdapter.publish()` (`lib/channels/instagram.ts`) does Graph container→publish for **image + carousel** (reels deferred). The `/api/cron/ig-publisher` cron (every minute, `vercel.json`) drains posts in status `scheduled` whose `scheduled_for` is due, atomically flips `scheduled→posting`, publishes, then stamps `posted` + `ig_media_id` + `permalink` (or `failed` + `publish_error` after retries). Columns added by `supabase/migrations/20260622_ig_publishing.sql`. Approve+arm via `schedulePostAction` (sets `status='scheduled'`, guarded on a `connected` `ig_connections` row). **Needs the `instagram_business_content_publish` scope → a SECOND App Review submission** (defer per Phase A); until then it works only for the chrlit account whose connecting user is an app admin/tester — exactly the dogfood path.
- [x] **`syncPostMetrics(clientId)`** — *(roadmap step 3)* **SHIPPED** (`instagram/metrics-sync.ts`). For each posted `ig_posts`: resolve the media id (direct for auto-published, **caption-match backfill** for handoff/manual posts), GET media insights (`fetchMetrics` in `lib/channels/instagram.ts`: `like_count`/`comments_count` fields + `/insights?metric=reach,saved,shares,profile_visits`, defensive per-metric), map → `{likes,comments,saves,reach,shares,profile_visits}` → write via the **same learning cascade** as the manual form (extracted into session-less `writeIGPostMetrics` + `fireMetricsLearning`, fired **once per sync**). Triggered by daily cron `/api/cron/ig-metrics-sync` **and** an on-demand button in PerformanceTab (`syncMetricsAction`). Works **now under Standard Access** for the owner's own connected account (insights scope already requested); tenants light up once App Review clears. Manual `MetricsInputForm` stays as the fallback.
- [ ] **Test against your own IG business account** (added as a role on the app) end-to-end under Standard Access. Confirm the connection + token storage works; metrics land once step 3 ships.

## Phase D — App Review submission prerequisites

Reviewers will reject instantly if these are missing:

- [x] **Privacy Policy URL** (public) describing IG data use — `app/privacy/page.tsx` §10 "Propojení s Instagramem (Meta)".
- [x] **Data Deletion** — callback URL `POST /api/data-deletion` (verifies Meta `signed_request`, deletes the `ig_connections` row, returns `{ url, confirmation_code }`); GET serves instructions.
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
