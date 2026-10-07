/**
 * #775 phase B — Employee Payment Entry body (claim cash part, advance payout, advance return). Spike 2026-10-07 §3:
 * ERPNext GUESSES `paid_to`/`paid_from` from the employee's ledger history (or falls back to Creditors) when they
 * are omitted, so both are ALWAYS sent. `reference_date` is always sent because a Bank-typed `paid_from` needs it
 * with `reference_no` (the anchor `adapter.ts` stamps). With no HRMS, Journal Entry is the only valid reference doctype.
 */
import type { PmoRecord } from '../../contract.ts';
import { AdapterError } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { mirrorMoney } from '../moneyShape.ts';

const MONEY = /^\d{1,12}\.\d{2}$/;

function required(rec: PmoRecord, field: string): string {
  const value = rec[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AdapterError('commit-rejected', `expense payment: ${field} is required`);
  }
  return value;
}

export function expensePaymentToBody(rec: PmoRecord, _ctx: ErpCtx): unknown {
  const expected = rec.erp_doc_kind === 'expense-receipt' ? 'Receive' : 'Pay';
  if (rec.payment_type !== expected) {
    throw new AdapterError('commit-rejected', `expense payment: direction ${String(rec.payment_type)} contradicts kind ${String(rec.erp_doc_kind)}`);
  }
  const amountText = required(rec, 'paid_amount');
  if (!MONEY.test(amountText) || Number(amountText) <= 0) {
    throw new AdapterError('commit-rejected', `expense payment: amount "${amountText}" must be a positive 2-decimal figure`);
  }
  const amount = Number(amountText);
  const postingDate = required(rec, 'posting_date');
  const journal = typeof rec.approval_journal === 'string' && rec.approval_journal ? rec.approval_journal : null;
  return {
    company: required(rec, 'company'),
    posting_date: postingDate,
    payment_type: expected,
    party_type: 'Employee',
    party: required(rec, 'party'),
    paid_from: required(rec, 'paid_from'),
    paid_to: required(rec, 'paid_to'),
    paid_amount: amount,
    received_amount: amount,
    reference_date: postingDate,
    references: journal ? [{ reference_doctype: 'Journal Entry', reference_name: journal, allocated_amount: amount }] : [],
  };
}

export function expensePaymentFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: String(d.name),
    // The adapter replaces `id` with the PMO record id on every command result; the side-mirror writer reads the
    // ERP document name from here (found by AC-EXP-140).
    erp_name: String(d.name),
    erp_docstatus: (d.docstatus as number | null | undefined) ?? null,
    erp_modified: (d.modified as string | null | undefined) ?? null,
    erp_amended_from: (d.amended_from as string | null | undefined) ?? null,
    reference_number: (d.reference_no as string | null | undefined) ?? null,
    amount: mirrorMoney(d.paid_amount),
  };
}

export const EXPENSE_PAYMENT_FROM_DOC_FIELDS = ['name', 'modified', 'docstatus', 'amended_from', 'reference_no', 'paid_amount'] as const;
