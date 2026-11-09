import type { PmoRecord } from '../../contract.ts';
import { AdapterError } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { expenseJournalToBody } from './expenseJournal.ts';
import { requireCompany } from './shared.ts';
import { assertImprestTransfer } from '../../imprestTransfer.ts';

/**
 * #1515 — head office → float cash as a two-row Journal Entry with no party. `adapter.ts` stamps the key into user_remark.
 *
 * ⚑ review r8 M-2: the Journal Entry states the BINDING's company, not the queued record's copy. The
 * served resolve (`resolveImprestPosting`) already refuses a binding that names no company with
 * `config-rejected` BEFORE the outbox row exists, so this is the body-level belt for the same rule: a
 * replay on a binding whose company was unlinked must refuse, never POST `company: null` into
 * ERPNext's default company (the sweep scopes its reads by the binding company, so that document would
 * never mirror back).
 */
export function imprestTransferToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  const company = requireCompany(ctx.config, 'Journal Entry');
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
  return { ...body, company, voucher_type: 'Bank Entry', cheque_no: t.reference, cheque_date: t.date };
}
