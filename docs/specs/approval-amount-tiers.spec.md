# Feature: Approval by amount tiers on approver lists (#2695)

> **Status:** Draft for Director sign-off (2026-11-21). Plan: `docs/plans/2026-11-21-approval-amount-tiers.md`. Map: #2516.
> **Builds on:** `docs/specs/approval-routing-by-budget.spec.md` (#803, ADR-0075), ADR-0070 (approval authority is rank),
> OD-APPROVER-BASIS. The routing function that decides every approval is `public.spend_approval_route_from_figures`
> (last defined `supabase/migrations/1016_spend_route_recorded_spending.sql`); `transition_procurement`, the display reads
> and the notification recipients all follow it, so a change there reaches all of them.

## 1. Job story

When a purchase is approved, I want the approver chosen by amount, so higher amounts reach more senior people.

## 2. Rule

Today a request routes by budget position: within its budget line it goes to the project's approver list, otherwise to the
organisation's senior list (`spend_approvers`). This adds an optional **minimum amount** to each approver row. When the
organisation turns tiers on, the list a request reaches is narrowed to the **tier its amount falls in**:

- A row's tier is its minimum amount; a row with none is the base tier (0).
- For a request of amount A the tier is the highest minimum that is at most A. If A is below every minimum, the lowest tier.
- Only that tier's rows are the list. Everything else about routing (reasons, escalation, SoD, eligibility, break-glass) is unchanged.
- Project list and senior list are tiered separately; the budget-position test still chooses between them.
- Amounts route up, never down: an unknown or invalid amount, or a request in a currency other than the organisation's
  currency, takes the highest tier.
- A tier whose members are all ineligible leaves the decision to an Admin (route `admin`), exactly as an unusable list does today.
  It never falls to a lower tier.

The approver also sees **budget used** on the request: the line's budget and the amount already used (existing figures
`line_budget`, `line_used` from the route read, today carried but not shown).

## 3. Settings (client controls; no client process is coded)

| Setting | Where | Default |
|---|---|---|
| `spend_approval_settings.tiers_enabled boolean not null default false` (one row per organisation; no row = off) | Admin-only insert/update by RLS and column grants; every change audited; no new security-definer client surface | **false: routing is byte-for-byte today's** |
| `spend_approvers.min_amount numeric null check (min_amount >= 0)` | Admin adds a row with an amount (insert-only, like the rest of the table) | null = base tier; ignored while the flag is off |
| Tier members | the existing Administration > Spend approvers lists, now with an amount per row | none |

Org currency is `organizations.default_currency`. Tier amounts are in it; a foreign-currency or unknown amount goes to the top tier, never converted (owner-confirmed). Not in `org_features` / the plan registry.
Scope: purchases and expense claims (both call `spend_approval_route`). Imprest float records read the senior list directly
(`0422`, `0426`) and are **not** tiered; stated, not changed.

## 4. Requirements (EARS)

- **FR-TIER-001** The system shall add `spend_approvers.min_amount` (nullable, `>= 0`) and the table `spend_approval_settings` (`tiers_enabled` default false).
- **FR-TIER-002** When a caller who is not an active Admin of the org writes `spend_approval_settings`, the system shall refuse (RLS); the setting shall change by no other path. Each change shall write an `audit_events` row (`spend_approval_tiers.change`).
- **FR-TIER-003** Where a caller inserts a `spend_approvers` row with `min_amount`, the system shall apply the existing insert rules (Admin, same org, active, approval rank) and shall accept `min_amount` only from an Admin.
- **FR-TIER-004** While `spend_approval_tiers_enabled` is false, the system shall return the same route, reason, approvers, line budget and line used as before this change for every input.
- **FR-TIER-005** While it is true, the system shall resolve the project list and the senior list to the tier of the request amount per §2, in `public.spend_approvers_for_amount(org, project, amount, currency)`, the one function every route read calls.
- **FR-TIER-006** When the amount is NULL, negative, or in a currency other than the organisation's, the system shall use the highest tier.
- **FR-TIER-007** When `transition_procurement` or the claim decision runs, the system shall refuse (`42501`, the existing routing message) a caller who is not in the request's tier list and is not an Admin; a member of a lower tier shall be refused for a higher amount.
- **FR-TIER-008** The notification recipients and the display reads (`get_procurement_approval_routes`, `get_expense_claim_approval_routes`) shall name the same tier list the decision enforces.
- **FR-TIER-009** The `spend_approver.add` audit row shall record `min_amount`.
- **FR-TIER-010 (UX only)** Administration > Spend approvers shall show, for Admins, a "Tiers on" switch and an optional **From amount** field when adding an approver, and a tier label per row; a read-only view for others. English and Bahasa Indonesia.
- **FR-TIER-011 (UX only)** The request page shall show the line budget and the amount used to an approver of the request, text not colour; absent when the figures are not readable (`spending_not_visible`, unknown).

## 5. Acceptance criteria

pgTAP in `supabase/tests/spend_approval_tiers.test.sql` unless stated.

- **AC-TIER-001** *Given* tiers off and rows with minimums, *when* any request is classified or decided, *then* route, reason and approvers equal those of an org with the same rows and no minimums. (FR-TIER-004) *mutation-worthy*
- **AC-TIER-002** *Given* tiers on, base-tier list {A}, 100000 tier {B}, 1000000 tier {C}, *when* amounts 500, 100000, 999999, 1000000 are routed, *then* approvers are A, B, B, C. (FR-TIER-005)
- **AC-TIER-003** *Given* the same, *when* B approves a 1000000 request, *then* `42501`; *when* C approves it, *then* it succeeds; *when* an Admin does, *then* it succeeds with `break_glass`. (FR-TIER-007) *mutation-worthy*
- **AC-TIER-004** *Given* only tiers starting at 50000, *when* a 10000 request is routed, *then* the lowest tier decides, never `flat`. (FR-TIER-005)
- **AC-TIER-005** *Given* tier C's only member is disabled, *when* a 1000000 request is routed, *then* route `admin`, not tier B. (FR-TIER-005)
- **AC-TIER-006** *Given* a request with a NULL amount, a negative amount, or a foreign currency, *then* the highest tier. (FR-TIER-006)
- **AC-TIER-007** *Given* a project list with tiers and an over-budget request, *then* the senior list's tier for the amount decides, and a within-budget request uses the project list's tier. (FR-TIER-005)
- **AC-TIER-008** *Given* a PM, Finance user and Engineer, *when* each calls `set_spend_approval_tiers_enabled`, *then* only the Admin succeeds; a PM update matches no row; an audit row exists; org B's Admin cannot change org A. (FR-TIER-002)
- **AC-TIER-009** *Given* a PM inserts a row with `min_amount`, *then* `42501`; a negative amount is refused; Admin insert succeeds and the audit row holds the amount. (FR-TIER-003/009)
- **AC-TIER-010** *Given* the claim route read, *then* it calls the same tiered route function as purchases (asserted on the function body); claim decisions then follow AC-TIER-002/003. (FR-TIER-007/008)
- **AC-TIER-011** *Given* tiers on, *when* the routes are listed and a submit notifies, *then* listed approvers and recipients equal the enforced tier list. (FR-TIER-008)
- **AC-TIER-012** (Vitest, `SpendApprovers.test.tsx`) *Given* an Admin, *then* the switch and From-amount field show and call the repository with the amount; a PM sees neither; strings exist in `en` and `id`. (FR-TIER-010)
- **AC-TIER-013** (Vitest, `ProcurementDetails.approvalRoute.test.tsx`) *Given* a routed request whose route carries line budget and used, *then* the approver sees both; with null figures neither; the existing gates are unchanged. (FR-TIER-011)
- **AC-TIER-014** (e2e `AC-TIER-014-amount-tier-approval.spec.ts`, one journey) *Given* tiers on, *when* the junior-tier approver opens a large request, *then* Approve is absent, the senior-tier approver approves it. (FR-TIER-007; UX)

## 6. Rulings and exclusions

Ruled (Director, 2026-11-21): tier amounts in the organisation's default currency, foreign or unknown goes to the top tier; a tier is a minimum only and membership is per tier (add a person to each tier they sit in).

**Not in this ticket:** imprest float records read the senior list directly and are not tiered.
