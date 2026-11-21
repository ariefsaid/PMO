# Labour cost in money per work order (LCM)

Issue #2670 (map #2516, scope OD-SCOPE-5, target 15 December 2026). Status: **Draft, 2026-11-21**. Plan
`docs/plans/2026-11-21-labour-cost-money.md`. IDs: `FR-LCM-###`, `AC-LCM-###`.
**Money path: ships alone.** It adds a costing setting and a read; it posts nothing, changes no approval, no timesheet
rule and no ledger. Extends #2519 (plan versus actual) and #2517 (cost attribution); migrations 1250-1254.

**Job story.** When approved hours reach a work order, I want them to become cost in money at the person's rate, so plan
versus actual shows manpower in rupiah and not only hours.

## 1. AS-IS
- Approved timesheet lines can name a work order and discipline (#2517). `work_order_cost_amounts_unpriced` returns them
  as hours with reason `no-rate`; plan versus actual shows "N h carry no rate and are not in the cost" (`uncostedHours`).
- The only rates today are **client billing** rates (`contract_rate_lines`, kind labour, 0515) and equipment hire
  rates. There is no **cost** rate for a person or a role. Cost and billing rates stay separate settings.
- A timesheet row has hours per day (0-24), no overtime field. Plan figures are direct and indirect budgets per work order.

## 2. Definitions (glossary entries added with the build)
- **Labour cost rate**: what an hour of a person's time costs the organisation. Per person or per role; hourly, daily or
  fixed monthly; with an overtime multiplier, a class and a start date.
- **Labour class**: an organisation-defined label on a rate (defaults direct, indirect, guard) used to break labour cost down.
- **Priced hours**: approved timesheet hours on a day the person has an effective rate. **Overtime hours**: a person's hours
  on one day beyond the rate's day length, counted across all that person's approved lines that day.

## 3. Requirements (EARS)

**Settings (client-controlled, nothing coded)**
- FR-LCM-001 The organisation shall have one switch, **labour cost in money**, **OFF by default**. While it is off, every
  read, total and screen is exactly as before this feature (no row, no column value, no panel).
- FR-LCM-002 Where the switch is on, Admin and Finance shall maintain **labour classes** (code, name, soft-archive). When
  the switch is first turned on and the organisation has no class, three are created from the defaults direct, indirect and
  guard; all are renameable and archivable. No class name is fixed in code.
- FR-LCM-003 Admin and Finance shall create **labour cost rates**: subject (one person, or one role), class, basis
  (hourly, daily, fixed monthly), amount (> 0, 2 decimals, organisation currency), overtime multiplier (1 to 5, default 1),
  day length in hours (default 8, 1 to 24) and month length in hours (default 173, 1 to 744), start date, optional end date.
  Day and month length live on the rate so a later change never restates past cost.
- FR-LCM-004 A rate shall apply to a date when the date is on or after its start, on or before its end (when set) and the
  rate is not archived. For one person and date: the person's own rate wins over the role rate; among several of one
  subject, the latest start wins. A person's role is the role on their profile.
- FR-LCM-005 A rate that would change the price of an hour already priced on an **Approved** timesheet shall be refused
  (new rate starting on or before a priced date of an affected person; archive or end of a used rate). Correct a rate by
  adding one that starts after the last priced date.
- FR-LCM-006 Only Admin and Finance shall write the switch, classes and rates; Admin, Finance and Executive read rates.
  Project Manager and everyone else read no rate.

**Cost**
- FR-LCM-010 While the switch is on, each timesheet line of an **Approved** week with a work order or project shall be
  priced at the rate that applies to its date: hourly equivalent = amount, amount / day length (daily) or amount / month
  length (fixed monthly); cost = hourly equivalent x (regular hours + overtime hours x multiplier), rounded to 2 decimals.
  Regular hours fill first; the person's lines of one day are ordered by project then line id.
- FR-LCM-011 A priced line shall be reported by `work_order_cost_amounts` with reason `counted`, the organisation currency,
  the amount and its labour class. A line with no applicable rate stays `no-rate` (hours, no money); a line of a week not
  Approved stays `not-posted`. Hours with no work order are project-level (shared) cost, as for any cost source.
- FR-LCM-012 Labour cost is internal costing outside the ledger: it shall be added to a work order's direct cost and to the
  project's shared cost, and shall not alter the ledger-based project actuals, the "project actuals" remainder row, project
  finances or project margin. (Equipment hire charges are the precedent, 0460 D5.)
- FR-LCM-013 For Project Manager the labour rows shall carry no person (amounts remain); Admin, Executive and Finance see the person.
- FR-LCM-014 The calculation shall be database-side only (`work_order_cost_amounts`), read-only, role-gated and
  org-scoped as the existing function; another organisation's project reads as absent.
- FR-LCM-015 Reopening a timesheet (no longer Approved) shall remove its cost from the work order with no other action.

**Screens**
- FR-LCM-020 Administration shall have a **Labour cost** section (Admin, Finance): the switch, classes and the rates list
  with add, end and archive, using the shared form primitives; English and Bahasa Indonesia; phone and desktop.
- FR-LCM-021 Where the switch is on and the work order has priced labour, plan versus actual (work-order page and project
  view) shall show labour cost per class, with hours, beside direct cost; hours with no rate keep their existing note.
  Labour is a part of direct cost, never added twice. Copy says "cost", never "pay" or "salary".

## 4. Acceptance criteria (Given/When/Then; owning layer in brackets)
- AC-LCM-001 Given an organisation that never turned the switch on, when plan versus actual loads, then every line,
  total and the `no-rate` hours are identical to before, and no labour panel shows. [pgTAP 1251 + vitest]
- AC-LCM-002 Given the switch off and rates saved, when cost is read, then labour lines stay `no-rate`. [pgTAP 1251]
- AC-LCM-003 Given the switch turned on for the first time, then classes direct, indirect and guard exist, renameable;
  turning it on again creates none. [pgTAP 1250]
- AC-LCM-004 Given an hourly rate 50000 and 8 approved hours, then the line costs 400000.00, reason `counted`, with its class. [pgTAP 1251]
- AC-LCM-005 Given a daily rate and a fixed monthly rate, then cost equals amount / day length (or month length) x hours. [pgTAP 1251]
- AC-LCM-006 Given 10 hours in a day, day length 8, multiplier 1.5, then cost = 8 x r + 2 x r x 1.5. [pgTAP 1251]
- AC-LCM-007 Given a person with lines on two work orders in one day totalling more than the day length, then overtime is
  counted once across the day and no hour is priced twice. [pgTAP 1251]
- AC-LCM-008 Given a person rate and a role rate both applying, then the person rate prices the hours. [pgTAP 1251]
- AC-LCM-009 Given two rates for one person from different dates, then each date takes the rate in force; a date before
  every start, or after an end, is `no-rate`. [pgTAP 1251]
- AC-LCM-010 Given Draft, Submitted or Rejected weeks, then their lines are `not-posted`, no money. When an Approved week is
  reopened its cost disappears. [pgTAP 1251]
- AC-LCM-011 Given an approved line with no work order, then its cost is shared cost; with a work order it is that work
  order's direct cost; the ledger project-actuals remainder row is unchanged. [pgTAP 1251 + vitest rollup]
- AC-LCM-012 Given a rate that would change an already priced approved hour, then it is refused (`23514`, `LCM_RATE_LOCKED`);
  a rate starting after the last priced date is accepted. [pgTAP 1250]
- AC-LCM-013 Given a non-Admin/Finance caller, then switch, class and rate writes are refused; Project Manager reads no rate
  row; Executive reads rates. [pgTAP 1250]
- AC-LCM-014 Given a rate or class of another organisation, then it is invisible and cannot be used; a person of another
  organisation cannot be named. org_id is stamped by the server. [pgTAP 1250]
- AC-LCM-015 Given a Project Manager reading cost, then labour rows have no person and amounts equal what Finance sees. [pgTAP 1251]
- AC-LCM-016 Given a rate with a bad amount, multiplier, day or month length, dates reversed, an unknown role or an archived
  class, then it is refused with a clear message. [pgTAP 1250]
- AC-LCM-017 Given priced labour in two classes, then rollup shows labour per class and the work order's direct cost includes
  it exactly once; hours with no rate stay named apart. [vitest `workOrderPlanVsActual`]
- AC-LCM-018 Given the Labour cost section, then Admin/Finance can switch on, rename a class, add, end and archive a rate;
  others do not see it; a refusal shows its reason. English and Bahasa Indonesia. [vitest + one e2e journey]
- AC-LCM-019 Given the work-order page on phone and desktop with priced labour, then the per-class labour block shows,
  money in the organisation currency; no look-pinning assertions. [vitest + screenshots]

## 5. Settings added and defaults (existing organisations see no change)
| Setting | Where | Default | Enforced by |
|---|---|---|---|
| Labour cost in money (switch) | `labour_cost_settings.enabled` | no row = OFF | `work_order_cost_amounts` reads it; pgTAP 1251 AC-LCM-001/002 |
| Labour classes | `labour_cost_classes` | none until switch first on, then direct / indirect / guard | RLS Admin/Finance; pgTAP 1250 |
| Cost rates (person or role, basis, amount, overtime multiplier, day/month length, class, dates) | `labour_cost_rates` | none | RPCs + RLS + lock rule; pgTAP 1250 |
Database-enforced: who writes (RLS, RPCs), rate validity, rate lock after pricing, rate read-visibility, redaction for
Project Manager, org scoping. Not enforced in the DB (UX only, ADR-0016): the visibility of the Administration section.

## 6. Open questions (answers assumed unless the orchestrator says otherwise)
1. Overtime = hours beyond a day length per person per day (the timesheet has no overtime field). Assumed yes.
2. Project finances and project margin stay ledger-only (FR-LCM-012); labour appears on work-order plan versus actual only.
3. Plan figures stay direct/indirect budgets; no per-class plan in this ticket (actual by class only).
4. Project Manager sees labour amounts but no rate and no person (FR-LCM-006/013).
5. Currency is the organisation currency; a work order in another currency lists labour apart, as other costs do.

## 7. Out of scope
Payroll, grades, wage scales, employment contracts, public-holiday calendars, per-class plan figures, posting labour
cost to the ERP, changing the timesheet or approval rules, and any client's wage rules (all are settings or later work).
