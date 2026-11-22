# Idle cost of people and rented equipment together (IWR)

Slice `idle-with-rent` of the People, crews and time lane. Extends `docs/specs/idle-hours-cost.spec.md` (IHC, migrations
1255-1256, restated by 1721). IDs: `FR-IWR-###`, `AC-IWR-###`. Size M. **Money path, read-only costing**: it posts nothing,
changes no approval, no ledger and no actual. Migrations **1730-1731**. Status: approved; built (Phase B) on top of the merged head-count slice (1710, 1722-1724).

**Job story.** When work stops, I want the idle cost of a work order to add up the people and the rented equipment for the
stopped hours, by reason, so the claimable idle cost is one figure.

## 1. Today (verified, read from the base and the database at head)
- `work_order_idle_cost(uuid)` (restated in `supabase/migrations/1721_work_order_cost_amounts_attendance.sql:115`; body read
  from the database, same) returns per work order and idle reason: minutes, hours, hourly cost, amount, `counted`/`no-rate`.
- Its amount is **idle hours x the work order's average hourly cost**, where the average is counted labour amount divided by
  counted labour hours (hours rows from timesheets and, since 1721, costed attendance days). That is the cost of **one person**.
  **There is no head count in it**: a crew of eight idle for an hour is costed as one person-hour. The item text assumes a head
  count is present; the code has none, so the figure undercounts crews.
- Equipment is **not in it**. Equipment standby money exists only as a hire charge: approved, non-archived
  `equipment_usage_entries` of `kind = 'standby'` (optional `work_order_id`) x `standby_rate` of the asset's `hire_rate`
  setting in force that day (`equipment_hire_charges`, migration 0471/0460; `equipment_settings_effective`). Under the
  charge, standby units with no standby rate charge nothing. It is project-level in `equipment_charge_project_actuals`.
- The read is gated on `idle_cost_enabled` (labour cost in money AND the idle switch, `idle_cost_settings.enabled`, off by
  default) and on roles Admin, Executive, Finance, Project Manager; a Project Manager gets no hourly cost.
- Display: `pmo-portal/pages/work-order-detail/IdleCostBlock.tsx` (reason table + total + "shown apart" note); data access
  `pmo-portal/src/lib/db/idleCost.ts`; switch `pmo-portal/pages/admin/IdleCostSwitch.tsx`.
- Idle periods are per daily site report (work order + date), not per person (`dsr_idle_periods`); only validated, current
  reports count.
- Present people per work order per day: `attendance_days` (`status = 'present'`, one row per worker, work order, day).
- Idle cost never enters `work_order_cost_amounts`, plan versus actual totals or margin (FR-IHC-004). That stays.

## 2. Definitions (glossary entry with the build)
- **Head count on a day**: distinct workers with a `present` attendance day on that work order and date, plus the approved
  unnamed head-count lines (1710) for that work order and date. Unnamed lines carry no worker, so the two never name the
  same person and add up. One set-based SQL helper `idle_headcount_days(org, project)` (1730, internal, no client grant)
  is the single join point; a later people source is added there, nowhere else. Unapproved head-count lines do not count
  (they are not yet money anywhere); a present day counts whether or not it is approved.
- **People idle cost** (per reason): sum over days of idle minutes / 60 x head count that day x work-order hourly cost.
- **Equipment standby cost** (per reason): per day, approved standby entries on that work order x standby rate in force,
  shared across that day's reasons in proportion to their idle minutes. Only days that have recorded idle time on that work
  order count (the "same period"). Entries with no work order, or no standby rate, add nothing.
- **Idle cost** = people + equipment. A **view of cost by reason**: the people hours are already inside labour cost and the
  standby money already inside hire charges, so idle cost is never added to actuals, plan versus actual or margin.

## 3. Requirements (EARS)
- FR-IWR-001 The organisation shall have a setting **idle cost covers**: `labour_average` (today's figure) or
  `people_and_equipment`. **Default `labour_average`**, because the new figure changes a money figure for an organisation
  already using idle cost. Written only by Admin and Finance, enforced in the database. No new on/off switch: the existing
  idle switch and labour cost still gate everything.
- FR-IWR-002 Where the setting is `people_and_equipment`, each read row shall carry people amount, equipment amount and
  head-count hours (person-hours idle), and `amount` = people + equipment, exact to two decimals, organisation currency.
  Where it is `labour_average`, rows are exactly as today and the new columns are null.
- FR-IWR-003 Where head count on a day is zero and the setting is `people_and_equipment`, that day's people part shall be 0
  and its hours still show; it shall not fall back to one person.
- FR-IWR-004 The equipment part shall use only approved, non-archived standby entries naming that work order, in the asset's
  rate unit, at the standby rate in force on the entry date; the money is read, never stored or posted.
- FR-IWR-005 Idle cost shall not alter `work_order_cost_amounts`, plan versus actual totals, project actuals, margin or the
  ledger, and shall not appear while labour cost in money or the idle switch is off.
- FR-IWR-006 The read stays database-side, org-scoped, limited to Admin, Executive, Finance and Project Manager, and reveals no
  person; a Project Manager sees no hourly cost and no per-person figure (head count is a number, not a name).
- FR-IWR-007 The work-order idle block shall show, where the setting is `people_and_equipment`, a People column and an
  Equipment column beside the reason total, and one total. A row with no rate says so. EN and Bahasa Indonesia; 390 and 1440 px.
- FR-IWR-008 Administration > Idle time as cost shall carry the setting (shared select primitive; Admin and Finance; a refusal
  says why and what to do), EN and Bahasa Indonesia. The refusal sentence goes in the refusals catalogue.

## 4. Acceptance criteria (owning layer)
- AC-IWR-001 Given scope `labour_average` (default or no row), then every row equals today's 1255/1721 result and the new
  columns are null. [pgTAP]
- AC-IWR-002 Given scope `people_and_equipment`, 3 workers present, 60 idle minutes, hourly cost 62500, then people amount
  187500.00 and head-count hours 3.00. [pgTAP]
- AC-IWR-003 Given two days with different head counts and one reason, then the people part is the per-day sum, not the average
  head count. [pgTAP]
- AC-IWR-004 Given an approved standby entry of 2 h at standby rate 100000 on that work order and a day with idle time, then
  equipment amount 200000.00 and `amount` = people + equipment. [pgTAP]
- AC-IWR-005 Given that day has two reasons (30 and 90 minutes), then the equipment amount is shared 1:3 by idle minutes;
  each reason row is rounded once, so a split that does not divide to the cent can differ from the day's standby by under one
  cent per reason, and the total is the sum of the rows. [pgTAP]
- AC-IWR-006 Given standby entries that are draft, rejected, archived, without a work order, for another work order, on a day
  with no idle time, or with no standby rate, then they add nothing. [pgTAP]
- AC-IWR-007 Given zero present workers that day, then people 0.00, hours shown, equipment still added. [pgTAP]
- AC-IWR-008 Given any setting, then `work_order_cost_amounts`, the work order's direct cost and the plan-versus-actual totals
  are identical before and after switching the setting. **Owning layer: pgTAP**
  (`supabase/tests/1731_idle_with_rent.test.sql`): the fixture's whole cost read is asserted against a hand-calculated row set
  and money total under **both** scopes, and the before/after md5 differential is kept, so any idle money added to actual
  costs fails on an extra/changed row or on the total. The plan-versus-actual screen reads that same function, so the vitest
  half named in an earlier draft (never built) is not an owning layer and is not owed — a unit test restating the reducer
  would prove nothing the database oracle does not.
- AC-IWR-009 Given labour cost off or the idle switch off, then no row, whatever the scope. [pgTAP]
- AC-IWR-010 Given a non-Admin/Finance caller, then writing the scope is refused (42501); another organisation's project reads
  as absent; a Project Manager's rows carry no hourly cost. [pgTAP]
- AC-IWR-011 Given the block with rows carrying people and equipment, then it shows both columns and one total, apart from
  direct cost; with null columns it renders as today. [vitest component]
- AC-IWR-012 Given the Administration control, then Admin/Finance change the scope and a refusal shows its reason; EN and ID.
  [vitest + one e2e journey]
- AC-IWR-013 Given approved unnamed head-count lines (1710), then they add to the head count of that work order and day, and
  an unapproved line or an absent attendance row adds nothing. [pgTAP]

## 5. Settings added and defaults
| Setting | Where | Default | Enforced by |
|---|---|---|---|
| Idle cost covers | `idle_cost_settings.scope` | `labour_average` (today's figure) | RPC `save_idle_cost_scope(text)` Admin/Finance; pgTAP |
Database-enforced: scope write role, both-switch gate, report eligibility, org scoping, role gate, head count and standby
arithmetic. UX-only: visibility of the Administration control.

## 6. Mutation plan (break the rule, the test must go red)
1. Drop the head-count factor (use 1) -> AC-IWR-002/003 red.
2. Count draft or archived standby entries (remove the status/archive filter) -> AC-IWR-006 red.
3. Use average head count instead of per-day -> AC-IWR-003 red.
4. Replace the proportional share with the full day's standby on every reason -> AC-IWR-005 red.
5. Remove the `idle_cost_enabled` early return, or the scope check on the write (`labour_cost_gate`) -> AC-IWR-009/010 red.
6. Make the scope default `people_and_equipment` -> AC-IWR-001 red.
7. Include idle amount in `work_order_cost_amounts` (M8: a new nonzero idle-derived row or amount) -> AC-IWR-008's absolute
   row set (12 rows) and money total (2805000.00) red under both scopes.

## 7. Questions for the customer (recommended answers)
1. Head count = people marked present that day on the work order, whether or not their attendance is approved yet?
   Recommended: yes, present counts (idle is a claim on who was on site), while labour cost still counts approved hours only.
2. Equipment standby counts in full for any day that has idle time, not capped to the idle minutes (standby is recorded in
   whole hours or days)? Recommended: yes, full recorded standby on days with idle time.
3. Is the changed figure acceptable as an opt-in setting rather than the new default? Recommended: opt-in (spec rule for a
   changed money figure); revisit once no organisation relies on the old figure.

## 8. Behaviour worth knowing
Under `people_and_equipment`, a reason on a work order with no priced labour has no people amount (`no-rate`, shown as "No
rate"), but its equipment amount is still shown and `amount` equals the equipment amount, so the standby money is not hidden.

## 9. Known limits
The hourly cost stays the work order's whole-history weighted average (IHC limit 3). Head-count lines carry person-hours in `quantity` (count x the rate's day length), verified at the merge, so the average stays per person-hour.
