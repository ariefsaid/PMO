# Lost reason: a required reason when a deal is lost, and win/loss by reason and by client (LR)

Issue #1577 (map #459). Source: `docs/reviews/2026-10-31-feature-comparison.md` §3b. Status: **Draft, 2026-11-01**
(decisions DD-LR-1..8 below are Director-delegate calls with a recommended default; owner may override). Plan:
`docs/plans/2026-11-01-lost-reason.md`. Related, not blocking: board drag and drop `docs/specs/board-drag-drop.spec.md`
(#1637), pipeline stage history (#1638, owner ruling OD-GRILL-20261101 "Pipeline dates").

**Job story.** When a deal is lost or declined, I want to say why in a couple of clicks, so that the company can
later see which reasons and which clients cost it the most bids, and stop guessing.

## What ships today (grounded in code at `origin/dev` b52aa48a)

- Three user paths lose a deal, all calling `transition_project(p_id, p_to, p_customer_contract_ref, p_contract_date)`
  (latest body `supabase/migrations/0236_project_status_declined_rules.sql`, via `transitionProject` in
  `pmo-portal/src/lib/db/projectTransitions.ts:113-125`):
  1. The status menu: `components/ProjectStatusControl.tsx:137-142,303-324`, a destructive `ConfirmDialog` "Mark
     project as lost" for `Loss Tender` and `Declined` (`projectStatusGroup === 'lost'`).
  2. The deal page: `pages/project-detail/PipelineLens.tsx:113,476-503`, two `ConfirmDialog`s, "Mark project as lost"
     (`runTransition('Loss Tender')`) and "Decline to bid" (`runTransition('Declined')`).
  3. Drag to the Lost column (#1637, being built on `feat/board-dnd-1637`): the shared `ProjectTransitionConfirm`
     (plan `docs/plans/2026-11-01-board-drag-drop.md` S2-T3) with a required Loss Tender vs Declined radio.
- No reason is captured anywhere. `projects` has `decided_at` (stamped `now()` on loss by `transition_project`) but no
  column for why.
- `transition_project` is `security definer`, role-gated to Admin, Executive, Project Manager, Finance, org and
  active-member re-asserted. Direct `UPDATE` on `projects` is revoked from `authenticated` except an allow-listed
  column set (`0075_explicit_api_grants.sql:217`), so a new column is writable only through a definer.
- The "win-rate tile" is `src/components/dashboard/WinRateCard.tsx` (embedded in the Company dashboard,
  `src/components/dashboard/hub/company/CompanyDashboard.tsx:369`), fed by `get_win_rate(p_from, p_to)`
  (latest `0385_dashboard_open_bids_and_stale_win_rate.sql`) through `useWinRate(range)` /
  `getWinRate` (`src/hooks/useDashboard.ts:53`, `src/lib/db/dashboard.ts:209`). Decided cohort: all-time includes
  undated outcomes, a bounded window requires `decided_at` in range. Wins = on-hand statuses, losses = `Loss Tender`;
  `Declined` is reported beside the rate and is in neither denominator (#774).
- Lost deals are listed through `useLostDeals` (`projects` RLS read, `Loss Tender` + `Declined`).
- `projects.client_id` references the client company; the deal page already shows a "Decision" tile
  (`PipelineLens.tsx:285-292`).

## Decisions (Director-delegate; each states what it rules out)

- **DD-LR-1 Reason shape: a fixed category list plus an optional note.** Not org-editable and not free text alone.
  Categories (stable keys, stored): `price`, `competitor`, `scope_fit`, `timing`, `capacity`, `relationship`,
  `client_cancelled`, `no_decision`, `other`. English labels: "Price", "Lost to a competitor", "Scope or fit",
  "Timing", "Our capacity", "Relationship", "Client cancelled or postponed", "No decision from the client", "Other".
  Note: free text, max 500 characters, optional; **required when the category is `other`** (so "Other" is never an
  empty bucket). One list serves both `Loss Tender` and `Declined` (the same picker appears in both confirms); a
  decline is told apart by status, not by a second list. Why: a fixed key set is what makes "win/loss by reason"
  countable without cleaning free text; free text alone would need manual tagging. Org-editable lists need an admin
  screen, a tenant-scoped reference table and key-retirement rules: a follow-up if a client asks (see Follow-ups).
- **DD-LR-2 Storage: two nullable columns on `projects`**, `lost_reason text` (CHECK against the nine keys) and
  `lost_note text` (CHECK `char_length <= 500`; CHECK `lost_note is null or lost_reason is not null`). No new table,
  so the side-mirror inventory (pgTAP 0136) and service_role grants (0137) are untouched. The reason is part of the
  deal's *current* lost state, so it lives on the deal row next to `status` and `decided_at`.
- **DD-LR-3 The server enforces "required".** `transition_project` gains `p_lost_reason text default null` and
  `p_lost_note text default null`. For a target of `Loss Tender` or `Declined` it raises `P0001` when the reason is
  null/blank/not in the list, or is `other` without a non-blank note. The FE disables Confirm until valid, but the
  RPC is the authority (ADR-0016/0019). Applies to every caller, not just the UI.
- **DD-LR-4 Revive clears; audit keeps.** A transition to any target outside the lost group (`Loss Tender` or
  `Declined` revived to `Negotiation`) sets `lost_reason` and `lost_note` to null: the deal is no longer lost, so it
  must not be counted in the breakdown and must not show a stale reason. The reason is recorded in the existing
  `project.transition` audit row detail (`lost_reason`, `lost_note`), so a later re-loss starts fresh while history
  keeps every earlier reason. `decided_at` handling is unchanged (this spec does not touch it).
- **DD-LR-5 Historic rows: no backfill.** Existing lost and declined deals keep `lost_reason` null and show as
  "Not recorded" (a visible row in the breakdown, not hidden). Inventing a reason for a past loss would be a made-up
  figure. Editing a reason after the fact is out of scope (Follow-ups).
- **DD-LR-6 The breakdown is a new read-only RPC, `get_loss_breakdown(p_from date, p_to date)`**, `security invoker`
  (RLS scopes org, like `get_win_rate`), `stable`. `get_win_rate` is **not** changed: it is a 150-line function with
  money and currency semantics and many consumers; appending to its payload risks all of them. Same decided cohort and
  window rule as `get_win_rate` (all-time includes undated; a bounded window needs `decided_at` in range).
  - `by_reason`: one row per reason key present, plus `null` for "Not recorded": `{reason, losses_count,
    declined_count}` (`Loss Tender` and `Declined` counted separately, so the tile's "declined not in the rate"
    rule stays visible), ordered by `losses_count + declined_count` desc, then reason.
  - `by_client`: top 10 clients by `wins + losses` desc then name: `{client_id, client_name, wins_count,
    losses_count}`; wins = on-hand statuses, losses = `Loss Tender` only (the win-rate definition; `Declined` is not
    a client-level loss). A client the caller cannot read shows `client_name` null, rendered "Unknown client".
  - **Counts only, no money.** Value by reason needs a per-currency split (the tile already has one currency block
    per currency); the count answer is the ask. Value is a follow-up.
- **DD-LR-7 UI: one shared reason field, three call sites; one breakdown block under the tile.**
  `LostReasonFields` (category select + note textarea) is used in the shared `ProjectTransitionConfirm` (menu and
  drag, #1637) and in both `PipelineLens` confirms. The breakdown renders inside `WinRateCard`, below the declined
  note, for the same period the tile shows (no second period control).
- **DD-LR-8 Order with #1637.** #1637 creates `ProjectTransitionConfirm`. This work extends it. The DB and data
  slices (plan S1, S2) do not depend on #1637; the three UI call sites (S3, S4) start only after #1637's
  `components/project-status/ProjectTransitionConfirm.tsx` is on the base branch. If it is not, the worker stops and
  asks; it never forks a second confirm.

### Interaction with #1638 (pipeline stage history)

#1638 keeps a dated entry per stage, with "Lost / Declined" as a stage entry. The two do not conflict:

- **History rows record *when* and *who*; the reason lives on the deal.** A Lost history entry shows the deal's
  current `lost_reason`/`lost_note` beside its date. Nothing is copied into a history row, so there is one source.
- **A re-lost deal.** After a revive (DD-LR-4) the old reason is cleared on the deal; the earlier Lost entry in
  history keeps its date, and its reason is available from that transition's audit row. #1638 may show it from there
  or show the earlier Lost entry without a reason. Either is acceptable and neither blocks this spec.
- **Constraint on #1638.** Any #1638 path that creates or backdates a *Lost/Declined* entry must go through
  `transition_project` (so DD-LR-3 applies) or be restricted to editing the date of an existing Lost entry. A history
  editor that can add a Lost entry through a different write would bypass the required reason. This is recorded here
  for the #1638 spec/plan to honour; this work adds no #1638 code.
- Dates are out of scope here: this work never changes `decided_at` or any stage date.

## Scope

In: the nine-key reason + note on every lost/declined transition at the RPC and in the three UI paths; the two
columns; the audit detail; the display of the reason on the deal page; `get_loss_breakdown`; the breakdown block in
the win-rate tile; i18n en + id; pgTAP, unit and one e2e journey.

Out of scope: org-editable reason lists; editing or backfilling a reason after the fact; value (money) by reason;
reasons for *won* deals; importing reasons through the pipeline import; per-reason drill-through to deal lists;
changing `get_win_rate`, `decided_at`, the transition map, or win eligibility; the Projects kanban and phone list.

## Terms

- **Lost group**: statuses `Loss Tender` and `Declined` (`LOST_STATUSES`, `projectTransitions.ts`).
- **Reason key**: one of the nine DD-LR-1 keys. **Not recorded**: a lost deal whose `lost_reason` is null.

## Functional requirements (EARS)

### Data and server

- **FR-LR-001** The system shall store, per project, an optional `lost_reason` (one of the nine keys) and an optional
  `lost_note` (at most 500 characters, only with a reason).
- **FR-LR-002** When `transition_project` is called with a target in the lost group, it shall require a valid
  `p_lost_reason`; if it is null, blank or not a key, then it shall raise `P0001` and write nothing.
- **FR-LR-003** If `p_lost_reason` is `other` and `p_lost_note` is null or blank, then `transition_project` shall raise
  `P0001` and write nothing.
- **FR-LR-004** When a lost-group transition succeeds, `transition_project` shall store the reason and the trimmed
  note (null when blank) on the project and include `lost_reason` and `lost_note` in the `project.transition` audit
  detail.
- **FR-LR-005** When `transition_project` moves a project to a target outside the lost group, it shall set
  `lost_reason` and `lost_note` to null.
- **FR-LR-006** The system shall ignore a reason passed with a target outside the lost group (it is never stored).
- **FR-LR-007** The system shall leave the role gate, org re-assertion, active-member check, transition map, win
  branch and `decided_at` stamping of `transition_project` unchanged.
- **FR-LR-008** The system shall not let `authenticated` write `lost_reason` or `lost_note` except through
  `transition_project`.

### Capture (UI)

- **FR-LR-010** When a user confirms moving a deal to `Loss Tender` or `Declined` from the status menu, the deal page,
  or a drag to the Lost column, the confirm shall show a reason picker (the nine labels) and an optional note, and
  shall keep Confirm disabled until a reason is chosen (and a note is entered when "Other" is chosen).
- **FR-LR-011** The picker shall have no preselected reason.
- **FR-LR-012** When the user confirms, the system shall send the chosen reason key and the note with the same
  transition call, in one request.
- **FR-LR-013** If the server refuses, the system shall show the server message through the toast or inline error the
  path already uses and shall not close the confirm silently.
- **FR-LR-014** The status menu, deal page and drag shall use one shared reason field component, one label source and
  one validity rule (`lostReasonValid`), not three copies.
- **FR-LR-015** Moves to non-lost targets shall be unchanged (no picker, same confirms).

### Display

- **FR-LR-020** While a deal is in the lost group, the deal page shall show its reason (label), and its note when
  present, next to the Decision tile; a null reason shows "Not recorded".
- **FR-LR-021** While a deal is not in the lost group, the deal page shall show no reason.

### Breakdown

- **FR-LR-030** The system shall provide `get_loss_breakdown(p_from, p_to)` returning `by_reason` and `by_client` as in
  DD-LR-6 for the caller's org only.
- **FR-LR-031** The cohort and window shall equal `get_win_rate`'s decided cohort for the same `p_from`/`p_to`.
- **FR-LR-032** The Win rate tile shall show, under its existing content, "Why deals were lost" (reason rows with
  lost and declined counts and a proportion bar; "Not recorded" as its own row) and "Win and loss by client" (top 10
  clients with won and lost counts), for the tile's selected period.
- **FR-LR-033** When no lost or declined deal is in the period, the system shall show "No lost deals in this period."
  in place of the reason list and shall omit the client list when there are no decided clients.
- **FR-LR-034** If the breakdown cannot be loaded, the system shall show an inline retry in the block and leave the
  rest of the tile unaffected.
- **FR-LR-035** After any project transition succeeds, the system shall refresh the breakdown (the `loss-breakdown`
  query joins the project projection invalidation roots).

## Non-functional requirements

- **NFR-LR-001 Authority.** `can()` stays UX-only; the RPC and column grants are the enforcement (ADR-0016, ADR-0019).
- **NFR-LR-002 Tenancy.** `get_loss_breakdown` is `security invoker`; org isolation comes from RLS. No `org_id` is sent
  or accepted from the client. Proven by pgTAP (a second org's deals never appear).
- **NFR-LR-003 Privileges.** The changed definer keeps `revoke ... from public, anon` and `grant execute ... to
  authenticated`; `get_loss_breakdown` is `execute` to `authenticated` only. The 0178 retained-definer count is
  unchanged (same `proname`; the invoker function is not a definer).
- **NFR-LR-004 Reversibility.** Down migrations restore the 0236 function and drop the columns and the new function.
- **NFR-LR-005 i18n.** New copy lives in its own namespace `lostReason` (`public/locales/{en,id}/lostReason.json`),
  en and id key trees identical; enum status values stay untranslated.
- **NFR-LR-006 Accessibility.** The picker is a labelled native `<select>` and `<textarea>`; error text is
  associated (`aria-describedby`); breakdown bars are decorative (`aria-hidden`) with counts in text; no new axe
  violations in the confirm and the tile.
- **NFR-LR-007 UI.** DESIGN.md tokens only; reuse `SelectField`/`TextField` styling primitives; rendered check with
  `scripts/ux-proof.sh` on the Company dashboard and a deal page.
- **NFR-LR-008 Performance.** One extra RPC per tile period; counts over indexed `projects` rows; no N+1.

## Acceptance criteria (Given / When / Then)

- **AC-LR-001** Given a project in Negotiation and a PM, when `transition_project` targets `Loss Tender` with reason
  `price` and note "Undercut by 8%", then status is `Loss Tender`, `lost_reason = 'price'`, the note is stored and the
  audit row detail contains both.
- **AC-LR-002** Given the same project, when the call targets `Loss Tender` or `Declined` with a null, blank or
  unknown reason, then it raises `P0001` and the project is unchanged.
- **AC-LR-003** Given reason `other` with a null or blank note, then `P0001`; with a note, it succeeds.
- **AC-LR-004** Given a `Declined` project revived to `Negotiation`, then `lost_reason` and `lost_note` are null and
  the earlier reason is still in its audit row; losing it again with `timing` stores `timing`.
- **AC-LR-005** Given a call to a non-lost target that also passes a reason, then no reason is stored.
- **AC-LR-006** Given the existing win and ordinary-transition behaviour, then pgTAP 0027, 0028, 0029, 0030, 0031 and
  0236 still pass with loss calls updated to pass a reason (map, role gate, SoD, decided_at unchanged).
- **AC-LR-007** Given `authenticated`, when it runs a direct `UPDATE projects SET lost_reason = ...`, then it is
  denied (column privilege), and `transition_project`/`get_loss_breakdown` ACLs match NFR-LR-003.
- **AC-LR-008** Given lost and declined deals with mixed reasons and a never-recorded historic loss in one org, and a
  deal in another org, when `get_loss_breakdown(null, null)` runs as the first org, then `by_reason` counts equal the
  hand-computed oracle (including the `null` row), the other org's deal is absent, and `by_client` ranks and counts
  match (Declined excluded from client losses).
- **AC-LR-009** Given a bounded window, then the cohort equals `get_win_rate`'s for the same bounds (a deal decided
  outside is excluded; an undated outcome appears only when both bounds are null).
- **AC-LR-010** Given a PM on a deal's status menu choosing `Loss Tender`, then the "Mark project as lost" confirm
  shows the reason picker with nothing selected and Confirm disabled; choosing "Price" enables it; Confirm sends
  `lostReason: 'price'`; choosing "Other" with an empty note keeps Confirm disabled.
- **AC-LR-011** Given the deal page "Mark lost" and "Decline to bid" confirms, then each shows the same picker and
  sends the reason with the transition.
- **AC-LR-012** Given a drag to the Lost column (Loss Tender or Declined chosen), then the same picker is required
  before Confirm and the reason is sent. *(Owned in the #1637 `DraggableSalesBoard` suite extension; see plan S4.)*
- **AC-LR-013** Given a server refusal on a lost transition, then the confirm path shows the server message and the
  deal is unchanged.
- **AC-LR-014** Given a lost deal with a reason and note, then the deal page shows the label and the note; given a
  historic lost deal, "Not recorded"; given an open deal, nothing.
- **AC-LR-015** Given the Win rate tile with breakdown data, then it lists reasons with counts (declined shown
  separately), a "Not recorded" row, and the top clients with won and lost counts, for the selected period; with no
  losses it shows "No lost deals in this period."; with a failed load it shows a retry and the rest of the tile still
  renders.
- **AC-LR-016** Given Indonesian locale, then the picker, deal-page line and breakdown render Indonesian copy and
  `npm run check:i18n` passes.
- **AC-LR-017** Given a PM and an open deal (real browser, real DB), when they mark it lost from the deal page with
  reason "Price", then after reload the deal page shows "Price", and the Company dashboard Win rate tile lists "Price"
  with a count of at least 1. *(Cross-stack journey.)*
- **AC-LR-018** Given the picker confirm and the tile breakdown, then axe reports no violations.

## Traceability (owning layer, ADR-0010)

| AC | Owning layer | Test (detail in the plan §4) |
|---|---|---|
| 001, 002, 003, 004, 005, 006, 007 | pgTAP | `supabase/tests/0437_lost_reason.test.sql` (0030 and 0236 updated to pass a reason; 0027, 0028, 0029, 0031, 0032 re-run unchanged) |
| 008, 009 | pgTAP | `supabase/tests/0438_loss_breakdown.test.sql` |
| 010 | Vitest/RTL | `components/ProjectStatusControl.lostReason.test.tsx` |
| 011, 013 | Vitest/RTL | `pages/project-detail/__tests__/PipelineLens.lostReason.test.tsx` |
| 012 | Vitest/RTL | `pages/sales-pipeline/__tests__/DraggableSalesBoard.lostReason.test.tsx` |
| 014 | Vitest/RTL | `pages/project-detail/__tests__/PipelineLens.lostReason.test.tsx` |
| 015, 016 | Vitest/RTL | `src/components/dashboard/__tests__/LossBreakdown.test.tsx` |
| (unit) reason model | Vitest | `src/lib/lostReasons.test.ts` (keys, validity, labels complete) |
| 017, 018 | Playwright (+ axe) | `e2e/AC-LR-017-lost-reason.spec.ts` |

## Open questions (owner signs; each has a recommended default)

1. **OQ-LR-1 Category list.** Default: the nine keys in DD-LR-1. Changing labels is free; changing keys later needs a
   data migration.
2. **OQ-LR-2 Reason for `Declined`.** Default: required, same list (a decline is also a lost opportunity worth
   explaining). Alternative: required for Loss Tender only.
3. **OQ-LR-3 Edit a reason afterwards.** Default: no (v1); historic rows stay "Not recorded". A small
   `set_lost_reason` RPC for Admin/Executive/PM is the follow-up if the owner wants to backfill.

## Follow-ups

Org-editable reason list; edit/backfill of a reason; value by reason (per currency); reason on the pipeline import;
click a reason to list its deals; the #1638 history view showing earlier reasons from the audit trail.
