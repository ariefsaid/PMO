import { describe, expect, it } from 'vitest';
import { AdapterError } from '../../contract';
import { expenseJournalFromDoc, expenseJournalToBody } from './expenseJournal';

const ctx = { refs: {}, config: {} };
const approval = {
  id: 'c1', erp_doc_kind: 'expense-journal', posting: 'approval', company: 'PMO Smoke Co', posting_date: '2026-10-08',
  journal_rows: [
    { account: 'Travel Expenses - PSC', debit: '150.00', project: 'PROJ-0001', cost_center: 'Main - PSC' },
    { account: 'Meals - PSC', debit: '25.00', project: 'PROJ-0001', cost_center: 'Main - PSC' },
    { account: 'Employee Payable - PSC', credit: '175.00', party: 'HR-EMP-00002', project: 'PROJ-0001' },
  ],
};

describe('expenseJournalToBody (AC-EXP-111)', () => {
  it('AC-EXP-111 approval: debit rows carry project + cost center; the Employee row carries neither', () => {
    expect(expenseJournalToBody(approval, ctx)).toEqual({
      company: 'PMO Smoke Co', voucher_type: 'Journal Entry', posting_date: '2026-10-08',
      accounts: [
        { account: 'Travel Expenses - PSC', debit_in_account_currency: 150, project: 'PROJ-0001', cost_center: 'Main - PSC' },
        { account: 'Meals - PSC', debit_in_account_currency: 25, project: 'PROJ-0001', cost_center: 'Main - PSC' },
        { account: 'Employee Payable - PSC', credit_in_account_currency: 175, party_type: 'Employee', party: 'HR-EMP-00002' },
      ],
    });
  });

  it('AC-EXP-111 overhead approval: no project key at all', () => {
    const body = expenseJournalToBody({
      ...approval,
      journal_rows: [
        { account: 'Travel Expenses - PSC', debit: '10.00', project: null, cost_center: 'Main - PSC' },
        { account: 'Employee Payable - PSC', credit: '10.00', party: 'HR-EMP-00002' },
      ],
    }, ctx) as { accounts: Array<Record<string, unknown>> };
    expect(body.accounts[0]).toEqual({ account: 'Travel Expenses - PSC', debit_in_account_currency: 10, cost_center: 'Main - PSC' });
  });

  it('AC-EXP-111 settlement: the payable row references the approval Journal Entry', () => {
    const body = expenseJournalToBody({
      ...approval, posting: 'settlement',
      journal_rows: [
        { account: 'Employee Payable - PSC', debit: '50.00', party: 'HR-EMP-00002', reference_name: 'ACC-JV-2026-00002' },
        { account: 'Employee Advances - PSC', credit: '50.00', party: 'HR-EMP-00002' },
      ],
    }, ctx) as { accounts: Array<Record<string, unknown>> };
    expect(body.accounts).toEqual([
      { account: 'Employee Payable - PSC', debit_in_account_currency: 50, party_type: 'Employee', party: 'HR-EMP-00002',
        reference_type: 'Journal Entry', reference_name: 'ACC-JV-2026-00002' },
      { account: 'Employee Advances - PSC', credit_in_account_currency: 50, party_type: 'Employee', party: 'HR-EMP-00002' },
    ]);
  });

  it('AC-EXP-111 refuses an unbalanced, zero, short or malformed entry before any call', () => {
    const rows = (debit: string, credit: string) => ({ ...approval, journal_rows: [
      { account: 'A', debit, project: null, cost_center: null }, { account: 'B', credit, party: 'E' }] });
    expect(() => expenseJournalToBody(rows('10.00', '9.99'), ctx)).toThrow(/unbalanced/);
    expect(() => expenseJournalToBody(rows('0.00', '0.00'), ctx)).toThrow(/unbalanced/);
    expect(() => expenseJournalToBody(rows('1.5', '1.5'), ctx)).toThrow(AdapterError);
    expect(() => expenseJournalToBody({ ...approval, journal_rows: [approval.journal_rows[0]] }, ctx)).toThrow(/two rows/);
  });

  it('AC-EXP-111 fromDoc maps the lifecycle fields', () => {
    expect(expenseJournalFromDoc({ name: 'ACC-JV-2026-00002', docstatus: 1, modified: '2026-10-07 14:07:45', amended_from: null, user_remark: 'expj:x' }))
      .toEqual({ id: 'ACC-JV-2026-00002', erp_name: 'ACC-JV-2026-00002', erp_docstatus: 1, erp_modified: '2026-10-07 14:07:45', erp_amended_from: null, user_remark: 'expj:x' });
    // The adapter replaces `id` with the PMO record id on every command result; the ERP name must survive in its
    // own field or the side mirror records the claim uuid as the document (found by AC-EXP-140).
  });
});
