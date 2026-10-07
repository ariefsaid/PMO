# ADR-0084 — Vendor bill tax: the amounts entered in PMO are the bill's tax; on an ERP-connected org they are sent as fixed ERPNext rows; vendor defaults only pre-fill

- **Status:** Accepted (Director, 2026-10-07, #876 slice 2) — ratified with DD-VWH-15..22
- **Deciders:** owner (OD-VWH-1); Director (DD-VWH-10..14); planner proposals DD-VWH-15..22
- **Amends:** ADR-0082 §5 (outbound) — the template path stays; an entered-amounts path is added beside it
- **Related:** ADR-0048 (ERPNext is the accounting oracle), ADR-0055 (integration architecture), ADR-0058 (outbox),
  0232 (`tax_prepaid_account` org-setting precedent), 0252 (transaction-local write flag precedent)
- **Spec:** `docs/specs/vendor-withholding.spec.md` §7. **Plan:** `docs/plans/2026-10-07-vendor-withholding-slice2.md`.
  If 0083 is taken when this merges, renumber (and the two references above).

## Context

Slice 1 (ADR-0082) lets a user on an ERP-connected org pick an ERPNext purchase tax template; ERPNext computes VAT and
PPh from the template's rates, and PMO mirrors the header. The owner ruled (OD-VWH-1) that vendor tax is set up **in
PMO**: each vendor carries a default treatment (VAT rate; PPh 23 / PPh 4(2) and rate; or none), a bill starts from it,
and its amounts are **editable** so a bill captures exactly what the vendor's own invoice shows — including invoices
made outside PMO and the ERP. For an ERP-connected org PMO sends those amounts as fixed rows, so no ERPNext template is
required. PMO never recomputes ERP-calculated figures.

Three forces:

- Rate-based templates cannot reproduce a vendor's invoice to the rupiah (the vendor rounds; the template rounds
  again), and RIS's ERPNext is headless (OD-ERP-3): nobody maintains templates per rate.
- The bench spike (`docs/reviews/2026-10-07-vendor-withholding-erp-spike.md`, addendum) showed ERPNext accepts
  `charge_type: 'Actual'` rows with stated `tax_amount`s, Add and Deduct, and its header then states exactly those
  amounts — so slice 1's read-back (DD-VWH-2) holds unchanged.
- `companies` carries table-level INSERT/UPDATE grants to `authenticated` (0075) under a four-role UPDATE policy; a
  column REVOKE cannot subtract from a table-level grant.

## Decision

1. **The bill's tax is what the user entered.** VAT amount, and (when withheld) the PPh type and amount. A standalone
   bill stores them (`tax_amount`, `withheld_amount`; both create functions take `p_withheld_amount`, DD-VWH-10). An
   ERP-connected bill sends them as `Actual` rows built **server-side in the dispatch** from the entered amounts and
   the organization's tax-account settings — VAT `Add` on the input-VAT account, PPh `Deduct` on the type's payable
   account, `category: 'Total'`, `included_in_print_rate: 0` — with `taxes_and_charges: ''` so no ERPNext template or
   default is applied on top (DD-VWH-13). Client-supplied rows and the server-only amounts-mode marker are dropped. A
   command naming a template **and** amounts is refused before any ERPNext call. Items carry the net (DD-VWH-14).
2. **Templates stay optional.** The slice-1 template path is unchanged. The bill form offers "Enter the tax amounts"
   (default) or a named template; it no longer offers "ERPNext default" (DD-VWH-15). The server still accepts a create
   naming neither (AC-520-2) for non-form callers.
3. **Vendor defaults are a pre-fill, never an input to a write.** Three `companies` columns (DD-VWH-11). No server path
   reads them when a bill is recorded (DD-VWH-19), so changing a default never re-states an old bill. They change only
   through `set_vendor_tax_defaults()` (SECURITY DEFINER; active member; Admin/Finance; own org; audited), enforced by a
   BEFORE INSERT/UPDATE trigger that refuses any other client write unless the function's transaction-local flag is on
   (the 0252 pattern, DD-VWH-16). The function sits outside the companies ERP mirror guard: ERPNext holds no such fact.
4. **Tax accounts are organization settings** (input VAT, PPh 23 payable, PPh 4(2) payable), Admin-only through column
   grants and the Admin-only UPDATE policy, audited (DD-VWH-12, the 0232 precedent). Each used account is read in
   ERPNext on send — it must be a non-group account of the binding's company, and a PPh account must be a Liability —
   otherwise the create is refused `config-rejected` naming the **setting**, never the account or company (ADR-0072).
5. **ADR-0048 holds.** PMO sends amounts; ERPNext computes totals and outstanding; PMO mirrors the header exactly as in
   slice 1. The pre-fill arithmetic runs only in the form, before anything is sent.

## Consequences

- Migration 0272 (reversible): three company columns + guard trigger + one definer function; three organization
  columns + audit trigger; `create_procurement_invoice` / `capture_vendor_invoice` re-created with one trailing
  parameter (signature change → the isolation-probe denominator and the client-RPC allow-list are re-derived); the
  procurement-invoice create audit records VAT and withheld.
- The dispatch adds one `organizations` read and at most two ERPNext Account reads per create; replays read nothing
  (the persisted rows are re-sent, AC-520-6 discipline).
- A bill with zero VAT and no withholding sends an explicit empty tax table (spike-verified that ERPNext then applies
  no default template).
- The PPh type is stored on every bill that withholds (DD-VWH-18, OQ-VWH-6 decided): on an ERP-bound bill it selects
  the payable account, and a standalone bill records it with its withheld amount (0272's `withheld_pph_type`), so the
  no-ERP tax register (#898) can read the type from the bill.
- Server bound: tax withheld above the items total is refused before any ERP write — otherwise the mirror's
  `withheld ≤ amount` bound would refuse every replay (the DD-VI-3a failure class) (DD-VWH-22).
- Future `companies` columns keep the incumbent grant behaviour (writable under the existing policy); only these three
  are guarded.

## Alternatives rejected

- **Rates on the bill, ERPNext computes the amounts.** Re-introduces rounding disagreement with the vendor's invoice and
  needs a template per rate on a headless ERP.
- **Converting `companies` to column-level grants** to make the three columns non-writable. Correct in principle, but
  freezes every future companies column out of client writes until someone remembers to grant it (0175's snapshot
  semantics) on a table the CRM edits freely; the guard trigger achieves the same reachability for these three only.
- **Reading the vendor default server-side at dispatch.** Turns a UX pre-fill into a write input that can disagree with
  what the user saw and confirmed; a later edit of the default would silently change what a retried command sends.
- **Storing the tax accounts on the ERPNext binding config.** The binding is Operator/Integration-owned and replaced on
  re-connect; tax accounts are an accounting judgement for the org Admin (same class as `tax_prepaid_account`).
