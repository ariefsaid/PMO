# Plan: Subcontractor progress certificate (#2584)

Spec: `docs/specs/subcontractor-progress-certificate.spec.md` (read its "Review 20 Nov"; binding). Executor: one fresh Orca worker; money
path, ships alone. Branch `feat/2584-subcon-certificate`. Migrations 1135 to 1138 (1139 unused).

## Built on defaults (owner to confirm)

| Decision | Default built |
|---|---|
| OD-SPC-1 | `dsr_progress_lines.crew_id` (nullable) added in 1135; `dsr_replace_lines` and `dsr_correct` carry it. Only lines whose crew is a vendor crew of the PO's vendor are measurable; a correction keeps the crew. |
| OD-SPC-2 | A separate rate card `subcontractor_rate_lines` (vendor, contract item); not the client catalogue (#2520) and not the T&M card (0515). |
| OD-SPC-3 | A rate window starts on a month's first day and ends on a month's last day; one rate per item per certificate; overlap refused by an exclusion constraint; a change from month M ends the open line the day before. |
| OD-SPC-4 | The certificate prepares a DRAFT acceptance (`prepare_certificate_acceptance`); the shipped cap (`subcontract_bill_cap_violation`) is the gate at approval and again at bill. |
| OD-SPC-5 | Backcharge is `procurement_invoices.deduction_amount`; the payment ceiling subtracts it through one trigger on `payments`; ERP-connected organisation with backcharges refused. ADR-0108. Project totals not changed (reader inventory in the ADR). |
| OD-SPC-6 | No retention in this slice. |
| OD-SPC-7 | One certificate = one PO, one calendar month, the PO's `work_order_id` (required; refused when absent). |
| OD-SPC-8 | Net may not be negative: refused at approval with the figures (stored at submit so the shortfall shows). |
| OD-SPC-9 | Approver is Finance or Admin (not Executive), never the preparer or the submitter, no sole-operator escape (function check plus a row CHECK, two independent layers). Billing is also Finance and Admin. |
| OQ-SPC-1 | The period is always a calendar month. |
| OQ-SPC-2 | Backcharge reasons: rework, damaged, safety, materials supplied, other. |
| Record history | Rate and certificate changes are audited through `log_audit` events (action `subcontractor_rate.set`, `subcontract_certificate.*`); `procurement_invoices.deduction_amount` and `certificate_id` are registered in the record-history catalogue. The new tables are not registered as record-history entities. |

## Design (money path)

- **Derive** (`spc_derive`, server only): candidate progress lines of the work order in the month, classified in this order:
  superseded, report not validated, not this vendor's crew, item not on the PO's effective revision, already certified (a live claim by
  another certificate), set aside, else eligible. Eligible work is grouped to the claim key (work order, day, contract line, crew); an
  item is rated from the card line whose window holds the period start (currency, unit and PO-rate checks), else listed unrated.
  Line amount `round(sum(q) x rate, 2)`. A client never supplies a quantity or an amount.
- **Claims**: at submit, in one transaction under the lock order procurement row, `subcontract_po_lock`, certificate row. A unique
  index on the claim key (whatever the PO) arbitrates two certificates racing for the same work; backcharges are claimed under their row
  lock. Return and cancel release; approved and billed are immutable by triggers (any caller, owner included).
- **Approve** (`approve_subcontract_certificate`): role Finance/Admin; approver is not preparer or submitter; no unrated item; net >= 0;
  the shipped cap pre-check over the frozen lines (fail closed).
- **Bill** (`bill_subcontract_certificate`): one call to `capture_subcontract_vendor_invoice` with the frozen lines at the frozen rates,
  the work order through `set_cost_attribution('vendor_bill', ...)`, then the deduction and the link. A refusal rolls the sub-transaction
  back, keeps the certificate `approved` and stores the reason.
- **Void hook**: after-update trigger on the bill returns a `billed` certificate to `approved` (claims stay until it is cancelled); every
  failure in it is a warning, never a blocked void.

## Acceptance criteria and owning test layer (ADR-0010)

| AC | Built | Owning test |
|---|---|---|
| AC-SPC-001 | hand calculation, exclusions with reasons | pgTAP `subcontract_certificate_derive.test.sql`; unit `certificateMath.test.ts` |
| AC-SPC-002 | net 500.00, stored at submit | pgTAP derive; unit |
| AC-SPC-003 | exact decimal line amount | unit `certificateMath.test.ts` |
| AC-SPC-004 | rate versions, month start, overlap | pgTAP `subcontract_rate_card.test.sql` |
| AC-SPC-005 | above PO rate / other currency unrated | pgTAP derive |
| AC-SPC-006 | SoD at approval (+ mutation) | pgTAP `subcontract_certificate_sod.test.sql`, `subcontract_certificate_mutation.test.sql`; unit `policy.subcontractCertificate.test.ts` |
| AC-SPC-007 | immutability of an approved certificate | pgTAP sod |
| AC-SPC-008 | snapshot unchanged, return and resubmit | pgTAP derive |
| AC-SPC-009 | cap pre-check names item, verified, PO, billed | pgTAP sod |
| AC-SPC-010 | one bill, snapshot lines, work order, second call refused | pgTAP `subcontract_certificate_bill.test.sql` |
| AC-SPC-011 | payable 500.00, payment above refused | pgTAP bill (+ mutation M4) |
| AC-SPC-012 | one claim; concurrent submits | pgTAP `subcontract_certificate_concurrency.test.sql` (two sessions), sod, mutation M3 |
| AC-SPC-013 | refused capture leaves nothing half-written | pgTAP bill |
| AC-SPC-014 | cancel and void release; position drops; void never blocked | pgTAP bill |
| AC-SPC-015 | negative net refused | pgTAP sod; unit |
| AC-SPC-016 | work-order cost read, net-based | pgTAP bill |
| AC-SPC-017 | tenancy and roles | pgTAP rate card, derive, sod, bill; unit policy and screen |
| AC-SPC-018 | mutation checks | pgTAP mutation |
| AC-SPC-019 | screen states, English and Bahasa | unit/RTL `SubcontractCertificateDetail.test.tsx`, `SubcontractCertificates.test.tsx` |
| AC-SPC-020 | one journey | e2e `AC-SPC-020-subcontract-certificate-journey.spec.ts` |

## Files

Migrations `1135_subcontractor_rate_card.sql`, `1136_subcontract_certificates.sql`, `1137_certificate_approval_and_bill.sql`,
`1138_certificate_acceptance_bridge.sql` (+ rollbacks, each refused while rows exist). DAL `src/lib/db/subcontractCertificates.ts`,
repository `src/lib/repositories/subcontractCertificates.ts`, hooks `src/hooks/useSubcontractCertificates.ts`, pure figures
`src/lib/subcontracts/certificateMath.ts`, screens `pages/subcontractCertificates/`, routes `/subcontract-certificates[/:id]` (gated by the
procurement switch), catalogues `subcontractCertificates` (en, id).

## Not built

- Moving the deduction into the project-finance and commitment readers (ADR-0108 inventory) and the ERP route for deductions (#1505).
- Crew entry on the daily-report screen itself (the field is accepted by `dsr_save_draft`; the report form does not yet offer a crew picker).
- A proof attachment picker on the backcharge form (the column and RPC argument exist).
- The work-order screen's certified-cost-by-period panel (the read `work_order_certified_cost` exists).
- Record-history registration of the new tables.
