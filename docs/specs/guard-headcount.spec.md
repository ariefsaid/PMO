# Daily head count for people with no name on the roster (HC)

Lane gap-people, item `guard-headcount`. Status: **Draft for Director go, 2026-11-22.** Plan
`docs/plans/2026-11-22-guard-headcount.md`. IDs: `FR-HC-###`, `AC-HC-###`. **Money path: ships alone** (it adds a
cost source to the labour cost read; it posts nothing and changes no ledger). Stacks on `no-login-labour-cost`
(`docs/specs/no-login-labour-cost.spec.md`, branch `feat/gap-people-no-login-labour-cost`) as that plan's "stacking" note describes.

**Job story.** When a work order has guards or helpers who have no login and are not named in the roster, I want to
enter a head count per day at a daily rate so their cost lands on the work order.

## 1. Today (verified on the labour-cost branch merged with `land/fix-1122`; bodies read from the database at head)
- **No head-count record exists.** `scripts/prior-art.sh headcount` / `"head count"`: the only hit is
  `crew_standard_roles.headcount` (`supabase/migrations/1035_crews_roster.sql:41`), a *planned* number of places in a
  crew role used for the shortfall read (`1036:80-97`). It records nothing per day and carries no cost. The ask is a real gap.
- **Class-priced labour has one reader and one branch.** `labour_cost_class_lines(project)`
  (`supabase/migrations/1721_work_order_cost_amounts_attendance.sql:20-57`) returns attendance days priced by
  `labour_class_for` x `labour_class_rate_for` (1720), gated on `labour_cost_enabled`. `work_order_cost_amounts`
  (`1721:59-110`) maps its rows generically: per row for Admin, Executive, Finance; for a Project Manager, priced money is
  aggregated per source, work order, discipline, class and unit with no record, date or person (`1721:80-87`). A second
  branch in the reader reaches every screen with no change to `work_order_cost_amounts`.
- **Rates and classes.** `labour_cost_classes` is one organisation-wide list (id, code, name, archived_at). A class rate
  has a basis (hourly, daily, monthly), amount, day length and month length (`labour_cost_rates`; `labour_class_rate_for`
  returns the latest start in force). Rates are readable by Admin, Finance, Executive only.
- **Who records attendance.** `attendance_can_record(crew)` = `crew_can_manage()` (active member with role Admin,
  Executive or Project Manager) **or** the crew's `field_controller_id` (`1036:219-225`). Week approval is by Admin,
  Executive or Project Manager who did not record any day of the week (`attendance_decide_week`, SoD, `42501`).
  `attendance_record` is on the field-account allowlist of the light-account sweep (`2711`), so a field seat can record
  attendance; nothing else in the labour-cost reads is open to a field seat (`work_order_cost_amounts` calls `assert_not_light`).
- **History lock.** `labour_class_locked` (1720) refuses a class rate or assignment change that would re-price an
  already costed attendance day, whatever the switch says (FR-NLL-008). It does not know head counts.
- **Front end.** `FinanceCostSource` and `SOURCES` list `attendance_day` (`pmo-portal/src/lib/db/workOrderFinance.ts:20`);
  an unlisted source throws "unexpected row". Idle cost reads every counted hourly labour row (FR-NLL-009), so a head-count
  line in hours enters idle cost with no change there. Roster and attendance entry is `pmo-portal/pages/crews/AttendanceTick.tsx`.

## 2. Definitions (glossary entries added with the build)
- **Head-count line**: for one work order, one crew rostered on it that day, one date and one labour class, the number of
  people present who are not named people in the roster. Its cost is the number x the class's daily rate.
- **Daily equivalent** of a class rate: daily basis = the amount; hourly basis = amount x day length; monthly basis =
  amount / month length x day length (the same conversions labour cost uses for an hour).

## 3. Requirements (EARS)
- FR-HC-001 Where a crew is rostered on a work order on a date, an authorised person shall record a head-count line
  (class, whole number 1 to 500) for that crew, work order and date, replacing the line's number if one exists for the
  same class, until the line is approved.
- FR-HC-002 Entry authority is exactly `attendance_can_record(crew)` (Admin, Executive or Project Manager; the crew's
  field controller) and **not** a field account: a field account is refused (`LIGHT_ACCOUNT`). A foreman with a regular
  account who is the crew's field controller may enter; a field seat may not (decision, see section 6).
- FR-HC-003 A line shall be recorded not in the future and not earlier than the organisation's attendance back-date limit
  (the existing organisation setting).
- FR-HC-004 A line counts toward cost only once approved by an Admin, Executive or Project Manager who did not enter or
  change it (SoD, `42501`). An approved line is final.
- FR-HC-005 While labour cost in money is on, `labour_cost_class_lines` shall return each approved line as source
  `headcount_day`, priced at count x the daily equivalent of the class rate in force on the date (rounded to 2 decimals),
  quantity = count x the rate's day length in hours, unit `hours`, no overtime; a line whose class has no rate in force
  is a line with no amount (reason `no-rate`). While the switch is off it returns exactly what it returns today.
- FR-HC-006 Privacy as labour cost: Admin, Finance, Executive read the per-row figures; a Project Manager reads priced
  head-count money only aggregated per work order, discipline, class and unit (no record, no date); other roles are
  refused (the existing `work_order_cost_amounts` gate). A head-count line carries no person. Entered numbers (no money)
  are readable by Admin, Executive, Project Manager, Finance and the crew's field controller.
- FR-HC-007 A class rate or class change that would re-price an approved head-count line shall be refused
  (`LCM_RATE_LOCKED`, `23514`), whatever the switch says; the rule extends `labour_class_locked`.
- FR-HC-008 **No double count.** A head-count line is for people *not* named in the roster, so it never reads or
  suppresses named attendance, and named attendance never reads it. The system cannot know a guard's identity, so the
  organisation's rule is: a person is either a named roster member (costed through attendance or a timesheet) or counted
  in a head-count line, never both. The entry screen shows the number of named people marked present on that crew and
  date next to the head-count field so the keeper sees the overlap.
- FR-HC-009 Idle cost, plan versus actual direct cost and labour by class shall include approved head-count money
  (source `headcount_day`) with no other change; crew hours include its hours.
- FR-HC-010 The attendance screen of a crew on a work order shall offer a head-count section (add, change, clear while
  not approved; approve for the approver), English and Bahasa Indonesia, phone and desktop. A refusal shows its catalogue
  sentence.

No setting: head counts ride the existing labour cost switch and are on for every organisation. For an organisation using
labour cost money changes only after someone enters and approves a line (new data).

## 4. Acceptance criteria (owning layer in brackets)
- AC-HC-001 Given labour cost is off and an approved line with a class rate exists, When Finance reads
  `work_order_cost_amounts` and `work_order_idle_cost`, Then both equal their pre-line results; When it is switched on,
  Then a `headcount_day` row exists. [pgTAP]
- AC-HC-002 Given hourly, daily and monthly class rates, When counts are approved, Then each amount is count x daily
  equivalent rounded to 2 decimals using the rate in force on the date; a later-start rate does not re-price an earlier
  day; a class with no rate gives a `no-rate` row with no amount. [pgTAP]
- AC-HC-003 Given a line entered but not approved, Then it is absent from the cost read; once approved it is present. [pgTAP]
- AC-HC-004 Given a Project Manager, Then no `headcount_day` row has a record id, date or person and the aggregate sum
  equals Finance's per-row sum; an Engineer is refused (`42501`); the rate table and assignments stay unreadable to the PM. [pgTAP]
- AC-HC-005 Entry authority: Admin, Executive, Project Manager and the crew's non-field foreman succeed; Finance, an
  Engineer who is not the field controller, a field account, a disabled member and a crew not rostered on the work order
  that day (and another organisation's ids) are refused with their own messages. [pgTAP]
- AC-HC-006 SoD: the entrant, and anyone who changed the line, cannot approve it (`42501`); a different Admin, Executive
  or Project Manager can; Finance and a field account cannot. [pgTAP]
- AC-HC-007 Count 0 or 501, a future date, a date before the back-date limit, and any change to an approved line are
  refused; entering the same class again before approval replaces the count and clears the recorder history for SoD
  (entrant stays barred). [pgTAP]
- AC-HC-008 A class rate edit, end or archive that would re-price an approved line is refused (`LCM_RATE_LOCKED`); an edit
  after the last approved day is allowed; the refusal holds with the switch off. [pgTAP]
- AC-HC-009 With one named attendance day and one head-count line on the same work order and date, the cost read holds
  both, each once, `sum(amount)` = hand sum, and the named day's row is unchanged by the line. [pgTAP]
- AC-HC-010 `listProjectCostAmounts` accepts `headcount_day` (per row and PM aggregate); plan versus actual counts its
  money in direct cost once and in labour by class, and its hours in crew hours. [vitest `workOrderFinance.test.ts`, `workOrderLabourCost.test.ts`]
- AC-HC-011 The head-count section: empty state names who adds it; add and replace for an allowed role; a field seat does
  not see the control; approve is offered only to a different approver and a disabled approve says why; refusals show the
  catalogue sentence. [vitest `HeadCountSection.test.tsx`] and journey `e2e/serial/AC-HC-011-headcount-day.spec.ts`.
- AC-HC-012 Light-account sweep (`2711`), active-member gate (`0173`), policy composition (`0203`) and the anon-definer
  inventory pass with the new objects, with no allowlist entry added. [existing pgTAP + `check:anon-definer-inventory`]

## 5. Mutation plan (wave run: break the rule, the named AC must go red, restore)
- M1 delete the `approved_at is not null` filter in the head-count branch -> AC-HC-003.
- M2 replace `labour_cost_enabled(org.id)` in the branch with `true` -> AC-HC-001.
- M3 replace the SoD test in `approve_headcount_day` with `true` -> AC-HC-006.
- M4 replace `attendance_can_record(...)` with `true`, and remove `assert_not_light()` -> AC-HC-005 (two cuts).
- M5 replace the body of the head-count arm of `labour_class_locked` with `false` -> AC-HC-008.
- M6 in the PM branch change `where not v_pm or l.amount is null` to `where true` -> AC-HC-004 (shared with NLL M3a).
- M7 multiply by `1` instead of `count` -> AC-HC-002.

## 6. Decisions and open questions (for the customer; recommended answer first)
1. **Foreman path.** Decided: reuse `attendance_can_record` but refuse light accounts. Recommended: keep; a field seat
   foreman enters counts through a later item if wanted. Allowing it needs one allowlist line and no schema change.
2. **Approval.** Decided: second-person approval before cost counts, as for no-login attendance. Alternative: counts
   cost on entry (fewer steps, weaker control). Recommended: keep approval.
3. **Correcting an approved line.** Decided: approved is final in this slice. Recommended: add an Admin-only "return for
   correction" (blocked once a period is closed) as a later item; until then a wrong approved line is a finance adjustment.
4. **Paid hours of a head-count day.** Decided: the class rate's day length, no overtime. Recommended: keep.
5. **Same guard counted twice.** Decided: organisational rule (FR-HC-008) plus the on-screen named-present count.
   Recommended: also keep guards in one class used for head counts only so a class never mixes both.

## 7. Out of scope
Head count by hour or shift, a count with overtime, a foreman on a field seat, reopening an approved line, a rate
privately per work order, importing counts.
