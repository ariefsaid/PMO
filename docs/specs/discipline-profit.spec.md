# Profit per discipline: revenue next to the cost that exists

Issue #2669 (map #2516). Status: **Draft, 2026-11-21**. IDs: `FR-DPR-###`, `AC-DPR-###`.
Executor: Director-dispatched Orca worker; money read, ships alone. Plan `docs/plans/2026-11-21-discipline-profit.md`.
**Money path: read-only derivation.** No posting, no SoD change. Reuses, does not fork: the plan-versus-actual read
(`docs/specs/work-order-plan-vs-actual.spec.md`, DD-WPVA-1: direct and allocated cost per discipline, one margin
formula, largest-remainder allocation) and validated daily progress (`docs/specs/daily-site-report.spec.md`: a
validated report freezes its rate and amount per progress line; only current, non-superseded, validated reports count).

**Job story.** When I review a project, I want revenue and cost side by side per discipline, so I can see which
discipline makes or loses money.

## 1. AS-IS
- Cost per discipline (plan and actual, direct and allocated) already exists per work order and per project
  (`rollupProject`, `pages/project-detail/WorkOrderPlanVsActual.tsx`). WPVA FR-WPVA-030 states "discipline revenue is
  not apportioned": revenue exists only per work order and project.
- Validated progress lines carry the frozen contract rate and amount (`dsr_progress_lines.frozen_amount`) but no
  discipline. A progress line points at a work-order line, which points at a BoQ item (`boq_items`). A BoQ item has no
  discipline. Disciplines are the client's own list (`cost_disciplines`).

## 2. Definitions
- **Discipline revenue**: the sum of `frozen_amount` of validated, non-superseded, non-archived progress lines whose BoQ
  item names that discipline. Lines whose BoQ item names none roll under "No discipline". Revenue is at the contract
  rate frozen at validation, never re-priced. A validated line frozen without a rate is counted as **unrated**, named
  apart, and makes that discipline's revenue "incomplete", never zero.
- **Discipline margin** = discipline revenue - (direct cost + allocated shared cost), shown also before shared cost
  (revenue - direct), using the one existing margin formula.

## 3. Requirements (EARS)

**Setting and data**
- FR-DPR-001 The organisation shall have a setting "Profit per discipline", **off by default**. While off, no screen,
  read or total in the app changes for the organisation, and the read below returns nothing.
- FR-DPR-002 A BoQ item shall carry an optional discipline from the organisation's own list (an active discipline of the
  same org). Existing items have none. Setting or clearing it is a write for Admin, Executive, Finance and the project's
  Project Manager, enforced in the database; a discipline of another org or an archived one is refused.
- FR-DPR-003 Changing a BoQ item's discipline shall not change any validated amount, claim, rate or project total.

**Read**
- FR-DPR-010 Where the setting is on, one read per project shall return revenue per discipline and currency, the count
  of unrated validated lines, and the count of validated lines per discipline, from the same rows work-order revenue uses.
  It is available only to callers who may see revenue on that project (Admin, Finance, Executive, the project's Project
  Manager); any other caller is refused, never returned zeros (restricted).
- FR-DPR-011 A project of another org shall read as absent. Draft, submitted, returned and superseded reports shall not
  count.
- FR-DPR-012 Revenue per discipline summed with "No discipline" shall equal the project's validated work revenue from
  `work_order_validated_revenue`, over its work orders.

**Screen (project, plan-versus-actual tab)**
- FR-DPR-020 Where the setting is on and the caller may see revenue, a "Profit per discipline" table shall show per
  discipline: revenue, direct cost, allocated shared cost, margin before and after shared cost, plus a project total row.
  Disciplines with cost but no revenue (or revenue but no cost) still appear. The total row's cost and revenue equal the
  project figures already on the tab.
- FR-DPR-021 Revenue and cost in different currencies shall never be blended: per currency, margin reads "not
  comparable" when currencies differ (as `different-currencies`). Restricted, incomplete (unrated) and unknown figures read
  as such in words, never as zero. A loss reads "loss of X" in text, not colour alone.
- FR-DPR-022 The table shall be usable at phone width, in English and Bahasa Indonesia, with one empty line when no
  discipline has figures.
- FR-DPR-023 An Admin shall be able to turn the setting on or off from the existing organisation settings screen.

## 4. Settings (all client-controlled; no client process in code)
| Setting | Where | Default |
|---|---|---|
| `organizations.discipline_profit_enabled` (boolean) | org settings screen | **false** (existing organisations see no change) |
| Discipline list | existing `cost_disciplines` (Admin keeps it) | unchanged |
| `boq_items.discipline_id` | BoQ item edit | empty |

## 5. Database-enforced rules and proofs
| Rule | Enforced by | pgTAP |
|---|---|---|
| FR-DPR-002 write roles, same-org active discipline, no other BoQ column touched | security-definer RPC `set_boq_item_discipline` (column write revoked) | `supabase/tests/1265_discipline_profit.test.sql` |
| FR-DPR-001/010/011 setting off returns nothing; revenue-reader roles only; other org absent | security-definer RPC `project_discipline_revenue` using `dsr_may_see_revenue` | same file |
| FR-DPR-012 reconciliation to project validated revenue | same RPC | same file |
| FR-DPR-023 only Admin flips the setting | existing org-update policy / column grant | same file |

## 6. Acceptance criteria
| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-DPR-001 | Given a new or existing org, then `discipline_profit_enabled` is false and `project_discipline_revenue` returns no rows and the tab shows no table. | pgTAP + Unit |
| AC-DPR-002 | Given the setting off, when the app renders any existing project screen, then output equals today's (no new request). | Unit |
| AC-DPR-003 | Given an Engineer or a Project Manager of another project, when setting a BoQ item discipline or reading the revenue, then refused (42501); Finance/Admin/Executive/own PM succeed. | pgTAP |
| AC-DPR-004 | Given a discipline of another org or an archived one, when set on a BoQ item, then refused. | pgTAP |
| AC-DPR-005 | Given validated lines 100.00 (civil), 50.00 (electrical), 25.00 (no discipline) and a draft line 999.00, then revenue is 100.00, 50.00, 25.00, the draft is not counted. | pgTAP |
| AC-DPR-006 | Given a superseded validated report and its correction, then only the correction counts. | pgTAP |
| AC-DPR-007 | Given the per-discipline revenue, then its sum equals `work_order_validated_revenue` summed over the project's work orders. | pgTAP (Layer-1 money test) |
| AC-DPR-008 | Given a validated line frozen without a rate, then it is counted as unrated and the discipline reads "incomplete", never zero. | pgTAP + Unit |
| AC-DPR-009 | Given revenue 100.00 and direct 60.00, allocated 15.00, then margin before shared is 40.00, after is 25.00; revenue 100.00 and cost 130.00 reads "loss of 30.00". | Unit (pure function `disciplineProfit`) |
| AC-DPR-010 | Given a discipline with cost and no revenue, and another with revenue and no cost, then both appear; totals equal the project figures. | Unit |
| AC-DPR-011 | Given revenue in one currency and cost in another, then margin reads "not comparable". | Unit |
| AC-DPR-012 | Given a caller who cannot see revenue, then the table reads "restricted", not zero. | Unit |
| AC-DPR-013 | Given the setting on, when a Finance user opens the project tab, then the table shows revenue beside cost and margin per discipline and a project total. | E2E (one journey) |
| AC-DPR-014 | Given Bahasa Indonesia, then every new string is translated (completeness check) and the table fits at 390 px. | Unit (i18n) + screenshots |
| AC-DPR-015 | Given a non-Admin, when turning the setting on, then refused; Admin succeeds. | pgTAP |

**Mutation check (required):** make `project_discipline_revenue` count every status (or drop the `superseded_at is null`
filter) and AC-DPR-005/006/007 go red; make `set_boq_item_discipline` skip the role gate and AC-DPR-003 goes red; restore.

## 7. Rulings (coordinator, 2026-11-21)
1. The discipline sits on the contract item (`boq_items.discipline_id`); progress lines reach it through `work_order_lines.boq_item_id`.
2. The headline margin is after shared cost; before shared cost is the second column.
3. A picker on the contract line form, shown only while the setting is on and only when editing an existing line (a new line has no id until saved). The contract-line import carries no discipline column, so the picker is the only way.
4. The setting follows the organisation-setting pattern of the fiscal-year start (a column, a getter, an Admin-only audited setter RPC), not `org_features`.
5. The revenue read returns a `basis` column (`validated_progress`) so a second basis (billed) can be added beside it without rewriting the read or the join.

## 8. Out of scope
Forecast to completion, tax, per-discipline billing, re-pricing validated lines, new cost sources.
