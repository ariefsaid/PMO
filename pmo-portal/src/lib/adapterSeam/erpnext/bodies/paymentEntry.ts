/**
 * Payment Entry `toBody`/`fromDoc` — R9 §2 frozen (the R9 unknown, now pinned). The stock REST API
 * defaults NONE of the account fields (docs/spikes/2026-07-11-erpnext-pe-mandatory-fields.md §2) — the
 * adapter supplies `paid_from`/`paid_to` from the org binding's resolved Company defaults.
 *
 * #910 (DD-VPAY-6, FR-VPAY-007): the body ALWAYS carries `posting_date`/`reference_date` (= the
 * command's `date`) and its accounts are fail-closed — a binding that names neither cash nor bank
 * refuses (`commit-rejected` naming the Administration → Accounting setting) instead of silently
 * sending `undefined` and dying at ERPNext as an opaque mandatory-field error. `reference_date` is
 * mandatory-in-practice: a Bank-typed `paid_from` + the stamped `reference_no` anchor (ADR-0058 §3)
 * needs it (the `expensePayment.ts` ruling). Serve-side gates (invoice/outstanding/SoD) run BEFORE
 * this builder; this file stays the last fail-closed line for what the BODY alone owns.
 */
import type { PmoRecord } from '../../contract.ts';
import { AdapterError } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { mirrorMoney } from '../moneyShape.ts';

/** The binding's account default: present, non-blank text — else a refusal naming the setting. */
function requiredAccount(config: Record<string, unknown>, key: 'default_cash_account' | 'default_bank_account' | 'default_payable_account'): string {
  const value = config[key];
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  throw new AdapterError('commit-rejected', `vendor payment: set ${key} in Administration → Accounting before paying a bill`);
}

export function peToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  const amount = Number(rec.paid_amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AdapterError('commit-rejected', `vendor payment: paid_amount "${String(rec.paid_amount)}" must be a positive figure`);
  }
  const date = typeof rec.date === 'string' && rec.date.trim() !== '' ? rec.date.trim() : null;
  if (!date) {
    throw new AdapterError('commit-rejected', 'vendor payment: date is required (it is the Payment Entry posting/reference date)');
  }
  // paid_from: cash preferred, bank fallback (R9 §2 "account defaults... resolved from Company defaults")
  // — and NEITHER present is a refusal, never a silent undefined (DD-VPAY-6).
  const paidFrom = ctx.config.default_cash_account != null && ctx.config.default_cash_account !== ''
    ? requiredAccount(ctx.config, 'default_cash_account')
    : requiredAccount(ctx.config, 'default_bank_account');
  const paidTo = requiredAccount(ctx.config, 'default_payable_account');
  // References are optional at both save and submit (R9 §2). #910 (DD-VPAY-2): the SERVER-resolved
  // allocation wins — when refs.pi is present (the dispatch resolved the bill's ERP name) an empty
  // payload default becomes exactly one allocation of the full paid_amount against that bill.
  const references = Array.isArray(rec.references) && rec.references.length > 0
    ? rec.references
    : typeof ctx.refs.pi === 'string' && ctx.refs.pi
      ? [{ reference_doctype: 'Purchase Invoice', reference_name: ctx.refs.pi, allocated_amount: amount }]
      : [];
  return {
    payment_type: 'Pay',
    party_type: 'Supplier',
    party: ctx.refs.supplier,
    paid_amount: amount,
    received_amount: rec.received_amount ?? amount,
    paid_from: paidFrom,
    paid_to: paidTo,
    posting_date: date,
    reference_date: date,
    references,
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

/**
 * The list-endpoint fields `peFromDoc` actually READS (Luna BLOCK 6). The modified-poll sweep builds its
 * `fields=[…]` request from this, so an adopted/updated mirror row is never written with NULLs for
 * data the ERP doc carries. Co-located with the mapper so the two cannot drift apart.
 */
export const PE_PAY_FROM_DOC_FIELDS = ['name', 'modified', 'docstatus', 'amended_from', 'payment_type', 'paid_amount', 'reference_no'] as const;
