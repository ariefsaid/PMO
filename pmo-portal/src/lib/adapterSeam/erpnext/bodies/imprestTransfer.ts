import type { PmoRecord } from '../../contract.ts';
import { AdapterError } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { expenseJournalToBody } from './expenseJournal.ts';
import { assertImprestTransfer } from '../../imprestTransfer.ts';

/** #1515 — head office → float cash as a two-row Journal Entry with no party. `adapter.ts` stamps the key into user_remark. */
export function imprestTransferToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  let t;
  try {
    t = assertImprestTransfer({ key: String(rec.idempotency_key), fromAccount: String(rec.from_account),
      toAccount: String(rec.to_account), amount: String(rec.amount), date: String(rec.posting_date), reference: String(rec.reference) });
  } catch (e) {
    throw new AdapterError('commit-rejected', (e as Error).message);
  }
  const body = expenseJournalToBody({ ...rec, journal_rows: [
    { account: t.toAccount, debit: t.amount },
    { account: t.fromAccount, credit: t.amount },
  ] }, ctx) as Record<string, unknown>;
  return { ...body, voucher_type: 'Bank Entry', cheque_no: t.reference, cheque_date: t.date };
}
