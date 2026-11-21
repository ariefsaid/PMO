---
status: proposed
date: 2026-11-21
---

# ADR-0120 — Labour cost is internal costing, priced in the database from approved hours

- **Issue:** #2670 (map #2516). **Spec:** `docs/specs/labour-cost-money.spec.md`. **Plan:** `docs/plans/2026-11-21-labour-cost-money.md`.
- **Migrations:** `1250_labour_cost_settings.sql`, `1251_labour_cost_pricing.sql`, `1252_work_order_cost_amounts_labour.sql`.
- **Relates to:** ADR-0104 (work orders on the cost side), ADR-0016/0019, 0460 (equipment hire charge precedent).

## Decision
1. **Cost, not payroll.** A dated cost rate per person or per role (hourly, daily or fixed monthly, an overtime multiplier,
   a class) prices Approved timesheet hours. Nothing is paid, posted or sent to the ledger.
2. **Outside the ledger.** Priced labour adds to a work order's direct cost and to the project's shared cost. It never
   alters ledger-based project actuals, project finances or project margin (the equipment hire charge is the precedent).
3. **One pricing authority, in the database.** `work_order_cost_amounts` (the one money read) prices labour; the client
   rolls up and never recomputes. The 1113 outer wrapper is renamed `work_order_cost_amounts_pre_labour` and a new wrapper
   of the same name adds a `labour_class_id` column; the inner readers (`_unpriced`, `_unrounded`) are untouched.
4. **Off by default.** No row in `labour_cost_settings` = off; with it off the read returns the old rows.
5. **History is stable.** Day and month length live on the rate. A rate that would change an hour already priced on an
   Approved timesheet is refused (`LCM_RATE_LOCKED`); a correction is a new rate starting after the last priced day.
6. **Overtime is derived**: hours beyond the rate's day length per person per date across all their Approved lines, since
   the timesheet has no overtime field. Roles are text validated by a cast to `user_role`, so a grown role set needs no change here.

## Consequences
Rates are wage-sensitive: Admin, Finance and Executive read them; a Project Manager sees amounts, never a rate or a person.
Project margin excludes labour until a later decision brings it into the ledger view.
