# Auth Specification: Real Supabase Auth (Issue #3)

> **Status:** Module spec for Issue #3 — "replace mock `UserContext` with real Supabase Auth". Synthesized
> from `target-architecture.spec.md §7/§2.3/§10`, `baseline.spec.md §5.1/§5.2`, `supabase/migrations/0002_rls.sql`,
> `supabase/seed.sql`, and the Director's locked decisions. Conforms to house conventions (`CLAUDE.md`):
> EARS requirements `FR-AUTH-###`, Given/When/Then acceptance criteria `AC-###` (each → one `e2e/<AC>.spec.ts`).
>
> **Owner is AFK.** Reasonable assumptions are made and flagged `[OWNER-DECISION]` where the owner should
> confirm before production cutover. No requirement is blocked on the owner.

---

## 1. Scope

### 1.1 In scope (this issue)
Replace the client-side **role-simulation** auth (`OBS-AUTH-001..006`) with **real Supabase Auth (GoTrue)**:
- Typed Supabase browser client (`src/lib/supabase/client.ts`) reading env config.
- A real session + profile + role context (`AuthProvider` / `useAuth`) replacing mock `UserContext`.
- `BrowserRouter` (was `HashRouter`, `OBS-NAV-003`), a `/login` route, and an unauthenticated-redirect route guard.
- Nav role-gating (`Sidebar`/`Header`) driven by the **real** role from `profiles.role`.
- The Header role-switch dropdown re-cast as an **Admin-only client-side impersonation** ("view as role") control.
- Real credentialed GoTrue seed users so each seeded profile can actually sign in (dev only).

### 1.2 Out of scope (later issues — do NOT implement here)
- The full data-access layer (`src/lib/db/*`) and swapping any page's business data mock→real (**Issue #4**).
  Pages keep reading `data/mockData.ts` for business data; **only the user/role identity** comes from Supabase.
- Password reset, MFA, OAuth/social providers (future — §8).
- The `app_metadata.role` JWT fast-path claim and its profiles→claim sync trigger. `auth_role()` in
  `0002_rls.sql` reads `profiles.role` and is **unchanged by this issue** (see §6, future per that file's note).

### 1.3 Relationship to existing code
- `context/UserContext.tsx`, `App.tsx` (`HashRouter`), `components/Header.tsx` (role-switch), `components/Sidebar.tsx`
  (role gate), `index.tsx` are the AS-IS surfaces being replaced/rewired. `pmo-portal/src/lib/supabase/database.types.ts`
  already exists (generated); the client and context consume `Database` / `Tables<'profiles'>` from it.
- `0001_init_schema.sql` (`profiles`, default org `00000000-0000-0000-0000-000000000001`) and `0002_rls.sql`
  (`auth_org_id()`/`auth_role()` read `profiles`; RLS needs `auth.uid()`) are already authored. This issue makes
  `auth.uid()` real (a logged-in GoTrue user) so those policies resolve against a genuine session.

---

## 2. Design decisions (baked in)

| # | Decision | Source / rationale |
|---|---|---|
| D-1 | Auth methods: **email/password + magic link**. | Director locked; `target-architecture §7.1`. |
| D-2 | Email confirmations **OFF for dev** (`config.toml auth.email.enable_confirmations = false`, already set). | Director locked. `[OWNER-DECISION]` enable for pre-prod/prod (§7). |
| D-3 | Typed singleton client at `src/lib/supabase/client.ts`, env-driven (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). | Director locked; `target-architecture §2.2`, ADR-0002 (anon key public by design). |
| D-4 | `profiles.role` is the **authoritative** role. No JWT role claim wired this issue. | `0002_rls.sql` comment (claim fast-path removed pending signed claim + audited sync). |
| D-5 | `AuthProvider`/`useAuth` replace `UserContext`/`useUser`; subscribe to `supabase.auth.onAuthStateChange`; load the signed-in user's `profiles` row; expose `currentUser`, `role`, `signOut`, `signInWithPassword`, `signInWithMagicLink`. | Director locked; `target-architecture §7.3`. |
| D-6 | `BrowserRouter` + `/login` route + `RequireAuth` guard (unauthenticated → `/login`). | Director locked; `target-architecture §10`, `FR-ARCH-004`. |
| D-7 | Header role-switch → **Admin-only impersonation** ("view as role"); non-Admins do not see it; **client-side view only** (does NOT change RLS/server identity). | Director locked. **Limitation flagged** in §3.4 + AC-AUTH-010. |
| D-8 | Real credentialed GoTrue seed users replace bare `auth.users` rows; dev credentials documented. | Director locked; `seed.sql` NOTE. |

### 2.1 Identity / role mapping (mock → real)
- Mock `User` (`types.ts`, numeric `id`) is **not** the auth identity going forward. The authenticated user
  is a `profiles` row (`Tables<'profiles'>`: `id: uuid = auth.users.id`, `full_name`, `email`, `avatar_url`,
  `role: user_role`). `useAuth().currentUser` is the `profiles` row; `useAuth().role` is `profiles.role`.
- `Sidebar`/`Header` consume `role` (the `user_role` string enum `'Executive' | 'Project Manager' | 'Finance'
  | 'Engineer' | 'Admin'`) — same string values as the existing `UserRole` enum, so nav-gating logic is preserved.

---

## 3. Functional requirements (EARS)

### 3.1 Client & configuration
- **FR-AUTH-001** (ubiquitous) The system shall expose a single typed Supabase browser client created from
  `import.meta.env.VITE_SUPABASE_URL` and `import.meta.env.VITE_SUPABASE_ANON_KEY`, typed with the generated
  `Database` type. *(D-3)*
- **FR-AUTH-002** (event-driven) When either `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing at
  module load, the system shall throw a descriptive error rather than construct a client with `undefined` config. *(fail-fast; NFR-DEPLOY-001)*
- **FR-AUTH-003** (ubiquitous) The system shall never embed the Supabase service-role key in the browser bundle;
  only the anon key is used client-side. *(ADR-0002; NFR-SEC-002)*

### 3.2 Session & role context
- **FR-AUTH-010** (event-driven) When the application mounts, the system shall read any persisted Supabase session
  and, if present, load the matching `profiles` row before rendering protected routes. *(replaces `OBS-AUTH-001`)*
- **FR-AUTH-011** (event-driven) When the Supabase auth state changes (sign-in / sign-out / token refresh), the
  system shall update the in-memory session, profile, and role accordingly. *(subscribe to `onAuthStateChange`)*
- **FR-AUTH-012** (state-driven) While a session exists but its `profiles` row is still loading, the system shall
  render a loading state and shall not render protected business routes.
- **FR-AUTH-013** (event-driven) When `useAuth` is called outside an `AuthProvider`, the system shall throw
  `"useAuth must be used within an AuthProvider"`. *(parallels `OBS-AUTH-005`)*
- **FR-AUTH-014** (state-driven) While authenticated, the system shall expose `currentUser` (the `profiles` row),
  `role` (`profiles.role`), `session`, `signInWithPassword`, `signInWithMagicLink`, and `signOut` via `useAuth()`. *(D-5)*

### 3.3 Authentication flows
- **FR-AUTH-020** (event-driven) When a user submits valid email + password on `/login`, the system shall establish
  an authenticated session and navigate to `/` (the dashboard). *(`FR-AUTH-001` target-arch)*
- **FR-AUTH-021** (event-driven) When a user submits invalid credentials on `/login`, the system shall display an
  inline error and shall not navigate away from `/login`.
- **FR-AUTH-022** (event-driven) When a user requests a magic link with a valid email on `/login`, the system shall
  call `signInWithMagicLink` and display a "check your email" confirmation; completing the emailed link shall
  establish a session and land on `/`. *(testable via local Inbucket, `config.toml inbucket` port 54324)*
- **FR-AUTH-023** (event-driven) When a user signs out, the system shall clear the Supabase session and route to
  `/login`. *(`FR-AUTH-004` target-arch; replaces no-op mock)*
- **FR-AUTH-024** (event-driven) When the application reloads while a valid session exists, the system shall restore
  the session without re-prompting. *(replaces reset-on-refresh `OBS-AUTH-006`; `FR-AUTH-005` target-arch)*

### 3.4 Routing, guards & role gating
- **FR-AUTH-030** (ubiquitous) The system shall use `BrowserRouter`. *(replaces `HashRouter`, `OBS-NAV-003`; `FR-UI-001`)*
- **FR-AUTH-031** (state-driven) While unauthenticated, the system shall redirect any protected route to `/login`,
  including direct deep-link navigation. *(`FR-ARCH-004`; closes the cosmetic-only gating gap, `baseline §5.2` note)*
- **FR-AUTH-032** (ubiquitous) The system shall render sidebar/header nav items based on the **real** `role`,
  preserving the existing role→nav mapping (`OBS-NAV-001/002`): Engineer sees no Sales/Procurement/Companies/Reports
  and no Administration; Executive/Admin see Administration.
- **FR-AUTH-033** (state-driven) While the current role is `Admin`, the system shall render an impersonation
  ("View as role") control offering the four non-Admin roles; while the role is not `Admin`, the system shall not
  render that control. *(D-7; replaces `OBS-AUTH-002/003`)*
- **FR-AUTH-034** (event-driven) When an Admin selects a role in the impersonation control, the system shall change
  the **client-side displayed role** (driving nav gating and any role-branched view) without changing the Supabase
  session or any server identity. *(D-7)*
- **FR-AUTH-035** (ubiquitous) The system shall treat impersonation as **view-only**: it shall not alter `auth.uid()`,
  the JWT, or RLS evaluation, and any future server data fetch shall still execute under the Admin's real identity.
  **Limitation:** impersonation cannot preview another user's row-level data; it only previews role-gated UI. *(D-7)*

### 3.5 Seed
- **FR-AUTH-040** (ubiquitous) The system shall seed real credentialed GoTrue users (one per seeded profile) so each
  profile can sign in locally; the profiles FK (`profiles.id → auth.users.id`) shall resolve after a fresh reset. *(D-8; replaces bare `auth.users` in `seed.sql`)*
- **FR-AUTH-041** (ubiquitous) Seeded dev credentials shall be documented (in `.env.example` / a seed note) and shall
  exist only in the local seed path — never in production seeds. *(`[OWNER-DECISION]` prod seeding strategy, §7)*

---

## 4. Non-functional requirements

- **NFR-AUTH-SEC-001** No secrets committed: `.env.local` is gitignored; only `.env.example` (placeholder/local-dev
  values) is committed; no service-role key client-side. *(NFR-SEC-002, NFR-DEPLOY-001)*
- **NFR-AUTH-SEC-002** Authorization remains server-enforced by RLS; client-side guards/impersonation are UX only and
  non-authoritative. *(NFR-SEC-001; FR-AUTH-035)*
- **NFR-AUTH-TEST-001** The session/role context and `RequireAuth` guard shall be unit-tested with a mocked Supabase
  client (no network). The login→dashboard→sign-out flow and deep-link redirect shall be covered by Playwright e2e
  against the local Supabase stack.
- **NFR-AUTH-UX-001** `/login` and the auth-loading state shall handle loading/error states (no blank screens, no
  unhandled promise rejections); keyboard-operable form controls (WCAG AA, `FR-UI-002`).

---

## 5. Acceptance criteria (Given/When/Then)

> Each maps 1:1 to `e2e/<AC-id>.spec.ts` (Playwright) **except** AC-AUTH-007/008 which are unit-level (Vitest, mocked
> client) and are noted as such. e2e AC require the local Supabase stack running (`supabase start`) + `npm run dev`.

**AC-AUTH-001 — Unauthenticated user is redirected to /login** (FR-AUTH-031) *(e2e)*
Given no active session
When I navigate to `/`
Then I am redirected to `/login` and the sign-in form is shown.

**AC-AUTH-002 — Protected deep-link blocked when logged out** (FR-AUTH-031) *(e2e)*
Given no active session
When I navigate directly to `/projects/40000000-0000-0000-0000-000000000001`
Then I am redirected to `/login` (no project data renders).

**AC-AUTH-003 — Valid password login lands on dashboard with correct role** (FR-AUTH-020, FR-AUTH-032) *(e2e)*
Given I am on `/login`
When I sign in as `pm@acme.test` with the seeded password
Then I land on `/`, the header shows "Alice Manager" / "Project Manager", and the sidebar shows Projects, Sales Pipeline, Procurement, Timesheets (Project Manager nav set).

**AC-AUTH-004 — Invalid credentials show an error and stay on /login** (FR-AUTH-021) *(e2e)*
Given I am on `/login`
When I submit `pm@acme.test` with a wrong password
Then an inline error is shown and the URL is still `/login`.

**AC-AUTH-005 — Magic-link login completes via local inbox** (FR-AUTH-022) *(e2e, local stack + Inbucket)*
Given I am on `/login`
When I request a magic link for `engineer@acme.test`, open the email in the local Inbucket (port 54324), and follow the link
Then I land on `/` authenticated as "Dave Engineer".

**AC-AUTH-006 — Sign-out returns to /login** (FR-AUTH-023) *(e2e)*
Given I am signed in and on `/`
When I click "Sign out"
Then I am routed to `/login` and navigating back to `/` redirects to `/login`.

**AC-AUTH-007 — useAuth exposes profile + role from the session** (FR-AUTH-010, FR-AUTH-014) *(unit, mocked client)*
Given a mocked Supabase client returning a session for `00000000-0000-0000-0000-0000000000a2` and a `profiles` row with role "Project Manager"
When a component renders inside `AuthProvider` and reads `useAuth()`
Then `currentUser.full_name === "Alice Manager"` and `role === "Project Manager"`.

**AC-AUTH-008 — RequireAuth renders children only when authenticated** (FR-AUTH-012, FR-AUTH-031) *(unit, mocked client)*
Given `RequireAuth` wrapping a protected element
When the mocked client reports no session
Then it renders a redirect to `/login` (not the protected element); when it reports a session + loaded profile, it renders the protected element.

**AC-AUTH-009 — Engineer role hides Administration and restricted nav** (FR-AUTH-032) *(e2e)*
Given I am signed in as `engineer@acme.test` (Engineer)
When I view the sidebar
Then Sales Pipeline, Procurement, Companies, Reports, and Administration are hidden, and Dashboard, Projects, Timesheets, Tasks are shown.

**AC-AUTH-010 — Admin sees impersonation and can view as a role (client-side)** (FR-AUTH-033, FR-AUTH-034, FR-AUTH-035) *(e2e)*
Given I am signed in as `admin@acme.test` (Admin)
When I open the "View as role" control and select "Engineer"
Then the sidebar updates to the Engineer nav set; the underlying session/identity is unchanged (signing out still works and the real account stays Admin).

**AC-AUTH-011 — Non-Admin does not see the impersonation control** (FR-AUTH-033) *(e2e)*
Given I am signed in as `finance@acme.test` (Finance)
When I view the header
Then no "View as role" / impersonation control is rendered.

**AC-AUTH-012 — Session persists across reload** (FR-AUTH-024) *(e2e)*
Given I am signed in and on `/`
When I reload the page
Then I remain on `/` authenticated (no redirect to `/login`, no re-prompt).

---

## 6. RLS / tenancy interaction (no schema change this issue)

- `0002_rls.sql` `auth_org_id()` and `auth_role()` read `profiles` keyed on `auth.uid()`. Making auth real means
  `auth.uid()` is a genuine logged-in GoTrue user, so every existing policy now evaluates against a real identity.
- **This issue does not modify migrations or RLS.** It does **not** add the `app_metadata.role` JWT claim or a
  profiles→claim sync trigger (that returns in a later issue per the `0002_rls.sql` note). `profiles.role` stays
  authoritative (D-4).
- `org_id` seam: untouched — column default (`0001`) + `WITH CHECK` (`0002`) keep `org_id` client-unspoofable.
  Seeded profiles all belong to the single default org, so tenant isolation is a structurally-present no-op (per
  `target-architecture §6.4`).

---

## 7. `[OWNER-DECISION]` flags (confirm before pre-prod / prod)

- **`[OWNER-DECISION]` D-2 / prod email confirmations:** dev runs with `enable_confirmations = false`. Before
  pre-prod, enable email confirmation (and configure a real SMTP provider in `config.toml [auth.email.smtp]`).
- **`[OWNER-DECISION]` D-8 / prod seeding:** real credentialed users with documented passwords are **dev-only**.
  Production user provisioning (invite flow / admin-created accounts, no shared passwords) is a separate decision.
- **`[OWNER-DECISION]` impersonation in prod:** Admin client-side "view as role" is a UX convenience that does NOT
  preview row-level data (FR-AUTH-035). Confirm whether a server-side impersonation (e.g. audited, RLS-aware) is
  ever required; if so it becomes its own issue.
- **`[OWNER-DECISION]` post-login redirect target:** assumed `/` (dashboard). Confirm whether deep-link "return to
  intended URL after login" is desired (deferred to a follow-up; see §8).

---

## 8. Future / deferred

- `app_metadata.role` JWT claim + audited profiles→claim sync trigger (re-enables `auth_role()` fast-path).
- Password reset, MFA, OAuth/social providers.
- "Return to originally-requested URL after login" (currently always lands on `/`).
- CI wiring for Playwright against an ephemeral Supabase stack (this issue brings e2e live locally; CI is a follow-up).

---

## 9. Traceability

| Concern | Baseline / target | This spec |
|---|---|---|
| Mock role-simulation auth | `OBS-AUTH-001..006`, `F-2` | §2, FR-AUTH-010..024 |
| Cosmetic-only nav gating | `baseline §5.2` note, `NFR-002` | FR-AUTH-031/032, AC-AUTH-001/002/009 |
| HashRouter | `OBS-NAV-003` | FR-AUTH-030 |
| Role lives in profiles, RLS reads it | `target-arch §7.2`, `0002_rls.sql` | D-4, §6 |
| Env-driven client, no secrets | `target-arch §2.2`, ADR-0002, `NFR-DEPLOY-001` | FR-AUTH-001..003, NFR-AUTH-SEC-001 |
| Bare auth.users to replace | `seed.sql` NOTE | FR-AUTH-040/041 |
| Admin role semantics (impersonation) | `target-arch §7.1` `[ASSUMPTION]`, `baseline §10` | D-7, FR-AUTH-033..035 |
