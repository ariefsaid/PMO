# Progress billing — ERPNext spike (plan Task 0), 2026-10-06

Local dev bed only. ERPNext **v15.94.3** (frappe 15.96.0), company currency IDR, Standard COA. Not v16: the plan's
"re-verify on a v16 bench before enabling" still stands.

## Result: PASS with one required setup step

| Check | Result |
|---|---|
| (a) Item whose Item Default income account is a liability account, on a submitted Sales Invoice (down payment) | PASS |
| (b) Later invoice: quantity lines + negative line on the same item submits, nets the advance, tax on the reduced base | PASS — **only after** Selling Settings "Allow Negative rates for Items" is on |

### Required setup (ADR-0077 gap)

With the setting off (the default), submit of the negative-rate line is refused:

> `frappe.exceptions.ValidationError: For item <strong>PB-DOWN-PAYMENT</strong>, rate must be a positive number. To Allow negative rates, enable <strong>`Allow Negative rates for Items`</strong> in Selling Settings`

Validation fires at submit, not at draft save. The setting is **global to the ERP site** (Selling Settings, not per item).
ERP setup (DD-OPS-3) must enable it, and the pre-enable checklist should check it.

The liability account as an item's income account was accepted with no setting change.

### GL evidence (IDR; accounts abbreviated -PSC)

Down payment, 200,000 net, 10% tax on net total:
- Customer Advances credit 200,000 · VAT credit 20,000 · Debtors debit 220,000 (grand total 220,000). Nothing in Sales.

(Same DP without tax: Customer Advances credit 200,000 · Debtors debit 200,000.)

Claim = 4 x 50,000 (stock item) + 1 x -40,000 on the DP item, no tax:
- Debtors debit 160,000 · Sales credit 200,000 · Customer Advances debit 40,000. Grand total 160,000.

Same claim with 10% tax on net total: net total 160,000, tax 16,000 (on the reduced base), grand total 176,000:
- Debtors debit 176,000 · Sales credit 200,000 · VAT credit 16,000 · Customer Advances debit 40,000.

Per-line `income_account` was server-derived: the quantity line `Sales`, the negative DP line `Customer Advances`.

### Notes for the build

- Tax rows must be sent explicitly (or set server-side); a REST insert naming only `taxes_and_charges` produced no tax rows.
- The tax base for the claim is net of the recovery line, as ADR-0077 decision 4 states.
