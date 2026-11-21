# Daily target per work order: target against actual per day, month to date, projection (#2672)

Status: **Draft, 2026-11-21.** Map #2516. Target 15 December 2026. Size M. IDs `FR-WDT-###`, `AC-WDT-###`.
Stacked on #2671 (`docs/specs/work-order-revenue-plan.spec.md`). Rulings: OD-SCOPE-2 (no client process in code), OD-SCOPE-7 (the target is an entered
figure, never calculated from crews or productivity).
Plan: `docs/plans/2026-11-21-work-order-daily-target.md`. Executor: Orca worker. Derived reads and one settings list; posts nothing, no money-path or SoD change.

**Job story.** When a month starts, I want a revenue target per work order and per day, so each day's result is read against what we aimed for.

## 1. Decision: one record, not two
**The daily target IS #2671's dated revenue plan row** (`work_order_revenue_plan`, one amount per work order and date). Why:
- #2671 already stores an entered amount per work order per date, entered by date or by month and spread evenly over working days with edits kept. That is exactly this ticket's "what ships" entry half.
- A second table would hold the same figure twice; the two would drift and the screen would have to say which one is "the target". One figure, one name in the UI ("Target"; the #2671 cumulative view stays "Revenue plan").
- What this ticket adds is therefore not a new store but (a) the client's **non-working-dates list**, which changes which days a month is spread over, and (b) **per-day, month-to-date and month-end projection reads** over the same rows and the same actual.
- OD-SCOPE-7 holds: nothing computes a target; the projection (FR-WDT-013) projects the *actual* run-rate and is labelled a projection, never a target.

## 2. AS-IS (reused, not forked)
- Plan rows, entry RPCs (`wo_revenue_plan_set_day`, `wo_revenue_plan_set_month`, `wo_revenue_plan_clear`), the on/off switch `org_revenue_plan_settings.enabled` (off by default) and working weekdays (1275-1277).
- `org_is_working_day(org, date)` is the single place a working day is decided; the month spread and this ticket both call it.
- Actual = validated, non-superseded, non-archived daily revenue by report `work_date` (`wrp_figures`); visibility gate `dsr_may_see_revenue`.
- Not present: a non-working-dates list; a per-day / month-to-date / projection read (`scripts/prior-art.sh "daily target"` finds only OD-SCOPE-7).

## 3. Definitions (glossary additions)
- **Daily target** — the entered revenue amount for one work order on one date (a plan row, #2671).
- **Non-working date** — a calendar date an organisation marks as not worked (holiday, shutdown), whatever its weekday. A working day = its weekday is a working weekday **and** the date is not a non-working date.
- **Month to date (MTD)** — the sum from the first of the as-of date's month to the as-of date, for target and for actual.
- **Projection to month end** — actual MTD plus the average actual per elapsed working day times the working days left in the month. A forecast of actual, not a target.

## 4. Requirements (EARS)

**Setting**
- FR-WDT-001 Where the Revenue plan setting (#2671) is on, an Admin shall be able to keep a list of non-working dates (date, optional label up to 80 chars). While the setting is off, the list reads empty to everyone and writes are refused. No new row = no change: an organisation with an empty list behaves exactly as #2671.
- FR-WDT-002 `org_is_working_day` shall return false for a listed date. This changes the month spread for months entered afterwards; existing rows are never changed or deleted by editing the list (an entered figure is not silently moved). A target already on a non-working date stays and is shown with a "non-working day" marker.
- FR-WDT-003 Adding a date that is already listed is a no-op; a date shall be a real calendar date between 2000-01-01 and 2100-12-31; removing a date removes only that row. Each change is audited (who, when, date).

**Entering the target** (no new entry path)
- FR-WDT-004 Entering a target per day or per month, spreading, keep-edited, freezing for Cancelled/Closed, roles, amount shape and audit are exactly FR-WRP-002..007; this ticket adds no write RPC for targets.

**Reading target against actual**
- FR-WDT-010 The system shall provide one read per work order and as-of date (default today in the organisation's timezone) returning, for the as-of month, a row per calendar day: date, working-day flag, target, actual, day gap (actual less target) and a flag "no target entered". Target and actual come from the same SQL read as #2671's figures.
- FR-WDT-011 The same read shall return month-to-date target, month-to-date actual and month-to-date gap, and the month's full target.
- FR-WDT-012 A day with a target and no validated revenue shows actual 0 and, when submitted-not-validated reports exist for that day, their count ("not yet validated"); those are never counted as actual (as FR-WRP-013).
- FR-WDT-013 The same read shall return **projection to month end**: actual MTD + (actual MTD / elapsed working days) x remaining working days. Elapsed working days = working days from the later of the first of the month and the work order's start date, through the as-of date; remaining = working days after the as-of date to the earlier of month end and the work order's end date. When elapsed working days is 0 the projection is null ("not enough days yet"), never 0.
- FR-WDT-014 The read shall also return the projected gap to the month's full target; both amounts are always shown, never a percentage alone. Money is exact to the cent.
- FR-WDT-015 A caller who may not see revenue (`dsr_may_see_revenue` false) shall get a refusal, shown as "restricted", never a zero. Setting off returns no rows. A work order with no target in the month shows "no target entered", not a zero gap.
- FR-WDT-016 A project-level read shall return the same MTD figures per work order and a total **per currency**, never blended.

**Screens**
- FR-WDT-020 The work-order Revenue plan section (#2671) shall gain a **Daily target** view (only when the setting is on and the caller may see revenue): the as-of month's days against target and actual, the MTD figures, the projection, and the "keep edited days / month amount" entry already built. Phone shows a list per day; desktop a table plus a day bar chart. Behind-target reads in words ("1,200.00 behind target").
- FR-WDT-021 The project Revenue plan roll-up (#2671) shall add MTD target, MTD actual and projection per work order and the per-currency total.
- FR-WDT-022 The Administration > Projects card (where #2671 put the switch) shall gain a **Non-working dates** editor (add a date + label, remove), Admin only, shared form primitives.
- FR-WDT-023 English and Bahasa Indonesia strings; 320 CSS px; `DESIGN.md` tokens; states loading, empty, error, restricted.

## 5. Settings and defaults (existing organisations see no change)
| Setting | Where | Default |
|---|---|---|
| Revenue plan on/off (reused) | `org_revenue_plan_settings.enabled` | **off** |
| Working weekdays (reused) | `org_revenue_plan_settings.working_weekdays` | Monday to Friday |
| Non-working dates (new list) | new table `org_non_working_dates(org_id, work_date, label)` | **empty**; no row = every weekday rule stands |
No client calendar, holiday set or day count is coded. The target amounts, the dates and the weekdays are the client's data.

## 6. Database-enforced rules and proofs
| Rule | Enforced by | pgTAP |
|---|---|---|
| Admin-only list writes; own org; real date; setting off refuses; table grants SELECT only (FR-WDT-001/003) | security-definer RPCs `non_working_date_add/remove` + RLS `(select auth_org_id())` | `supabase/tests/1280_non_working_dates.test.sql` |
| Working-day rule honours the list; month spread skips listed dates; existing rows untouched (FR-WDT-002) | `create or replace org_is_working_day` (1280) | same file |
| Per-day, MTD, projection, restricted, setting off (FR-WDT-010..016) | read RPCs reusing `dsr_may_see_revenue` and the actual filter | `supabase/tests/1281_work_order_daily_target_reads.test.sql` |
| Cross-org isolation, anon cannot execute, RLS initplan | RLS + revokes | both files + 0178 anon test + 0646 |

Mutation checks (written as a note, run by the orchestrator): (a) make `org_is_working_day` ignore the list; (b) count `submitted` reports in actual; (c) drop the Admin check in `non_working_date_add`. Each must turn its file red.

## 7. Acceptance criteria
| ID | Given / When / Then | Layer |
|---|---|---|
| AC-WDT-001 | Given the setting off (default), when anyone reads the day view or edits the non-working list, then reads return nothing, writes are refused and no section shows. | pgTAP + Unit |
| AC-WDT-002 | Given an Admin with the setting on, when they add 25 Dec, then it is listed; adding it again changes nothing; a non-Admin is refused. | pgTAP (+ mutation c) |
| AC-WDT-003 | Given 25 Dec (a Thursday) listed and a December amount of 2100.00 spread over the other working days, when spread, then no row is dated 25 Dec and the rows sum exactly to 2100.00. | pgTAP (+ mutation a) |
| AC-WDT-004 | Given a month already spread, when a date is added to the list, then no existing target row changes. | pgTAP |
| AC-WDT-005 | Given targets 100 on 1 Dec and 100 on 2 Dec and validated actual 80 on 1 Dec, when read as of 2 Dec, then day 1 gap is -20, day 2 actual 0, MTD target 200, MTD actual 80, MTD gap -120. | pgTAP |
| AC-WDT-006 | Given a submitted (not validated) report of 50 and a superseded one of 40 on a day, when read, then actual excludes both and the day shows "1 not yet validated". | pgTAP (+ mutation b) |
| AC-WDT-007 | Given MTD actual 600 after 3 elapsed working days and 19 working days left, when read, then projection is 600 + 200 x 19 = 4400.00; with 0 elapsed working days the projection is null. | pgTAP |
| AC-WDT-008 | Given a work order with no target in the month, when viewed, then "no target entered" shows, not a zero gap. | Unit |
| AC-WDT-009 | Given an Engineer, when reading, then refused and the screen says restricted, never 0. | pgTAP + Unit |
| AC-WDT-010 | Given two work orders in two currencies, when the roll-up is read, then MTD and projection totals are per currency, never blended. | pgTAP + Unit |
| AC-WDT-011 | Given a user of another org, when reading or editing the list, then no rows and refused. | pgTAP |
| AC-WDT-012 | Given a target dated on a listed date, when the day view renders, then the day carries a "non-working day" marker and its target is still counted. | Unit |
| AC-WDT-013 | Given Bahasa Indonesia, when the view and the editor render, then every string is translated. | Unit |
| AC-WDT-014 | Given an Admin on a phone, when they add a non-working date and a Finance user then enters a month amount, then the day view shows no target on that date and MTD matches the project page. | E2E (one journey) |

## 8. Open questions (defaults taken, owner may override)
- OQ-WDT-1 Same record as #2671's plan (decided above). Override only if the client wants a target distinct from a plan.
- OQ-WDT-2 Projection is a run-rate over elapsed working days; an alternative "plan pace" (actual MTD + remaining target) is not built. Default as written.
- OQ-WDT-3 Adding a date does not re-spread existing months (an entered figure is never silently moved); the user re-enters the month with "keep edited days" to re-spread.
