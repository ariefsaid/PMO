# ERPNext v16 budget range and yearly distribution rehearsal

**Status:** upstream source contract recorded; Director-run rehearsal is pending. The probe has not
been run against the v16 copy, so no live acceptance, read-back, zero-year, rounding, or overlap result
is claimed here.

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
Fiscal Year rows, submits a range Budget with yearly amounts `100.00 / 0.00 / 200.00`, and reads it
back. It then changes the manual percentages to `25 / 0 / 75`, changes the total to `400.00`, and
checks whether ERPNext recalculates the row amounts to `100.00 / 0.00 / 300.00`. That distinguishes
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
| Accepted parent and child field names | Source fields recorded; live request pending |
| Number and dates of yearly rows across three fiscal years | Live read-back pending |
| Whether a zero year survives save and submit | Live read-back pending |
| Amount and percent read-back precision | Live read-back pending |
| Field that drives manual amount recalculation | Source indicates percent; live read-back pending |
| Duplicate error for annual→range and range→annual overlap | Source indicates `DuplicateBudgetError`; live result pending |

Slice 4+5 and AC-018 remain gated on this live result. Slices 2 and 3 can continue as planned. If
the real copy rejects the body, drops the zero year, or fails to reject overlap, pause before Slice 4
and take the observed contract to the owner; do not infer a workaround.
