# Auth Production Floor Specification — "Auth production floor" (GTM MVP item 2)

> **Status:** Module spec for the GTM/MVP-viability issue **"Auth production floor"** — `docs/backlog.md`
> ▶ *GTM / MVP-viability program*, **item 2** (non-negotiable). The requirements grill is **DONE and
> owner-approved (2026-07-04)**; the decisions in §3 are baked-in and are **not** re-opened by this spec.
> This spec only **encodes** them. Conforms to house conventions (`CLAUDE.md` → *Spec & test conventions* +
> *Architecture patterns*): EARS requirements `FR-AUTHF-###`, non-functional `NFR-AUTHF-###`, Given/When/Then
> acceptance criteria `AC-AUTHF-###` (each → exactly **one** owning test layer per ADR-0010).
>
> **Related:** `docs/specs/auth.spec.md` (Issue #3 — real Supabase Auth foundation: login, magic link, session,
> impersonation; this issue **extends**, does **not** duplicate) · `docs/adr/0047-gtm-production-topology.md`
> (per-client Supabase Cloud Pro + CF Pages; the old cloud project = staging/demo) · `docs/backlog.md` GTM item 1
> ("ops-admin surface" — owns the invite-**issuance** rails; see §1.2 boundary) · `docs/environments.md`
> (the config/runbook deliverable target) · `docs/glossary.md` (Operator / Organization / Entity).
>
> **ID namespace:** `AUTHF` (Auth **F**loor) is deliberately distinct from the existing `AUTH` namespace
> (`auth.spec.md` owns 23 `FR-AUTH-###` ids / `AC-AUTH-001..012`). No ID is reused; `grep -r AC-AUTHF-…` finds this
> issue's proof points without collision.

---

## 1. Scope

### 1.1 In scope (this issue)
The **production auth email flows + configuration floor** — everything required to move auth from
"works on the local/demo stack" to "safe to put real paying-client users on." Four slices, built together
with the GTM item-1a invite rails (same email/SMTP backbone):

1. **Password-reset flow** — a request page (`/reset-password`: enter email →
   `supabase.auth.resetPasswordForEmail`) and an update page (`/update-password`: recovery-token session →
   `supabase.auth.updateUser`), with every state rendered (idle / loading / error / expired-or-invalid-token /
   success). DESIGN.md-token UI via the shared form primitives.
2. **Invite-acceptance flow** — a user lands from a Supabase invite email, sets a password, and is signed in
   to their org. The `/update-password` page serves this case too (set-first-password).
3. **Email-confirmation handling** — a confirm-required state on `/login` when GoTrue rejects an unconfirmed
   email, with a working **Resend confirmation** action.
4. **Configuration floor (NFRs + runbook)** — the per-client Supabase project config that makes 1–3 real and
   safe: SMTP via **Resend** behind an env-var seam, configurable sender address (no hardcoded domain),
   `site_url`/redirect allowlist locked to the deployed HTTPS URL, seed credentials rotated/disabled, and
   `auth.auto_expose_new_tables=false`. **This is config, not code** — delivered as a runbook section in
   `docs/environments.md` (NFR-AUTHF-CONF-007).

### 1.2 Out of scope — explicit boundary with the "ops-admin surface" issue (GTM item 1a)
**Invite *issuance* is a separate issue** (`docs/backlog.md` GTM item 1a: "user invite/disable — service-role
edge fn + `profiles.status` + email rails"). This issue owns only the invite **acceptance** surface. Concretely,
this issue does **NOT**:

- Build any admin/operator UI to send invites.
- Add a `profiles.status` column, a service-role edge function, or any server-side `inviteUserByEmail` wiring.
- Create `profiles` rows or assign roles. The ops-admin issuance issue creates the `auth.users` row (via
  `supabase.auth.admin.inviteUserByEmail`) **and** the matching `profiles` row before the user accepts.
- Disable/re-enable users (`profiles.status`).

**Handshake contract between the two issues (binding):** by the time a user reaches `/update-password` from an
invite link, the ops-admin issuance has already created (a) the `auth.users` row with a pending invite and
(b) the `profiles` row carrying the user's `role` + `org_id`. This issue's acceptance surface therefore never
creates identity; it only sets the password and lets the existing session resolve. If a profile is missing on
accept (issuance bug), the existing `RequireAuth` → `ProfileErrorPage` path (`pmo-portal/src/auth/RequireAuth.tsx`)
handles it — no new code for that path in this issue (the invite-pending gate at FR-AUTHF-034 is separate new
code that composes with `RequireAuth`).

**Named cross-spec contract `INVITE_PENDING` (this issue ↔ GTM item 1a — binding, both directions):**
- **Direction item 1a → this issue (produced by *issuance*):** when ops-admin issues an invite via the
  service-role `inviteUserByEmail`, it stamps **`user_metadata.invite_pending = true`** on the created
  `auth.users` row. That flag travels on the session that lands the invitee on `/update-password`, and is the
  signal this issue's gate consumes (FR-AUTHF-034). *(Owned by GTM item 1a; this issue consumes it.)*
- **Direction this issue → item 1a / rest of app (produced by *acceptance*):** the `/update-password` success
  path calls `updateUser` to set the password **and** writes `user_metadata.invite_pending = false` in the
  **same** operation (FR-AUTHF-035), so the resulting session no longer carries the flag. Any downstream code
  (this issue's gate, any future item-1a admin UI) reads `invite_pending` from `user.user_metadata`. *(Owned by
  this issue.)*

### 1.3 Relationship to existing code (the surfaces this issue extends)
- `pmo-portal/App.tsx` — route wiring. The new pages are **public** routes (siblings of `/login`, **outside**
  `<RequireAuth>`), mirroring the existing `<Route path="/login" element={<LoginPage />} />`.
- `pmo-portal/src/auth/AuthContext.ts` + `AuthProvider.tsx` — the `AuthContextValue` seam. This issue adds
  `requestPasswordReset`, `updatePassword`, and `resendEmailConfirmation`, each returning
  `{ error: string | null }` to mirror the established `signInWithPassword` / `signInWithMagicLink` shape.
  **Code reality (M-4):** `AuthProvider` today subscribes to `onAuthStateChange` as `(_event, session) => …` —
  the **event type is discarded**, so `PASSWORD_RECOVERY` is **not** threaded through context. FR-AUTHF-020's
  recovery-session detection must therefore subscribe to the event **in-page** (`/update-password`) or extend
  the context seam to expose the event; either is within this issue's scope (it already extends the seam). (The
  invite-pending gate at FR-AUTHF-034 reads `user.user_metadata` off the session, which the context *does*
  expose, so the gate does not depend on the event.)
- `pmo-portal/src/auth/LoginPage.tsx` — gains a **"Forgot password?"** link to `/reset-password` and a
  **confirm-required** state + Resend action. The existing `ErrorBanner` / `SuccessNotice` / `InputBlock`
  primitives are reused as-is.
- `pmo-portal/src/auth/RequireAuth.tsx` — gains a **sibling invite-pending gate** that composes with it at the
  protected-route boundary (FR-AUTHF-034): while `user.user_metadata.invite_pending === true`, protected routes
  redirect to `/update-password` instead of rendering. The existing session/profile logic in `RequireAuth` is
  unchanged; the gate is a separate check alongside it, and `/update-password` lives outside both so it never
  loops. *(I-1 GATE decision.)*
- `supabase/config.toml` — local dev stays as-is (`enable_confirmations=false`); the **production** values are
  a runbook deliverable (§7), not committed code changes in this issue.
- `pmo-portal/src/lib/analytics/` — `AuthMethod` and `AuthFailureReason` types are extended (§3.7).

---

## 2. Goals & non-goals

**Goals**
- A real user (invited by an Operator/Admin) can set a password from an email link and land signed in.
- A real user who forgets their password can self-serve a reset end-to-end with no admin involvement.
- A real user whose email is unconfirmed gets a clear, actionable message and a resend path.
- Every auth email redirects only to the deployed app; no open redirect; no user enumeration.
- The per-client Supabase auth config is a documented, repeatable checklist (runbook), with **no** domain or
  secret hardcoded in the repo — domain/brand is deferred (owner; `docs/backlog.md` BUILD-LOOP block).

**Non-goals**
- Google OAuth / social sign-in — **explicitly OUT** (stretch; own issue). SAML — **OUT**.
- A new RBAC engine, MFA, passkeys/WebAuthn, anonymous sign-in, or "return-to-original-URL-after-login."
- Any in-app admin/operator console for invite issuance or user disable (→ GTM item 1a).
- A hardcoded email domain or brand. Everything sender-related is a config value.

---

## 3. Design decisions (baked in — grill, owner-approved 2026-07-04)

These are **decisions of record**, not proposals. The spec encodes them; it does not re-litigate them.

| # | Decision | Source / rationale |
|---|---|---|
| D-AUTHF-1 | **Email provider = Resend over SMTP** (Supabase GoTrue `[auth.email.smtp]`). The API key is supplied via the env-var seam **`RESEND_API_KEY`** (a Supabase project secret, never committed). | Grill; `docs/backlog.md` GTM item 2 + BUILD-LOOP block. |
| D-AUTHF-2 | **Sender address is configurable** (Supabase `admin_email` + `sender_name`, sourced from config at provisioning). **No domain is hardcoded in the repo** — the domain/brand decision is deferred until after GTM items 1–2 (`docs/backlog.md`). | Grill (BUILD-LOOP: "domain/brand decision DEFERRED… build against env-var seams"). |
| D-AUTHF-3 | **Two new public routes**: `/reset-password` (request) and `/update-password` (set). Both are siblings of `/login`, outside `<RequireAuth>`. | Mirrors `auth.spec.md` D-6; `App.tsx` route shape. |
| D-AUTHF-4 | **The `/update-password` page serves both the reset case and the invite-acceptance case** — both end in `supabase.auth.updateUser({ password })`. Invite *issuance* is GTM item 1a (§1.2). | Grill: "build together with 1a (same rails)"; Supabase GoTrue invite+recovery both resolve to a set-password step. |
| D-AUTHF-5 | **Email confirmation is ON in production** (`enable_confirmations=true`) and **open self-signup is OFF** (`enable_signup=false`) — production is **invite-only**. Local/dev keeps `enable_confirmations=false` (no behavior change to the existing seed/demo flow). | Grill: "email confirm + invite emails"; `auth.spec.md` D-2 `[OWNER-DECISION]` resolved here → ON for prod. |
| D-AUTHF-6 | **Redirect allowlist = the deployed HTTPS origin only.** `site_url` + `additional_redirect_urls` point at the client's Cloudflare Pages HTTPS URL; no `localhost`, no `http`, no wildcard, no second origin. | Grill: "redirect allowlist → prod HTTPS only"; ADR-0047 (CF Pages). |
| D-AUTHF-7 | **No user enumeration.** The reset-request success notice is identical whether or not the email exists in `auth.users`. | OWASP A07 (identification); security-auditor concern. |
| D-AUTHF-8 | **All redirects from auth emails target `window.location.origin` only** (the SPA's own origin) — `resetPasswordForEmail({redirectTo})`, `signInWithOtp({redirectTo})`, `resend({redirectTo})`, and the invite `redirectTo` (set by GTM item 1a) all use the origin, never an arbitrary URL. | D-AUTHF-6; open-redirect prevention. |
| D-AUTHF-9 | **Seed credentials are demo/staging-only.** `Passw0rd!dev` / `admin@acme.test` (from `seed.sql` + `supabase/seed-admin.sql` + the `VITE_DEMO_MODE` login panel) must be **rotated/disabled** on any real-client Supabase project, and `db-seed-prod.sh` must never run against a real tenant. | Grill: "rotate/kill seed creds"; `docs/environments.md` (demo-deploy posture). |
| D-AUTHF-10 | **`auth.auto_expose_new_tables=false`** on every deployed project (and opted-in in `config.toml`). | Grill: "`auto_expose_new_tables=false`"; `config.toml` line 24 comment. |
| D-AUTHF-11 | **No new server-side tier, no new tables, no service-role client in the browser.** These flows use only the existing anon-key browser client + GoTrue. RLS remains the sole enforcement authority. | `auth.spec.md` NFR-AUTH-SEC-002; ADR-0016/0017. |
| D-AUTHF-12 | **UI = DESIGN.md tokens via the shared form primitives.** The new pages reuse the `LoginPage` pattern (`Card`/`CardPad`/`Button`/`ErrorBanner`/`SuccessNotice`) and, where they fit, the shared primitives (`TextField`/`FieldShell`/`FieldError`/`FormActions` in `src/components/ui/FormFields.tsx`). 32px controls; 16px root font. | `CLAUDE.md` → *Architecture patterns*; `DESIGN.md`. |
| D-AUTHF-13 | **Analytics extends, doesn't invent.** `AuthMethod` gains `'password_reset'` + `'invite_accept'`; `AuthFailureReason` gains `'email_not_confirmed'` + `'weak_password'` + `'expired_token'`. No PII (no email/password/token) is ever sent. | `pmo-portal/src/lib/analytics/events.ts`; existing `trackAuthLoginSucceeded/Failed`. |
| D-AUTHF-14 | **Recovery sessions are deliberately NOT gated** by the invite-pending gate (FR-AUTHF-034). A `PASSWORD_RECOVERY` session belongs to a user who **already owns a password**, so abandoning the reset is harmless (they can still sign in with their existing password); the gate therefore keys on `user_metadata.invite_pending` (set only by invite issuance — §1.2 `INVITE_PENDING`), which a recovery user never carries. Gating recovery would lock a password-having user out of the app for no security benefit; the only residual risk (abandoned invite = passwordless browse until session expiry) is closed by the gate, not by gating recovery. | I-1 GATE decision (Director, 2026-07-04); OWASP — minimize account-lockout surface. |

---

## 4. Functional requirements (EARS)

> EARS keyword legend: **ubiquitous** (always true) · **When** (event-driven) · **While** (state-driven) ·
> **Where** (optional/feature-driven) · **While…when…** (conditional). The `<system>` is the PMO Portal SPA
> unless noted.

### 4.1 Routes & public auth surface
- **FR-AUTHF-001** (ubiquitous) The system shall expose two **public** routes — `/reset-password` and
  `/update-password` — wired as siblings of `/login` **outside** `<RequireAuth>`, so an unauthenticated user
  (and a user in a recovery/invite session) can reach them. *(D-AUTHF-3; `App.tsx`.)*
- **FR-AUTHF-002** (state-driven) While a user navigates to `/update-password` **without** an active
  recovery/invite session, the system shall render the **expired-or-invalid-token** state (§4.3) and shall
  **not** render the set-password form. *(D-AUTHF-4; FR-AUTHF-021.)*
- **FR-AUTHF-003** (ubiquitous) The system shall render a **"Forgot password?"** link on `/login` that
  navigates to `/reset-password`. *(D-AUTHF-3.)*

### 4.2 Password-reset request (`/reset-password`)
- **FR-AUTHF-010** (ubiquitous) The `/reset-password` page shall render an email field + a primary
  "Send reset link" action + a "Back to sign in" link, using DESIGN.md tokens and the shared form primitives.
  *(D-AUTHF-12.)*
- **FR-AUTHF-011** (event-driven) **When** the user submits a syntactically valid email, the system shall call
  `supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/update-password' })`
  and enter a **loading** state that disables the form. *(D-AUTHF-1, D-AUTHF-8.)*
- **FR-AUTHF-012** (event-driven) **When** the call resolves successfully, the system shall show a
  **"check your email"** success notice and shall **not** navigate away. *(D-AUTHF-7.)*
- **FR-AUTHF-013** (ubiquitous) The success notice shall be **identical regardless of whether the email
  exists** in `auth.users` (no account-existence leak). *(D-AUTHF-7; NFR-AUTHF-SEC-001.)*
- **FR-AUTHF-014** (event-driven) **When** the call fails (network / rate-limit / config error), the system
  shall show the error in an `ErrorBanner` and stay on `/reset-password` (no unhandled rejection).
- **FR-AUTHF-015** (ubiquitous) The `redirectTo` argument shall equal `window.location.origin + '/update-password'`
  and shall never reflect user input (no open redirect). *(D-AUTHF-8; FR-AUTHF-050.)*

### 4.3 Password-update / set (`/update-password`) — reset + invite-acceptance
- **FR-AUTHF-020** (state-driven) **While** a valid recovery session is active (the `PASSWORD_RECOVERY`
  `onAuthStateChange` event, or a freshly-established invite session), the system shall render the
  **set-password form**: a new-password field, a confirm-password field, and a primary "Set new password"
  action. *(D-AUTHF-4.)*
- **FR-AUTHF-021** (state-driven) **While** no usable recovery/invite session is present on `/update-password`
  (direct navigation, or an expired/already-consumed/invalid token), the system shall render the
  **expired-or-invalid-token** state: a destructive notice that the link is invalid or expired and a primary
  action linking to `/reset-password`. The set-password form shall **not** render in this state.
  *(D-AUTHF-4; OWASP — no password write without a valid token.)*
- **FR-AUTHF-022** (event-driven) **When** the user submits, the system shall validate that the two passwords
  match client-side (inline `FieldError`, no submit on mismatch) and shall then call
  `supabase.auth.updateUser({ password })`. *(D-AUTHF-4; `minimum_password_length`/`password_requirements`
  are enforced by GoTrue server-side — the client surfaces the resulting error.)*
- **FR-AUTHF-023** (state-driven) **While** the update call is in flight, the system shall show a loading
  state and disable the form.
- **FR-AUTHF-024** (event-driven) **When** `updateUser` succeeds, the system shall navigate to `/`
  (replace) so the now-signed-in user lands on the dashboard under `<RequireAuth>`. *(D-AUTHF-4.)*
- **FR-AUTHF-025** (event-driven) **When** `updateUser` fails (weak password / network / token consumed), the
  system shall show the error in an `ErrorBanner` and stay on `/update-password`; the user may correct and
  retry, or use the "request a new link" path from the expired state if the token is gone.
- **FR-AUTHF-026** (ubiquitous) The page shall never transmit, log, or analytics-track the password value.
  *(NFR-AUTHF-SEC-002.)*
- **FR-AUTHF-027** (event-driven) **When** a recovery/invite session is established on `/update-password` (the
  token link resolves), the system shall strip the recovery/confirmation query parameters (`type`, `token`,
  `refresh_token`, etc.) from the URL bar and history via `history.replaceState` to the clean `/update-password`
  path, so the token does not persist in the address bar or browser history. Supabase does **not** strip these
  automatically. *(M-3; NFR-AUTHF-SEC-002.)*

### 4.4 Invite-acceptance (acceptance surface only — issuance is GTM item 1a, §1.2)
- **FR-AUTHF-030** (event-driven) **When** a user arrives from a Supabase invite email (the link GoTrue issued
  via `inviteUserByEmail` on the service-role side — GTM item 1a), the system shall land them on
  `/update-password` ready to set a first password. *(D-AUTHF-4; FR-AUTHF-020.)*
- **FR-AUTHF-031** (event-driven) **When** that user sets a password via `updateUser` (FR-AUTHF-022) and it
  succeeds, the system shall sign them in to their org and navigate to `/` — identical success path to the
  reset case (FR-AUTHF-024). *(D-AUTHF-4.)*
- **FR-AUTHF-032** (ubiquitous) This issue shall ship **no** invite-issuance UI, **no** service-role client,
  and **no** `profiles`-creation code. Identity creation is the ops-admin issue's responsibility (§1.2
  handshake contract). *(D-AUTHF-11; scope boundary.)*
- **FR-AUTHF-033** (state-driven) **While** the invite-acceptance session is active but the matching
  `profiles` row is missing (issuance bug), the post-set-password navigation to `/` shall hit the existing
  `RequireAuth` → `ProfileErrorPage` path (no new code for that path; no silent sign-in to a roleless session).
  *(§1.2 handshake; `RequireAuth.tsx`.)*
- **FR-AUTHF-034** (state-driven) **While** a signed-in user has `user.user_metadata.invite_pending === true`,
  every protected route (every route rendered inside `<RequireAuth>`) shall redirect to `/update-password`
  instead of rendering, so an invitee cannot browse the app passwordless. The gate composes with `RequireAuth`
  at the protected-route boundary — it does **not** replace the existing session/profile gate; `/update-password`
  itself sits outside the boundary so the redirect never loops. *(I-1 GATE decision; §1.2 `INVITE_PENDING`
  contract — consumes the `invite_pending` flag stamped by GTM item 1a issuance.)* **Honesty note
  (Director):** `user_metadata` is user-writable (`updateUser({data})`), so an invitee could clear
  their own flag via the API without setting a password. The gate is a UX/lockout-prevention
  boundary, NOT a security boundary — RLS bounds what any session can read either way, and a user
  bypassing the gate only self-harms into the lockout the gate exists to prevent. Deliberately
  accepted over `app_metadata` (tamper-proof but needs a service-role write to clear — cross-issue
  friction for zero security gain).
- **FR-AUTHF-035** (event-driven) **When** the `/update-password` form submits successfully, the single
  `updateUser` call shall set the new password **and** write `user_metadata.invite_pending = false` in the same
  operation — `supabase.auth.updateUser({ password, data: { invite_pending: false } })` (supabase-js v2: `data`
  is the `user_metadata` attribute) — so the resulting session no longer trips FR-AUTHF-034 and the FR-AUTHF-024
  navigation to `/` is not bounced back. The `invite_pending=false` write is idempotent for the pure-reset case
  (where the flag was never set). *(I-1 GATE decision; §1.2 `INVITE_PENDING` contract — producer direction;
  NFR-AUTHF-REL-002 no-loop.)*

### 4.5 Email-confirmation handling (on `/login`)
- **FR-AUTHF-040** (event-driven) **When** `signInWithPassword` rejects with a GoTrue "email not confirmed"
  error (prod, `enable_confirmations=true`), the `/login` page shall render a **confirm-required** state in
  place of the generic error: a notice that the email needs confirmation + a **"Resend confirmation"** action.
  *(D-AUTHF-5.)*
- **FR-AUTHF-041** (event-driven) **When** the user activates "Resend confirmation", the system shall call
  `supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: window.location.origin } })`.
  *(D-AUTHF-8.)*
- **FR-AUTHF-042** (event-driven) **When** the resend succeeds, the system shall show a "confirmation sent"
  success notice; **when** GoTrue rate-limits the resend, the system shall show a rate-limit message and
  disable the action until the user may retry. *(NFR-AUTHF-UX-001.)*
- **FR-AUTHF-043** (state-driven) **While** `enable_confirmations=false` (local/dev), the confirm-required
  state shall **never** appear — sign-in either succeeds or fails with `invalid_credentials`/`auth_error`
  exactly as in `auth.spec.md` FR-AUTH-020/021. The confirm-required classification is driven **solely** by
  the GoTrue error string, not by a build flag. *(D-AUTHF-5; the state is unreachable in dev by construction.)*

### 4.6 Redirect safety
- **FR-AUTHF-050** (ubiquitous) Every auth-email `redirectTo` the client passes to GoTrue
  (`resetPasswordForEmail`, `signInWithOtp` magic link, `resend`, and the invite `redirectTo` set by GTM
  item 1a) shall equal `window.location.origin` (or an origin-rooted path) and shall **never** be derived
  from user-supplied query params or untrusted input. *(D-AUTHF-8.)*
- **FR-AUTHF-051** (ubiquitous) The deployed Supabase project's `site_url` and `additional_redirect_urls`
  shall contain **only** the deployed HTTPS origin (D-AUTHF-6 runbook). This is a config gate, not client code.

### 4.7 Demo-mode & analytics hygiene
- **FR-AUTHF-060** (ubiquitous) The `/reset-password` and `/update-password` pages shall **never** render the
  demo-login panel or demo credentials, regardless of `VITE_DEMO_MODE`. (The demo panel is scoped to `/login`
  only — `LoginPage.tsx`.) *(D-AUTHF-9.)*
- **FR-AUTHF-061** (ubiquitous) The analytics layer shall extend `AuthMethod` with `'password_reset'` and
  `'invite_accept'`, and `AuthFailureReason` with `'email_not_confirmed'`, `'weak_password'`, and
  `'expired_token'`; the existing `trackAuthLoginSucceeded(method)` / `trackAuthLoginFailed(method, reason)`
  builders shall be called for the new flows. No email, password, recovery token, or OTP is ever sent.
  *(D-AUTHF-13; NFR-AUTHF-SEC-002.)*

---

## 5. Non-functional requirements

### 5.1 Security
- **NFR-AUTHF-SEC-001** *(user enumeration — client-observable parity)* The reset-request response **as
  rendered by the client** is constant regardless of account existence (FR-AUTHF-013): identical notice copy,
  identical rendered state, and identical client-side timing in both cases. This is scoped to what the SPA
  controls — GoTrue still sends a real email for registered addresses (a server-side timing + email-receipt
  side channel the client cannot suppress); that residual channel is **bounded** by the rate-limit lever
  (§7.4), not eliminated. *(D-AUTHF-7.)*
- **NFR-AUTHF-SEC-002** *(no secret exfiltration)* Passwords, recovery tokens, OTPs, and confirmation tokens
  are never logged, never placed in analytics properties, never rendered beyond the field that owns them, **and
  recovery/confirmation tokens are stripped from the URL bar and history immediately after the session is
  established** (FR-AUTHF-027 — Supabase does not strip them automatically). *(FR-AUTHF-026, FR-AUTHF-027,
  FR-AUTHF-061.)*
- **NFR-AUTHF-SEC-003** *(no new server exposure)* This issue adds no edge function, no RPC, no new table, no
  service-role client in the browser, and no relaxation of any RLS policy. RLS stays the enforcement
  authority. *(D-AUTHF-11; ADR-0016/0017.)*
- **NFR-AUTHF-SEC-004** *(open redirect)* No auth flow redirects to a URL other than the app's own origin
  (FR-AUTHF-050, FR-AUTHF-051). *(D-AUTHF-6/8.)*

### 5.2 Configuration floor (per-client Supabase project — **config, not code**; delivered as the §7 runbook)
- **NFR-AUTHF-CONF-001** *(SMTP provider)* Production auth email is delivered via **Resend** over SMTP
  (Supabase `[auth.email.smtp]`). The Resend API key is supplied through the **`RESEND_API_KEY`** env-var seam
  (a Supabase project secret set via `supabase secrets set` / the dashboard; **never** committed). *(D-AUTHF-1.)*
- **NFR-AUTHF-CONF-002** *(configurable sender)* The sender address (`admin_email`) and display name
  (`sender_name`) are **config values** set at provisioning; the repo hardcodes **no domain**. *(D-AUTHF-2.)*
- **NFR-AUTHF-CONF-003** *(redirect allowlist)* `site_url` and `additional_redirect_urls` contain **only** the
  deployed HTTPS origin of the client's Cloudflare Pages site (no `localhost`, no `http`, no wildcard, no
  second origin). *(D-AUTHF-6, FR-AUTHF-051.)*
- **NFR-AUTHF-CONF-004** *(confirmations + invite-only)* Production runs with `enable_confirmations=true` and
  `enable_signup=false` (invite-only). *(D-AUTHF-5.)*
- **NFR-AUTHF-CONF-005** *(seed credentials)* On any real-client project the `Passw0rd!dev` /
  `admin@acme.test` seed credential is rotated or the seed user disabled; `db-seed-prod.sh` + `seed-admin.sql`
  + the `VITE_DEMO_MODE` login panel are **demo/staging-only** and must never run on a real tenant. *(D-AUTHF-9.)*
- **NFR-AUTHF-CONF-006** *(table exposure)* `auth.auto_expose_new_tables=false` is set on every deployed
  project (and opted-in in `config.toml`). *(D-AUTHF-10.)*
- **NFR-AUTHF-CONF-007** *(runbook deliverable)* A **"Production auth configuration"** section is added to
  `docs/environments.md` containing the per-client provisioning checklist that satisfies
  NFR-AUTHF-CONF-001…008 (the §7 outline is the binding content).
- **NFR-AUTHF-CONF-008** *(rate-limit & captcha)* Production auth runs with `[auth.rate_limit] email_sent` set
  (intended production value **`2`**, mirroring the committed `config.toml` template) and `[auth.captcha]`
  enabled once the per-client captcha provider keys are provisioned — the primary abuse levers for the
  reset/confirm/invite endpoints this issue exposes. *(§7.4; I-3.)*

### 5.3 UX / accessibility
- **NFR-AUTHF-UX-001** *(states)* Every auth surface renders each of its states — idle / loading / error /
  expired-token / success — with DESIGN.md tokens; no blank screens, no unhandled promise rejections. Errors
  use `role="alert"` + `aria-live="assertive"`; success notices use `role="status"` + `aria-live="polite"`
  (mirroring `LoginPage.tsx`). *(D-AUTHF-12; `auth.spec.md` NFR-AUTH-UX-001.)*
- **NFR-AUTHF-UX-002** *(controls)* Auth forms use 32px-min controls on a 16px root font, keyboard-operable,
  visible focus ring (`--ring`), WCAG AA. *(D-AUTHF-12; `DESIGN.md` §a11y.)*
- **NFR-AUTHF-UX-003** *(mobile)* The new pages are full-bleed single-column at 390/360px, consistent with
  `/login` (the canonical auth layout). *(D-AUTHF-12; the `AC-MOBILE-OVERFLOW-001` gate applies.)*

### 5.4 Reliability
- **NFR-AUTHF-REL-001** *(graceful errors)* Any GoTrue client error (network, rate-limit, malformed) resolves
  to an `ErrorBanner` message — never a thrown promise, never a white screen.
- **NFR-AUTHF-REL-002** *(no recovery/invite loop)* Recovery/invite session detection is deterministic: a
  present valid session → set-password form; absence → expired state; an active session **before** set-password
  is fully defined — an invite-pending session is gated to `/update-password` (FR-AUTHF-034), a recovery session
  is not (D-AUTHF-14). The invite-pending gate creates no redirect loop because the success path clears
  `invite_pending` in the same `updateUser` call (FR-AUTHF-035) and `/update-password` is outside the gate
  boundary. No infinite redirect/render loop.
- **NFR-AUTHF-REL-003** *(session-handoff)* After `updateUser` succeeds, the existing `onAuthStateChange`
  subscription in `AuthProvider` drives session/profile resolution — no parallel session code path.

### 5.5 Observability
- **NFR-AUTHF-OBS-001** *(analytics, privacy-safe)* The new flows emit the existing auth events
  (`auth_login_succeeded` / `auth_login_failed`) with the extended method/reason codes (FR-AUTHF-061). No PII.
- **NFR-AUTHF-OBS-002** *(PostHog gating unchanged)* PostHog capture remains governed by the existing
  `VITE_DEMO_MODE` / `VITE_ANALYTICS_ENABLED` gates (`docs/environments.md`); this issue adds no new gate.

---

## 6. Acceptance criteria (Given/When/Then)

> **One owning test layer per AC (ADR-0010).** Unit = Vitest + React Testing Library with a **mocked** Supabase
> client (no network); E2E = curated Playwright against the local stack + Inbucket (port 54324). **No pgTAP-owned
> AC** — this issue adds no migration/RLS (NFR-AUTHF-SEC-003); the invite-issuance `profiles.status` + service-
> role RPC live in GTM item 1a, which owns its own pgTAP. **AC-id tagging:** Vitest — the `AC-AUTHF-###` id is in
> the `it(...)` title; Playwright — the `AC-AUTHF-###` id is the leading token of the `test(...)` title and the
> file is `e2e/<AC-id>-<slug>.spec.ts`. Config-runbook acceptance is **separate** (§7, owner-gated, per-client) —
> it is **not** in this automatable AC battery because it mutates a live cloud project.

### 6.1 Password-reset request (`/reset-password`) — unit-owned
**AC-AUTHF-001 — `/reset-password` renders the request form** (FR-AUTHF-010, NFR-AUTHF-UX-001) *(unit, RTL)*
Given the `/reset-password` route with no active session
When it renders
Then an email field, a primary "Send reset link" action, and a "Back to sign in" link are visible, and no
demo credentials are shown (FR-AUTHF-060).

**AC-AUTHF-002 — submitting a valid email calls `resetPasswordForEmail` with the origin-rooted redirect**
(FR-AUTHF-011, FR-AUTHF-015, FR-AUTHF-050) *(unit, RTL — assert mocked-client call args)*
Given the mocked Supabase client's `auth.resetPasswordForEmail` resolves `{ error: null }`
When the user enters `someone@example.com` and submits
Then `resetPasswordForEmail` is called once with
`{ redirectTo: window.location.origin + '/update-password' }` and the form enters a loading state.

**AC-AUTHF-003 — success notice has client-observable message parity** (FR-AUTHF-012, FR-AUTHF-013,
NFR-AUTHF-SEC-001) *(unit, RTL — Supabase call mocked, so this proves client-rendered parity only)*
Given the mocked client resolves `{ error: null }` for **both** a known and an unknown email
When the user submits each
Then the rendered "check your email" notice is byte-identical in both cases (no client-rendered
account-existence signal; the server-side timing/email-receipt side channel is out of unit-test reach and is
bounded by §7.4, not asserted here).

**AC-AUTHF-004 — request error shows an inline banner and stays on page** (FR-AUTHF-014, NFR-AUTHF-REL-001)
*(unit, RTL)*
Given the mocked client rejects `resetPasswordForEmail` with a network error
When the user submits
Then an `ErrorBanner` (role="alert") shows the message, the URL is still `/reset-password`, and no promise is
unhandled.

### 6.2 Password-update / set (`/update-password`) — unit-owned
**AC-AUTHF-010 — valid recovery session renders the set-password form** (FR-AUTHF-020, NFR-AUTHF-UX-001)
*(unit, RTL — mock a `PASSWORD_RECOVERY` session)*
Given the mocked auth client reports an active recovery session
When `/update-password` renders
Then new-password + confirm-password fields and a "Set new password" action are visible.

**AC-AUTHF-011 — mismatched confirm password blocks submit with inline validation** (FR-AUTHF-022)
*(unit, RTL)*
Given the set-password form is visible
When the user enters mismatched passwords and submits
Then an inline `FieldError` shows on the confirm field and `updateUser` is **not** called.

**AC-AUTHF-012 — submitting calls `updateUser` with the password (and clears `invite_pending`)** (FR-AUTHF-022,
FR-AUTHF-026, FR-AUTHF-035) *(unit, RTL)*
Given the mocked `auth.updateUser` resolves `{ error: null }`
When the user enters matching valid passwords and submits
Then `updateUser` is called once with `{ password, data: { invite_pending: false } }` (FR-AUTHF-035 — the
idempotent clear runs for both reset and invite) and the password value is not present in any analytics
capture call (FR-AUTHF-061).

**AC-AUTHF-013 — success navigates to `/`** (FR-AUTHF-024, NFR-AUTHF-REL-003) *(unit, RTL — assert mocked
`navigate`)*
Given `updateUser` resolves `{ error: null }`
When the user submits
Then the router navigates to `/` (replace).

**AC-AUTHF-014 — weak-password error stays on page with an inline banner** (FR-AUTHF-025) *(unit, RTL)*
Given the mocked `updateUser` rejects with a "weak password" error
When the user submits
Then an `ErrorBanner` shows the message and the URL is still `/update-password`.

**AC-AUTHF-015 — expired/invalid token renders the expired state, not the form** (FR-AUTHF-002, FR-AUTHF-021,
NFR-AUTHF-REL-002) *(unit, RTL — mock NO recovery session / a token-error)*
Given the mocked auth client reports **no** recovery session (direct navigation or an expired/invalid token)
When `/update-password` renders
Then the expired-or-invalid-token state is shown, a primary action links to `/reset-password`, and the
set-password form is **not** rendered.

**AC-AUTHF-017 — recovery/invite token is stripped from the URL after session establishment** (FR-AUTHF-027,
NFR-AUTHF-SEC-002) *(unit, RTL — assert `history.replaceState` / router replace to the clean path)*
Given the mocked auth client reports an active recovery/invite session AND the URL initially carries the
recovery query params (e.g. `?type=recovery&token=…`)
When `/update-password` renders
Then the URL bar reflects the clean `/update-password` path (no `type`/`token`/`refresh_token` params), via
`history.replaceState` or an equivalent router replace, and no token value persists in history.

### 6.3 Cross-stack round-trips — e2e (local stack + Inbucket)
**AC-AUTHF-005 — password-reset email round-trips via Inbucket** (FR-AUTHF-011, FR-AUTHF-015, FR-AUTHF-020,
FR-AUTHF-024) *(e2e — `e2e/AC-AUTHF-005-password-reset.spec.ts`, local stack + Inbucket)*
Given a seeded user `pm@acme.test` and I am on `/reset-password`
When I submit `pm@acme.test`, open the reset email in local Inbucket (port 54324), and follow the link
Then I land on `/update-password` with a set-password form; when I set a new password I am navigated to `/`
signed in, and I can subsequently sign in with the **new** password (and not the old).

**AC-AUTHF-020 — invite-acceptance round-trips to a signed-in org session; the gate clears after set-password**
(FR-AUTHF-030, FR-AUTHF-031, FR-AUTHF-032, FR-AUTHF-034, FR-AUTHF-035) *(e2e —
`e2e/AC-AUTHF-020-invite-acceptance.spec.ts`, local stack + Inbucket; test setup issues the invite via the
service-role admin API **and** stamps `user_metadata.invite_pending=true`, standing in for GTM item 1a's
issuance + the §1.2 `INVITE_PENDING` contract)*
Given the test has issued an invite to `newuser@example.com` (service-role `inviteUserByEmail` with
`user_metadata.invite_pending=true`) and the matching `profiles` row exists
When the invite email arrives in Inbucket and I follow the link
Then I land on `/update-password`; when I set a password I am signed in and land on `/` as the invited user,
the success `updateUser` call also cleared `invite_pending` (FR-AUTHF-035) so the FR-AUTHF-034 gate does **not**
bounce me back to `/update-password` on the next navigation to `/`, and no invite-issuance UI exists in this
issue's diff (FR-AUTHF-032 boundary).

### 6.4 Email-confirmation handling (`/login`) — unit-owned
**AC-AUTHF-025 — confirm-required error → confirm state (not generic error)** (FR-AUTHF-040, FR-AUTHF-043)
*(unit, RTL — mock `signInWithPassword` rejecting with a "email not confirmed" error)*
Given the mocked client rejects sign-in with a GoTrue "email not confirmed" error
When the user submits valid credentials
Then a confirm-required state is rendered (notice + "Resend confirmation" action), **not** the generic
`ErrorBanner`; the classification is driven by the error string alone (no build flag).

**AC-AUTHF-026 — Resend calls `resend({ type: 'signup', email })` with the origin redirect**
(FR-AUTHF-041, FR-AUTHF-050) *(unit, RTL — assert mocked-client call args)*
Given the confirm-required state is shown
When the user activates "Resend confirmation"
Then `auth.resend` is called once with
`{ type: 'signup', email, options: { emailRedirectTo: window.location.origin } }`.

**AC-AUTHF-027 — Resend success shows "confirmation sent"; rate-limit shows a rate-limit message**
(FR-AUTHF-042) *(unit, RTL)*
Given the mocked `resend` resolves `{ error: null }`
When the user resends
Then a "confirmation sent" success notice (role="status") is shown; and when `resend` rejects with a
rate-limit error, a rate-limit message is shown and the action is disabled until retry is permitted.

### 6.5 Redirect safety & hygiene — unit-owned
**AC-AUTHF-030 — every client-side auth `redirectTo` equals the origin** (FR-AUTHF-050, NFR-AUTHF-SEC-004)
*(unit, RTL — assert the wrapped helpers pass origin-only `redirectTo`)*
Given the mocked auth client
When the reset request, the magic-link request (`signInWithMagicLink`), and the confirmation resend are each
invoked
Then the `redirectTo` argument passed to GoTrue is `window.location.origin` (or `origin + '/update-password'`
for reset) in every case, and never reflects a query-string or user input.

**AC-AUTHF-035 — new auth pages never surface demo credentials** (FR-AUTHF-060, D-AUTHF-9) *(unit, RTL —
render with `VITE_DEMO_MODE=true`)*
Given `VITE_DEMO_MODE=true`
When `/reset-password` and `/update-password` render
Then neither page shows the demo-login panel, the `Passw0rd!dev` credential, or any persona button.

**AC-AUTHF-036 — new auth methods/reason codes are tracked without PII** (FR-AUTHF-061, NFR-AUTHF-OBS-001,
NFR-AUTHF-SEC-002) *(unit, RTL — assert analytics capture calls)*
Given the reset and invite-acceptance flows succeed, and the confirm-required/weak-password/expired-token
flows fail
When each path runs
Then `trackAuthLoginSucceeded` is called with `'password_reset'` / `'invite_accept'` and
`trackAuthLoginFailed` with `'email_not_confirmed'` / `'weak_password'` / `'expired_token'` as appropriate,
and **no** capture property contains an email, password, token, or OTP.

### 6.6 Invite-pending gate (I-1, GATE decision)
**AC-AUTHF-016 — invite-pending user is redirected from protected routes to `/update-password`**
(FR-AUTHF-034, D-AUTHF-14) *(unit/router-test — render the protected-route boundary with a session whose
`user.user_metadata.invite_pending === true`)*
Given a signed-in user whose `user.user_metadata.invite_pending === true` (per the §1.2 `INVITE_PENDING`
contract produced by GTM item 1a issuance)
When the user navigates to `/` (or any route inside `<RequireAuth>`)
Then the router redirects to `/update-password` and the protected content does **not** render. A
recovery-only session (`invite_pending` absent/false) is **not** redirected by this gate (D-AUTHF-14).

---

## 7. Configuration runbook deliverable (owner-gated, per-client — target: `docs/environments.md`)

> This is **not** in the §6 automatable AC battery — it mutates a live Supabase Cloud project per client
> (ADR-0047) and is an **owner checkpoint at client provisioning**. It is the fulfillment of
> NFR-AUTHF-CONF-001…008. The implementer adds a **"Production auth configuration"** section to
> `docs/environments.md` whose binding content is the checklist below (real values filled per client; no
> domain or secret committed). **Cloud SMTP is configured differently from local** (§7.1a local vs §7.1b
> cloud); rate-limit & captcha levers are §7.4.

**7.1 SMTP via Resend — two environments, configured differently.** The Resend API key lives in the 1Password
client vault (vault `AS` pattern, per `docs/environments.md`); the sender address's domain is **verified in
Resend**, not in this repo (D-AUTHF-2). **Never commit the key.** *(NFR-AUTHF-CONF-001/002.)*

**7.1a Local dev — `supabase/config.toml` (TOML, env-substituted).** The committed `config.toml` is the LOCAL
template and supports the `env(...)` substitution the cloud dashboard does **not**:
```toml
[auth.email.smtp]
enabled      = true
host         = "smtp.resend.com"                      # per Resend's current SMTP docs — confirm at provisioning
port         = 465                                     # 465 (SSL) or 587 (STARTTLS) per Resend docs
user         = "resend"                                # Resend SMTP user; password = the API key
pass         = "env(RESEND_API_KEY)"                   # LOCAL ONLY — config.toml resolves this from the dev env
admin_email  = "<sender-address>@<verified-domain>"    # CONFIG VALUE — no domain hardcoded in repo
sender_name  = "<Product or Org name>"                 # CONFIG VALUE
```
Locally the key is read from the developer's environment (`.env`, **not** committed).

**7.1b Cloud project — dashboard Auth → SMTP Settings (literal key, NOT `env()`).** GoTrue SMTP on a Supabase
**Cloud** project is configured in the **dashboard**, and the dashboard does **not** accept the `env(...)`
form — the **literal** API key goes in the SMTP password field. `supabase secrets set RESEND_API_KEY=…`
configures **edge-function** secrets and does **not** configure GoTrue SMTP; do **not** use it for this step.
Steps:
1. Retrieve the key from 1Password (vault `AS`): the `re_…` secret for this client.
2. Dashboard → **Authentication → SMTP Settings** → enable **Custom SMTP**.
3. Enter: Host `smtp.resend.com`; Port `465` (or `587` per Resend docs); Username `resend`;
   **Password = the literal `re_…` API key from 1Password** (paste directly — no `env()` wrapping);
   Sender email = `<sender-address>@<verified-domain>`; Sender name = `<Product or Org name>`;
   Minimum interval per the project's needs.
4. **Save**, then send the dashboard **test email** and confirm receipt at the target inbox.

**7.2 Redirect allowlist** — set, on the cloud project (Auth → URL configuration):
- `site_url` = the client's deployed **HTTPS** Cloudflare Pages URL (e.g. `https://<client>.<host>`);
- `additional_redirect_urls` = the same HTTPS origin (covering `/login`, `/update-password`).
No `localhost`, no `http`, no wildcard, no second origin. *(NFR-AUTHF-CONF-003.)*

**7.3 Auth toggles** — on the cloud project:
- `enable_confirmations = true` (email confirmation required) — NFR-AUTHF-CONF-004;
- `enable_signup = false` (invite-only — GTM item 1a issues all users) — NFR-AUTHF-CONF-004;
- `enable_anonymous_sign_ins` stays `false`;
- `minimum_password_length` / `password_requirements` kept at least as strict as the local template
  (`>=10`, `lower_upper_letters_digits`).

**7.4 Rate-limit & captcha** — on the cloud project (Auth → Rate limits / Auth → Captcha). The reset/confirm/
invite endpoints this issue exposes are the primary abuse surface:
- `[auth.rate_limit] email_sent = 2` — seconds between emails to the same address; production value **`2`**
  (mirrors the committed `config.toml` template; tune per client). This is the **primary** abuse lever for the
  reset/confirm endpoints. *(NFR-AUTHF-CONF-008.)*
- `[auth.captcha]` — enable captcha (hCaptcha / Cloudflare Turnstile per the project) for production once the
  provider keys are provisioned; `enabled = true` + `provider` + the secret/site-key pair is a per-client
  provisioning value (**no key committed**). Intended production value: **enabled**.
- **Rate-limit-vs-enumeration interaction (D-AUTHF-7, NFR-AUTHF-SEC-001):** a sender who is rate-limited learns
  that *the endpoint was hit repeatedly for that address* — a side channel distinct from the client-rendered
  message parity the app controls. The app cannot eliminate this (it is server-side), so the client keeps the
  **rendered** notice constant (FR-AUTHF-013) and treats a rate-limit response the same as other transient
  errors from the user's point of view; the `email_sent` + captcha levers bound the leakage rate.

**7.5 Seed-credential hygiene** — on a **real** client project (not staging/demo):
- rotate or disable the `Passw0rd!dev` / `admin@acme.test` user;
- **do not run** `scripts/db-seed-prod.sh` or `supabase/seed-admin.sql`;
- **do not set** `VITE_DEMO_MODE=true` on the client's CF Pages environment (the login demo panel must not
  appear). *(NFR-AUTHF-CONF-005, FR-AUTHF-060.)*

**7.6 Table-exposure** — set `auth.auto_expose_new_tables=false` on the cloud project (Data API settings) and
opt-in in the committed `supabase/config.toml`. *(NFR-AUTHF-CONF-006.)*

**7.7 Provisioning sign-off** — the Operator (glossary) completes 7.1–7.6 as the final step of new-client
provisioning (ADR-0047: this *is* the "add org" operation's auth step). Recorded against the client's
`docs/environments.md` registry row.

---

## 8. RLS / tenancy / schema interaction

- **No migration, no RLS change, no new table** in this issue (NFR-AUTHF-SEC-003). All `org_id` / RLS
  enforcement is untouched; the new pages carry no business data.
- The invite-acceptance path depends on the **ops-admin** handshake (§1.2): the `profiles` row (with `role`
  + `org_id`) must exist before acceptance. `org_id` continues to be client-unspoofable (column default +
  `WITH CHECK`, ADR-0017); the accepting user lands inside their org's RLS wall by construction.
- `profiles.role` remains the authoritative role source (`auth.spec.md` D-4); `auth_role()` in `0002_rls.sql`
  is unchanged. No JWT-claim fast-path is introduced here.

---

## 9. Out-of-scope / future

- **Google OAuth / social providers** — stretch, own issue (grill). **SAML** — out (grill).
- **Invite-issuance UI / user disable / `profiles.status` / service-role invite edge function** — GTM item 1a
  (§1.2). This issue consumes those rails; it does not build them.
- **Return-to-original-URL-after-login** — deferred (carries over from `auth.spec.md` §8).
- **MFA / passkeys / WebAuthn / anonymous sign-in** — not now.
- **Email-template customization** (branded reset/invite/confirm HTML) — deferred with the domain/brand
  decision; the runbook (§7.1a/b) notes `[auth.email.template.*]` as the future hook.
- **Live e2e for the confirm-required round-trip** — config-dependent (`enable_confirmations=true` flips the
  shared stack); classification + state are unit-owned (AC-AUTHF-025..027), and the email rails themselves are
  proven by AC-AUTHF-005 (reset) + AC-AUTHF-020 (invite) over Inbucket.

---

## 10. Traceability

| Concern (source) | This spec |
|---|---|
| `docs/backlog.md` GTM item 2 — "Resend SMTP" | D-AUTHF-1; FR-AUTHF-011; NFR-AUTHF-CONF-001; §7.1a/b |
| GTM item 2 — "password-reset flow" | §4.2 + §4.3; AC-AUTHF-001..015, AC-AUTHF-005 |
| GTM item 2 — "email confirm + invite emails" (acceptance) | §4.4 + §4.5; AC-AUTHF-020, AC-AUTHF-025..027 |
| GTM item 2 — "redirect allowlist → prod HTTPS only" | D-AUTHF-6/8; FR-AUTHF-050/051; NFR-AUTHF-CONF-003; §7.2 |
| GTM item 2 — "rotate/kill seed creds" | D-AUTHF-9; FR-AUTHF-060; NFR-AUTHF-CONF-005; §7.5 |
| GTM item 2 — "`auto_expose_new_tables=false`" | D-AUTHF-10; NFR-AUTHF-CONF-006; §7.6 |
| GTM item 2 — "build together with 1a (same rails)" + boundary | §1.2 handshake + `INVITE_PENDING` contract; FR-AUTHF-030..035; AC-AUTHF-016, AC-AUTHF-020 ext |
| GTM item 2 — "Google OAuth = stretch; SAML = out" | §2 non-goals; §9 |
| GTM BUILD-LOOP — "domain DEFERRED… env-var seams" | D-AUTHF-2; NFR-AUTHF-CONF-002; §7.1a/b (no hardcoded domain) |
| ADR-0047 — per-client Supabase Cloud Pro + CF Pages | §7 runbook = the per-client auth step; NFR-AUTHF-CONF-* |
| `auth.spec.md` — login/session/magic-link/impersonation foundation | Extended, not duplicated (§1.3); D-AUTHF-3 |
| `CLAUDE.md` — EARS + Given/When/Then + one-owning-layer + AC tagging | §4 / §6 / this spec's ID namespace |
| `CLAUDE.md` — shared form primitives + DESIGN.md tokens | D-AUTHF-12; NFR-AUTHF-UX-001..003 |
| `docs/product-expectations.md` Part C — RLS on every business table, no new exposure | NFR-AUTHF-SEC-003; §8 |
| Spec-review REVISE round (2026-07-04) — I-1..I-3, M-1..M-4 | §1.2 `INVITE_PENDING` contract; M-1 count fix; D-AUTHF-14; FR-AUTHF-027/034/035; NFR-AUTHF-SEC-001/002, CONF-008, REL-002; AC-AUTHF-003 title, AC-AUTHF-016/017, AC-AUTHF-020 ext; §7.1a/b, §7.4; §11.9 |

---

## 11. Self-verification (re-read against the brief + READ-FIRST docs)

Re-checked this spec against the task brief and the READ-FIRST documents. Deviations / notes:

1. **Boundary with ops-admin (item 1a)** — named explicitly in §1.2 and §4.4 (FR-AUTHF-030..035). Invite
   *issuance* (`inviteUserByEmail` service-role, `profiles.status`, profiles creation) is assigned to GTM item
   1a; this issue owns only the *acceptance* surface (plus the invite-pending gate FR-AUTHF-034/035, which
   consumes the §1.2 `INVITE_PENDING` contract item 1a produces). ✔ matches the brief's scope clause.
2. **No domain assumed** — D-AUTHF-2 + NFR-AUTHF-CONF-002 + §7.1a/b keep every sender/domain value behind config;
   no hardcoded domain appears anywhere in the spec. ✔
3. **Google OAuth / SAML** — both listed OUT (§2, §9); not specced. ✔
4. **Config/runbook as NFR with a `docs/environments.md` deliverable** — NFR-AUTHF-CONF-001…008 + §7 (the
   binding runbook content). Deliberately kept **out** of the §6 automatable AC battery (it mutates a live
   cloud project per client; ADR-0010's one-owning-layer rule covers *behavioral* ACs, and a per-client cloud
   config has no in-CI test layer) — flagged here as a conscious, documented exception rather than a hidden
   one. The brief's four config items (Resend/SMTP, redirect allowlist, seed rotation, `auto_expose=false`)
   are each an NFR + a runbook step. ✔
5. **Real Supabase API names** — `resetPasswordForEmail`, `updateUser({password})`, `resend({type:'signup'})`,
   `onAuthStateChange` `PASSWORD_RECOVERY`, `inviteUserByEmail` (issuance side, item 1a), `[auth.email.smtp]`,
   `site_url`/`additional_redirect_urls`, `auto_expose_new_tables`. No invented APIs. ✔
6. **EARS + Given/When/Then + one-owning-layer + AC tagging** — §4 is EARS-typed; §6 is Given/When/Then with a
   single owning layer per AC and the tagging convention stated; the `AUTHF` namespace avoids collision with
   the existing `AUTH` namespace. ✔
7. **Did NOT implement / did NOT touch other files / did NOT re-litigate grill decisions** — this is a spec
   only; §3 records the grill outcomes as baked. ✔
8. **Minor note (not a deviation):** Resend's exact SMTP `host`/`port`/`user` are given as the
   commonly-documented values and flagged "confirm at provisioning" (§7.1a/b) — the grill locked *Resend as the
   provider + the `RESEND_API_KEY` seam + configurable sender*, not a specific port, so this stays within the
   locked decisions while remaining honest about a value the implementer should verify against Resend's
   current docs.
9. **Review-fix round (REVISE → fix, 2026-07-04).** An independent review returned REVISE with I-1..I-3 +
   M-1..M-4; all resolved in-place, no unflagged section reworked: **I-1** (invite/recovery session scope) →
   GATE decision: §1.2 `INVITE_PENDING` contract (both directions), D-AUTHF-14 (recovery NOT gated, with
   rationale), FR-AUTHF-034 (gate) + FR-AUTHF-035 (clear-in-same-call), NFR-AUTHF-REL-002 extended, AC-AUTHF-016
   (unit/router) + AC-AUTHF-020 extended (e2e). **I-2** (cloud SMTP runbook) → §7.1 split into 7.1a (local TOML
   `env()`) / 7.1b (cloud dashboard, literal key). **I-3** (rate-limit absent) → §7.4 rate-limit/captcha step +
   NFR-AUTHF-CONF-008 + rate-limit-vs-enumeration note. **M-1** → namespace count corrected. **M-2** →
   enumeration NFR/AC softened to client-observable parity. **M-3** → URL-token-cleanup FR-AUTHF-027 +
   NFR-AUTHF-SEC-002 sentence + AC-AUTHF-017. **M-4** → AuthProvider event-discard reality noted in §1.3.

SPEC-FIX-DONE