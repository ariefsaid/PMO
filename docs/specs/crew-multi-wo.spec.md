# Crew on several work orders in one day: options (decision note, no build)

**Status:** ON HOLD. A decision note, not a build spec. No code, no migration. Lane gap-people, item `crew-multi-wo`.
Map #2516. Base: `land/fix-1122` at e45a80693.

**Job story.** When a mobile crew works on several work orders in one day, I want its hours split across them on the
day's records so each work order carries its share; the day's total per worker cannot exceed what was worked.

## The standing ruling this item would reverse

**OD-CRW-2: "A crew serves one work order per day."** Written in `docs/specs/crews-roster-attendance.spec.md:91`
(owner decisions table; "if wrong: a split-day crew cannot be represented; per-day hours split would need another
rule") and `:29` (FR-CRW-006); restated in `docs/glossary.md:283` ("Roster (crew)"). Reverting it is an owner decision.
`scripts/prior-art.sh "one work order per day"` finds nothing (the sources use "serves one work order on any day");
`docs/decisions.md` and `docs/adr/` hold no ruling on it. Note the spec header at `:3` says the decisions "need
sign-off before build"; the steering note calls it signed. The owner confirms which when answering below.
ADR-0104 (`docs/adr/0104-work-orders-on-the-cost-side.md:64`) already records "splitting one day's hours across two work
orders of one project is a follow-up".

## Today (verified)

The finding that shapes the options: **attendance already allows one person on several work orders in a day. The roster
rule is what blocks it.**

| Layer | What it does | Where |
|---|---|---|
| Roster | A crew cannot be on two work orders on overlapping dates: `work_order_crews_no_overlap` exclusion on `(crew_id =, daterange &&)`. This is the OD-CRW-2 enforcement. | `supabase/migrations/1035_crews_roster.sql:114-116` |
| Attendance key | `unique (worker_id, work_order_id, work_date)`: already one row per person, day AND work order. Two rows for one person-day on two work orders are allowed. | `1036_attendance_days.sql:~135` (`attendance_days_one_per_day`) |
| Attendance entry | `attendance_record` refuses a row unless the worker's effective crew is rostered on THAT work order that day (`ATT_NOT_ROSTERED`). With one crew per day on one work order, a worker can only reach one work order. This is the second place OD-CRW-2 bites. | `1248_attendance_record_effective.sql` (rostered-crew join, "OD-CRW-3" comment) |
| 24-hour ceiling | `guard_attendance_day` sums present hours plus overtime across ALL the person's work orders that day and refuses above 24 (`ATT_DAY_CEILING`), serialised by an advisory lock per person-day. So "cannot exceed" already holds across work orders, but at 24 hours, not at "what was worked". | `1036_attendance_days.sql` (guard, "AC-CRW-007") |
| Roster read | `work_order_roster(wo, date)` lists members of crews rostered on that work order that day; two work orders would each list the whole crew. Loans and follows narrow this through `worker_effective_crew` (1246, 1247). | `1035`, `1247` |
| Timesheet key (login users) | `timesheet_entries_cell_uq unique (timesheet_id, project_id, entry_date)`: one line per project per day. `work_order_id` is a plain column on the line. | `0011_timesheet_entry_with_check.sql:41`; line columns from `0952_timesheet_week_attribution.sql` |
| Timesheet generation | `attendance_generate_timesheet` refuses a day split across two work orders of ONE project (`ATT_TS_SPLIT_DAY`); a split across two projects is fine (two lines). It writes one line per project-day. | `1037_attendance_timesheet.sql:80-86`, `:125-139` |
| No-login people | No timesheet. Approved hours stay on the attendance row, so the timesheet key never applies to them and the split-day refusal does not either (that guard sits after the no-login early return at `:67-76`). | `1037_attendance_timesheet.sql:67-76` |
| Cost reads | `work_order_cost_lines` has one `attendance_day` row per attendance row (own `work_order_id`, hours plus overtime) and one `timesheet_entry` row per line. Per-row attribution means a split needs no change to the reader. | `1037_attendance_timesheet.sql:259-297` |
| Crew hours on the work order | Approved-only crew hours per work order read the same rows (`1115_work_order_crew_hours_approved_only.sql`). | `1115` |
| ERP timesheet push | Pushes approved timesheets keyed by project and date; not yet checked for a same-day second line (see risk). | `supabase/functions/adapter-dispatch/approvalGuard.ts`, `erpnext-sweep` |

## What the in-flight items change nearby

- **crew-followed** (branch `feat/gap-people-crew-followed`, migrations 1768-1769): adds `attendance_days.followed_crew_id`
  and restates `worker_effective_crew`, `work_order_roster`, `attendance_record`, `phone_check_in`. It chose a
  **plain** partial index `(work_date, worker_id) where followed_crew_id is not null`, with the one-follow-per-person-day
  rule in `attendance_record`, "so the same crew on two work orders is allowed for the crew-multi-wo split". So it
  does not block either option. Both options restate `attendance_record` and `work_order_roster` again: they must be
  built AFTER 1769 and take the head body from the database then (`npm run check:restated-functions`).
- **no-login-labour-cost** (branch `feat/gap-people-no-login-labour-cost`, migrations 1720-1721): restates the cost
  reader to price approved attendance days (labour class rate, overtime multiplier, daily or monthly rates). Its
  AC-NLL-003 already specifies a person with 6 h on one work order and 4 h on another on the same day: priced once per
  hour, no hour twice. So the cost side is written for a split day. Option A depends on that and adds nothing to cost.

## Options

### A. No-login crews only: split the day on attendance

Scope: a crew whose members have no login (supplier crews) may be rostered on more than one work order on a day.

What changes:
- Relax the roster rule. Replace `work_order_crews_no_overlap` with a rule that still refuses the same crew on the same
  work order twice (`exclude using gist (crew_id =, work_order_id =, daterange &&)`). Two work orders on one day then
  become legal for every crew, so "no-login only" is held by the next bullet, not by the roster.
- Keep login holders out: today a login holder's same-project split is refused only at timesheet generation
  (`ATT_TS_SPLIT_DAY`), late. Add an entry-time rule in `attendance_record`: a person with a login who already has present
  hours on another work order of the same project that day is refused, with a sentence saying to use the timesheet.
  Different projects stay allowed (two timesheet lines today).
- The tick screen and phone path show a work-order switcher or, when two work orders are rostered, a per-work-order
  hours entry for the day. The day total shown against 24.
- "Cannot exceed what was worked": add a per-person-day total check against the hours the person was recorded present
  that day by the phone path (`phone_hours`) or the crew's day hours, when set; otherwise the 24 ceiling stands.

What breaks / needs care: the roster read lists the crew on both work orders, so "expected headcount" and the attendance
rate (member-days over rostered crew-days, #2704 and the attendance-rate plan) count a member-day twice unless a
person-day is counted once. Crew loans and follows must pick a work order too (loan host crew rostered on two).

Migration sketch: restate `work_order_crews` constraint (drop and add; existing data is valid under the weaker rule),
restate `attendance_record` (entry-time split rule), restate `work_order_roster` if the day lists both. Rollback: re-add
the old exclusion; refused if any crew now has two work orders on one day (the down script says so and stops).

Risk: low to medium. No timesheet or ERP change, cost unchanged, 24-hour guard already in place. The main risk is
the rate and utilisation reads double counting a person-day.

### B. Everyone: also split a login holder's timesheet day

Scope: any crew, with or without logins.

What changes: everything in A (without the login refusal), plus the timesheet key becomes one line per
`(timesheet, project, work_order, day)`: replace `timesheet_entries_cell_uq` with a unique index on
`(timesheet_id, project_id, coalesce(work_order_id, zero-uuid), entry_date)`; `attendance_generate_timesheet`
drops `ATT_TS_SPLIT_DAY` and writes one line per project, work order and day (`:125-139` matches on project and date today).

What breaks: `save_timesheet_week` and the week grid (one cell per project-day; `0055`, `0168`, `0172`, `0952`) assume
one line per project-day, so the grid, its totals and the validation need reshaping. The ERP timesheet push and its
backstop (`adapter-dispatch`, `erpnext-sweep`) key on project and date and could see two lines for one
cell: unverified, needs a read before any commitment. Timesheet approval screens that show one row per project-day change.
This touches the money path (hours become cost) so it is Director-dispatched and ships alone.

Migration sketch: A's, plus the index swap above and restated `attendance_generate_timesheet` and `save_timesheet_week`.
Rollback: restore the old unique key; refused if any project-day now has two lines (merge them first).

Risk: high. It changes a long-lived key under approved, pushed money data and an external mirror.

## Recommendation

**Option A.** It answers the job story for the crews that need it (supplier crews with no login, whose hours live on the
attendance row), needs no timesheet or ERP change, and the cost reader (1721, AC-NLL-003) and the 24-hour guard already
handle a split. Login holders that need a same-project split are the exception and are named by `ATT_TS_SPLIT_DAY`
today; they keep working across different projects. B is revisited only if the owner meets an own-staff crew that must
split one project across work orders in the week grid.

## Owner decision needed

1. Reverse OD-CRW-2 (a crew serves one work order per day) for supplier crews, or keep it. Recommended: reverse it,
   scoped by Option A.
2. Option A or B. Recommended: A.
3. "Cannot exceed what was worked": is the ceiling 24 hours a day (today), or the hours the crew or person was recorded
   present that day? Recommended: keep 24, plus a warning when the split total exceeds the day's recorded present hours.
4. Confirm OD-CRW-2 was signed (the spec at `:3` still says proposed).

Nothing is built until these are answered.
