# ADR-0049 — Ops-Admin surface (Operator-as-platform-grant, org-pool credits, `org_features` entitlements, aggregates-only privacy line)

- **Status:** Accepted (plan-issued 2026-07-04)
- **Dates:** 2026-07-04 (grill lock) · 2026-07-04 (plan issue)
- **Authority:** `docs/specs/ops-admin-surface.spec.md` (owner-approved grill of 2026-07-04 — locked)
- **Controlling ADRs:** 0016 (FE authz UX-only), 0017 (repository seam), 0018 (soft-archive), 0019
  (server-enforced SoD + destructive writes), 0043 (transcript owner-private), 0044 (agent RateGuard),
  0047 (per-client Supabase isolation), 0010 (test pyramid).
- **Plan:** `docs/plans/2026-07-04-ops-admin-surface.md`

## Context

`/administration` is currently an org-Admin directory with role/manager edits only — "Add user" is a
permanently-disabled control and there is no disable, no credits UI, no usage view, and no
feature-entitlements system. Two as-built gaps make this unsafe to sell:

1. **Credits self-grant (migration `0047_agent_usage_credits.sql`, `credits_insert` policy).** The
   INSERT policy is `auth_role() = 'Admin'` — any client org-Admin can INSERT a `credits` row of any
   size and mint themselves unlimited AI spend. This is a **revenue hole**.
2. **No Operator persona.** Platform powers (grant credits, toggle entitlements, see all-org usage)
   have no server representation, so they cannot be enforced or delegated.

The owner-approved grill (2026-07-04) locked the shape of the fix as a single coherent `/administration`
surface with five sections (Users / Credits / Usage / Features / an Operator mechanism underneath).

## Decisions

1. **Operator is a platform grant, NOT a 6th `user_role` enum value.** Modelled as a
   `platform_operators` table keyed by `user_id`, with RLS enabled+forced and **exactly one** policy —
   `FOR SELECT USING (user_id = auth.uid())` (a member confirms only their own membership) and **no**
   write policy for any role (append-only-by-omission, the FR-AUC-007 pattern — provisioned via
   seed/SQL only). `is_operator()` is a **plain `SECURITY INVOKER`** function; it works *because* that
   SELECT policy makes the operator's own row visible to themselves (forced RLS would otherwise hide
   every row and the function would always return `false`). Operator powers are exercised **only**
   through security-definer RPCs that assert `is_operator()` and take an explicit `p_org_id`; org
   tables stay owner/org-scoped (the RPCs are the sole boundary-crosser). Seeded Operator =
   `arief.said@gmail.com` (staging/demo seed + per-client provisioning runbook). **Operator-axis
   carve-out from FR-INV-003 (M3):** the Operator axis is governed **solely** by `platform_operators`
   row presence — revocation is row removal (service-role/SQL), and an Operator's org-membership
   `status` does **not** gate their platform powers — so the Operator RPCs
   (`operator_grant_credits`/`operator_toggle_feature`/`operator_usage_summary`/`operator_list_orgs`)
   re-assert `is_operator()`/`auth_org_id()` at entry but deliberately do **not** re-assert
   `is_active_member()` (unlike `admin_set_user_status`, which is an org-member-axis action and does).
   Rationale: a platform Operator must keep operating for a client org even if their *own* home-org
   membership is disabled — the two axes are independent, and conflating them would let a home-org
   Admin lock out platform operations.

2. **Credits are org-pool, not per-user — NON-DESTRUCTIVE.** A grant is recorded against the org.
   Balance = `Σ credits.amount where org_id = X` **regardless of `owner_id`** −
   `Σ agent_usage.cost where org_id = X`. `credits.owner_id` is made **nullable**; new Operator
   grants are written with `owner_id IS NULL`; legacy non-null `owner_id` grants (from `0047`)
   **count toward their org's pool**. **No backfill `UPDATE`** is issued — a non-null `owner_id` is
   both historical attribution and a live pool contribution. Per-user `agent_usage.owner_id` is
   retained for the usage view (attribution only), not for any per-user balance.

3. **`credits` INSERT RLS flips `auth_role()='Admin'` → `is_operator()` only (revenue-hole fix).**
   This closes the cited defect in `0047`. The `credits` SELECT policy widens from
   `owner_id = auth.uid()` to own-org read (Admin+Executive) for the grants *view*; an Operator
   receives **no** broadened `credits` SELECT — cross-org grant reads go only through the Operator
   RPCs. **Metering** (the `RateGuard` preflight, `AGENT_CREDITS_ENFORCED`) reads the org balance via
   the **`org_credit_balance(p_org_id)` security-definer RPC** (asserts `p_org_id = auth_org_id()`),
   not a raw `credits` SELECT — so any member of the org (the deputy caller, ADR-0044 §6) can read
   their own org's pool without needing credits SELECT. `creditRateGuard.check()` changes signature
   from `check(userId)` → `check(orgId)`; FR-AUC-010 is amended from per-`owner_id` to per-`org_id`
   (a pointer is added to `agent-usage-credits.spec.md` so the two stay reconciled).

4. **`org_features` write is Operator-only; org-Admin is read-only.** This **flips the 2026-06-15
   backlog note** (which proposed admin-write) — recorded as a deliberate, owner-approved reversal.
   SELECT is widened to **all org members** (`org_id = auth_org_id()`) — entitlements are **not
   intra-org secrets**, so an Engineer/PM must resolve hide-vs-show for their own rail/routes (this
   is what `useFeature()` reads directly). `org_has_feature(p_org_id, p_key)` ships now as the
   **future server-enforcement hook only** — it is **unused by any gated module table's RLS** and
   **unused by the FE**; the FE reads `org_features` rows directly. Core modules (`projects`,
   `dashboard`, `approvals`, `administration`) are never gated.

5. **Feature-disable = hide, never destroy; UI-hide-first.** Where a feature is off, the rail item is
   hidden, the route redirects to the dashboard (not a 404), and in-page affordances are hidden. No
   data is ever mutated on disable; re-enabling restores everything. **UI-first bypass risk:** because
   `org_has_feature()` ships unused by gated-table RLS, a direct API call can still reach a gated
   module's data today. This is accepted for v1 (no module is yet paid) and is the deferred
   "per-module `AND org_has_feature(...)` RLS" backlog item.

6. **Usage = aggregates only; transcripts are off-limits (the privacy line).** No `/administration`
   surface (Users, Credits, Usage, Features, Operator RPCs) shall read `agent_events`/`agent_runs`/
   `agent_threads`. The usage surface sources exclusively from `agent_usage`. Proven by pgTAP
   (`AC-PRIV-001`): the RPC dependency graph is `agent_usage`-only and every admin/operator persona's
   transcript `SELECT` yields 0 rows (ADR-0043 owner-private policies hold).

7. **Disable is enforced at two layers (defense in depth).** A reusable predicate
   `is_active_member()` (security-definer, like `auth_org_id()`) is conjoined into **every**
   business-table policy — SELECT `USING` and the write policies' `USING`/`WITH CHECK` alike — so a
   disabled member's still-valid JWT reads zero business rows and cannot write. **Plus** session
   revocation on disable (`auth.users.banned_until`, set by the `admin_set_user_status` security-definer
   RPC) so refresh fails and the short-lived JWT stops working. The sole-/self-Admin lockout guard
   rejects **regardless of caller, including an Operator**.

8. **Invite issuance here; accept flow is `auth-production-floor`.** The `admin-invite-user` service-
   role edge function **issues** the Supabase auth invite + creates the `profiles` row and **rejects**
   (`401`/`403`) any caller whose JWT proves neither Admin-in-org nor Operator. The email body / SMTP
   (Resend) / magic-link / password-set landing / redirect allowlist → prod HTTPS is backlog item 2.

## Consequences

- **Positive.** Revenue hole closed (AC-CRE-002). Platform powers are representable, enforceable, and
  delegable without a 6th role or a separate console app. Org-pool credits are non-destructive (no
  data loss, attribution intact). Entitlements are hide-not-destroy (zero data risk on toggle). The
  privacy line is inviolable and pgTAP-proven.
- **Negative / accepted.** (a) UI-first entitlements bypass — gated-table RLS enforcement is deferred
  (decision 5). (b) Org-pool TOCTOU window **widens** vs the per-user window (~org-size more
  concurrency on the shared balance); accepted v1, still advisory/bounded — the backlog's
  "transactional / `SELECT … FOR UPDATE` preflight" is the future hardening (NFR-PERF-002). (c)
  Operator cross-org email enumeration (FR-INV-005) — an Operator iterating invites can probe
  cross-org membership; accepted (Operator = trusted platform staff). (d) The `is_active_member()`
  conjunction migration is a broad mechanical pass over every business-table policy (D4) — mitigated
  by single-sourcing the predicate and pgTAP-proving it across the core tables.
- **Operational.** New Operator must be provisioned per client (seed for staging/demo; SQL runbook for
  real projects per ADR-0047). `AGENT_CREDITS_ENFORCED` default stays OFF until an Operator grants.
  Supabase project setting `auto_expose_new_tables=false` (auth-floor item 2) keeps the new tables
  (`platform_operators`, `org_features`) from being anonymously readable; both carry RLS regardless.
