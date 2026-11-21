# Dated revenue plan per work order: plan to date, actual and gap (#2671)

Status: **Draft, 2026-11-21.** Map #2516. Target 15 December 2026. Size M. IDs `FR-WRP-###`, `AC-WRP-###`.
Rulings: OD-SCOPE-2 (no client process in code), OD-SCOPE-7 (the daily target is an entered figure, never calculated from crews or productivity).
Plan: `docs/plans/2026-11-21-work-order-revenue-plan.md`. Executor: Orca worker, ships with the other money-lane tickets; the read is
derived and posts nothing, so no money-path or SoD change.

**Job story.** When a work order is running, I want its revenue plan by date against what was earned, so I see the gap while there is time to act.

## 1. AS-IS (reused, not forked)
- **Actual** = validated daily revenue (`daily_site_reports`, 1040; `dsr_progress_lines.frozen_amount`, 1041). Only `validated`, non-superseded,
  non-archived reports count (FR-DSR-014). `work_order_validated_revenue(wo)` already returns the total to date; there is no per-date read.
- Read access to revenue is `dsr_may_see_revenue(project)` (Admin, Finance, Executive, the project's PM). This feature uses the same gate.
- `work_order_plan_lines` (0997) holds planned **cost** figures; this feature is a separate, dated **revenue** plan and does not touch it.
- No dated plan, no working-day calendar and no organisation switch for this exist (`scripts/prior-art.sh` found nothing).

## 2. Definitions (glossary additions)
- **Revenue plan** — per work order, an entered amount of revenue for each plan date, in the work order's currency.
- **Plan to date** — sum of plan amounts dated on or before the as-of date (default today in the organisation's timezone).
- **Actual to date** — sum of validated, non-superseded daily revenue dated on or before the as-of date (by report `work_date`).
- **Gap** = actual to date less plan to date. Negative = behind plan. Never a percentage-only figure; both amounts are always shown.
- **Working days** — the weekdays the organisation marks as working (setting); a month amount is spread over them.

## 3. Requirements (EARS)

**Setting (off by default)**
- FR-WRP-001 The organisation shall have one setting **Revenue plan** (off by default) and one setting **Working weekdays** (default Monday to Friday).
  Admin only sets them. While the setting is off, no new screen, section, column or action appears and the read functions return nothing.

**Entering the plan**
- FR-WRP-002 Where the setting is on, an Admin, Executive, Finance or the project's Project Manager shall be able to enter a plan amount **for one date** of a work order.
- FR-WRP-003 Where the setting is on, the same roles shall be able to enter a plan amount **for one month**; the system shall spread it evenly over the
  month's working days (clipped to the work order's dates if it has them), exact to the cent by largest remainder (earliest dates take the extra cent), and store one dated row per day.
- FR-WRP-004 A day's amount can then be edited on its own; an edited day is kept when the month is re-spread only if the user chooses "keep edited days",
  and the remaining amount of the month is spread over the other working days. Re-entering a month without that choice replaces all its rows.
- FR-WRP-005 An amount shall be a finite number from 0 to under 1e15 with at most two decimals; a date shall be a real calendar date. A month with no working day is refused with a clear message.
- FR-WRP-006 A Cancelled or Closed work order's plan is frozen (refused on write). Each write call records who, when and the amounts before and after in the audit log.
- FR-WRP-007 Clearing a date or a month removes its rows. The plan never changes an actual, a project total, a budget or an invoice.

**Reading plan, actual and gap**
- FR-WRP-010 The system shall provide one read per work order returning, for an as-of date: plan to date, actual to date, gap, full plan total, and a series by
  date (plan, actual, cumulative plan, cumulative actual) for a chosen range. Plan and actual come from the same SQL read so the screen never re-sums.
- FR-WRP-011 The system shall provide one read per project returning the same figures per work order and a total **per currency**; currencies are never blended (as `deriveMargin`).
- FR-WRP-012 A caller who may not see revenue (`dsr_may_see_revenue` false) shall get a refusal, shown as "restricted"; never a zero or partial figure.
- FR-WRP-013 A work order with a plan but no validated report shows actual 0 **and** the count of submitted-not-validated reports ("not yet validated"), never counted as actual.
- FR-WRP-014 A work order with no plan shows "no plan entered", not a zero gap. Actual dated after the last plan date still counts in actual to date.

**Screens**
- FR-WRP-020 The work-order page shall have a **Revenue plan** section (only when the setting is on and the caller may see revenue): the three figures,
  a cumulative plan-versus-actual chart, and the entry form (by date, by month) from the shared form primitives, `can()`-gated. Overspend/shortfall reads in words.
- FR-WRP-021 The project page shall show a **Revenue plan** roll-up (same condition): one row per work order and the per-currency total, each row linking to its page.
- FR-WRP-022 Strings in English and Bahasa Indonesia; works at 320 CSS px; `DESIGN.md` tokens; states: loading, empty, error, restricted.

## 4. Settings and defaults (existing organisations see no change)
| Setting | Where | Default |
|---|---|---|
| Revenue plan on/off | new table `org_revenue_plan_settings.enabled` (one row per org); Administration > Projects card | **off** |
| Working weekdays | `org_revenue_plan_settings.working_weekdays smallint[]` (ISO 1..7) | `{1,2,3,4,5}` |

No row = off. The internal function `org_is_working_day(org, date)` is the one place a working day is decided; #2672 reuses it and adds a non-working-dates list. No client calendar or day count is coded.

## 5. Database-enforced rules and proofs
| Rule | Enforced by | pgTAP |
|---|---|---|
| Plan write roles; cancelled/closed frozen; own org/project; amount shape (FR-WRP-002/005/006) | security-definer write RPCs (table grants SELECT only) + check trigger | `supabase/tests/1275_work_order_revenue_plan.test.sql` |
| Month spread exact to the cent, working days only (FR-WRP-003/004) | `wo_revenue_plan_set_month` | same file |
| Setting off => reads return null, writes refused (FR-WRP-001) | RPC guard | both files |
| Revenue visibility and only-validated actual (FR-WRP-010..013) | read RPCs reusing `dsr_may_see_revenue` | `supabase/tests/1276_work_order_revenue_plan_reads.test.sql` |
| Cross-org isolation, anon cannot execute, RLS initplan | RLS `(select auth_org_id())`, revoke from anon | both files + 0178 anon test + 0646 |

Mutation checks: (a) drop the role check in the write RPC; (b) change the actual filter to include `submitted` reports. Each must turn its pgTAP file red.

## 6. Acceptance criteria
| ID | Given / When / Then | Layer |
|---|---|---|
| AC-WRP-001 | Given the setting off (default), when any caller reads or writes the plan, then reads return no rows and writes are refused; no section shows on either page. | pgTAP + Unit |
| AC-WRP-002 | Given the setting on and a Finance user, when they enter 500.00 for a date, then plan to date as of that date includes it. | pgTAP |
| AC-WRP-003 | Given a month of 22 working days and amount 1000.01, when spread, then 22 rows sum to exactly 1000.01 and no weekend row exists. | pgTAP |
| AC-WRP-004 | Given a spread month and one edited day with "keep edited days", when re-spread with a new amount, then the edited day is unchanged and the rest sum to the remainder. | pgTAP |
| AC-WRP-005 | Given an Engineer or another project's PM, when they write a plan, then it is refused; Admin, Executive, Finance and the project's PM may. | pgTAP (+ mutation) |
| AC-WRP-006 | Given a Cancelled work order, when its plan is written, then refused. | pgTAP |
| AC-WRP-007 | Given validated 300 on 3 Dec, submitted 200 and a superseded 100, when actual to date is read, then it is 300 and the not-yet-validated count is 1. | pgTAP (+ mutation) |
| AC-WRP-008 | Given plan to date 800 and actual 300, when read, then gap is -500 and the screen says "500.00 behind plan". | pgTAP + Unit |
| AC-WRP-009 | Given an Engineer, when reading, then refused and the screen says restricted, never 0. | pgTAP + Unit |
| AC-WRP-010 | Given two work orders in two currencies on a project, when the roll-up is read, then totals are per currency and never blended. | pgTAP + Unit |
| AC-WRP-011 | Given a work order with no plan, when viewed, then "no plan entered" shows, not a zero gap. | Unit |
| AC-WRP-012 | Given a user in another org, when reading or writing, then no rows and refused. | pgTAP |
| AC-WRP-013 | Given Finance on a phone, when they enter a month amount on a work order and open the project page, then both show the same plan to date and gap. | E2E (one journey) |
| AC-WRP-014 | Given Bahasa Indonesia, when the section renders, then every string is translated. | Unit |

## 7. Open questions (defaults taken, owner may override)
- OQ-WRP-1 Holidays: default is weekdays only; a per-organisation non-working date list is a small follow-up, not built here.
- OQ-WRP-2 The plan date is compared to the report's `work_date` (not validation date). Default as written.
- OQ-WRP-3 Roles: Admin, Executive, Finance and the project's PM write; the same set plus the daily-report validators read (matches `dsr_may_see_revenue`).
