# Budget→ERPNext binding-gate authz review (Option A, commit 1a1be8c9 + follow-ups)

**Scope:** OWASP/STRIDE authz review of the P3c budget feature-gate move from a spec-forbidden
`external_domain_ownership('budget')` row onto the org's ACTIVE ERPNext binding. Money-write path.
Branch `test/erpnext-p3c-coverage-gaps`, worktree `/Users/ariefsaid/Coding/PMO/.claude/worktrees/erp-complete`.

## VERDICT: SAFE — authz-preserving and fail-closed at every layer. No Critical/High/Medium/Low authz finding.

The change swaps only the ORG-LEVEL "employs ERPNext" signal for the `budget` domain. It does not touch
the principal/role gate (b), the domain-kind gate (c), the tenancy seam, or any non-budget domain. The new
RPC has byte-for-byte the same security posture (SECURITY INVOKER + RLS + identical grants) as the
`domain_owned_by_tier` gate it replaces for this one domain.

---

## Concern 1 — Authz-preserving for every Posture-A domain? → CONFIRMED, authz-preserving.

`BINDING_GATED_DOMAINS = new Set(['budget'])`
(`supabase/functions/adapter-dispatch/authGuard.ts:77`). Gate (a) branches on
`if (BINDING_GATED_DOMAINS.has(command.domain))` (`authGuard.ts:108`). Only `command.domain === 'budget'`
enters the new binding branch; every other value falls to the unchanged `else` running
`domain_owned_by_tier(orgId, domain, 'erpnext')` (`authGuard.ts:118-125`) — byte-for-byte the prior logic.

Domain strings verified literal-exact against the set: `ERPNEXT_COMPANIES_DOMAIN='companies'`,
`procurement`, `revenue`, `timesheets`, `ERPNEXT_BUDGET_DOMAIN='budget'`
(`pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts:22-32`). No non-budget domain can fall into the
binding branch, and budget cannot fall into the ownership branch. Gates (b) role-set and (c) kind-match
are shared code, untouched. **The authz decision for companies/procurement/revenue/timesheets is
bit-identical to pre-change.**

## Concern 2 — Does the new gate WIDEN who can drive a budget push/quarantine? → CONFIRMED no improper widening.

- **Principal/role authority is unchanged.** Who may push is still gated by (b): `budget` →
  `MASTER_DATA_WRITE_ROLES` (`authGuard.ts:42`, `moneyWriteRolesForDomain`) + active-membership via the
  SECURITY DEFINER `actor_authorization_state`. This commit does not touch (b). The org-level (a) signal
  is all that changed.
- **The "widening" at the org level is the spec-correct fix, not a hole.** Old (a) required an
  `external_domain_ownership('budget')` row — a row FR-BUD-006(a)/FR-BUD-010 forbid from ever existing;
  budget push only "worked" via a forbidden seed row. Posture B (ADR-0059 §7) defines the employ signal AS
  the active binding + push route. An org with an active ERPNext binding is, by definition, entitled to
  push its PMO-SoT budget to that ERP for GL controls; there is no separate budget opt-in in the model.
- **No cross-org widening.** `orgId` is derived server-side from the caller's OWN profile row read under
  the deputy caller-JWT client (`adapter-dispatch/index.ts:644-655`), never from the request body
  (AC-EAS-023). The budget SoD gate re-reads `budget_versions`/`projects` under the same caller client
  (`index.ts:473-493`), so a cross-org budget version is invisible. No principal can target another org.

## Concern 3 — Does `org_has_active_erpnext_binding` (SECURITY INVOKER) run under a caller who can see the row via RLS, and can it be coerced TRUE cross-org? → CONFIRMED correct trust level; cannot be coerced.

`org_has_active_erpnext_binding(uuid)` — `language sql stable security invoker set search_path = public,
pg_temp`, `revoke ... from public`/`anon`, `grant execute to authenticated, service_role`
(`supabase/migrations/0160_budget_push_status_binding_gate.sql:36-48`). Predicate is
`exists(select 1 from external_org_bindings where org_id = p_org_id and external_tier='erpnext' and
activated_at is not null)`.

- **Sync path (deputy caller-JWT client, `index.ts:682`).** RLS on `external_org_bindings` is
  `for select using (org_id = auth_org_id() and is_active_member())` with `force row level security`
  (`supabase/migrations/0096_erpnext_seam_tables.sql:99-103`). Under SECURITY INVOKER the RLS predicate is
  applied, so a passed `p_org_id != auth_org_id()` returns ZERO rows → `exists` = FALSE → 403. A caller
  cannot fabricate TRUE for, nor leak the binding state of, another org. Since `orgId` is already pinned to
  the caller's own org, the identity `p_org_id == auth_org_id()` holds and the probe is truthful.
- **Recovery/sweep path (service_role).** RLS bypassed by design; reads the binding for the outbox row's
  own org — the correct machine-actor trust level, mirroring the dual-caller posture `domain_owned_by_tier`
  already relied on (that fn is ALSO `security invoker`, mig `0135:42`). Actor standing on this path is
  re-asserted separately via the SECURITY DEFINER `actor_authorization_state`.
- `set search_path = public, pg_temp` blocks search-path injection. The parity claim in the migration
  header is accurate.

## Concern 4 — Fail-closed if the binding is missing/inactive? → CONFIRMED at all three layers.

- **Dispatch (authGuard):** `if (employed.error || employed.data !== true) return 403`
  (`authGuard.ts:110-112`) — denies on RPC error, null, or any non-`true`.
- **Sweep (`reconcileOrgBudgetPushesLive`):** `if (!org.activatedAt) return { driven: 0 }`
  (`erpnext-sweep/index.ts:1203`), and `listEmployingOrgsLive` only enumerates orgs whose binding has
  `activated_at` set (`index.ts:552-564,591`). A missing/inactive binding is never even enumerated. Note:
  the prior gate `ownedDomains.includes('budget')` was ALWAYS false once the forbidden ownership row was
  removed (the AC-BUD-032 regression: stale `committing` budget rows never quarantined) — the change to
  `activatedAt` restores the safety/quarantine backstop for genuinely-employing orgs. It does not widen
  who can push: every actual write still routes through `dispatchMoneyWrite`, and per-row eligibility is
  re-asserted by the backstop's still-Active gate (FR-BUD-102) against DB truth; candidates are scoped to
  the org's own outbox via the `p_org_id`-scoped `outbox_reconcile_candidates` RPC.
- **FE (`BudgetTab`):** `employsExternalBudget = erpnextBinding?.status === 'active'`
  (`pmo-portal/pages/project-detail/tabs/BudgetTab.tsx`). Loading/undefined/absent/disconnected/errored →
  falsy → panel not mounted. UX-only; RLS remains the enforcement authority. `get_budget_push_status`
  (mig 0160) likewise infers the banner only when an active binding exists, under SECURITY INVOKER RLS.

## Seed note
`supabase/seed.sql` removed the spec-forbidden `external_domain_ownership('budget')` insert and seeds an
active binding — aligns local/test fixtures with Posture B. No authz impact (seed is local-only).
