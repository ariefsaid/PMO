/**
 * #775 phase B — Journal Entry body for the `approval` and `settlement` postings. Shapes are the spike's
 * (2026-10-07 §1): expense rows carry `project` + `cost_center` (they reach the GL Entry verbatim, §4); Employee
 * party rows carry neither (ERPNext defaults their cost center). `user_remark` is NOT set here — `adapter.ts`
 * stampAnchor writes the idempotency key into it on create AND on amend.
 */
import type { PmoRecord } from '../../contract.ts';
import { AdapterError } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';

export interface ExpenseJournalRow {
  account: string;
  debit?: string;
  credit?: string;
  project?: string | null;
  cost_center?: string | null;
  /** The Employee party; its presence makes this a party row. */
  party?: string;
  /** A Journal Entry this row settles against (the settlement's payable row → the approval). */
  reference_name?: string | null;
}

const MONEY = /^\d{1,12}\.\d{2}$/;

function cents(value: string, account: string): bigint {
  if (!MONEY.test(value)) throw new AdapterError('commit-rejected', `expense journal: amount "${value}" on ${account} is not a 2-decimal figure`);
  return BigInt(value.replace('.', ''));
}

export function expenseJournalToBody(rec: PmoRecord, _ctx: ErpCtx): unknown {
  const rows = rec.journal_rows as ExpenseJournalRow[] | undefined;
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new AdapterError('commit-rejected', 'expense journal needs at least two rows');
  }
  let debit = 0n;
  let credit = 0n;
  const accounts = rows.map((row) => {
    const out: Record<string, unknown> = { account: row.account };
    if (row.debit) {
      debit += cents(row.debit, row.account);
      out.debit_in_account_currency = Number(row.debit);
    }
    if (row.credit) {
      credit += cents(row.credit, row.account);
      out.credit_in_account_currency = Number(row.credit);
    }
    if (row.party) {
      out.party_type = 'Employee';
      out.party = row.party;
      if (row.reference_name) {
        out.reference_type = 'Journal Entry';
        out.reference_name = row.reference_name;
      }
    } else {
      if (row.project) out.project = row.project;
      if (row.cost_center) out.cost_center = row.cost_center;
    }
    return out;
  });
  if (debit !== credit || debit === 0n) {
    throw new AdapterError('commit-rejected', `expense journal is unbalanced (debit ${debit} ≠ credit ${credit} cents, or zero)`);
  }
  return { company: rec.company, voucher_type: 'Journal Entry', posting_date: rec.posting_date, accounts };
}

export function expenseJournalFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: String(d.name),
    erp_docstatus: (d.docstatus as number | null | undefined) ?? null,
    erp_modified: (d.modified as string | null | undefined) ?? null,
    erp_amended_from: (d.amended_from as string | null | undefined) ?? null,
    user_remark: (d.user_remark as string | null | undefined) ?? null,
  };
}

/** The list fields `expenseJournalFromDoc` reads (the sweep's poll requests exactly these, plus routing fields). */
export const EXPENSE_JOURNAL_FROM_DOC_FIELDS = ['name', 'modified', 'docstatus', 'amended_from', 'user_remark'] as const;
