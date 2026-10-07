# Spike — ERPNext withholding arithmetic on a Purchase Invoice (#876, plan Task 0)

- **Date:** 2026-10-07
- **Bench:** local ERPNext dev bed (`http://localhost:8080`), ERPNext `15.94.3`, company `PMO Smoke Co` (IDR)
- **Run:** under `scripts/with-erpnext-lock.sh`, bench key pair held in shell variables only
- **Fixtures created on the bench (kept, reused by AC-VWH-005):** accounts `Spike PPN Masukan - PSC` and
  `Spike PPh 23 Payable - PSC` (both under `Duties and Taxes - PSC`, account type Tax); template
  `Spike PPN11 PPh23 - PSC` (PPN 11% Add, PPh 23 2% Deduct, both On Net Total, category Total)
- **Documents left on the bench:** `ACC-PINV-2026-00230` (paid by `ACC-PAY-2026-00239`) and `ACC-PINV-2026-00231`
  (submitted, unpaid — the S7 target)

Purchase Invoice: supplier `Spike Supplier`, one item `SPIKE-ITEM-1` × 1 at 1,000,000, the template above.

| Step | Expected | Observed |
|---|---|---|
| S1 parent account | `is_group 1, root_type Liability` | `is_group 1, root_type Liability` |
| S3 header | currency IDR, net_total 1000000, added 110000, deducted 20000, total_taxes 90000, grand_total 1090000, outstanding 1090000 | currency IDR, net_total 1000000, taxes_and_charges_added 110000, taxes_and_charges_deducted 20000, total_taxes_and_charges 90000, grand_total 1090000, rounded_total 1090000, outstanding_amount 1090000 |
| S4 list endpoint | includes `taxes_and_charges_deducted: 20000` | `taxes_and_charges_deducted: 20000` returned by the list endpoint |
| S5 GL | debits PPN 110000 + item account 1000000; credits Creditors 1090000, PPh 23 Payable 20000 | debits `Spike PPN Masukan - PSC` 110000, `Stock Received But Not Billed - PSC` 1000000; credits `Creditors - PSC` 1090000, `Spike PPh 23 Payable - PSC` 20000 |
| S6 after paying the net (1,090,000) | status Paid, outstanding 0, modified changed | status Paid, outstanding 0, `modified` changed (true) |
| S7 paying the gross (1,110,000) | refused (allocation above outstanding) | refused at Payment Entry insert (`ValidationError`) |
| S8 version | bench ERPNext version | `15.94.3` |

**Gate:** pass. The mapper arithmetic (DD-VWH-2) holds: gross = grand_total + deducted = 1,110,000; VAT =
total_taxes_and_charges + deducted = 110,000. A payment bumps the bill's `modified`, so the feed refresh (plan Tasks
11–12) observes it — ADR-0082's fallback is not needed. Paying the gross is refused, so DD-VWH-3 stands as written.

Note: the item posts to `Stock Received But Not Billed` because `SPIKE-ITEM-1` is a stock item on this bench; the
amount is the net total either way (cost gross of withholding, DD-VWH-8). Re-run S3–S6 on the v16 instance before
deploy (plan §4).

## Addendum — fixed-amount tax rows, no template (OD-VWH-1 de-risk)

Same bench, same accounts, no `taxes_and_charges` template name; `taxes` sent as two `charge_type: 'Actual'` rows
(`tax_amount` stated; VAT `Add`, PPh `Deduct`; category `Total`). Documents left: `ACC-PINV-2026-00232`, `-00233`.

| Case | Sent | ERPNext header (list endpoint) | GL |
|---|---|---|---|
| A | 1 × 1,000,000; VAT 110,000; PPh 20,000 | net 1000000, added 110000, deducted 20000, total_taxes 90000, grand_total 1090000, rounding_adjustment 0, outstanding 1090000 | Dr item 1000000, Dr VAT 110000; Cr Creditors 1090000, Cr PPh 20000 |
| B | 3 × 333,333.33; VAT 109,999.99; PPh 19,999.99 | net 999999.99, added 109999.99, deducted 19999.99, total_taxes 90000, grand_total 1089999.99, **rounded_total 1090000, rounding_adjustment 0.01, outstanding 1090000** | Dr item 999999.99, Dr VAT 109999.99, Dr Round Off 0.01; Cr Creditors 1090000, Cr PPh 19999.99 |

Findings: an `Actual` row lands its stated amount exactly (added / deducted equal the entered VAT / PPh), so the
existing mirror (DD-VWH-2) reads them back unchanged. This bench has rounded totals ON: with fractional figures the
outstanding is the rounded net payable (case B: outstanding 1,090,000 vs grand_total 1,089,999.99) — the OQ-VWH-1
default (a sub-rupiah difference is accepted) is exercised by case B.
