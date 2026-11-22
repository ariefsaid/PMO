# Labour cost for crew members with no login (NLL)

Lane gap-people, item `no-login-labour-cost`. Status: **Draft for Director go, 2026-11-22.** Plan
`docs/plans/2026-11-22-no-login-labour-cost.md`. IDs: `FR-NLL-###`, `AC-NLL-###`. **Money path: ships alone** (it adds
rates and a read; it posts nothing, changes no approval and no ledger). Extends labour cost in money
(`docs/specs/labour-cost-money.spec.md`, #2670) and idle cost (`docs/specs/idle-hours-cost.spec.md`, #2673). Migrations 1720-1721.

**Job story.** When a crew member with no login has approved hours on a work order, I want those hours costed at a rate
set by their labour class, so the work order's labour cost is real.

## 1. Today (verified on `land/fix-1122` at fc42e1a0; function bodies read from the database at head)
- **Rates exist only for a login or an access level.** `labour_cost_rates.subject_kind in ('person','role')`, `person_id`
  references `profiles` (`supabase/migrations/1250_labour_cost_settings.sql:28-44`); `labour_rate_for` resolves a profile's
  own rate, then its role's (`1250:90-101`). A person in the people register with no login has neither. The labour class
  is a property of the rate (`1250:31`), never of a person.
- **Approved no-login hours are in the hours-only attribution view, not in any money read.** `work_order_cost_lines`
  carries them as source `attendance_day` (hours, no money) when `status = 'present'`, `approved_at is not null` and
  `timesheet_entry_id is null` (`1037_attendance_timesheet.sql:291-297`). The money read the screens use,
  `work_order_cost_amounts` (head = `1298_work_order_labour_reads_aggregate.sql:13-53`), unions
  `work_order_cost_amounts_pre_labour` → `_unrounded` → `_unpriced` and `labour_cost_priced_lines` (`1251`); none of
  them reads `attendance_days` (database at head: no `attendance` in any of the five bodies). So a work order run by such
  a crew shows no labour cost and no crew hours. The item's "appear in no cost read" is right for every money read; the
  attribution view does list them, as hours.
- **A login's attendance reaches cost once, through its timesheet line.** `attendance_generate_timesheet` writes one line
  per present day and links it (`attendance_days.timesheet_entry_id`, `1037:133-137`); approval of a no-login week stamps
  `approved_at` on the attendance itself (`1037:238`) and approved no-login days are never re-opened (the only unlock is the
  timesheet trigger, `1037:182-186`).
- **Idle cost reads hourly cost from timesheet rows only.** `work_order_idle_cost` sums `source = 'timesheet_entry'`
  counted rows (`1298:79`); a work order whose labour is attendance-only gets reason `no-rate` (`1298:94`). The item's
  claim is right.
- **Rate privacy today.** Rates are read by Admin, Finance, Executive only (`1250:69-71`); a Project Manager reads labour
  money only aggregated per work order, discipline and class, with no record, date or person (`1298:41-50`, FR-LCM-013);
  any other role is refused the read (`42501`). History lock: a rate change that would re-price an approved hour is
  refused whatever the switch says (`1299:14-25`).
- **Front end.** `listProjectCostAmounts` throws "unexpected row" for any source not in its list
  (`pmo-portal/src/lib/db/workOrderFinance.ts:20,48-51`); crew hours and labour-by-class read `timesheet_entry` only
  (`pmo-portal/src/lib/workOrderPlanVsActual.ts:272,409`).

## 2. Definitions (glossary entries added with the build)
- **Class rate**: a labour cost rate whose subject is a labour class (not a person or a role). Same basis, amount,
  overtime multiplier, day and month length, dates and history lock as any labour cost rate.
- **Labour class assignment**: the labour class a person in the people register holds from a start date (optional end).
  Dated, so reclassifying a person never re-prices days already costed.
- **Costed attendance day**: a present, approved attendance day of a person, not linked to a timesheet line, and with no
  approved timesheet line of that person's login on the same project and date.

## 3. Requirements (EARS)
- FR-NLL-001 Admin and Finance shall create, end and archive **class rates** through the existing rate actions; a class
  rate names its class and no person or role. Admin, Finance and Executive read them; nobody else does (the existing rule).
- FR-NLL-002 Admin and Finance shall create, end and archive **labour class assignments** (person, class, start, optional
  end). On one date the assignment in force with the latest start applies. Admin, Finance and Executive read them.
- FR-NLL-003 While labour cost in money is on, each costed attendance day of a project shall be priced at the class rate in
  force on its date for the class the person holds that date, by the timesheet rule (FR-LCM-010): hours = recorded hours
  plus recorded overtime hours; regular hours fill the rate's day length first across the person's costed days of that
  date (ordered by project then record id), the rest at the overtime multiplier; rounded to 2 decimals per day.
- FR-NLL-004 `work_order_cost_amounts` shall report a priced costed day as source `attendance_day`, reason `counted`, the
  organisation currency, its amount and its labour class; a costed day with no class or no class rate in force as
  `no-rate` (hours, no money). For an attendance row `person_id` is the person-register id.
- FR-NLL-005 While labour cost in money is off, `work_order_cost_amounts` and `work_order_idle_cost` shall return exactly
  what they return today: no `attendance_day` row.
- FR-NLL-006 One worker's hours for one project and date shall be counted once across the whole read: a day linked to a
  timesheet line counts only through that line; a day of a person whose login has an approved timesheet line on that
  project and date counts only through that line.
- FR-NLL-007 For a Project Manager, priced attendance money shall be aggregate per work order, discipline and class, with
  no record id, no date and no person (FR-LCM-013); unpriced attendance rows carry no person.
- FR-NLL-008 A class rate or labour class assignment change that would re-price an already priced costed day shall be
  refused (`LCM_RATE_LOCKED` for a rate, `LCM_CLASS_LOCKED` for an assignment, `23514`), whatever the switch says.
- FR-NLL-009 Idle cost's work-order hourly cost shall be read from every counted labour row of `work_order_cost_amounts`
  measured in hours (timesheet and attendance), so an attendance-only work order gets an hourly cost.
- FR-NLL-010 Plan versus actual shall count costed attendance hours in crew hours, its priced amount in direct cost (once)
  and in labour per class, and its unpriced hours in the existing "carry no rate" note.
- FR-NLL-011 Administration › Labour cost shall offer "Labour class" as a rate subject and a **Crew member classes** list
  (add, end, archive), English and Bahasa Indonesia, phone and desktop. The person picker lists people with no login; a
  refusal shows its catalogue sentence.

No new setting: the feature rides the existing labour cost switch. For an organisation already using labour cost, money
figures change only once someone enters a class rate and an assignment (new data). With the switch on, approved no-login
hours now show in crew hours and in the "carry no rate" note; that is hours, not money, and already visible on attendance.

## 4. Acceptance criteria (owning layer in brackets)
- AC-NLL-001 Given the switch off, approved no-login days, class rates and assignments, when cost and idle cost are read,
  then both results equal the results read before that data existed. [pgTAP 1721]
- AC-NLL-002 Given the switch on, an hourly class rate 40000.00 and an assignment, when an approved 8-hour no-login day is
  read by Finance, then one `attendance_day` row, `counted`, 320000.00, organisation currency, the class, the person. [pgTAP 1721]
- AC-NLL-003 Given daily and monthly class rates, and a person with 6 h on one work order and 4 h on another the same day
  (day length 8, multiplier 1.5), then the daily figure is amount / day length x hours and the day costs 8 x r + 2 x r x 1.5
  in total, no hour priced twice. [pgTAP 1721]
- AC-NLL-004 Given two class rates and two assignments with different starts, then each date takes the class and rate in
  force; a day with no assignment, or no class rate, is `no-rate` with its hours. [pgTAP 1721]
- AC-NLL-005 Given submitted-not-approved, absent or leave days, then no `attendance_day` row. [pgTAP 1721]
- AC-NLL-006 Whole read, one project: (a) a login person whose attendance generated an approved timesheet yields one row
  per day, source `timesheet_entry`; (b) a no-login person yields one `attendance_day` row per day; (c) a person with an
  approved unlinked attendance day and an approved timesheet line of their login on the same project and date yields one
  row (the timesheet line); the total counted labour equals the hand sum. [pgTAP 1721]
- AC-NLL-007 Given a Project Manager, then attendance labour money comes as aggregate rows only (no record, date, person)
  whose sum equals Finance's; the PM reads no class rate and no assignment row; a role outside the four is refused the
  read (`42501`); Executive reads rows and rates. [pgTAP 1721]
- AC-NLL-008 Given idle minutes on a work order whose only priced labour is attendance, then idle cost is `counted` with an
  hourly cost (none shown to a PM); existing idle tests stay green. [pgTAP 1721]
- AC-NLL-009 Given the rate action with subject class, then Admin/Finance create it; bad fields, an archived or foreign
  class, and a duplicate start are refused; other roles are refused. [pgTAP 1720]
- AC-NLL-010 Given the assignment actions, then Admin/Finance add, end and archive; a person or class of another
  organisation, an archived class, reversed dates and a duplicate start are refused; others are refused; org is stamped
  by the server. [pgTAP 1720]
- AC-NLL-011 Given a priced costed day, then a class rate or assignment starting on or before it, and ending or archiving
  the one that prices it, are refused (`LCM_RATE_LOCKED` / `LCM_CLASS_LOCKED`), also with the switch off; one starting after
  it is accepted. [pgTAP 1720]
- AC-NLL-012 Given cost rows with source `attendance_day` (per row and PM aggregate), then the repository parses them; an
  unknown source still fails. [vitest `workOrderFinance.test.ts`]
- AC-NLL-013 Given attendance rows in the rollup, then crew hours include them, labour per class includes them, direct cost
  counts them once, unpriced ones are in uncosted hours. [vitest `workOrderPlanVsActual.test.ts`]
- AC-NLL-014 Given the Labour cost section, then Finance adds a class rate and assigns a class to a person with no login,
  ends and archives it; a locked change shows the catalogue sentence; EN and ID. [vitest + e2e
  `e2e/serial/AC-NLL-014-crew-member-class.spec.ts`]

## 5. Mutation checks (run in the wave; each must turn its test red, then restore)
Listed with exact edits in the plan, section "Mutation checks": the no-double-count rule (AC-NLL-006), the switch gate
(AC-NLL-001), the privacy rule (AC-NLL-007), the history lock (AC-NLL-011).

## 6. Open questions (customer; recommended answer first)
1. Recorded overtime on an attendance day: price by the day-length rule, like timesheets (recommended: yes, one rule; a
   login's attendance already becomes a timesheet line of hours + overtime) or by the recorded overtime field?
2. Should a class rate also price a login person who has no person or role rate? Recommended: not now; login pricing stays
   as is, and this can be added later as a last fallback without changing any priced figure.
3. Rate by crew position (crew standard role) as well as class? Recommended: no; positions are per-crew names, the class
   list is organisation-wide and is what guard head-count will price.

## 7. Out of scope
Pricing unapproved attendance; pay, payroll, wage scales; changing approval or attendance rules; the attribution list's
display of `attendance_day` lines (`pmo-portal/src/lib/db/workOrderCosts.ts` drops sources it does not list; reported
separately).
