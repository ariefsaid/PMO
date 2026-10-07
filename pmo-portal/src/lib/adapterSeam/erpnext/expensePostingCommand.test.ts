import { describe, expect, it, vi } from 'vitest';
import { buildExpensePostingCommand, type ExpenseGateTruth, type ExpenseResolvedRefs } from './expensePostingCommand';
import { createErpAdapter } from './adapter';
import { DOCTYPE_BODIES } from './doctypeBodies';

const CLAIM = '0b7a8c2e-1111-4222-8333-444455556666';
const STAMP = '2026-10-07T10:00:00.123+00:00';
const EPOCH = '1791367200123';
const AFTER = '2026-10-07 09:59:00';
const t = (over: Partial<ExpenseGateTruth>): ExpenseGateTruth => ({
  mirror_id: 'm1', posting: 'approval', posting_identity: `${CLAIM}:approval`, subject_id: CLAIM, claim_id: CLAIM,
  claim_number: 'EXP-2610070001', claimant_id: 'u-e1', project_id: 'p1', currency: 'IDR', amount: '175.00',
  lines: [{ expense_type: 'Meals', amount: '25.00' }, { expense_type: 'Travel', amount: '150.00' }],
  state_stamp: STAMP, posting_date: '2026-10-07', approval_posting_exists: true, actor_id: 'u-pm', ...over,
});
const r: ExpenseResolvedRefs = {
  company: 'PMO Smoke Co', employee: 'HR-EMP-00002', payableAccount: 'Employee Payable - PSC', advanceAccount: 'Employee Advances - PSC',
  expenseAccounts: { Meals: 'Meals - PSC', Travel: 'Travel Expenses - PSC' }, erpProject: 'PROJ-0001', costCenter: 'Main - PSC',
  cashAccount: 'Cash - PSC', approvalJournal: 'ACC-JV-2026-00002',
};

describe('buildExpensePostingCommand (AC-EXP-117)', () => {
  it('AC-EXP-117 approval → expense-journal create, frozen journal rows', () => {
    const cmd = buildExpensePostingCommand(t({}), { ...r, approvalJournal: null }, AFTER);
    expect(cmd).toMatchObject({ domain: 'expenses', operation: 'create', idempotencyKey: `expj:${CLAIM}:${EPOCH}`, outboxIdentity: `${CLAIM}:approval` });
    expect(cmd.record).toEqual({
      id: CLAIM, erp_doc_kind: 'expense-journal', posting: 'approval', posting_identity: `${CLAIM}:approval`, outbox_identity: `${CLAIM}:approval`,
      claim_id: CLAIM, company: 'PMO Smoke Co', posting_date: '2026-10-07', currency: 'IDR',
      journal_rows: [
        { account: 'Meals - PSC', debit: '25.00', project: 'PROJ-0001', cost_center: 'Main - PSC' },
        { account: 'Travel Expenses - PSC', debit: '150.00', project: 'PROJ-0001', cost_center: 'Main - PSC' },
        { account: 'Employee Payable - PSC', credit: '175.00', party: 'HR-EMP-00002' },
      ],
    });
  });

  it('AC-EXP-117 settlement → payable row references the approval', () => {
    const cmd = buildExpensePostingCommand(t({ posting: 'settlement', posting_identity: `${CLAIM}:settlement`, amount: '50.00' }), r, AFTER);
    expect(cmd.idempotencyKey).toBe(`exps:${CLAIM}:${EPOCH}`);
    expect(cmd.record.journal_rows).toEqual([
      { account: 'Employee Payable - PSC', debit: '50.00', party: 'HR-EMP-00002', reference_name: 'ACC-JV-2026-00002' },
      { account: 'Employee Advances - PSC', credit: '50.00', party: 'HR-EMP-00002' },
    ]);
  });

  it('AC-EXP-117 claim payment → expense-payment with the composite-probe fields frozen in', () => {
    const cmd = buildExpensePostingCommand(t({ posting: 'claim-payment', posting_identity: `${CLAIM}:claim-payment`, amount: '100.00' }), r, AFTER);
    expect(cmd.idempotencyKey).toBe(`expp:${CLAIM}:${EPOCH}`);
    expect(cmd.record).toMatchObject({
      erp_doc_kind: 'expense-payment', payment_type: 'Pay', party_type: 'Employee', party: 'HR-EMP-00002',
      paid_from: 'Cash - PSC', paid_to: 'Employee Payable - PSC', paid_amount: '100.00', approval_journal: 'ACC-JV-2026-00002',
      je_names: ['ACC-JV-2026-00002'], pi_names: [], si_names: [], created_after: AFTER,
    });
  });

  it('AC-EXP-117 advance return → expense-receipt, subject = the return row', () => {
    const RET = '9c1d2e3f-aaaa-4bbb-8ccc-ddddeeeeffff';
    const cmd = buildExpensePostingCommand(t({ posting: 'advance-return', posting_identity: `${RET}:advance-return`, subject_id: RET, amount: '20.00' }), r, AFTER);
    expect(cmd).toMatchObject({ outboxIdentity: `${RET}:advance-return`, idempotencyKey: `expr:${RET}:${EPOCH}` });
    expect(cmd.record).toMatchObject({ id: RET, erp_doc_kind: 'expense-receipt', payment_type: 'Receive',
      paid_from: 'Employee Advances - PSC', paid_to: 'Cash - PSC', je_names: [] });
  });

  it('AC-EXP-117 approval cancel → transition cancel on the approval document, on the approval identity', () => {
    const cmd = buildExpensePostingCommand(t({ posting: 'approval-cancel', posting_identity: `${CLAIM}:approval-cancel` }), r, AFTER);
    expect(cmd).toMatchObject({ operation: 'transition', outboxIdentity: `${CLAIM}:approval`, idempotencyKey: `expx:${CLAIM}:${EPOCH}` });
    expect(cmd.record).toMatchObject({ erp_doc_kind: 'expense-journal', verb: 'cancel', externalRecordId: 'ACC-JV-2026-00002', posting_identity: `${CLAIM}:approval-cancel` });
  });

  it('AC-EXP-117 refuses to build when a needed reference is missing', () => {
    expect(() => buildExpensePostingCommand(t({}), { ...r, employee: null }, AFTER)).toThrow(/ERPNext employee/);
    expect(() => buildExpensePostingCommand(t({ posting: 'approval-cancel', posting_identity: `${CLAIM}:approval-cancel` }), { ...r, approvalJournal: null }, AFTER))
      .toThrow(/approval journal/);
  });
});

describe('expense approval cancel through the adapter (AC-EXP-127)', () => {
  it('AC-EXP-127 issues exactly one PUT {docstatus:2} on the approval Journal Entry, then re-reads it', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      return new Response(JSON.stringify({ name: 'ACC-JV-2026-00002', docstatus: 2, modified: 'm2' }));
    };
    const cmd = buildExpensePostingCommand(t({ posting: 'approval-cancel', posting_identity: `${CLAIM}:approval-cancel` }), r, AFTER);
    const adapter = createErpAdapter({
      client: { fetchImpl: vi.fn(fetchImpl) as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test' },
      doctypeBodies: DOCTYPE_BODIES, ctx: { refs: {}, config: {} },
    });
    const result = await adapter.commit({ domain: cmd.domain, operation: cmd.operation, record: cmd.record, idempotencyKey: cmd.idempotencyKey });
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'GET']);
    expect(calls[0].url).toContain('/api/resource/Journal%20Entry/ACC-JV-2026-00002');
    expect(calls[0].body).toEqual({ docstatus: 2 });
    expect(result.canonical).toMatchObject({ erp_docstatus: 2 });
  });
});
