# Spec: claim-quantity hard stop behind an organisation setting (survey-cap-stop, part B)

Job story: When I raise a claim, I want the jointly surveyed quantity for the work item to be the hard cap on what can be claimed, so a claim can never exceed what was measured.

Rulings in force: over-claim is a warning (OD-SCOPE-6). So the stop is a setting, `warn` by default, which keeps today's behaviour for every organisation; an organisation turns on `block` itself (money figure changes for an org on the older behaviour: setting with a default that keeps today's behaviour, per the brief). Part A (form warning, `claimableHeadroom`) is the base; part C (the survey record) feeds the seam below.

## Verified base behaviour (file:line, branch base = part A)
Every write of a claim line, found by searching all migrations and all app, CLI, edge-function and script code for `progress_claim_lines` and `create_progress_claim`:
- INSERT: ONE path, `create_progress_claim` (latest definition `supabase/migrations/0924_native_progress_claim_invoice.sql:169`, line insert at `:353`). Callers: `pmo-portal/src/lib/db/progressBilling.ts:139` (app). No other function, trigger, edge function or CLI command inserts claim lines (the CLI has only time-and-materials claim assembly, which writes other tables; `docs/runbooks/pmo-cli.md:566-578`). `1530_light_guard_declared_per_function.sql:24` only names the function in a guard list.
- UPDATE: refused for every role by `progress_claim_lines_immutable` (`0250_progress_billing.sql:326-334`), so there is no edit path to cap. The brief's "update" case is covered by keeping the same check callable and tested, and by a test that the immutability still holds.
- DELETE: only the claim cascade (`0345_claim_cascade_delete.sql`). Withdrawal sets `progress_claims.withdrawn_at` (`0250:600`), it does not touch lines.
- Table grants: `authenticated` has select only (`0250:342-345`), so no direct client write exists.
- Today NO database check bounds a claim line by accepted or ordered quantity (the money cap is the work-order value, `assert_work_order_invoiceable`, `0262:127`, called at `0924:343`). So today over-claim in quantity is allowed everywhere.
- "Already claimed" per work-order line, as the Billing tab reads it: lines of live claims (`withdrawn_at is null`, invoice not Cancelled) with that claim's `work_order_id` and `boq_item_id`, PLUS live opening-balance claimed quantities (`1046_opening_balances.sql:347-357`, `claimed_alloc`). Accepted = the latest Confirmed acceptance of that work order (`1046:362-372`); null when none exists, zero counts.
- Lock order in `create_progress_claim`: organisation row (share) -> `lock_work_order_billing` (`0262:113`, advisory xact lock) -> project row (update) -> boq rows (share) -> claim -> lines (`0924:199-230`).
- Existing Admin-only org setting pattern: `quantity_change_limit`, `1176_quantity_change_requests.sql:14-35` (column, Admin-only update policy, column grant, audit trigger); FE `getLimit/setLimit` in `pmo-portal/src/lib/db/quantityChanges.ts:239-247`.

## Requirements (EARS)
- FR-SCS-1: The system shall store `organizations.claim_quantity_over_cap` (`'warn'` | `'block'`, not null, default `'warn'`). Only an Admin of that organisation may change it; each change is audited with the old and new value (`org.claim_quantity_over_cap.change`).
- FR-SCS-2: The system shall provide a pure SQL twin `claimable_headroom(ordered, claimed, accepted, surveyed)` returning ceiling, basis (`surveyed` | `accepted` | `ordered`), headroom (floored at 0) and signed headroom, exact in milli-units, with the same precedence and cases as `claimableHeadroom` in `pmo-portal/src/lib/progressBilling.ts`.
- FR-SCS-3: The system shall provide a seam `survey_quantity_for_line(work_order_id, boq_item_id)` that returns null until part C replaces its body; the ceiling uses it as `surveyed`.
- FR-SCS-4: While an organisation's setting is `warn`, a claim line insert shall behave exactly as before (no new refusal, no new lock).
- FR-SCS-5: While the setting is `block`, when a progress claim line on a work-order scope (unit-rate line with a work-order allocation) is inserted with a quantity above the headroom (ceiling minus quantity on other live claims and live opening balances for that work-order line), the database shall refuse the whole claim with code `CLM_OVER_CAP`, naming the headroom, basis and what to do. A quantity equal to the headroom is allowed. Lump-sum lines and project-level (no work order) lines are out of scope, as in part A.
- FR-SCS-6: The check shall run as a BEFORE INSERT trigger on `progress_claim_lines`, so every path that creates claim lines is covered, taking the same work-order billing lock first (re-entrant inside `create_progress_claim`, so no new lock edge); two claims racing for the same headroom serialise and the second sees the first's lines.
- FR-SCS-7: Withdrawn claims, claims whose invoice is Cancelled, and the claim being inserted do not count as already claimed. Another organisation's setting never affects this one.
- FR-SCS-8: The Administration billing area shall show an Admin-only control for the setting (EN and ID); non-Admins see the current value and that only an Admin can change it.
- FR-SCS-9: While the organisation is on `block`, the claim form shall show "will be refused" wording instead of the warning, for the same condition as part A, in the same place, still with the next step.
- FR-SCS-10: The refusal `CLM_OVER_CAP` shall have an English and a Bahasa Indonesia sentence in the refusals catalogue saying: lower the quantity to the headroom, or confirm the next acceptance first.

## Acceptance criteria (Given/When/Then) and owning layer
- AC-SCS-001 pure twin cases mirror the TS ones exactly: (ordered 10, claimed 3, accepted 6) -> ceiling 6 accepted headroom 3; (10,4,null) -> ordered, 6; (10,0,0) -> accepted, 0; (10,7,5) -> headroom 0, signed -2; (1,0.1,0.3) -> 0.2; (10,1,8,surveyed 4) -> surveyed, 3. (pgTAP)
- AC-SCS-002 Given the default, when a claim exceeds the headroom, it is created as today. (pgTAP)
- AC-SCS-003 Given `block`, a claim over the headroom is refused with `CLM_OVER_CAP`; at exactly the headroom it is created; the refused claim leaves no claim row. (pgTAP)
- AC-SCS-004 Given `block`, ceiling basis follows precedence: accepted when a BAST exists (zero counts), else ordered; the seam stub returns null. (pgTAP)
- AC-SCS-005 Given `block`, a withdrawn claim and a Cancelled-invoice claim do not count; a live one and a live opening balance do. (pgTAP)
- AC-SCS-006 Given two organisations, one on `block`, the other on `warn` is unaffected. (pgTAP)
- AC-SCS-007 Only an Admin changes the setting (Finance, Project Manager and another org's Admin cannot); a change writes an audit row. (pgTAP)
- AC-SCS-008 Race: with the lock held by a first claim that consumed the headroom, a second claim sees it and is refused (sequential simulation; the lock call is asserted present in the trigger). (pgTAP)
- AC-SCS-009 Claim lines still cannot be updated. (pgTAP)
- AC-SCS-010 Claim form on `block` shows the "will be refused" text for a quantity over headroom and not the warning; on `warn` the part A warning is unchanged. (RTL, EN and ID)
- AC-SCS-011 The Admin control shows the value, saves a change, hides the control from a non-Admin and says why. (RTL, EN and ID)
- AC-SCS-012 `CLM_OVER_CAP` has EN and ID sentences. (`npm run check:guards` refusal gate, plus refusals test)

## Settings and defaults
`claim_quantity_over_cap` = `warn`. Question for the owner: whether `block` should also be offered per project (recommended: no, per organisation only). Meanwhile built: per organisation.

## Not in scope
The survey record itself (part C) and any change to the work-order value cap.
