# ADR-0075 — Spend approval routing narrows the flat matrix, from one config table and one resolver

- **Status:** Proposed (2026-10-06)
- **Context:** #803; spec `docs/specs/approval-routing-by-budget.spec.md`; plan `docs/plans/2026-10-06-approval-routing-by-budget.md`
- **Related:** OD-PROC-1 / OD-PROC-6 / OD-PROC-8, OD-BUDGET-1/2, ADR-0012 (procurement transition RPC), ADR-0016,
  ADR-0019, ADR-0034 (Reserved layer), ADR-0070 (approval authority is rank)

## Context

OD-PROC-1 authorises a procurement approval by role: any Project Manager, Finance or Executive who is not the
requester. The first client needs it by **who and how much**: spend charged to a project and within that project's
budget line goes to that project's named approver; overhead, or spend that would exceed the line, goes to a small
named senior set. Expense claims (#775) need the same rule next, and workflow notifications (#788) need to know who
the approvers are.

OD-PROC-6 anticipated this: "all transition authorization centralized in the one RPC + transition map → later
swappable for a config-driven version reading a per-org config table". The question is how to add the config
without forking the rule into three places (procurement, claims, notifications) and without weakening the controls
already shipped in `transition_procurement` (active-member gate, SoD-a, SoD-b, role matrix).

## Decision

1. **Routing narrows; it never widens.** The OD-PROC-1 role matrix, SoD-a and the active-member gate stay exactly
   as they are and still run. Routing adds one more refusal: on a routed request, a caller outside the named
   eligible set is refused. Named approvers must hold approval rank (≥ Project Manager, ADR-0070), so anyone the
   routing admits also passes the unchanged matrix. When nothing is configured, behaviour is today's.
2. **One config table, Admin-only.** `spend_approvers(org_id, project_id null|uuid, profile_id)`. A project row
   names a project approver; a null-project row names a senior-set member. FORCE RLS, read by active members, insert
   and delete by an active Admin of the org only, every change audited.
3. **One resolver function, record-agnostic.** `spend_approval_route(org, project, category, amount, currency,
   requester)` (SECURITY INVOKER) classifies the spend and returns the route, the reason and the eligible approver
   ids. `transition_procurement` enforces with it; `get_procurement_approval_routes` exposes it to the UI;
   #775 and #788 call it. The budget basis is reused, not re-derived: Active-version category line
   (OD-BUDGET-1) against Reserved (ADR-0034) + Committed (OD-BUDGET-2) spend on that line.
4. **Evaluated at approve time, under a per-line lock.** The decision reads the line at the moment of approval,
   inside `pg_advisory_xact_lock` keyed on (project, category), so two concurrent approvals cannot both spend the
   same headroom.
5. **Fail toward the senior set, then to an Admin.** Anything that makes "within budget" unknowable (no category,
   no Active budget, mixed currency, a negative or unknown amount) routes to the senior set. A configured project set
   with nobody eligible escalates to the senior set; a configured senior set with nobody eligible leaves the decision
   to an Admin (break-glass, audited). The flat matrix applies only when no senior set is configured at all, so a
   request can never be left with no possible approver (`docs/decisions.md` DD-APR-4).
6. **Inputs are fixed once submitted, and cannot be steered by the decider.** A trigger refuses client changes to
   project, category, header total and currency after Draft. A budget version activated by the decider, or after
   the request was submitted, routes to the senior set; amounts never count below zero and new ones cannot be
   negative (`docs/decisions.md` DD-APR-3, DD-APR-5).

## Consequences

- Good: one place defines "who approves this spend"; claims and notifications reuse it. No new client-callable
  SECURITY DEFINER function, so the 0178 allow-list and its count are unchanged.
- Good: a deployment with no configuration behaves exactly as before — existing journeys and fixtures are unaffected.
- Cost: an extra RPC round trip when listing or opening procurements (bounded by the `Requested` rows on the page).
- Cost: the eligibility check reads `profiles.status`, not the full ban check, because the UI path runs as the
  caller and cannot read `auth.users`. An approver banned out-of-band (status still `active`) stays listed until an
  Admin removes them; they still cannot act, because the transition's own active-member gate refuses them.
- Cost: the line is project-lifetime, not fiscal-year phased, matching OD-BUDGET-2. Phasing the check is a later
  change inside the one resolver.

## Alternatives considered

- **Thresholds per role (dollar limits).** Rejected: OD-PROC-6 deferred thresholds, and the client's rule is about
  budget fit and named people, not amounts.
- **Approver columns on `projects` and `organizations`.** Rejected: two write paths and two audit paths for one
  concept, and a column cannot hold a set.
- **A SECURITY DEFINER resolver.** Rejected: it would add a client-callable definer to the allow-list for a read;
  the invoker form needs no new privileged surface.
