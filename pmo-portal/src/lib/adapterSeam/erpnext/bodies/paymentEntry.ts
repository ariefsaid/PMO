/**
 * Payment Entry `toBody`/`fromDoc` — R9 §2 frozen (the R9 unknown, now pinned). The stock REST API
 * defaults NONE of the account fields (docs/spikes/2026-07-11-erpnext-pe-mandatory-fields.md §2) — the
 * adapter supplies `paid_from`/`paid_to` from the org binding's resolved Company defaults.
 */
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { mirrorMoney } from '../moneyShape.ts';

export function peToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  return {
    payment_type: 'Pay',
    party_type: 'Supplier',
    party: ctx.refs.supplier,
    paid_amount: rec.paid_amount,
    received_amount: rec.received_amount ?? rec.paid_amount,
    // paid_from: cash preferred, bank fallback (R9 §2 "account defaults... resolved from Company defaults").
    paid_from: ctx.config.default_cash_account ?? ctx.config.default_bank_account,
    paid_to: ctx.config.default_payable_account,
    // References are optional at both save and submit (R9 §2) — an unreferenced PE is a valid
    // on-account payment; default to [] rather than omitting the key.
    references: rec.references ?? [],
  };
}

export function peFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: String(d.name),
    pay_number: String(d.name),
    // The header paid_amount is the money oracle for this PE (a per-invoice allocated split is
    // resolved from `references[].allocated_amount` by the slice-6 payments.invoice_id linking).
    amount: mirrorMoney(d.paid_amount),
    reference_number: (d.reference_no as string | null) ?? null,
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
  };
}
