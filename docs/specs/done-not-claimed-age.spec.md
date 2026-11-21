# Spec: Done but not yet claimed, age on the billing plan (#2675)

**Status:** phase 1 (awaiting Director approval). IDs `FR-DNC-###`, `AC-DNC-###`, `OD-DNC-#`. Map #2516, money path adjacent (information only), ships alone. Plan: `docs/plans/2026-11-21-done-not-claimed-age.md`. Stacked on #2682 (`monthly-billing-plan.spec.md`), which left the seams used here: `accepted_on` on every candidate, the hidden `billing-plan-age-slot` on each line row, and the setting `done_not_claimed_reminder_on` (default false).

## Owner ruling applied (OD-SCOPE-6, settled)
The done-not-claimed reminder is **information, off as an alert by default**. The plan only shows; it never creates a claim or an invoice and never pushes to bill (holding a claim to next month can be deliberate). OD-SCOPE-2: no client day count in code; whether the alert is on and after how many days are organisation settings.

## Job story
When work is validated but not yet in a claim, I want to see how long it has been waiting, so nothing stays unbilled by accident.

## Terms
- **Age**: whole days from the date of the work order's latest confirmed acceptance (`accepted_on`, already in the organisation's time zone) to the organisation's today (`today`, same read). Never negative. Same date basis as the plan's read; no second definition of "done" or "unclaimed".
- **Alert**: only when the organisation has switched the reminder on AND set a day limit. A highlight on every candidate line whose age is above the limit, plus one notice to Finance per line.

## What is stored (plain statement)
1. One new nullable column on the existing settings row: `done_not_claimed_after_days integer` (null, or 1 to 3650). **No default**: a default would be a client day count in code (OD-SCOPE-2). Null means "no limit set": the reminder switch can be on but nothing is highlighted or notified until a limit exists. No spec default is needed.
2. One small table `done_not_claimed_notices` (org, work order, contract line or null, notified at): the once-only stamp, one row per notified line. Written only by the daily job. Clients cannot write it; reads limited to Admin, Executive, Project Manager, Finance of the organisation.
3. Age is **derived, never stored**.

## Decisions (stated plainly; Director may override)
- **OD-DNC-1 Age always shown.** Every candidate line on the plan shows its age (information, not an alert). The age uses `accepted_on` from the existing read; no migration to the read. An order with no acceptance date shows no age.
- **OD-DNC-2 Pure function.** `doneNotClaimedAge(acceptedOn, today)` and `isOverLimit(age, limit, reminderOn)` in `pmo-portal/src/lib/billingPlan.ts` (or a sibling module), unit-tested. Date arithmetic on `YYYY-MM-DD` strings in UTC, so no device clock or time zone enters.
- **OD-DNC-3 Alert gating.** Highlight and notices exist only when `done_not_claimed_reminder_on` is true AND `done_not_claimed_after_days` is not null. Reminder off (the default): no highlight, no notice, the job touches nothing for that organisation.
- **OD-DNC-4 One writer.** A new security-definer `set_billing_plan_reminder(p_reminder_on boolean, p_after_days integer)`, Admin or Finance only, upserts the same settings row (touching only those two columns; a new row has no target). `set_billing_plan_settings(numeric, text, boolean)` stays exactly as is, so existing callers and tests keep working; the existing form keeps calling it for target and currency, and the form's reminder switch and new day field save through the new function. Not callable by `anon`.
- **OD-DNC-5 Once-per-line notice.** The job `notify_done_not_claimed()` runs daily. For each organisation with reminder on and a limit, it reads the same candidate lines as the plan by calling `get_project_billing` per project that has a confirmed acceptance (as 1376 does; the arithmetic is not restated) and money-only orders from `work_order_billing`, computes age with the organisation's today (`native_org_today`), and for each line older than the limit with no stamp row: inserts the stamp and sends one notice to each active Finance user of that organisation (`notify_workflow_user`, literal English body as 1363, warning severity, linked to the project). Once-per-line is a single stamp key `(org, work order, contract line or none)`: a line that is claimed and later accepted again does not notify twice (stated trade-off: the reminder is a nudge, not a ledger). The job writes an audit event per notice (as 1363).
- **OD-DNC-6 Concurrency and cost.** The job selects with skip locked on the stamp insert (unique index, `on conflict do nothing` decides the winner), so two runs never double-notify. Projects walked are bounded to organisations with the reminder on.
- **OD-DNC-7 Never writes billing.** The job and the screen write no claim, invoice, step or task. The only writes are the stamp row, the notice and the audit event.

## Requirements (EARS)
- **FR-DNC-001** The plan shall show, on every candidate line, its age in days computed from `accepted_on` and `today`, in the existing age slot, whatever the reminder setting.
- **FR-DNC-002** The age shall be computed by a pure function; an absent acceptance date yields no age; a future date yields 0.
- **FR-DNC-003** While the reminder is on and a day limit is set, the plan shall highlight every line whose age is above the limit (text and icon, not colour alone) and say how many lines are over it in the summary; while off or without a limit, no highlight and no count.
- **FR-DNC-004** Admin and Finance shall edit the reminder switch and the day limit in Plan settings; the form states that the reminder is information and never raises a claim; other roles do not see the control.
- **FR-DNC-010** The database shall add `done_not_claimed_after_days` (null or 1 to 3650) to `org_billing_plan_settings`, and the table `done_not_claimed_notices` with RLS enforced and forced, select-only for the four money roles of the organisation, no client write grant.
- **FR-DNC-011** `set_billing_plan_reminder` shall refuse any caller who is not an active Admin or Finance of the organisation, refuse a null switch and a limit outside 1 to 3650, stamp `org_id` from the caller, and not be executable by `anon`.
- **FR-DNC-012** The daily job shall do nothing for an organisation whose reminder is off or whose limit is null.
- **FR-DNC-013** When the reminder is on, the job shall notify each active Finance user once per line older than the limit and shall not notify again on later runs.
- **FR-DNC-014** The job shall not touch another organisation's lines or settings, and shall create no claim or invoice.
- **FR-DNC-020** All strings shall exist in English and Bahasa Indonesia, with plural forms for days and counts.
- **NFR-DNC-001** New table and definers: isolation fragment `scripts/isolation-probe-denominator.d/2675-done-not-claimed-age.json`, anon-definer inventory entries, `docs/retention.md` row `done-not-claimed` (trigger only: stamps one row per notified line and one audit event, which the audit rule governs). `check:guards` and `check-isolation-denominator.mjs` clean.
- **NFR-DNC-002** The screen adds no write call; DESIGN.md tokens; phone 390 px and desktop 1440 px; 44 px touch targets.

## Acceptance criteria and owning layer
| AC | Given / When / Then | Layer |
|---|---|---|
| AC-DNC-001 | Given accepted dates and a today, then age is whole days, 0 for same day or a future date, none for no date | unit |
| AC-DNC-002 | Given reminder on, limit 10, ages 9, 10, 11, then only the 11-day line is over; with reminder off or limit null, none is over | unit |
| AC-DNC-003 | Given the plan renders with ages and reminder off, then every line shows its age and none is highlighted, no over-limit count | unit (RTL) |
| AC-DNC-004 | Given reminder on and a limit, then lines over it carry the highlight (with text) and the summary counts them | unit (RTL) |
| AC-DNC-005 | Given Admin or Finance, then the reminder switch and day limit show and saving calls the reminder repository; given Project Manager, no control; Bahasa Indonesia strings render | unit (RTL) |
| AC-DNC-006 | Given Finance or Admin, when they call `set_billing_plan_reminder`, then the row is stored with their org and the target and currency are unchanged; given Project Manager, Executive, Engineer or anon, then refused and nothing stored | pgTAP |
| AC-DNC-007 | Given a limit of 0, 3651 or a null switch, then refused with a plain error; the existing `set_billing_plan_settings` still works unchanged | pgTAP |
| AC-DNC-008 | Given reminder off (or on with no limit), when the job runs, then no stamp row, no notice, returns 0 | pgTAP |
| AC-DNC-009 | Given reminder on, limit 5, a line accepted 6 days ago and one 4 days ago, when the job runs twice, then one notice per active Finance user for the older line only, one stamp row, and the second run adds nothing | pgTAP |
| AC-DNC-010 | Given another organisation with reminder on and an old line, and this organisation off, then only the other organisation's line is notified and this organisation's rows are untouched; no claim or invoice rows are created | pgTAP |
| AC-DNC-011 | Given a client, when it inserts, updates or deletes the stamp table, then refused; reads limited to the four roles of the organisation | pgTAP |
| AC-DNC-012 | Given a Finance user, a seeded accepted line, the reminder on with a small limit, when they open the plan, then the line shows its age and the alert; with the reminder off, the age shows and no alert | e2e (one journey, extends the plan's serial lane as needed) |

## Errors
| Case | Behaviour |
|---|---|
| Reminder on, limit empty | Saved; a hint in the form says nothing is flagged until a limit is set; no alert |
| Limit out of range | Form error from `classifyMutationError`, values kept |
| Job finds no candidate | Returns 0, writes nothing |
| Notice send fails for one line | The whole line is rolled back (stamp and notice are one transaction per line) so the next run retries |

## Out of scope
Any push to bill, claim or invoice creation, per-project limits, email or other channels, escalation, re-notifying, changes to the candidates read or the settings function's signature, the board.

## Owner questions
None. OD-DNC-5's single stamp per line (no re-notify after a later re-acceptance) is the one choice the Director may overrule.
