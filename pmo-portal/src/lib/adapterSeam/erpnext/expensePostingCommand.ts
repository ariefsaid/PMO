/**
 * #775 phase B — the expense posting command: gate truth + resolved refs → the frozen outbox payload (DD-EXP-15).
 */
import { AdapterError } from '../contract.ts';
import type { ErpDocKind } from './doctypeRegistry.ts';
import { expenseOutboxIdentity, expensePostingKey, type ExpensePosting } from './expensePostingKey.ts';
import type { ExpenseJournalRow } from './bodies/expenseJournal.ts';

/** What `expense_posting_for_push` (0263 §5) returns — DB truth, never a payload. */
export interface ExpenseGateTruth {
  mirror_id: string;
  posting: ExpensePosting;
  posting_identity: string;
  subject_id: string;
  claim_id: string;
  claim_number: string | null;
  claimant_id: string;
  project_id: string | null;
  currency: string;
  amount: string;
  lines: Array<{ expense_type: string; amount: string }>;
  state_stamp: string;
  posting_date: string;
  approval_posting_exists: boolean;
  actor_id: string;
}

/** Everything a posting body needs, resolved before the outbox row exists. `null` = not needed by this posting. */
export interface ExpenseResolvedRefs {
  company: string;
  employee: string | null;
  payableAccount: string | null;
  advanceAccount: string | null;
  expenseAccounts: Record<string, string>;
  erpProject: string | null;
  costCenter: string | null;
  cashAccount: string | null;
  approvalJournal: string | null;
}

export const EXPENSE_KIND_BY_POSTING: Readonly<Record<ExpensePosting, ErpDocKind>> = {
  approval: 'expense-journal',
  settlement: 'expense-journal',
  'approval-cancel': 'expense-journal',
  'claim-payment': 'expense-payment',
  'advance-payment': 'expense-payment',
  'advance-return': 'expense-receipt',
};

export interface ExpensePostingCommand {
  domain: 'expenses';
  operation: 'create' | 'transition';
  idempotencyKey: string;
  /** The outbox / external_refs identity (the cancel uses the approval's). */
  outboxIdentity: string;
  record: { id: string; erp_doc_kind: ErpDocKind } & Record<string, unknown>;
}

function need(value: string | null | undefined, what: string): string {
  if (!value) throw new AdapterError('commit-rejected', `expense posting: ${what} is not resolved`);
  return value;
}

/**
 * Build the command whose `record` is persisted VERBATIM as the outbox payload (digest-bound, replayed by recovery).
 * `createdAfter` is the composite probe's claim-window floor (`YYYY-MM-DD HH:MM:SS`); it is excluded from the digest.
 */
export function buildExpensePostingCommand(truth: ExpenseGateTruth, refs: ExpenseResolvedRefs, createdAfter: string): ExpensePostingCommand {
  const kind = EXPENSE_KIND_BY_POSTING[truth.posting];
  const idempotencyKey = expensePostingKey(truth.posting, truth.subject_id, truth.state_stamp);
  const outboxIdentity = expenseOutboxIdentity(truth.posting, truth.subject_id);
  const base = {
    id: truth.subject_id.toLowerCase(), erp_doc_kind: kind, posting: truth.posting, posting_identity: truth.posting_identity,
    outbox_identity: outboxIdentity, claim_id: truth.claim_id, company: refs.company, posting_date: truth.posting_date,
    currency: truth.currency,
  };
  const create = (record: Record<string, unknown>): ExpensePostingCommand =>
    ({ domain: 'expenses', operation: 'create', idempotencyKey, outboxIdentity, record: { ...base, ...record } });

  switch (truth.posting) {
    case 'approval': {
      const employee = need(refs.employee, 'the ERPNext employee');
      const rows: ExpenseJournalRow[] = truth.lines.map((line) => ({
        account: need(refs.expenseAccounts[line.expense_type], `the ${line.expense_type} expense account`),
        debit: line.amount, project: refs.erpProject, cost_center: refs.costCenter,
      }));
      rows.push({ account: need(refs.payableAccount, 'the employee payable account'), credit: truth.amount, party: employee });
      return create({ journal_rows: rows });
    }
    case 'settlement': {
      const employee = need(refs.employee, 'the ERPNext employee');
      const payableRow: ExpenseJournalRow = { account: need(refs.payableAccount, 'the employee payable account'), debit: truth.amount, party: employee };
      if (refs.approvalJournal) payableRow.reference_name = refs.approvalJournal;
      return create({ journal_rows: [
        payableRow,
        { account: need(refs.advanceAccount, 'the employee advance account'), credit: truth.amount, party: employee },
      ] });
    }
    case 'claim-payment':
    case 'advance-payment':
    case 'advance-return': {
      const employee = need(refs.employee, 'the ERPNext employee');
      const cash = need(refs.cashAccount, 'the cash or bank account');
      const receive = truth.posting === 'advance-return';
      const partyAccount = truth.posting === 'claim-payment'
        ? need(refs.payableAccount, 'the employee payable account')
        : need(refs.advanceAccount, 'the employee advance account');
      const journal = truth.posting === 'claim-payment' ? refs.approvalJournal : null;
      return create({
        payment_type: receive ? 'Receive' : 'Pay', party_type: 'Employee', party: employee,
        paid_from: receive ? partyAccount : cash, paid_to: receive ? cash : partyAccount, paid_amount: truth.amount,
        approval_journal: journal,
        // ADR-0058 C-1 composite-probe inputs, frozen with the command (read back by buildOutboxProbe).
        je_names: journal ? [journal] : [], pi_names: [], si_names: [], created_after: createdAfter,
      });
    }
    case 'approval-cancel':
      return {
        domain: 'expenses', operation: 'transition', idempotencyKey, outboxIdentity,
        record: { ...base, verb: 'cancel', externalRecordId: need(refs.approvalJournal, 'the approval journal entry') },
      };
  }
}
