# ERPNext v16 budget range and yearly distribution rehearsal

**Status:** isolated local v16.53.0 rehearsal completed for the bounded cases recorded below.
The original source analysis remains useful context; results do not establish behavior on a separate deployment.

## Source checked

The upstream `version-16` branch was inspected at commit
[`9cd11b19575bfc34f092a24f6c8b368c4dd69481`](https://github.com/frappe/erpnext/commit/9cd11b19575bfc34f092a24f6c8b368c4dd69481):

- [`Budget` DocType](https://github.com/frappe/erpnext/blob/9cd11b19575bfc34f092a24f6c8b368c4dd69481/erpnext/accounts/doctype/budget/budget.json)
- [`Budget Distribution` child DocType](https://github.com/frappe/erpnext/blob/9cd11b19575bfc34f092a24f6c8b368c4dd69481/erpnext/accounts/doctype/budget_distribution/budget_distribution.json)
- [`Budget` controller](https://github.com/frappe/erpnext/blob/9cd11b19575bfc34f092a24f6c8b368c4dd69481/erpnext/accounts/doctype/budget/budget.py)

The parent requires `budget_against`, `company`, `account`, `budget_amount`, `from_fiscal_year`,
`to_fiscal_year`, and `distribution_frequency`; `Yearly` is an allowed frequency. `naming_series` is
also required but has a default. Each child row requires `start_date`, `end_date`, `amount`, and
`percent`. The dates come from the selected Fiscal Year records, so the probe reads those records
instead of deriving dates from fiscal-year labels.

The controller calculates the range dates from the endpoints, generates `Yearly` periods in
twelve-month steps, and raises `DuplicateBudgetError` when a non-cancelled Budget for the same
company, project/cost center, and account overlaps the range by date. A new document regenerates its
child rows during save; the probe therefore creates the draft, writes the intended date rows onto
that draft, and then submits it. On a manual distribution, changing only the parent total recomputes
row amounts from row percentages. The controller also checks that row amounts reconcile to the
total and percentages reconcile to 100, with a 0.10 tolerance. These are source observations, not
proof that the v16 copy behaves the same way.

## Director-run probe

Run only on the isolated rehearsal copy, with the ERPNext lock held:

```sh
scripts/with-erpnext-lock.sh node scripts/bv16-rehearsal.mjs --config-fd 3 --range-probe
```

The FD3 JSON configuration must include `rangeFiscalYears` with the three existing Fiscal Year
names in chronological order. Keep that configuration in the established private operator channel;
the names and access details do not belong in this public evidence file.

The mode is disabled unless `--range-probe` is supplied and refuses to proceed unless the version
handshake reports ERPNext major 16. It creates one uniquely named Project, reads three configured
Fiscal Year rows, then creates a range Budget draft and writes its explicit yearly rows
`100.00 / 0.00 / 200.00` onto that draft with a PUT, and reads the complete saved draft back (the
first three steps of the "Tested write sequence" below). It then changes the manual percentages to
`25 / 0 / 75` and the total to `400.00`, and checks whether ERPNext recalculates the row amounts to
`100.00 / 0.00 / 300.00` before submission; it submits that full document and reads the submitted
document back to check the same amounts. That distinguishes
percentage-driven recalculation from the saved amount rows. Two additional account cases attempt
overlapping annual-then-range and range-then-annual Budgets. Submitted test Budgets are cancelled;
any draft left by an interrupted run is deleted. The run-owned Project and cancelled Budget rows
remain as audit evidence. Output contains only result counts and booleans.

The routed fake tests cover successful read-back, percentage recalculation, zero retention,
both overlap directions, cleanup on read-back failure, v16 preflight, and refusal without explicit
opt-in. Those tests prove the runner's behavior only; they do not replace the real rehearsal.

## Observations to record from the live run

| Question | Current status |
|---|---|
| Accepted parent and child field names | Accepted on the isolated v16.53.0 test site |
| Number and dates of yearly rows across three fiscal years | Three rows matched the three configured fiscal-year date spans |
| Whether a zero year survives save and submit | Yes, in the tested three-year case |
| Amount and percent read-back precision | Tested values matched within the 0.001 percentage tolerance; general precision remains unproven |
| Field that drives manual amount recalculation | Percent, in the tested parent-total change |
| Duplicate error for annual→range and range→annual overlap | `DuplicateBudgetError` in both tested orders |

Slice 4+5 and AC-018 require review of these bounded results before proceeding. If a target copy
differs, take the observed contract to the owner; do not infer a workaround.

## Isolated v16.53.0 rehearsal (2026-11-03)

On a newly created local test site, the range probe passed with three yearly rows, a retained zero
row, percent-driven recalculation, and duplicate rejection in both overlap orders. The accepted
request used the parent and child fields described above. The draft read-back matched amounts
100/0/200 and percentages 33.333/0/66.667 within the probe's 0.001 percentage tolerance; after a
25/0/75 change and a total of 400, submission read back 100/0/300. This observes these specific
rounding inputs and tolerance, not a general precision guarantee.

A separate journal-entry check against a 300 range budget submitted 200 in the first year, rejected
101 in the next year with `BudgetError`, submitted 100 in the final year, and rejected one further
unit with `BudgetError`. This demonstrates total enforcement for those actual-expense cases across
years. It does not prove every transaction type, rounding boundary, or calendar configuration.
Both probes settled their own submitted budgets as cancelled. The journal-entry probe issued
cancellation for its submitted entries, removed its drafts, and read back its budget as cancelled;
it did not re-read the journal cancellations. The disposable site was stopped after the check.

The tested write sequence is **POST the Budget draft → PUT its explicit `budget_distribution`
rows → GET the complete saved draft → submit that full document → GET the submitted document**.
The initial new-document save regenerates child rows, so a create request alone is not the tested
way to preserve the manual yearly allocation. The saved draft returned by GET includes the current
modification stamp used in submission.
