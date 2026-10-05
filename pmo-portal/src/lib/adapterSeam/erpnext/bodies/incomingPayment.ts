/**
 * Payment Entry (Receive) `toBody`/`fromDoc` — R9-P3a spike §3 frozen.
 * The AR twin of `paymentEntry.ts` (PE-pay): same `Payment Entry` doctype,
 * `payment_type:'Receive'` + `party_type:'Customer'`.
 * The REST API defaults NEITHER account (OQ-SAR-1 #3) — the adapter supplies
 * BOTH from binding config (`paid_from`=`default_receivable_account`/Debtors;
 * `paid_to`=`default_cash_account`/Cash, bank fallback).
 * `received_amount` is MANDATORY even same-currency.
 * `reference_no` is NEVER sent by the body (PMO owns it for PMO-originated
 * PE-receives — it IS the idempotency-anchor carrier; `stampAnchor` writes
 * the key into it).
 */
import { AdapterError, type PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { mirrorMoney, toDecimalString } from '../moneyShape.ts';

const WITHHOLDING_SLIP_PREFIX = 'Withholding slip: ';

function receiptCents(value: unknown): bigint {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new AdapterError('commit-rejected', 'Receipt amounts must be non-negative money with at most two decimal places.');
  }
  const decimal = toDecimalString(value);
  if (Number(value) < 0 || Number(value) !== Number(decimal)) {
    throw new AdapterError('commit-rejected', 'Receipt amounts must be non-negative money with at most two decimal places.');
  }
  return BigInt(decimal.replace('.', ''));
}

export function peReceiveToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  const withheldCents = receiptCents(rec.withheld_amount ?? 0);
  let deductions: unknown[] | undefined;
  if (withheldCents > 0n) {
    const account = ctx.config.tax_prepaid_account;
    if (typeof account !== 'string' || !account.trim() || account.length > 140) {
      throw new AdapterError('commit-rejected', 'Set the Tax-prepaid account in Administration → Accounting before recording withheld tax.');
    }
    const costCenter = ctx.config.cost_center;
    if (typeof costCenter !== 'string' || !costCenter.trim() || costCenter.length > 140) {
      throw new AdapterError('commit-rejected', 'Set the ERP Company default cost center before recording withheld tax.');
    }
    const slip = rec.withholding_slip_number;
    if (typeof slip !== 'string' || !slip.trim() || slip.trim().length > 140) {
      throw new AdapterError('commit-rejected', 'Enter a withholding-slip number of at most 140 characters.');
    }
    if (receiptCents(rec.received_amount) + withheldCents !== receiptCents(rec.paid_amount)) {
      throw new AdapterError('commit-rejected', 'Cash received plus withheld tax must equal the amount allocated to the invoice.');
    }
    deductions = [{ account: account.trim(), cost_center: costCenter.trim(),
      amount: toDecimalString(rec.withheld_amount as number | string),
      description: WITHHOLDING_SLIP_PREFIX + slip.trim() }];
  }
  return {
    payment_type: 'Receive',
    party_type: 'Customer',
    party: ctx.refs.customer,
    paid_amount: rec.paid_amount,
    received_amount: rec.received_amount ?? rec.paid_amount, // mandatory even same-currency (#3)
    // The adapter supplies BOTH accounts (REST defaults neither).
    // paid_to: cash preferred, bank fallback.
    paid_from: ctx.config.default_receivable_account,
    paid_to: ctx.config.default_cash_account ?? ctx.config.default_bank_account,
    // references[] cites the SI (optional — an unreferenced PE-receive is a valid on-account receipt).
    references: rec.references ?? [],
    ...(deductions ? { deductions } : {}),
    // No exchange rates — both auto-derive to 1.0 once the accounts are present (#3).
  };
}

export function peReceiveFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  // The marked deduction carries PMO's stated tax fact; unrelated ERP adjustments are not inferred.
  // Missing child rows in a lifecycle webhook mean unknown, rather than a cleared tax credit.
  const deductions = Array.isArray(d.deductions) ? d.deductions as Record<string, unknown>[] : undefined;
  const withholding = deductions?.filter((row) => typeof row.description === 'string'
    && row.description.startsWith(WITHHOLDING_SLIP_PREFIX));
  if (withholding && withholding.length > 1) {
    throw new AdapterError('commit-rejected', 'Multiple withholding-slip deductions need reconciliation in ERPNext.');
  }
  const deduction = withholding?.[0];
  return {
    id: String(d.name),
    ip_number: String(d.name),
    // Luna BLOCK A3: `party` (the Customer name, party_type='Customer' for a Receive PE), `posting_date`
    // (mapped to canonical `date`), and `references` (the child table citing the paid SI). The inbound
    // feed's mint path (erpnextFeedDeps.ts) resolves `customer`->customer_id and
    // `references[0].reference_name`->sales_invoice_id via external_refs — omitting these left every
    // inbound-adopted native Receive entry with customer_id/sales_invoice_id = NULL.
    customer: (d.party as string | null) ?? null,
    date: (d.posting_date as string | null) ?? null,
    references: (d.references as Array<{ reference_doctype?: string; reference_name?: string | null; allocated_amount?: unknown }> | null) ?? [],
    reference_number: (d.reference_no as string | null) ?? null, // also the anchor carrier
    amount: mirrorMoney(d.paid_amount), // header = money oracle
    ...(d.received_amount !== undefined ? { received_amount: mirrorMoney(d.received_amount) } : {}),
    ...(deductions ? {
      withheld_amount: deduction ? mirrorMoney(deduction.amount) : deductions.length === 0 ? '0.00' : null,
      withholding_slip_number: deduction ? String(deduction.description).slice(WITHHOLDING_SLIP_PREFIX.length) : null,
    } : {}),
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
    erp_amended_from: (d.amended_from as string | null) ?? null,
  };
}

/**
 * The list-endpoint fields `peReceiveFromDoc` actually READS (Luna BLOCK 6). The modified-poll sweep builds its
 * `fields=[…]` request from this, so an adopted/updated mirror row is never written with NULLs for
 * data the ERP doc carries. Co-located with the mapper so the two cannot drift apart.
 */
export const PE_RECEIVE_FROM_DOC_FIELDS = ['name', 'modified', 'docstatus', 'amended_from', 'payment_type', 'party', 'posting_date', 'reference_no', 'paid_amount', 'received_amount'] as const;
