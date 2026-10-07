import { describe, expect, it } from 'vitest';
import type { ErpAccountFacts } from './expenseAccountRules';
import type { ExpenseGateTruth } from './expensePostingCommand';
import type { ExpensePosting } from './expensePostingKey';
import { resolveExpensePosting, type ExpenseResolveDeps } from './expensePostingResolve';

const CLAIM = '0b7a8c2e-1111-4222-8333-444455556666';
const ACCOUNTS: Record<string, ErpAccountFacts> = {
  'Employee Payable - PSC': { name: 'Employee Payable - PSC', root_type: 'Liability', account_type: 'Payable', is_group: 0, disabled: 0, company: 'PMO Smoke Co', account_currency: 'IDR' },
  'Creditors - PSC': { name: 'Creditors - PSC', root_type: 'Liability', account_type: 'Payable', is_group: 0, disabled: 0, company: 'PMO Smoke Co', account_currency: 'IDR' },
  'Employee Advances - PSC': { name: 'Employee Advances - PSC', root_type: 'Asset', account_type: 'Payable', is_group: 0, disabled: 0, company: 'PMO Smoke Co', account_currency: 'IDR' },
  'Travel Expenses - PSC': { name: 'Travel Expenses - PSC', root_type: 'Expense', account_type: '', is_group: 0, disabled: 0, company: 'PMO Smoke Co', account_currency: 'IDR' },
  'Meals - PSC': { name: 'Meals - PSC', root_type: 'Expense', account_type: '', is_group: 0, disabled: 0, company: 'PMO Smoke Co', account_currency: 'IDR' },
};

function truth(posting: ExpensePosting, over: Partial<ExpenseGateTruth> = {}): ExpenseGateTruth {
  return {
    mirror_id: 'm1', posting, posting_identity: `${CLAIM}:${posting}`, subject_id: CLAIM, claim_id: CLAIM,
    claim_number: 'EXP-2610070001', claimant_id: 'user-e1', project_id: 'proj-1', currency: 'IDR', amount: '175.00',
    lines: [{ expense_type: 'Meals', amount: '25.00' }, { expense_type: 'Travel', amount: '150.00' }],
    state_stamp: '2026-10-07T10:00:00+00:00', posting_date: '2026-10-07', approval_posting_exists: true, actor_id: 'user-pm',
    ...over,
  };
}

function deps(over: Partial<ExpenseResolveDeps> = {}): ExpenseResolveDeps & { calls: string[] } {
  const calls: string[] = [];
  const base: ExpenseResolveDeps = {
    readBinding: async () => { calls.push('binding'); return { company: 'PMO Smoke Co', cashAccount: 'Cash - PSC', costCenter: 'Main - PSC', projectMap: { 'proj-1': 'PROJ-0001' } }; },
    readConfirmedEmployee: async () => { calls.push('employee'); return 'HR-EMP-00002'; },
    readAccountMap: async () => { calls.push('map'); return { employee_payable: 'Employee Payable - PSC', employee_advance: 'Employee Advances - PSC', Travel: 'Travel Expenses - PSC', Meals: 'Meals - PSC' }; },
    readApprovalPosting: async () => { calls.push('approval'); return { push_state: 'pushed', erp_name: 'ACC-JV-2026-00002', erp_cancelled_at: null }; },
    readErpAccounts: async (names) => { calls.push('accounts'); return names.map((n) => ACCOUNTS[n]).filter(Boolean); },
    readErpCompany: async () => { calls.push('company'); return { currency: 'IDR', defaultPayableAccount: 'Creditors - PSC' }; },
    readApprovalOutboxExists: async () => { calls.push('approval-outbox'); return false; },
    readErpJournalDocstatus: async () => { calls.push('docstatus'); return 1; },
  };
  return { ...base, ...over, calls };
}

describe('resolveExpensePosting (AC-EXP-115)', () => {
  it('AC-EXP-115 approval: ready with exactly the accounts it needs', async () => {
    expect(await resolveExpensePosting(truth('approval'), deps())).toEqual({ outcome: 'ready', refs: {
      company: 'PMO Smoke Co', employee: 'HR-EMP-00002', payableAccount: 'Employee Payable - PSC', advanceAccount: null,
      expenseAccounts: { Meals: 'Meals - PSC', Travel: 'Travel Expenses - PSC' }, erpProject: 'PROJ-0001', costCenter: 'Main - PSC',
      cashAccount: 'Cash - PSC', approvalJournal: null } });
  });

  it('AC-EXP-115 refusals, each named, each before any ERP read', async () => {
    const unlinked = deps({ readConfirmedEmployee: async () => null });
    expect(await resolveExpensePosting(truth('approval'), unlinked)).toMatchObject({ outcome: 'refuse', code: 'employee-unlinked' });
    expect(unlinked.calls).not.toContain('accounts');
    expect(await resolveExpensePosting(truth('approval'), deps({ readAccountMap: async () => ({ employee_payable: 'Employee Payable - PSC', Travel: 'Travel Expenses - PSC' }) })))
      .toMatchObject({ outcome: 'refuse', code: 'expense-account-unmapped', message: expect.stringContaining('Meals') });
    expect(await resolveExpensePosting(truth('approval'), deps({ readBinding: async () => ({ company: 'PMO Smoke Co', cashAccount: 'Cash - PSC', costCenter: null, projectMap: {} }) })))
      .toMatchObject({ outcome: 'refuse', code: 'project-unmapped' });
    expect(await resolveExpensePosting(truth('advance-payment'), deps({ readBinding: async () => ({ company: 'PMO Smoke Co', cashAccount: null, costCenter: null, projectMap: {} }) })))
      .toMatchObject({ outcome: 'refuse', code: 'expense-cash-account-unconfigured' });
    expect(await resolveExpensePosting(truth('approval'), deps({ readBinding: async () => ({ company: null, cashAccount: null, costCenter: null, projectMap: {} }) })))
      .toMatchObject({ outcome: 'refuse', code: 'config-rejected' });
  });

  it('AC-EXP-115 refuses Creditors as employee payable and a currency the company does not keep', async () => {
    expect(await resolveExpensePosting(truth('claim-payment'), deps({ readAccountMap: async () => ({ employee_payable: 'Creditors - PSC' }) })))
      .toMatchObject({ outcome: 'refuse', code: 'expense-account-invalid', message: expect.stringContaining('supplier payable') });
    expect(await resolveExpensePosting(truth('approval'), deps({ readErpCompany: async () => ({ currency: 'USD', defaultPayableAccount: 'Creditors - PSC' }) })))
      .toMatchObject({ outcome: 'refuse', code: 'config-rejected' });
  });

  it('AC-EXP-115 the supplier payable account is the LIVE ERPNext company default, not a stored copy', async () => {
    // ERPNext's company now names another default payable account: the old one is no longer the supplier account.
    const moved = deps({
      readAccountMap: async () => ({ employee_payable: 'Creditors - PSC' }),
      readErpCompany: async () => ({ currency: 'IDR', defaultPayableAccount: 'Supplier Payables - PSC' }),
    });
    expect(await resolveExpensePosting(truth('claim-payment', { approval_posting_exists: false }), moved)).toMatchObject({ outcome: 'ready' });
    // …and the account ERPNext names now is refused.
    expect(await resolveExpensePosting(truth('claim-payment', { approval_posting_exists: false }), deps({
      readAccountMap: async () => ({ employee_payable: 'Employee Payable - PSC' }),
      readErpCompany: async () => ({ currency: 'IDR', defaultPayableAccount: 'Employee Payable - PSC' }),
    }))).toMatchObject({ outcome: 'refuse', code: 'expense-account-invalid', message: expect.stringContaining('supplier payable') });
    // A company that names none cannot confirm any employee payable account (fail closed).
    expect(await resolveExpensePosting(truth('claim-payment', { approval_posting_exists: false }), deps({
      readErpCompany: async () => ({ currency: 'IDR', defaultPayableAccount: null }),
    }))).toMatchObject({ outcome: 'refuse', code: 'expense-account-invalid' });
    expect(await resolveExpensePosting(truth('approval'), deps({ readErpCompany: async () => null })))
      .toMatchObject({ outcome: 'refuse', code: 'config-rejected' });
  });

  it('AC-EXP-115 a payment waits for its approval journal, then references it', async () => {
    expect(await resolveExpensePosting(truth('claim-payment'), deps({ readApprovalPosting: async () => ({ push_state: 'pending', erp_name: null, erp_cancelled_at: null }) })))
      .toEqual({ outcome: 'wait', reason: 'expense-approval-journal-not-posted' });
    const ready = await resolveExpensePosting(truth('claim-payment'), deps());
    expect(ready).toMatchObject({ outcome: 'ready', refs: { approvalJournal: 'ACC-JV-2026-00002', payableAccount: 'Employee Payable - PSC', cashAccount: 'Cash - PSC' } });
    expect(await resolveExpensePosting(truth('settlement'), deps({ readApprovalPosting: async () => ({ push_state: 'pushed', erp_name: 'ACC-JV-2026-00002', erp_cancelled_at: '2026-10-08T00:00:00Z' }) })))
      .toMatchObject({ outcome: 'refuse', code: 'expense-approval-journal-cancelled' });
  });

  it('AC-EXP-115 no approval intent (approved before employment): no reference, no read of it', async () => {
    const d = deps();
    expect(await resolveExpensePosting(truth('settlement', { approval_posting_exists: false }), d))
      .toMatchObject({ outcome: 'ready', refs: { approvalJournal: null, advanceAccount: 'Employee Advances - PSC' } });
    expect(d.calls).not.toContain('approval');
  });

  it('AC-EXP-115 cancel: waits for the approval, is done when ERPNext already cancelled it, else cancels it', async () => {
    expect(await resolveExpensePosting(truth('approval-cancel'), deps({
      readApprovalPosting: async () => ({ push_state: 'failed', erp_name: null, erp_cancelled_at: null }),
      readApprovalOutboxExists: async () => true,
    }))).toEqual({ outcome: 'wait', reason: 'expense-approval-journal-not-posted' });
    expect(await resolveExpensePosting(truth('approval-cancel'), deps({ readErpJournalDocstatus: async () => 2 })))
      .toEqual({ outcome: 'already-done', erpName: 'ACC-JV-2026-00002' });
    expect(await resolveExpensePosting(truth('approval-cancel'), deps()))
      .toMatchObject({ outcome: 'ready', refs: { approvalJournal: 'ACC-JV-2026-00002' } });
  });

  it('AC-EXP-115 cancel: an approval that never posted and has no outbox command is done — nothing to cancel', async () => {
    for (const approval of [{ push_state: 'pending', erp_name: null, erp_cancelled_at: null }, { push_state: 'held', erp_name: null, erp_cancelled_at: null }, null]) {
      const d = deps({ readApprovalPosting: async () => approval });
      expect(await resolveExpensePosting(truth('approval-cancel'), d)).toEqual({ outcome: 'already-done', erpName: null });
      expect(d.calls).not.toContain('docstatus');
    }
  });
});
