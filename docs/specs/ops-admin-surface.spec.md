# Feature: Ops-Admin surface (GTM / MVP-viability program, item 1)

> **Authority:** This spec encodes the **owner-approved requirements grill of 2026-07-04** (locked;
> do not re-open — see "Grill decisions of record" below). It is the whole of backlog
> `docs/backlog.md` §"GTM / MVP-viability program" item **1 (Ops-Admin surface)**, (a)–(e), as one
> coherent administration surface under `/administration`. The plan (`docs/plans/`) slices it into
> buildable issues; this document is the contract the slices satisfy.
>
> **Controlling ADRs (binding):** ADR-0016 (`can()` is UX-only; RLS/RPC is the authority; gate on
> the **real JWT role**), ADR-0017 (typed repository seam; `org_id` never client-sent), ADR-0019
> (server-enforced SoD + destructive writes via security-definer RPC / restrictive RLS + pgTAP
> proof), ADR-0047 (per-client Supabase-Cloud-Pro isolation; one org per project today,
> forward-compatible to multi-org), ADR-0018 (soft-archive; the disable affordance reuses the
> pattern), ADR-0010 (test pyramid; one owning layer per AC).
>
> **Glossary (binding, `docs/glossary.md`):** **Operator** — the platform-level persona (the vendor
> operating PMO), distinct from any org role; owns creating orgs, granting AI credits, toggling
> per-org feature entitlements; **NOT a sixth org role** — granted by a separate platform-level
> mechanism. **Organization (org)** — the tenant boundary; one paying client **group** (subsidiaries
> are an Entity dimension inside the org, never separate orgs). **Entity** — a subsidiary dimension
> on the org's data. **Admin** — the client's own in-org administrator role (`user_role` enum value).
>
> **Related specs:** `docs/specs/agent-usage-credits.spec.md` (the `agent_usage` + `credits` ledger
> this surface refactors to org-pool and reports on), `docs/specs/agent-persistence.spec.md`
> (ADR-0043; `agent_threads`/`agent_runs`/`agent_events` — the transcript tables this surface is
> **forbidden** from reading). **Boundary — out of this spec:** the invite-**ACCEPT** flow (Resend
> SMTP, the invite email, the magic-link / password-set landing, the redirect allowlist → prod
> HTTPS) is the separate **`auth-production-floor`** spec (backlog item 2). This spec owns
> invite-**issuance** only and names the hand-off edge explicitly (FR-INV-004).

---

## Overview

Today `/administration` (`pmo-portal/pages/AdminUsers.tsx`) is an org-Admin directory of `profiles`
with role + manager edits only — "Add user" is a permanently-disabled control (the Supabase
auth-admin invite API needs a service-role key the client can't hold) and there is no disable, no
credits UI, no usage view, and no feature-entitlements system. Two as-built gaps make this unsafe
to sell:

1. **Credits self-grant (migration `0047_agent_usage_credits.sql`, `credits_insert` policy).** The
   INSERT policy is `auth_role() = 'Admin'` — any client org-Admin can INSERT a `credits` row of
   any size for their own org and mint themselves unlimited AI spend. This is a **revenue hole**;
   the grill locked the fix: grants become **Operator-only**, scoped to the **org pool**.
2. **No Operator persona.** Platform powers (grant credits, toggle entitlements, see all-org usage)
   have no server representation, so they can't be enforced or delegated.

This feature ships the **Ops-Admin surface**: a single `/administration` page composed of five
sections — **Users** (invite / disable / re-enable + the existing role/manager edits), **Credits**
(Operator grants + org-Admin read-only balance), **Usage** (aggregated agent spend with a margin
column; Operator sees all orgs, org-Admin sees own org), **Features** (per-org entitlement toggles
and the FE `useFeature()`/`<FeatureGate>` rail+route+affordance gate), and an **Operator** mechanism
underneath (`platform_operators` table + `is_operator()` SQL helper + Operator-only security-definer
RPCs). A hard **privacy line** runs through all of it: admin/operator surfaces read **aggregates
only** — never `agent_events`/`agent_runs`/`agent_threads` transcript content.

**User value:**
- *As the Operator (vendor), I grant an org AI credits and toggle which modules they can use, and I
  see what every org is spending — so I can run the business without SQL access and without ever
  seeing a client's private conversation content.*
- *As an org Admin, I invite my colleagues, disable a leaver, see our remaining credit balance and
  our team's aggregated assistant usage — so I can manage my workspace self-serve.*
- *As a user in an org whose feature was turned off, the rail item and route simply aren't there
  (re-enabling restores everything; nothing is destroyed).*

This is the whole of backlog GTM item 1. **CUT and named out of scope** (owner-confirmed): custom
RBAC engine / roles editor; Stripe / billing; a separate operator-console app; any transcript
reading (forbidden, not merely deferred).

---

## Grill decisions of record (owner-approved 2026-07-04 — binding, do not re-open)

| Decision | Lock |
|---|---|
| **Operator is a platform grant, not a 6th role enum value.** | `platform_operators` table keyed by `user_id`; RLS/RPCs key on `is_operator()`. The `user_role` enum (`Executive`,`Project Manager`,`Finance`,`Engineer`,`Admin`, `0001_init_schema.sql:11`) is **unchanged**. |
| **Seeded Operator = `operator@pmo.test`.** | Seed (`supabase/seed.sql` for staging/demo; per-client provisioning runbook for real projects) creates a `profiles` row + a `platform_operators` row for that user. |
| **Org-Admin AND Operator may invite users.** | Issuance runs in a **service-role edge function**; the FE gates the affordance on `can('create','user')` (org-Admin) **or** `isOperator()`. |
| **Credits are org-pool, not per-user.** | A grant is recorded against the org; balance = Σ org grants − Σ org-wide `agent_usage.cost`. Per-user `agent_usage.owner_id` is **retained** for the usage view (attribution), not for the balance. |
| **Credits INSERT RLS flips `auth_role()='Admin'` → `is_operator()` only.** | Closes the revenue hole in `0047_agent_usage_credits.sql` `credits_insert`. Cited as the defect being fixed. |
| **`AGENT_CREDITS_ENFORCED` semantics keep working against the org pool.** | The `RateGuard` preflight (`agent-usage-credits.spec.md` FR-AUC-011) computes the **org** balance, not the owner balance. |
| **Usage = aggregates only; transcripts are off-limits.** | Hard privacy line. No admin/operator surface reads `agent_events`/`agent_runs`/`agent_threads`. Proven by pgTAP. |
| **`org_features` write is Operator-only; org-Admin read-only.** | **Flips the 2026-06-15 backlog note** (which proposed admin-write). Recorded as an explicit reversal. |
| **Feature-disable = hide, never destroy.** | Re-enabling restores all data affordances; core modules (Projects, Dashboard, Approvals, Administration) are **never** gated. |
| **UI-hide-first for entitlements; server-enforcement per-module RLS deferred.** | `org_has_feature(key)` SQL fn ships now but is **not yet** applied to gated module tables' RLS (the paywall hook). The `org_features` table itself gets **real RLS**. |
| **Issuance here; invite-accept flow is `auth-production-floor`.** | The edge fn issues the invite; the email/SMTP/link/redirect/allowlist is backlog item 2. |

---

## Scope (five sub-features — one coherent `/administration` surface)

**(a) User invite / disable / re-enable** — §FR-INV-*. (b) **Operator mechanism** — §FR-OPR-*.
**(c) Credits → org-pool** — §FR-CRE-*. (d) **Usage view** — §FR-USE-*. (e) **`org_features`
entitlements** — §FR-ENT-*. Cross-cutting security/privacy/perf in §NFR-*.

### In scope
- `profiles.status` column + disable/re-enable RPCs + session/RLS enforcement.
- A service-role **`admin-invite-user`** edge function (issuance only; boundary named in FR-INV-004).
- `platform_operators` table + `is_operator()` helper + seed.
- Org-pool credits refactor of `0047_agent_usage_credits.sql` + the `credits_insert` RLS flip.
- `agent_usage` schema additions for the usage view (`provider_cost_usd`, `action`) + the aggregate
  view/RPC (Operator all-orgs, org-Admin own-org).
- `org_features` table + feature registry + `org_has_feature()` fn + RLS (read own-org, write
  Operator-only) + FE `useFeature()`/`<FeatureGate>` mirroring `usePermission()`/`<CanWrite>`.
- The `/administration` page composed into Users / Credits / Usage / Features sections with
  Operator-conditional affordances and an Operator org-switcher (forward-compatible; 1 org today).

### Out of scope (deferred / CUT — owner-confirmed)
- **Invite-ACCEPT flow** (Resend SMTP, invite/confirm emails, magic-link landing, password set,
  redirect allowlist → prod HTTPS, seed-cred rotation) → `auth-production-floor` (item 2).
- **Pricing strategy** (what a credit costs, default grant size, tiered plans, USD↔credit rate).
  The margin column is computed against an optional `CREDITS_PER_USD` env and is **informational**
  (null/hidden) until pricing lands (NFR-USE-PRIV-002 / FR-USE-006).
- **Per-module `AND org_has_feature(...)` RLS enforcement** (the paywall) — `org_has_feature()`
  ships now, unused by gated tables; the ADR records the UI-first bypass risk.
- **Custom RBAC engine / roles editor** (CUT; escape valve = read-only Viewer role, its own issue).
- **Stripe / Midtrans billing** (CUT; manual MSA billing).
- **A separate operator-console application** (CUT; <~5 deployments, lives inside `/administration`).
- **Reading `agent_events`/`agent_runs`/`agent_threads` content** from any admin/operator surface
  — **forbidden**, not deferred (NFR-PRIV-001).
- **Entity (subsidiary) dimension** (item 7) — orthogonal; build only when a group-of-companies
  client signs.
- **Google OAuth / SAML** — `auth-production-floor` (OAuth stretch; SAML out).

---

## Glossary alignment (binding; resolves the admin-slice TODOs)

- **Operator ≠ Admin.** An org-Admin is a client role (`user_role='Admin'`, in one org, behind that
  org's RLS wall). The Operator is a platform grant (`platform_operators`) that **transcends** the
  org boundary: Operator powers are exercised via security-definer RPCs that take an explicit
  `org_id` and assert `is_operator()`, never via the org-scoped `auth_org_id()` policies. A user may
  hold both (an Operator who is also an org-Admin in a given project), but the powers are disjoint.
- **Organization = client group** behind one RLS wall. Per ADR-0047 there is **one org per Supabase
  project** today; the "Operator sees all orgs" affordance is forward-compatible (an org switcher
  over ≥1 org) and collapses to a single org now.
- **Entity = subsidiary dimension** inside the org — not modelled by this surface; the usage/
  credits/feature axes are **org**-scoped, never Entity-scoped.

---

## Functional requirements (EARS)

> EARS keywords: ubiquitous (`The system shall…`), event-driven (`When <trigger>, the system shall…`),
> state-driven (`While <state>, the system shall…`), optional-feature (`Where <feature>, the system
> shall…`), conditional (`While <state>, when <event>, the system shall…`). IDs: `FR-<AREA>-NNN`.

### (a) User invite / disable / re-enable — FR-INV-*

**FR-INV-001 — `profiles.status` column.**
The system shall add a `profiles.status` column of a new `profile_status` enum (`'active'`,
`'disabled'`), `NOT NULL DEFAULT 'active'`, to the `profiles` table (migration; reversibility via
`supabase db reset` and a documented reverse). Existing seed/profiles default to `'active'`.

**FR-INV-002 — Disable is server-enforced (Admin in-org OR Operator), reversible.**
While the caller is an org-Admin (`auth_role()='Admin'` and `org_id = auth_org_id()`) **or** an
Operator (`is_operator()`), when the caller invokes the disable affordance on a profile in their org
(or, for an Operator, the selected org), the system shall set that profile's `status='disabled'` via
a security-definer RPC `admin_set_user_status(p_profile_id uuid, p_status profile_status,
p_org_id uuid)` that re-asserts the caller's authority, and shall revoke the user's active Supabase
sessions (refresh-token invalidation / `banned_until` via the service-role edge function path), and
shall record the actor. A re-enable sets `status='active'` and lifts the ban. Self-disable and disabling the sole org-Admin
are rejected by the RPC (SoD / lockout guard) **regardless of who the caller is — including an
Operator** (so no Operator can brick an org's only Admin; the guard is caller-agnostic).

**FR-INV-003 — Disabled members read nothing and cannot resume.**
While a profile's `status='disabled'`, the system shall deny that user all reads of business tables
and shall prevent new/refreshed sessions. The mechanism is a reusable SQL predicate
`is_active_member()` = `exists (select 1 from profiles where id = auth.uid() and status='active')`
conjoined into **every business-table policy — SELECT `USING`, and the write policies' `USING`/
`WITH CHECK` (INSERT/UPDATE/DELETE) alike** (one mechanical migration pass; mirrors the existing
`org_id = auth_org_id()` conjunct — a disabled user with a still-valid JWT must be unable to WRITE,
not just read; security-definer RPCs assert the same predicate at entry), **plus** session revocation on
disable (FR-INV-002) so a still-valid short-lived JWT reads nothing the moment refresh fails.

**FR-INV-004 — Invite issuance runs in a service-role edge function; rejects unauthorized callers.**
While the caller is an org-Admin (`auth_role()='Admin'` and `org_id = auth_org_id()`) **or** an
Operator (`is_operator()`), when the caller submits an invite (email + role), the system shall call
the **`admin-invite-user`** edge function, which uses the **service role** key (server-only, never
shipped to the client) to issue the Supabase auth invite (`auth.admin.inviteUserByEmail`) and to
create the `profiles` row (org_id, role, status='active'), and shall return success. The edge
function **shall reject** (`401`/`403`) any caller whose JWT proves **neither** Admin-in-org **nor**
Operator — the service-role key is never exercised for an unauthorized caller (a binding SHALL, not
just a task note). **Boundary:** the invite-**ACCEPT** flow — the email body, SMTP (Resend), the
magic-link / password-set landing page, the redirect allowlist → prod HTTPS — is the separate
**`auth-production-floor`** spec (backlog item 2); this spec's edge function issues only.

**FR-INV-005 — Invite validates inputs and org membership.**
While the caller is an org-Admin or an Operator, when the caller submits an invite for an email
already present in the target org, the system shall reject the invite with a classified
`23505`-style duplicate error; when the role is not a valid `user_role`, the system shall reject
with a validation error. Operators cannot invite into an org that does not exist. **Conscious
decision:** the duplicate check is scoped to the **target** org only (correct — no cross-org data
leak to org-Admins), but an Operator iterating invites across orgs can probe whether an email
already belongs to *some other* org (a cross-org membership oracle). This is **accepted** — the
Operator is trusted platform staff, and the alternative (a global duplicate-suppression that
reveals nothing) would block legitimate cross-org reuse of an email; recorded here as a deliberate
tradeoff, not an oversight.

**FR-INV-007 — An invite has one defined outcome per case (#2252).**
When the address already belongs to an account the caller cannot add (another organization, or an
account the auth service already holds), the system shall answer `409 INVITE_NOT_ADDABLE` with the
same body for every reason and for an org-Admin and an Operator alike. When the caller repeats an
invite identical to an existing member (same address, organization and role), the system shall
answer `200 { ok: true, already_invited: true }` without a second email or profile while the member's
invite link is still valid or they have accepted; while the member is still pending and the link has
expired (the auth service's email-link expiry, counted from `confirmation_sent_at`), the system shall
issue a fresh link, send one email and answer `200 { ok: true, invite_resent: true }`. A repeat with
a different role keeps `409 DUPLICATE_EMAIL`. When two invites for the same address race and the
other wrote the profile first, the system shall answer `409 INVITE_RETRY` with `Retry-After: 1`,
leave no half-made profile, and the retry shall get the idempotent success.

**FR-INV-006 — `/administration` Users section exposes the affordances.**
While a user with `can('create','user')` (org-Admin) or `isOperator()` views `/administration`, the
system shall render the "Add user" affordance (wired), the row-menu "Disable"/"Re-enable" actions
(confirmed, destructive-styled for disable), and the existing "Edit role"/"Change manager" actions;
while a non-Admin, non-Operator, non-Executive views the route, the system shall render the
existing Admin-only gate (`GateNotice variant="blocked"`).

### (b) Operator mechanism — FR-OPR-*

**FR-OPR-001 — `platform_operators` table (one SELECT policy, no write policy).**
The system shall create a `platform_operators` table: `user_id uuid primary key references
profiles(id) on delete cascade`, `granted_at timestamptz not null default now()`, `granted_by uuid
references profiles(id)`, with RLS enabled and forced, and **no** `org_id` column (the grant is
platform-level, not tenant-scoped). The table shall carry **exactly one** policy — `FOR SELECT USING
(user_id = auth.uid())` (a member can confirm **only their own** membership; this is what makes the
plain `is_operator()` sub-select in FR-OPR-002 return `true` for an Operator and `false` for everyone
else). The system shall define **no** INSERT/UPDATE/DELETE policy for any role, so the table is
**append-only-by-omission** (the FR-AUC-007 pattern): Operators are provisioned exclusively via
seed/provisioning SQL (FR-OPR-003), never via any client API.

**FR-OPR-002 — `is_operator()` SQL helper (plain `SECURITY INVOKER`, NOT security-definer).**
The system shall provide `is_operator() returns boolean` = `exists (select 1 from
platform_operators where user_id = auth.uid())`, usable inside RLS policies and RPCs. The function
is **plain (`SECURITY INVOKER`), NOT `SECURITY DEFINER`** — it does **not** bypass RLS. Because
`platform_operators` has RLS forced and its only policy is `FOR SELECT USING (user_id = auth.uid())`
(FR-OPR-001), the sub-select inside `is_operator()` sees the caller's own row and nothing else: an
Operator's own row is visible → returns `true`; a non-Operator sees zero rows → returns `false`.
**That SELECT policy is why the function works** — without it, forced RLS would hide every row and
`is_operator()` would always return `false`, denying every Operator RPC (FR-OPR-004) for the seeded
Operator. It mirrors the `auth_role()`/`auth_org_id()` helpers in `0002_rls.sql` (which sit over
RLS-exempt system lookups; `platform_operators` instead achieves the same effect via its SELECT
policy rather than a security-definer bypass).

**FR-OPR-003 — Seeded Operator.**
The system shall seed `operator@pmo.test` as an Operator: a `profiles` row (role `'Admin'` for
shell access) plus a `platform_operators` row, in `supabase/seed.sql` (staging/demo) and in the
per-client provisioning runbook (ADR-0047; real projects). Additional Operators are added by SQL
only in v1 (no in-app Operator-of-Operators affordance).

**FR-OPR-004 — Operator powers are RPC-only (cross-org by explicit param); `operator_list_orgs` is
directory-only.**
Where the caller is an Operator, the system shall expose Operator powers exclusively through
security-definer RPCs that assert `is_operator()` and take an explicit `p_org_id` parameter:
`operator_grant_credits`, `operator_toggle_feature`, `operator_usage_summary`,
`operator_list_orgs`. The Operator shall **not** receive broadened per-org SELECT policies — org
tables stay owner/org-scoped; only the RPCs cross the boundary. (An org-Admin's own-org reads
continue through normal RLS.) **`operator_list_orgs` returns org-directory columns only** —
`organizations(id, name)` — so the Operator org-switcher can populate its list; **no business-data
aggregates** (usage, credits, members) leak through the org-listing path (those live in their
dedicated RPCs, FR-USE-002/FR-CRE-005).

**FR-OPR-005 — `useIsOperator()` FE hook.**
The system shall expose a `useIsOperator(): boolean` React hook (read from a `platform_operators`
membership query over the repository seam) for gating Operator-only affordances in
`/administration`. The hook is a **clarity projection only** (ADR-0016); every Operator power is
re-asserted server-side by the RPC.

### (c) Credits → org-pool — FR-CRE-*

**FR-CRE-001 — Credit grants are org-scoped; the pool is `owner_id`-agnostic.**
The system shall model a credit grant as a `credits` row **for an org** (the existing `org_id`
column), with `owner_id` made **nullable**. New Operator grants are written with `owner_id IS NULL`
(the v1 org-pool grant shape). The org's credit balance (FR-CRE-002) is computed as
`Σ credits.amount` **for the org regardless of `owner_id`** — legacy per-user grants (existing
non-null `owner_id` rows from `0047`) **count toward their org's pool**. This is **NON-DESTRUCTIVE**:
no backfill `UPDATE` is issued and the attribution history is left intact, so a non-null `owner_id`
is **both** historical attribution **and** a live contribution to the org balance. `granted_by`
remains the issuing Operator.

**FR-CRE-002 — Balance is computed org-wide (`owner_id`-agnostic).**
The system shall compute an org's current credit balance as
`(Σ credits.amount where org_id = X) − (Σ agent_usage.cost where org_id = X)` — summing **every**
`credits` row for the org **regardless of `owner_id`**, so legacy per-user grants (non-null
`owner_id`) and new NULL-`owner_id` org-pool grants **both** count (FR-CRE-001) — computed fresh at
check time (never stored), flipping `agent-usage-credits.spec.md` FR-AUC-010 from per-`owner_id` to
per-`org_id`. Per-user `agent_usage` rows are **retained** (FR-USE-*) and contribute to the org
balance; they are no longer a per-user balance.

**FR-CRE-003 — `credits` INSERT RLS is Operator-only (closes the revenue hole).**
The system shall replace the `credits_insert` policy in `0047_agent_usage_credits.sql` — currently
`auth_role() = 'Admin'` (which lets any client org-Admin self-grant unlimited credits) — with
`is_operator()` as the sole authority, while keeping the append-only-by-omission contract (no
UPDATE/DELETE policy for any role, FR-AUC-007) and the existing `org_id` cross-checks. The SELECT
policy widens from `owner_id = auth.uid()` to **own-org read only**: org-Admin and org-Executive may
`SELECT` their **own** org's `credits` rows (read-only, for the balance/grants view). An Operator
does **not** receive a broadened `credits` `SELECT` — cross-org grant reads go **only** through the
Operator RPCs (FR-OPR-004), so org tables stay owner/org-scoped and only the RPCs cross the boundary.

**FR-CRE-004 — `AGENT_CREDITS_ENFORCED` meters the org pool.**
While `AGENT_CREDITS_ENFORCED` is on, the system shall run the `RateGuard` preflight
(`agent-usage-credits.spec.md` FR-AUC-011) against the **org** balance (FR-CRE-002), and when the
org balance is `<= 0` the system shall return the existing `RATE_LIMITED`/out-of-credits behavior
unchanged for the deputy caller (interactive and automation consumers, ADR-0044 §6). The deputy
invariant (ADR-0036) is preserved — the caller still consumes their org's pool under their own JWT.

**FR-CRE-005 — Operator grant affordance.**
Where the caller is an Operator, the system shall render a "Grant credits" affordance in
`/administration` › Credits that calls `operator_grant_credits(p_org_id, p_amount, p_note)`; the
amount must satisfy the existing `amount > 0` constraint, and the RPC stamps `granted_by =
auth.uid()`. The org-Admin sees the resulting grants and the computed balance **read-only**.

**FR-CRE-006 — Reversal stays append-only.**
The system shall not introduce a grant-reversal / negative-adjustment primitive; a mis-issued grant
is corrected by issuing a correcting grant or by SQL, never by editing/deleting a row
(`agent-usage-credits.spec.md` FR-AUC-007/009 unchanged).

### (d) Usage view — FR-USE-*

**FR-USE-001 — `agent_usage` carries provider USD cost and action.**
The system shall add to `agent_usage` (migration): `provider_cost_usd numeric not null default 0`
(the USD the provider charged PMO, from `ModelResponse.usage.total_cost`, captured at the same
caller-JWT insert point as today) and `action text not null default 'chat'` (the model-calling
call-site kind: `'chat' | 'compose' | 'automation'`). The existing `cost` column is documented as
the **credit charge** (the deduction against the org pool). Both the `agent-chat` and `compose-view`
edge functions populate the new columns at usage-recording time.

**FR-USE-002 — Usage aggregate surface.**
The system shall provide an aggregate read (a security-definer RPC `operator_usage_summary` for
Operators, and an own-org view/RPC `org_usage_summary` for org-Admins) that returns, grouped by
`(org_id, owner_id, action, month)` from `agent_usage`: run count, Σ`prompt_tokens`,
Σ`completion_tokens`, Σ`provider_cost_usd`, Σ`cost` (credits charged), and a derived `margin_usd`
(FR-USE-006). Operators may pass an optional `p_org_id` filter (default: all orgs); org-Admins
receive only their own org (enforced by `auth_org_id()`, not by a client-sent param).

**FR-USE-003 — Aggregates only; no transcript content.**
Where a usage surface is rendered, the system shall source its rows **exclusively** from
`agent_usage` (the numeric ledger) — it shall not `SELECT` from, join, or otherwise read
`agent_events`, `agent_runs`, or `agent_threads` (the transcript tables, ADR-0043). This is the
hard privacy line (NFR-PRIV-001) and is proven by pgTAP (AC-PRIV-001).

**FR-USE-004 — Operator sees all orgs; org-Admin sees own org.**
While the caller is an Operator, the usage surface shall present an org dimension (all orgs, or a
selected org via the Operator org-switcher); while the caller is an org-Admin (non-Operator), the
surface shall present only their own org, with no org-switcher. A non-Admin, non-Operator sees
nothing (the route gate).

**FR-USE-005 — Per-user attribution is by `agent_usage.owner_id`, not by a balance.**
The system shall attribute usage to a user via `agent_usage.owner_id` (the spending user) for the
aggregate view only; it shall not present a per-user credit balance (the balance is org-pool,
FR-CRE-002). Attribution is metadata for the usage view, not a spendable counter.

**FR-USE-006 — `margin_usd` is conditional on a configured rate.**
Where the `CREDITS_PER_USD` env/config is unset, the system shall render `margin_usd` as `NULL`
(and the UI hides the column with an "Pricing not yet configured" note); where it is set, the
system shall compute `margin_usd = (Σ cost / CREDITS_PER_USD) − Σ provider_cost_usd`. Pricing is
deferred (Out of Scope); the column is the forward-looking seam, never a fabricated figure.

### (e) `org_features` entitlements — FR-ENT-*

**FR-ENT-001 — Feature registry (TS + DB check).**
The system shall define a feature registry as both a TypeScript const
(`pmo-portal/src/lib/features.ts` `FEATURE_KEYS`, superseding the interim hardcoded flags) and a DB
`CHECK (feature_key = ANY (ARRAY[...]))` (or enum) over the gated candidates — e.g. `incidents`,
`crm`, `procurement`, `timesheets`, `import_export`, `agent_assistant`, `user_views`. The registry
shall mark a **core never-gated set** — `projects`, `dashboard`, `approvals`, `administration` —
that no `org_features` row may disable (enforced: core keys are rejected at insert/`org_has_feature`
always returns true for them).

**FR-ENT-002 — `org_features` table.**
The system shall create `org_features`: `org_id uuid not null references organizations(id)`,
`feature_key text not null`, `enabled boolean not null`, `updated_at timestamptz not null
default now()`, `updated_by uuid references profiles(id)`, primary key `(org_id, feature_key)`,
with RLS enabled and forced, and an index on `org_id`.

**FR-ENT-003 — `org_features` RLS: read all-org-members, write Operator-only.**
While the caller is an org member, the system shall permit `SELECT` on `org_features` for **every**
member of the org (`org_id = auth_org_id()`) — entitlements are **not intra-org secrets**, so an
Engineer/PM/Finance member must be able to resolve hide-vs-show for their own rail/routes (this is
what `useFeature()` reads directly, FR-ENT-005); the system shall permit `INSERT`/`UPDATE` **only**
to Operators (`is_operator()`). This **flips the 2026-06-15 backlog note** (which proposed
admin-write) — recorded as a deliberate reversal — and widens `SELECT` beyond the earlier
Admin/Executive-only draft (entitlements are not intra-org secrets).

**FR-ENT-004 — `org_has_feature(key)` SQL fn ships now (the deferred-enforcement hook).**
The system shall provide `org_has_feature(p_org_id uuid, p_key text) returns boolean` returning
`true` for any core key (FR-ENT-001), else the row's `enabled` (defaulting to `true` when no row
exists, so absence = included). The function ships now, **unused by any gated module table's RLS** (the paywall is deferred, Out of
Scope) and **unused by the FE** (`useFeature()` reads `org_features` rows directly, FR-ENT-003/005);
it is the **future server-enforcement hook only** (per-module `AND org_has_feature(...)` RLS,
deferred).

**FR-ENT-005 — `useFeature()` / `<FeatureGate>` mirror the authz primitives.**
The system shall provide `useFeature(key): boolean` and `<FeatureGate feature={key}>` mirroring
`usePermission()`/`<CanWrite>` (`pmo-portal/src/auth/usePermission.tsx`): a hook bound to the
current org's `org_features` (cached per-org via react-query) and a declarative render gate. The
hook is a **clarity projection only** (ADR-0016); server enforcement is deferred (FR-ENT-004 note).

**FR-ENT-006 — Gate rail + route redirect + affordances; disable = hide, never destroy.**
Where `org_has_feature(org, key)` is `false`, the system shall (i) **hide** the module's rail item
(like `Rail.tsx` already hides `/administration` for non-Admin/Exec), (ii) **redirect** a deep-link
to the route away (to the dashboard, not a 404), and (iii) **hide** the module's in-page
affordances. The system shall **never delete or mutate** the module's data on disable; re-enabling
restores the rail item, the route, and all affordances and data unchanged.

**FR-ENT-007 — Core set is never gated.**
Where a feature key is in the core never-gated set, the system shall always render it regardless of
`org_features` (`org_has_feature` returns `true`, FR-ENT-004); `useFeature('projects'|'dashboard'|
'approvals'|'administration')` always returns `true`.

**FR-ENT-008 — org-Admin read-only "included in plan" list; Operator toggles.**
While the caller is an org-Admin (non-Operator) viewing `/administration` › Features, the system
shall render a read-only list of the org's features with their enabled state ("Included in your
plan"); while the caller is an Operator, the system shall render the same list as toggle controls
calling `operator_toggle_feature(p_org_id, p_key, p_enabled)`.

---

## Non-functional requirements

### Security (NFR-SEC-*)

**NFR-SEC-001 — `can()` is UX-only; RLS/RPC is the authority.** Every Ops-Admin write (invite,
disable/re-enable, credit grant, feature toggle) is gated in the FE by `can(...)` **or**
`useIsOperator()` for clarity, and **enforced** by RLS or a security-definer RPC that re-asserts the
caller's authority (ADR-0016/0019). A direct API call bypassing the FE is denied at the DB.

**NFR-SEC-002 — Credits INSERT is Operator-only (revenue-hole fix).** A non-Operator (incl. an
org-Admin) cannot INSERT a `credits` row (FR-CRE-003). Proven by pgTAP (AC-CRE-002): an org-Admin
JWT attempting a grant is rejected (`42501`).

**NFR-SEC-003 — Disable is enforced even with a live JWT.** A disabled member's existing JWT reads
zero business rows (FR-INV-003 `is_active_member()`) and cannot refresh (FR-INV-002 session
revocation). Proven by pgTAP (AC-INV-002).

**NFR-SEC-004 — `org_id` is never client-sent on any Ops-Admin write.** Child rows inherit/stamp
`org_id` server-side (column default + RPC param); RLS `WITH CHECK (org_id = auth_org_id())` is the
tenancy authority (ADR-0017/0019). Operator RPCs take an explicit `p_org_id` asserted against
`organizations` existence, not against `auth_org_id()`.

**NFR-SEC-005 — Service-role key is server-only.** The `admin-invite-user` edge function is the only
holder of the service-role key for issuance; the client never sees it. Supabase project setting
`auto_expose_new_tables=false` (auth-floor item 2) prevents new tables (`platform_operators`,
`org_features`) from being anonymously readable; both carry RLS regardless.

### Privacy (NFR-PRIV-*) — the hard line

**NFR-PRIV-001 — No admin/operator surface reads transcript content.** No `/administration` surface
(Users, Credits, Usage, Features, Operator RPCs) shall `SELECT`, join, or otherwise read
`agent_events`, `agent_runs`, or `agent_threads`. The usage surface sources exclusively from
`agent_usage` (FR-USE-003). Proven by pgTAP (AC-PRIV-001): (a) the `operator_usage_summary` /
`org_usage_summary` RPC dependency graph is `agent_usage`-only (no transcript table), and (b) an
Operator and an org-Admin JWT each `SELECT` from `agent_events`/`agent_runs`/`agent_threads` yields
**0 rows** (the ADR-0043 owner-private policies hold for every admin/operator persona).

**NFR-PRIV-002 — Margin is informational, never a billed figure.** `margin_usd` is `NULL` until
`CREDITS_PER_USD` is configured (FR-USE-006); the UI never fabricates a margin.

### Performance (NFR-PERF-*)

**NFR-PERF-001 — Usage aggregate + org balance are index-backed.** The usage RPC filters/group on
`(org_id, owner_id, action, date_trunc('month', created_at))`; the migration adds a composite index
on `agent_usage (org_id, created_at)` (the existing `(owner_id, created_at)` index,
`0047_agent_usage_credits.sql`, is retained for the per-user path). The org-balance SUM
(`org_credit_balance`, FR-CRE-002) filters `credits(org_id)`, so the migration also adds
`credits(org_id)` (the existing `credits(owner_id)` index from `0047` is retained for attribution).
Target: the Operator all-orgs aggregate over a realistic month returns in <300 ms (p95) on the
staging dataset, bound to **≤ 10k `agent_usage` rows** (the quantified dataset size the p95 is
measured against).

**NFR-PERF-002 — Balance stays a fresh SUM (no stored counter); TOCTOU window widens with org-pool
fan-in (accepted v1).** The org balance is computed at check time (FR-CRE-002), preserving the
no-mutable-counter/no-race posture of `agent-usage-credits.spec.md`. **Truth in limits:** the accepted v1
TOCTOU/race window (`creditRateGuard.ts`'s advisory/eventually-consistent preflight, FR-AUC-010)
**widens** under org-pool — N deputies across the org race the same shared balance (~org-size more
concurrency than the per-user window it replaces), so the bounded transient overspend window is
materially larger. This is **accepted for v1** (still advisory, still bounded) and is the deferred
backlog item **"TOCTOU preflight revisit at ADR-0044-scale concurrency"** (a transactional /
`SELECT … FOR UPDATE` / locked-counter preflight is the future hardening; out of scope here).

### Accessibility (NFR-A11Y-*)

**NFR-A11Y-001 — Administration surface meets the charter a11y gate.** The composed
`/administration` sections pass `axe-core` zero-violations (the Layer-1 a11y gate, ADR-0030 §C) at
desktop + 390px; toggles are real `<switch>`/`role="switch"` controls with labels; destructive
disable uses the existing `ConfirmDialog` with an `aria-live` toast result.

---

## Acceptance criteria (Given/When/Then; one owning layer per AC, ADR-0010)

> Owning-layer tags: **[pgTAP]** RLS/tenancy/role authority; **[Unit/RTL]** Vitest+RTL for
> component/render/logic; **[e2e]** Playwright curated journey for a real cross-stack flow. AC-id
> tagging per CLAUDE.md: the owning test names its `AC-…` in its title/description.

### (a) Invite / disable

**AC-INV-001 [e2e] — org-Admin invites a user (issuance).** *Given* an org-Admin is signed in on
`/administration`, *when* they submit "Add user" with a fresh email + role "Engineer", *then* the
`admin-invite-user` edge function issues the Supabase invite, a `profiles` row is created
(`status='active'`, the caller's `org_id`, the chosen role), and the directory shows the new user
within 2 s. *(Curated journey `e2e/AC-INV-001-invite.spec.ts`; the invite-email/accept path is
asserted only as "the edge fn was called with the email" — the accept flow belongs to
`auth-production-floor`.)*

**AC-INV-002 [pgTAP] — disabled member reads nothing.** *Given* an org-Admin has disabled member M
via `admin_set_user_status`, *when* M's still-valid JWT issues a `SELECT` against any business table,
*then* every business-table policy's `is_active_member()` conjunct returns 0 rows (proven across the
core tables: `profiles`, `projects`, `procurements`, `agent_usage`, `org_features`).

**AC-INV-003 [pgTAP] — disable authority is Admin-in-org or Operator.** *Given* profiles in org A
and org B, *when* an org-A Engineer, an org-A Admin, and an Operator each call
`admin_set_user_status` on an org-B profile, *then* the Engineer and the org-A Admin are rejected
(`42501`), and only the Operator (and an org-B Admin) succeeds.

**AC-INV-004 [Unit/RTL] — self-disable and lockout are blocked.** *Given* an org-Admin is the sole
Admin, *when* the disable affordance targets themselves or the sole Admin, *then* the RPC rejects
with a classified "lockout" error and the FE surfaces it via `classifyMutationError` (toast), and
the row stays `active`.

**AC-INV-005 [Unit/Deno] — an address that cannot be added gets one neutral outcome.** *Given* the
address is in another organization or already held by the auth service, *when* an org-Admin
invites it, *then* the answer is `409 { error: 'INVITE_NOT_ADDABLE' }` for every reason and no
profile is written.

**AC-INV-006 [Unit/Deno] — an identical repeat is idempotent.** *Given* an invite succeeded, *when*
the same caller invites the same address (any case, padded) with the same role, *then* the answer is
`200 { ok: true, already_invited: true }`, no second email goes out and one profile exists; with a
different role the answer stays `409 DUPLICATE_EMAIL`.

**AC-INV-009 [Unit/Deno] — an expired invite is re-sent on an identical repeat.** *Given* a pending
member whose invite link has expired, *when* the caller repeats the identical invite, *then* the
answer is `200 { ok: true, invite_resent: true }`, exactly one more email goes out with a fresh link,
one profile exists, and a repeat with a different role stays `409 DUPLICATE_EMAIL`.

**AC-INV-010 [Unit/Deno] — an accepted invite is never re-sent.** *Given* a member who accepted their
invite long ago, *when* the caller repeats the identical invite, *then* the answer is
`200 { ok: true, already_invited: true }` and no email goes out.

**AC-INV-007 [Unit/Deno] — the loser of a race retries to success.** *Given* two invites for one
address reach the auth service before either profile is written, *when* both complete, *then* one
gets `200`, the other `409 INVITE_RETRY` with `Retry-After: 1`, its retry gets `200`, and the store
holds one account and one complete profile.

**AC-INV-008 [Unit/Deno] — the Operator path.** *Given* an Operator, *when* they invite into a chosen
organization, repeat it, and invite an address held by another organization, *then* the profile
lands in the chosen organization, the repeat is idempotent, and the neutral answer is identical to an
org-Admin's.

### (b) Operator

**AC-OPR-001 [pgTAP] — Operator powers are RPC-only and `is_operator()`-gated.** *Given* the seeded
Operator and a plain org-Admin, *when* each calls `operator_grant_credits` /
`operator_toggle_feature` / `operator_usage_summary`, *then* only the Operator succeeds; the
org-Admin is rejected. *And* a direct (non-RPC) `INSERT`/`UPDATE`/`DELETE` into `credits`, `org_features`, **or
`platform_operators`** by any role (incl. an Operator) is rejected by RLS — `platform_operators` is
append-only-by-omission (no write policy for any role, FR-OPR-001; cross-checked with AC-CRE-002 /
AC-ENT-002).

**AC-OPR-002 [pgTAP] — Operator is not a 6th role.** *Given* the `user_role` enum, *then* it still
contains exactly `('Executive','Project Manager','Finance','Engineer','Admin')` and
`platform_operators` is a separate table; an Operator with `role='Engineer'` still exercises Operator
powers (the grant is on `platform_operators.user_id`, not on the role).

**AC-OPR-003 [Unit/RTL] — `useIsOperator()` gates affordances.** *Given* the seeded Operator and a
plain org-Admin, *when* each renders `/administration`, *then* only the Operator sees the "Grant
credits" control, the Feature toggles, and the org-switcher; the org-Admin sees the read-only
variants. (RLS is the authority — AC-OPR-001.)

### (c) Credits → org-pool

**AC-CRE-001 [pgTAP] — org-pool balance math (`owner_id`-agnostic).** *Given* org X has grants
`{1000}` (`owner_id IS NULL` — a new org-pool grant) **and** `{250}` (`owner_id` = a legacy member —
a non-null pre-flip grant from `0047`), and `agent_usage.cost` rows `{100, 50}` for two different
`owner_id`s, *then* the org balance computed by the balance function equals `1100` (**both** the
NULL and the legacy non-null grant count, FR-CRE-001/002), and a per-`owner_id` "balance" is **not**
defined (querying the old per-owner expression returns the org total regardless of `owner_id`).

**AC-CRE-002 [pgTAP] — credits INSERT is Operator-only (revenue hole closed).** *Given* an org-Admin
JWT, *when* it issues `INSERT INTO credits(org_id, owner_id, amount) VALUES (X, NULL, 99999)`,
*then* the insert is rejected (`42501`) — the `0047` `auth_role()='Admin'` hole is closed; *and given*
an Operator JWT, the same insert succeeds with `granted_by` stamped.

**AC-CRE-003 [pgTAP] — `AGENT_CREDITS_ENFORCED` meters the org pool.** *Given* an org with balance
`0` and `AGENT_CREDITS_ENFORCED=on`, *when* any member's deputy turn hits the `RateGuard` preflight,
*then* it returns `exceeded: true` (out-of-credits) regardless of which member fired it; *and given*
the Operator grants `+500`, the next turn proceeds.

**AC-CRE-004 [e2e] — Operator grants, org-Admin sees balance.** *Given* the Operator on
`/administration` › Credits, *when* they grant 500 credits to org X with a note, *then* a `credits`
row is created (`granted_by`=Operator), and an org-X Admin subsequently sees "Balance: 500 (− usage)"
read-only. *(Curated journey `e2e/AC-CRE-004-grant.spec.ts`.)*

### (d) Usage view

**AC-USE-001 [pgTAP] — Operator sees all orgs; org-Admin sees own org.** *Given* usage rows in orgs
A and B, *when* the Operator calls `operator_usage_summary()` (no filter) vs an org-A Admin calls
`org_usage_summary()`, *then* the Operator result contains both orgs' aggregates and the org-A Admin
result contains only org A.

**AC-USE-002 [pgTAP] — aggregate columns are correct.** *Given* `agent_usage` rows for an org with
known `(prompt_tokens, completion_tokens, provider_cost_usd, cost, action)`, *then* the aggregate
returns run count, Σtokens, Σ`provider_cost_usd`, Σ`cost` (credits charged) per
`(owner_id, action, month)` exactly.

**AC-PRIV-001 [pgTAP] — no transcript reads (the privacy line).** *Given* an Operator JWT and an
org-Admin JWT, *when* each issues `SELECT` from `agent_events`, `agent_runs`, `agent_threads`,
*then* each yields 0 rows; *and* the `operator_usage_summary` / `org_usage_summary` definitions
depend on `agent_usage` only — proven by parsing the dependency graph via `pg_depend` plus a
`pg_proc.prosrc` text scan of the RPC bodies (assert: no `agent_events`/`agent_runs`/`agent_threads`
token appears in any transitively-referenced function body, and the only table relation reached from
the RPCs is `agent_usage`).

**AC-USE-003 [Unit/RTL] — margin hidden until pricing configured.** *Given* `CREDITS_PER_USD` unset,
*when* the Usage section renders, *then* the `margin_usd` column is absent and a "Pricing not yet
configured" note is shown; *given* it is set, the column renders the computed margin.

### (e) `org_features` entitlements

**AC-ENT-001 [pgTAP] — `org_features` RLS: read all-org-members, write Operator-only.** *Given* an
org-A Admin, an org-A Engineer, and an Operator, *when* each `SELECT`s/`INSERT`s/`UPDATE`s
`org_features` for org B vs org A, *then* the Admin **and the Engineer** each read only org A (all
members read their own org — entitlements are not intra-org secrets, FR-ENT-003) and neither can
write any row; the Operator can write any org's rows. (Confirms the flip from the 2026-06-15
admin-write note.)

**AC-ENT-002 [pgTAP] — core set is never gated.** *Given* an `org_features` row disabling
`'projects'`, *when* `org_has_feature(org, 'projects')` is evaluated, *then* it returns `true`
(core keys ignore the table); *and* an attempt to insert a disabling row for a core key is rejected.

**AC-ENT-003 [Unit/RTL] — `useFeature()`/`<FeatureGate>` hide affordances.** *Given* an org whose
`crm` feature is disabled, *when* the shell renders, *then* the CRM rail item is absent and a
deep-link to `/crm` redirects to the dashboard (not a 404); *given* the Operator re-enables `crm`,
*then* the rail item and route reappear with no data loss (disable = hide, never destroy).

**AC-ENT-004 [Unit/RTL] — org-Admin read-only Features list.** *Given* a non-Operator org-Admin on
`/administration` › Features, *when* the section renders, *then* features appear as a read-only
"Included in your plan" list with no toggle controls.

**AC-ENT-005 [e2e] — Operator toggles a feature; the rail updates.** *Given* the Operator on
`/administration` › Features, *when* they disable `incidents` for org X, *then* an org-X member's
next shell render hides the Incidents rail item and `/incidents` redirects; re-enabling restores it.
*(Curated journey `e2e/AC-ENT-005-toggle.spec.ts`.)*

### Cross-cutting

**AC-A11Y-001 [Unit/RTL] — axe-clean administration surface.** *Given* the composed
`/administration` page rendered for an Operator and an org-Admin at desktop and 390px, *then*
`axe-core` reports zero violations (the Layer-1 a11y gate).

---

## Error handling

| Trigger | Code / signal | UX surface (`classifyMutationError`) |
|---|---|---|
| Non-Admin/Operator reaches a write affordance (invite/disable/grant/toggle) | `42501` (RLS/RPC deny) | "You don't have permission…" warning toast; the FE already hid the control. |
| Invite a duplicate email in the org | `23505` | "That person is already in your workspace" toast. |
| Self-disable / sole-Admin disable | RPC `P0001` ("lockout") | "You can't disable the only Admin" toast; row unchanged. |
| Credit grant `amount <= 0` | DB `CHECK` violation | "Grant amount must be positive" toast. |
| Operator RPC called by a non-Operator | `42501` / RPC `raise exception` | "Operator only" toast; FE hid the control. |
| Usage RPC failure / timeout | network error | `<ListState variant="error">` with Retry. |
| Feature toggle for a core key | RPC reject | "Core modules can't be disabled" toast. |
| Disabled member's JWT hits any business read | empty result (RLS) | Shell shows the signed-out/disabled state; the accept-flow (re-enable) is the Admin's. |
| `admin-invite-user` edge fn unreachable / 5xx | network error | "Invite service is unavailable — try again" toast; no partial profile created. |

---

## Test traceability matrix (AC → owning layer → test)

| AC | Owning layer | Canonical test (file / title token) |
|---|---|---|
| AC-INV-001 | e2e | `e2e/AC-INV-001-invite.spec.ts` `test('AC-INV-001 org-Admin invites a user (issuance)…')` |
| AC-INV-002 | pgTAP | `supabase/tests/0NNN_ops_admin_disabled_reads_nothing.sql` `AC-INV-002 …` |
| AC-INV-003 | pgTAP | `supabase/tests/0NNN_ops_admin_disable_authority.sql` `AC-INV-003 …` |
| AC-INV-004 | Unit/RTL | `pages/__tests__/AdminUsers.disable.test.tsx` `it('AC-INV-004 blocks self-/sole-Admin disable')` |
| AC-INV-005 | Unit/Deno | `supabase/functions/admin-invite-user/index.test.ts` `AC-INV-005 …` |
| AC-INV-006 | Unit/Deno | `supabase/functions/admin-invite-user/index.test.ts` `AC-INV-006 …` |
| AC-INV-007 | Unit/Deno | `supabase/functions/admin-invite-user/index.test.ts` `AC-INV-007 …` |
| AC-INV-008 | Unit/Deno | `supabase/functions/admin-invite-user/index.test.ts` `AC-INV-008 …` |
| AC-INV-009 | Unit/Deno | `supabase/functions/admin-invite-user/index.test.ts` `AC-INV-009 …` |
| AC-INV-010 | Unit/Deno | `supabase/functions/admin-invite-user/index.test.ts` `AC-INV-010 …` |
| AC-OPR-001 | pgTAP | `supabase/tests/0NNN_ops_admin_operator_rpc_only.sql` `AC-OPR-001 …` |
| AC-OPR-002 | pgTAP | `supabase/tests/0NNN_ops_admin_operator_not_role.sql` `AC-OPR-002 …` |
| AC-OPR-003 | Unit/RTL | `pages/__tests__/Administration.operatorGate.test.tsx` `it('AC-OPR-003 useIsOperator gates affordances')` |
| AC-CRE-001 | pgTAP | `supabase/tests/0NNN_credits_org_pool_balance.sql` `AC-CRE-001 …` |
| AC-CRE-002 | pgTAP | `supabase/tests/0NNN_credits_insert_operator_only.sql` `AC-CRE-002 …` |
| AC-CRE-003 | pgTAP | `supabase/tests/0NNN_credits_enforced_org_pool.sql` `AC-CRE-003 …` |
| AC-CRE-004 | e2e | `e2e/AC-CRE-004-grant.spec.ts` `test('AC-CRE-004 Operator grants, Admin sees balance')` |
| AC-USE-001 | pgTAP | `supabase/tests/0NNN_usage_operator_vs_admin_scope.sql` `AC-USE-001 …` |
| AC-USE-002 | pgTAP | `supabase/tests/0NNN_usage_aggregate_columns.sql` `AC-USE-002 …` |
| AC-PRIV-001 | pgTAP | `supabase/tests/0NNN_ops_admin_no_transcript_reads.sql` `AC-PRIV-001 …` |
| AC-USE-003 | Unit/RTL | `pages/__tests__/Administration.usage.margin.test.tsx` `it('AC-USE-003 margin hidden until pricing configured')` |
| AC-ENT-001 | pgTAP | `supabase/tests/0NNN_org_features_rls.sql` `AC-ENT-001 …` |
| AC-ENT-002 | pgTAP | `supabase/tests/0NNN_org_features_core_never_gated.sql` `AC-ENT-002 …` |
| AC-ENT-003 | Unit/RTL | `auth/__tests__/useFeature.test.tsx` + `shell/__tests__/FeatureGate.route.test.tsx` `it('AC-ENT-003 useFeature/FeatureGate hide + redirect')` |
| AC-ENT-004 | Unit/RTL | `pages/__tests__/Administration.features.readonly.test.tsx` `it('AC-ENT-004 org-Admin read-only Features list')` |
| AC-ENT-005 | e2e | `e2e/AC-ENT-005-toggle.spec.ts` `test('AC-ENT-005 Operator toggles a feature')` |
| AC-A11Y-001 | Unit/RTL | `pages/__tests__/Administration.a11y.test.tsx` `it('AC-A11Y-001 axe-clean administration surface')` |

> Exact `0NNN` migration/pgTAP numbers are assigned by the eng-plan against `main`/`dev` at build
> time (next free migration ≥ `0058`; next free pgTAP ≥ `0110`) — the Companies / agent-persistence
> / ADR-0043 precedent of leaving exact numbering to the plan.

---

## Implementation TODO checklist (2–5 min tasks; plan owns sequencing/slicing)

> **Binding final gate for every slice:** run **`npm run verify`** (= typecheck && lint:ci && test
> && build) from `pmo-portal/` AND `supabase test db` (pgTAP) before any PR — full suite, never
> touched-files-only (CLAUDE.md quality gates). Slice PRs target `dev`; promote `dev`→`main` is
> owner-gated. **Never push to `production`** without a direct owner instruction.

**Schema (migrations — next free ≥ `0058`; one logical group, plan may split):**
- [ ] mig: `profile_status` enum + `profiles.status` column (`default 'active'`); backfill existing.
- [ ] mig: `is_active_member()` helper; conjoin into every business-table SELECT policy's `USING`
      (mechanical pass over `0002_rls.sql` + later policy migrations); add the pgTAP proofs.
- [ ] mig: `platform_operators` table (RLS enabled+forced, no `org_id`) + its single `FOR SELECT
      USING (user_id = auth.uid())` policy and **no** write policies (append-only-by-omission,
      FR-OPR-001) + `is_operator()` helper (`SECURITY INVOKER`, not security-definer; relies on that
      SELECT policy — FR-OPR-002).
- [ ] mig: `admin_set_user_status(p_profile_id, p_status, p_org_id)` security-definer RPC (re-asserts
      Admin-in-org **or** Operator; self-/sole-Admin lockout guard) + session-revocation hook.
- [ ] mig: credits org-pool — `alter table credits alter column owner_id drop not null` (**NO**
      backfill `UPDATE`: legacy non-null `owner_id` rows are kept as-is and still count in the org
      balance, FR-CRE-001/002); new Operator grants are written with `owner_id IS NULL`; replace
      `credits_insert` policy `auth_role()='Admin'` → `is_operator()`; widen `credits_select` to
      own-org read (Admin+Exec read **their own** org; Operator cross-org via RPC only, FR-CRE-003);
      add `credits(org_id)` index (NFR-PERF-001).
- [ ] mig: add `org_credit_balance(p_org_id)` security-definer fn (FR-CRE-002 math).
- [ ] mig: `agent_usage` add `provider_cost_usd numeric not null default 0` + `action text not null
      default 'chat'`; composite index `(org_id, created_at)`.
- [ ] mig: `operator_grant_credits` / `operator_toggle_feature` / `operator_usage_summary` /
      `operator_list_orgs` (returns `organizations(id, name)` only — no aggregates, FR-OPR-004) /
      `org_usage_summary` security-definer RPCs (all assert `is_operator()` or `auth_org_id()`);
      `operator_usage_summary`/`org_usage_summary` read `agent_usage` ONLY.
- [ ] mig: `org_features` table (PK `(org_id, feature_key)`, `CHECK` registry, core-set guard) +
      `org_has_feature(p_org_id, p_key)` fn + RLS (read own-org Admin+Exec; write Operator-only).
- [ ] seed: `operator@pmo.test` → `profiles` (role `'Admin'`) + `platform_operators` row in
      `supabase/seed.sql`; mirror in the per-client provisioning runbook (ADR-0047).

**Edge functions (`supabase/functions/`):**
- [ ] new `admin-invite-user/` edge fn: service-role `auth.admin.inviteUserByEmail` + `profiles`
      insert (org_id, role, status='active'); assert caller is Admin-in-org or Operator (via the
      caller JWT + `is_operator()`); validate email + role; idempotent on the email-in-org check.
      **Boundary:** no email body / SMTP / link / redirect here — that is `auth-production-floor`.
- [ ] edit `agent-chat/` + `compose-view/` usage-recording: populate `provider_cost_usd` (from
      `ModelResponse.usage.total_cost`) and `action` (`'chat'`/`'compose'`/`'automation'`).
- [ ] edit the `RateGuard`/`creditRateGuard` balance computation: per-`owner_id` → per-`org_id`
      (FR-CRE-002 / FR-CRE-004); `AGENT_CREDITS_ENFORCED` semantics unchanged.

**Repository seam + DAL (`pmo-portal/src/lib/`):**
- [ ] extend `repositories/profile` (`repositories/types.ts` + Supabase impl, ADR-0017):
      `inviteUser`, `setUserStatus`, plus existing `listUsers`/`updateRole`/`assignManager`.
- [ ] new `lib/db/credits.ts` + `repositories.credit`: `getOrgBalance()` (own-org read),
      `grantCredits(orgId, amount, note)` (Operator RPC).
- [ ] new `lib/db/usage.ts` + `repositories.usage`: `getOrgUsageSummary()` / `getOperatorUsageSummary()`.
- [ ] new `lib/db/orgFeatures.ts` + `repositories.orgFeature`: `listOwnOrgFeatures()`,
      `operatorToggleFeature()`, `hasFeature(key)` (FE cache source).
- [ ] new `lib/db/operators.ts` + `repositories.operator`: `isOperator()` (membership query),
      `listOrgs()` (Operator org-switcher).
- [ ] replace `src/lib/features.ts` interim hardcoded flags with the registry (`FEATURE_KEYS` +
      core-never-gated set) consumed by the new hooks.

**Auth + FE primitives (`pmo-portal/src/auth/`, `src/hooks/`):**
- [ ] `useIsOperator()` hook (reads `repositories.operator.isOperator()`; clarity-only).
- [ ] `useFeature(key)` + `<FeatureGate feature>` mirroring `usePermission()`/`<CanWrite>`
      (`src/auth/usePermission.tsx`); react-query key org-scoped.
- [ ] policy.ts: document that Operator affordances are **not** in `can()` (Operator isn't a role);
      they gate on `useIsOperator()`. No `user_role` change.

**`/administration` page (`pmo-portal/pages/AdminUsers.tsx` → composed surface):**
- [ ] section: **Users** — wire "Add user" (invite modal → `admin-invite-user`); add confirmed
      "Disable"/"Re-enable" row actions; keep existing role/manager edits; remove the interim
      "Copy invite instructions" affordance once invite ships.
- [ ] section: **Credits** — Operator "Grant credits" (FR-CRE-005) + read-only balance for all
      (org-Admin own-org; Operator selected org).
- [ ] section: **Usage** — aggregate table (FR-USE-002), Operator org-switcher, margin conditional
      (AC-USE-003); sourced from the usage RPC only.
- [ ] section: **Features** — Operator toggles + org-Admin read-only list (FR-ENT-008); core set
      rendered as always-on, non-toggleable.
- [ ] Operator org-switcher (Operator-only) over `operator_list_orgs()`.
- [ ] shell: hide gated module rail items + redirect their routes via `useFeature`
      (FR-ENT-006); `Rail.tsx` already conditionally renders `/administration` — extend the pattern.

**Tests (per the traceability matrix; AC-ids in test titles):**
- [ ] pgTAP: AC-INV-002, AC-INV-003, AC-OPR-001, AC-OPR-002, AC-CRE-001/002/003, AC-USE-001/002,
      AC-PRIV-001, AC-ENT-001/002 (the RLS/tenancy/privacy authority).
- [ ] Unit/RTL: AC-INV-004, AC-OPR-003, AC-USE-003, AC-ENT-003/004, AC-A11Y-001.
- [ ] e2e (curated journeys): AC-INV-001, AC-CRE-004, AC-ENT-005.
- [ ] Full `npm run verify` + `supabase test db` green before PR (binding gate).

**Docs/ADR:**
- [ ] ADR `0049` (pre-assign) — Ops-Admin surface: records (i) Operator-as-platform-grant (not a
      role); (ii) the credits INSERT flip (revenue hole) + org-pool balance; (iii) the
      `org_features` Operator-write flip from the 2026-06-15 note; (iv) the **UI-first entitlements
      bypass risk** (`org_has_feature` ships unused by gated-table RLS — the paywall is deferred);
      (v) the privacy line (aggregates only) as an inviolable constraint.
- [ ] Update `docs/environments.md` provisioning runbook: seed the Operator per client (ADR-0047).

---

## Contradictions / conflicts flagged against existing code & locked decisions

1. **`0047_agent_usage_credits.sql` `credits_insert` policy (`auth_role()='Admin'`) is the cited
   defect.** This spec replaces it with `is_operator()` (FR-CRE-003 / AC-CRE-002). The replacement is
   a deliberate fix, not a contradiction — the as-built policy was flagged in the grill as a revenue
   hole and is being closed.
2. **`agent-usage-credits.spec.md` FR-AUC-010 (per-owner balance) is superseded for THIS surface.**
   The org-pool refactor (FR-CRE-002) changes the balance scope from `owner_id` to `org_id`. This
   does not delete FR-AUC-010; it amends it — file the amendment in the Ops-Admin ADR and add a
   pointer from the agent-usage-credits spec so the two stay reconciled. (FR-AUC-007 append-only and
   FR-AUC-009 `amount > 0` are unchanged.)
3. **The 2026-06-15 backlog note proposed `org_features` admin-write; this spec flips it to
   Operator-write** (FR-ENT-003 / AC-ENT-001). Recorded as an explicit, owner-approved reversal
   (grill lock) — the ADR must state it.
4. **`pmo-portal/src/lib/features.ts` interim hardcoded flags** (`incidents`, `userViews`,
   `aiComposer`, `agentAssistant`) are **superseded** by the registry + `useFeature()`
   (FR-ENT-001/005). The env-var flags (`VITE_FEATURES_*`) remain as the **default** value for an org
   with no `org_features` row (FR-ENT-004: absence = included), preserving today's behavior for the
   staging/demo org until the Operator toggles.
5. **`AdminUsers.tsx` "Copy invite instructions" interim affordance is removed** once invite ships
   (FR-INV-006) — it was an honest placeholder for exactly this feature.
6. **`is_active_member()` conjoined into every business-table SELECT policy** is a broad (mechanical)
   migration; it is the correct "RLS-level" enforcement the grill named and is pgTAP-proven
   (AC-INV-002). The plan may land it as one migration or a generated pass; either way the predicate
   is single-sourced.

No contradiction found with ADR-0043 (transcript tables stay owner-private — the privacy line leans
on it), ADR-0047 (one org per project today — the Operator all-orgs affordance is forward-compatible),
or ADR-0016/0017/0019 (all followed: `can()` UX-only, repository seam, server-enforced authority).

---

## Open questions (minimal — grill decisions are locked; these are plan-level details)

1. **Exact migration / pgTAP / ADR numbers** — assigned by the eng-plan against `main`/`dev` (next
   free migration ≥ `0058`, pgTAP ≥ `0110`, ADR `0049` pre-assigned). Not pre-decided here.
2. **Session-revocation mechanism on disable** — `banned_until` on `auth.users` vs deleting refresh
   tokens vs a GoTrue hook. The spec mandates the **outcome** (a disabled member's JWT reads nothing
   and cannot refresh, AC-INV-002/003) and names the candidate mechanisms (FR-INV-002/003); the plan
   picks the one that works against the live Supabase auth version and proves it by pgTAP + a local
   sign-in drill.
3. **`org_features` default for the staging/demo org** — until the Operator toggles, features use the
   `VITE_FEATURES_*` env defaults (conflict #4); the plan confirms the seed leaves no `org_features`
   rows so "absence = included" holds for staging.
4. **Whether the Operator org-switcher is a top-of-page control or a per-section one** — a UX detail
   for the design pass (render-Discover, ADR-0030); the spec mandates only that it exists and is
   Operator-only (FR-USE-004 / AC-OPR-003).

---

## Self-verify (re-read against the brief + READ-FIRST docs)

**Coverage of the 5 sub-features:** (a) invite/disable — FR-INV-*, AC-INV-* ✓; (b) Operator
mechanism (platform table, not 6th role, seeded arief) — FR-OPR-*, AC-OPR-* ✓; (c) credits→org-pool
with the INSERT-RLS flip cited against `0047` — FR-CRE-*, AC-CRE-* ✓; (d) usage view with aggregates
+ margin + the hard privacy line as an NFR with pgTAP — FR-USE-*, AC-USE-*/AC-PRIV-*, NFR-PRIV-001 ✓;
(e) `org_features` with Operator-write flip from the 2026-06-15 note, FE `useFeature`/`<FeatureGate>`,
disable=hide-never-destroy, core never-gated — FR-ENT-*, AC-ENT-* ✓.

**Conventions honored:** EARS FR-###/NFR-### ✓; AC-### Given/When/Then ✓; one owning layer per AC
per ADR-0010 (pgTAP for RLS/tenancy/privacy, Unit/RTL for UI states, e2e for cross-stack journeys) ✓;
AC-id tagging in test titles ✓; server enforcement per ADR-0016/0019 (`can()`/`useIsOperator()` UX-only,
RLS/RPC authority) ✓; no placeholders (real paths, real RPC names, real seed email; only exact
migration/pgTAP numbers left to the plan per repo precedent) ✓.

**Boundaries named:** invite-ACCEPT flow → `auth-production-floor` (FR-INV-004, AC-INV-001) ✓.
**CUTs honored:** no custom RBAC editor, no Stripe/billing, no operator-console app, no transcript
access (forbidden), no Entity dimension ✓. **No re-litigation:** every grill lock is in the
"decisions of record" table and encoded as binding FR/NFR ✓.

**Deviations from the brief (flagged, all within the locked decisions):**
- **D1 — `margin_usd` is conditional/null until pricing is configured.** The brief lists "margin" as
  a delivered column; pricing is CUT. Resolved by making the column the forward-looking seam that is
  `NULL`/hidden until `CREDITS_PER_USD` is set (FR-USE-006, NFR-PRIV-002) — never a fabricated
  number. Consistent with the grill's "credits pricing decision deferred" lock.
- **D2 — `agent_usage` gains `provider_cost_usd` + `action` columns** to make the brief's
  "provider USD cost / credits charged / action" columns real and distinct (today `cost` is the sole
  credit-denominated column). This is an additive schema change within scope (the credits refactor
  already touches these tables) and is necessary to deliver the usage view as specified.
- **D3 — `credits.owner_id` made nullable (NULL = new org-pool grant; legacy non-null grants still
  count)** rather than a new table or a `scope` column. Minimal-diff to `0047`, keeps append-only +
  the existing indexes, and preserves per-user attribution via `agent_usage.owner_id`; per FR-CRE-001
  there is **no backfill** — legacy non-null `owner_id` grants remain and contribute to the org pool.
  The plan may choose a `scope` column instead; the spec mandates only the outcome (org-pool balance,
  FR-CRE-001/002).
- **D4 — `is_active_member()` is conjoined into every business-table SELECT policy** (a broad
  migration) to satisfy "enforced at RLS level" decisively, rather than relying on session revocation
  alone. This is the correct reading of the grill's "session/RLS level" wording (both, defense in
  depth); flagged because it is the largest single migration in the set.

No other deviations. All four are consistent with the locked grill decisions and the controlling
ADRs; none re-opens a decision.

---

## Fix-round log (REVISE response, 2026-07-04) — finding → resolution

| Finding | Resolution (encoded exactly per Director decisions) |
|---|---|
| **C1** (existing per-user credits dropped from org balance — money-path data loss) | **Option (b), NON-DESTRUCTIVE.** FR-CRE-001/002 rewritten: org balance = `Σ credits.amount where org_id = X` **regardless of `owner_id`** − `Σ agent_usage.cost where org_id = X`. Legacy per-user grants (non-null `owner_id` rows from `0047`) **count toward their org's pool**; new Operator grants are written with `owner_id IS NULL`. **No backfill `UPDATE`** — attribution history intact; a non-null `owner_id` is now **both** historical attribution **and** a live pool contribution. Migration TODO updated (drop-not-null only, no backfill); AC-CRE-001 extended to prove both legacy non-null + new NULL grants count (balance `1100`); D3 clarified. |
| **C2** (`is_operator()` vs forced-RLS `platform_operators` undefined — build-blocker) | FR-OPR-001: `platform_operators` carries **exactly one** policy — `FOR SELECT USING (user_id = auth.uid())` (a member confirms only their own membership). FR-OPR-002: `is_operator()` is **plain `SECURITY INVOKER`, NOT `SECURITY DEFINER`**; the RLS-forced sub-select mechanics documented (without that SELECT policy, forced RLS hides all rows → `is_operator()` always false → every Operator RPC dead). Migration TODO updated. |
| **I1** (TOCTOU window "unchanged" claim is false) | NFR-PERF-002 rewritten to tell the truth: the window **widens** with org-pool fan-in (~org-size more concurrency on the shared balance); **accepted v1**; revisit pointer added to the backlog's **"TOCTOU preflight revisit at ADR-0044-scale concurrency"** (transactional/`SELECT … FOR UPDATE` hardening deferred). |
| **I2** (`org_features` read policy contradicts `useFeature()` for non-Admin members) | **Option (a).** FR-ENT-003 widened: `SELECT` for **all** org members (`org_id = auth_org_id()`) — entitlements are not intra-org secrets; `useFeature()` reads `org_features` **directly**. FR-ENT-004 corrected: `org_has_feature()` is the **future server-enforcement hook only** (unused by FE). AC-ENT-001 extended to prove an Engineer reads own-org features. |
| **I3** (`platform_operators` write-protection not nailed down) | Folded into FR-OPR-001 as an explicit binding SHALL: the table has the **C2 SELECT policy only**; **no INSERT/UPDATE/DELETE policy for any role** — append-only-by-omission (FR-AUC-007 pattern), provisioned via seed/SQL only. AC-OPR-001 extended to prove any role's direct write to `platform_operators` is rejected. |
| **I4** (`credits(org_id)` index missing for org-balance SUM) | NFR-PERF-001: added `credits(org_id)` index (existing `credits(owner_id)` retained for attribution). Migration TODO updated to add it. |
| **M1** (FR-CRE-003 SELECT-widening wording loose / conflicts with FR-OPR-004) | FR-CRE-003 tightened: org-Admin/Executive get **own-org** `SELECT` only; an Operator gets **no** broadened `credits` SELECT — cross-org grant reads go **only via RPC** (FR-OPR-004). |
| **M2** (FR-INV-004 edge-fn authorization was a TODO, not a SHALL) | FR-INV-004 promoted: the edge fn **shall reject** (`401`/`403`) any caller whose JWT proves neither Admin-in-org nor Operator — binding SHALL, not a task note. |
| **M3** (`operator_list_orgs` return shape unconstrained) | FR-OPR-004 + migration: `operator_list_orgs` returns **org-directory columns only** (`organizations(id, name)`); no business-data aggregates leak through the org-listing path. |
| **M4** (Operator cross-org email enumeration unnoted) | FR-INV-005: recorded as a **conscious decision** — the target-org-scoped duplicate check lets an Operator probe cross-org membership by iterating invites; accepted (Operator = trusted platform staff). |
| **M5** (AC-PRIV-001 "parsed dependency graph" mechanism unnamed) | AC-PRIV-001: mechanism named — `pg_depend` + `pg_proc.prosrc` text scan asserting no transcript token appears in any transitively-referenced RPC body. |
| **M6** (sole-Admin lockout guard not caller-agnostic) | FR-INV-002: made explicit — the sole-Admin / self-disable guard rejects **regardless of caller, including an Operator** (no Operator can brick an org's only Admin). |
| **M7** (NFR-PERF-001 "staging dataset" unquantified) | NFR-PERF-001: p95 target bound to **≤ 10k `agent_usage` rows**. |

All other sections unchanged. No grill decision re-opened.

SPEC-FIX-DONE