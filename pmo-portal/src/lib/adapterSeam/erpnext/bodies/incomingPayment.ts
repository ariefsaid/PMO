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
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { mirrorMoney } from '../moneyShape.ts';

export function peReceiveToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
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
    // No exchange rates — both auto-derive to 1.0 once the accounts are present (#3).
  };
}

export function peReceiveFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
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
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
    erp_amended_from: (d.amended_from as string | null) ?? null,
  };
}