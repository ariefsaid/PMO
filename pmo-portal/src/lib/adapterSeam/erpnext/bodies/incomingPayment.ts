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

function centsToDecimal(cents: bigint): string {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
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
    // DD-RCPT-1 holds only for same-currency accounts (ERPNext forces received = paid there). Across
    // currencies the cash and the gross are in different units, so the deduction cannot balance.
    const fromCurrency = ctx.config.paid_from_account_currency;
    const toCurrency = ctx.config.paid_to_account_currency;
    if (typeof fromCurrency !== 'string' || !fromCurrency || fromCurrency !== toCurrency) {
      throw new AdapterError('commit-rejected', 'Withheld tax can only be recorded when the receivable and cash accounts use the same currency.');
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
    // DD-RCPT-1: ERPNext forces received_amount = paid_amount for same-currency accounts, so a receipt
    // with tax withheld carries the CASH in both header amounts; the gross rides on the invoice
    // allocation (references[]) and the withheld tax on the marked deduction row.
    paid_amount: deductions ? rec.received_amount : rec.paid_amount,
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

/**
 * Marker field on the canonical: the receipt carries a withholding deduction PMO could not confirm, so
 * the tax facts are mirrored as unknown and the feed raises an "Action required" notice. Never a column.
 */
export const WITHHOLDING_REVIEW_FIELD = 'withholding_review';
export type WithholdingReviewReason = 'multiple-withholding-deductions' | 'header-amounts-differ' | 'unreadable-withholding';

/** The mapper runs inside the feed's listing loop, so a malformed ERP value maps to unknown (null)
 *  rather than throwing — one odd document must never stop later receipts from syncing. */
function tryMoney(value: unknown): string | null {
  try {
    return mirrorMoney(value);
  } catch {
    return null;
  }
}

export function peReceiveFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  // The marked deduction carries PMO's stated tax fact; unrelated ERP adjustments are not inferred.
  // Missing child rows in a lifecycle webhook mean unknown, rather than a cleared tax credit.
  const deductions = Array.isArray(d.deductions) ? d.deductions as Record<string, unknown>[] : undefined;
  const withholding = deductions?.filter((row) => typeof row?.description === 'string'
    && row.description.startsWith(WITHHOLDING_SLIP_PREFIX));
  const header = tryMoney(d.paid_amount);
  const received = d.received_amount !== undefined ? tryMoney(d.received_amount) : undefined;
  // DD-RCPT-1: a marked deduction is withholding ONLY on ERPNext's same-currency shape, where the header
  // carries the cash twice (received_amount === paid_amount). Anything else is ambiguous: the tax facts
  // stay unknown, the header amount is kept, and a human is asked to reconcile it in ERPNext.
  let review: WithholdingReviewReason | null = null;
  let deduction: Record<string, unknown> | undefined;
  if (withholding && withholding.length > 1) review = 'multiple-withholding-deductions';
  else if (withholding?.length === 1) {
    if (header !== null && received !== undefined && received !== null && received !== header) review = 'header-amounts-differ';
    else if (header !== null && received === header) deduction = withholding[0];
  }
  // DD-RCPT-1: the ERP header is the cash; PMO's settled amount is the gross. Derive it ONLY from a
  // confirmed marked withholding deduction — zero, amountless or unrelated rows leave the header as-is.
  let withheld = deduction ? tryMoney(deduction.amount) : null;
  let slip = deduction ? String(deduction.description).slice(WITHHOLDING_SLIP_PREFIX.length).trim() : null;
  // A confirmed row whose amount or slip the receipt record cannot hold is unknown too, never a stall.
  const unreadableAmount = deduction !== undefined && deduction.amount != null && deduction.amount !== ''
    && (withheld === null || Number(withheld) < 0);
  const unreadableSlip = withheld !== null && Number(withheld) > 0 && (!slip || slip.length > 140);
  if (unreadableAmount || unreadableSlip) {
    review = 'unreadable-withholding';
    deduction = undefined;
    withheld = null;
    slip = null;
  }
  const amount = header !== null && Number(header) >= 0 && withheld !== null && Number(withheld) > 0
    ? centsToDecimal(BigInt(header.replace('.', '')) + BigInt(withheld.replace('.', '')))
    : header;
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
    amount, // header (+ marked withholding) = money oracle
    ...(received !== undefined ? { received_amount: received } : {}),
    ...(deductions ? {
      withheld_amount: deduction ? withheld : deductions.length === 0 ? '0.00' : null,
      withholding_slip_number: deduction ? slip : null,
    } : {}),
    ...(review ? { [WITHHOLDING_REVIEW_FIELD]: review } : {}),
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
