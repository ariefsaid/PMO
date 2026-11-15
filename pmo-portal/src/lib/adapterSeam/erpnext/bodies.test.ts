/**
 * AC-SAR-030/031 — erpnext/bodies.test.ts: unit tests for the spike-frozen
 * salesInvoice + incomingPayment body maps. Proves the exact field shapes
 * sent to ERPNext and the canonical PMO shapes returned from ERP docs.
 */
import { describe, expect, it } from 'vitest';
import { siToBody, siFromDoc, SI_FROM_DOC_FIELDS } from './bodies/salesInvoice.ts';
import { peReceiveToBody, peReceiveFromDoc } from './bodies/incomingPayment.ts';
import type { ErpCtx } from './doctypeRegistry.ts';
import { manualJournalFromDoc, manualJournalReversalToBody, manualJournalToBody } from './bodies/manualJournal.ts';
import { AdapterError } from '../contract.ts';
import { journalKey, journalReversalKey, type LedgerJournal } from '../ledgerJournal.ts';

const CTX: ErpCtx = {
  refs: { customer: 'Spike Customer', project: 'PROJ-0001' },
  config: {
    default_receivable_account: 'Debtors - PSC',
    default_income_account: 'Sales - PSC',
    default_cash_account: 'Cash - PSC',
    default_bank_account: 'Bank - PSC',
  },
};

const CTX_NO_PROJECT: ErpCtx = {
  refs: { customer: 'Spike Customer', project: null },
  config: {
    default_receivable_account: 'Debtors - PSC',
    default_income_account: 'Sales - PSC',
    default_cash_account: 'Cash - PSC',
    default_bank_account: 'Bank - PSC',
  },
};

describe('erpnext/bodies — Sales Invoice (AC-SAR-030: SI money shape)', () => {
  it('siToBody sends exactly {customer, items:[{item_code,qty,rate}], project?} — NO account fields', () => {
    const body = siToBody(
      {
        id: 'pmo-si-1',
        items: [{ item_code: 'SPIKE-ITEM-1', qty: 2, rate: 75000 }],
      },
      CTX,
    );
    expect(body).toEqual({
      customer: 'Spike Customer',
      items: [{ item_code: 'SPIKE-ITEM-1', qty: 2, rate: 75000 }],
      project: 'PROJ-0001',
    });
    // OQ-SAR-1 #1: income_account and debit_to are server-derived, NOT in body
    expect((body as Record<string, unknown>).income_account).toBeUndefined();
    expect((body as Record<string, unknown>).debit_to).toBeUndefined();
  });

  it('siToBody omits project when ctx.refs.project is null (gate OFF / inbound-adopted)', () => {
    const body = siToBody(
      { id: 'pmo-si-2', items: [{ item_code: 'X', qty: 1, rate: 100 }] },
      CTX_NO_PROJECT,
    );
    expect(body).toEqual({
      customer: 'Spike Customer',
      items: [{ item_code: 'X', qty: 1, rate: 100 }],
    });
    expect((body as Record<string, unknown>).project).toBeUndefined();
  });

  it('siToBody throws commit-rejected on empty/missing items (R9-P3a-7: 500 TypeError guard)', () => {
    expect(() => siToBody({ id: 'pmo-si-3', items: [] }, CTX)).toThrow('Sales Invoice requires at least one line item');
    expect(() => siToBody({ id: 'pmo-si-4' }, CTX)).toThrow('Sales Invoice requires at least one line item');
  });

  it('siFromDoc mirrors grand_total/outstanding_amount/po_no as the money oracle (ADR-0048)', () => {
    const canonical = siFromDoc({
      name: 'ACC-SINV-2026-00001',
      posting_date: '2026-07-14',
      po_no: 'CUST-PO-123',
      grand_total: 150000,
      outstanding_amount: 150000,
      docstatus: 1,
      modified: '2026-07-14 10:00:00.000000',
      amended_from: null,
    });
    expect(canonical).toMatchObject({
      id: 'ACC-SINV-2026-00001',
      si_number: 'ACC-SINV-2026-00001',
      invoice_date: '2026-07-14',
      reference_number: 'CUST-PO-123',
      amount: '150000.00',
      erp_outstanding_amount: '150000.00',
      erp_docstatus: 1,
      erp_modified: '2026-07-14 10:00:00.000000',
      erp_amended_from: null,
    });
  });

  it('#478 siFromDoc mirrors the doc currency and the header tax facts (never a PMO constant)', () => {
    const canonical = siFromDoc({
      name: 'ACC-SINV-2026-00003',
      posting_date: '2026-08-19',
      grand_total: 111000,
      outstanding_amount: 111000,
      currency: 'IDR',
      total_taxes_and_charges: 11000,
      taxes_and_charges: 'Indonesia PPN 11% - RIS',
      docstatus: 1,
      modified: '2026-08-19 10:00:00.000000',
      amended_from: null,
    });
    expect(canonical).toMatchObject({
      currency: 'IDR',
      tax_amount: '11000.00',
      tax_template: 'Indonesia PPN 11% - RIS',
    });
    // tax_rate is deliberately NOT derived: the per-rate breakdown is on the `taxes` CHILD table and a
    // computed rate would be a PMO-invented money figure (ADR-0048).
    expect(canonical.tax_rate).toBeUndefined();
  });

  it('#478 SI_FROM_DOC_FIELDS requests every field siFromDoc reads — the sweep cannot silently null the tax facts', () => {
    expect([...SI_FROM_DOC_FIELDS]).toEqual([
      'name', 'modified', 'docstatus', 'amended_from', 'customer', 'posting_date', 'po_no',
      'grand_total', 'outstanding_amount', 'currency', 'total_taxes_and_charges', 'taxes_and_charges', 'due_date', 'project',
    ]);
  });

  it('Luna BLOCK A3: siFromDoc carries the ERP customer name so an inbound-adopted SI resolves customer_id (not NULL)', () => {
    const canonical = siFromDoc({
      name: 'ACC-SINV-2026-00001',
      customer: 'Spike Customer',
      posting_date: '2026-07-14',
      po_no: 'CUST-PO-123',
      grand_total: 150000,
      outstanding_amount: 150000,
      docstatus: 1,
      modified: '2026-07-14 10:00:00.000000',
      amended_from: null,
    });
    expect(canonical).toMatchObject({ customer: 'Spike Customer' });
  });

  it('siFromDoc handles null/undefined optional fields gracefully', () => {
    const canonical = siFromDoc({
      name: 'ACC-SINV-2026-00002',
      posting_date: null,
      po_no: null,
      grand_total: '200000.50',
      outstanding_amount: '100000.25',
      docstatus: 0,
      modified: null,
      amended_from: null,
    });
    expect(canonical).toMatchObject({
      id: 'ACC-SINV-2026-00002',
      invoice_date: null,
      reference_number: null,
      amount: '200000.50',
      erp_outstanding_amount: '100000.25',
      erp_docstatus: 0,
      erp_modified: null,
      erp_amended_from: null,
      customer: null,
    });
  });
});

describe('erpnext/bodies — Incoming Payment / PE-receive (AC-SAR-031: PE-receive money shape)', () => {
  it('peReceiveToBody sends payment_type:Receive, party_type:Customer, BOTH accounts from config, received_amount explicit, references[], NO reference_no', () => {
    const body = peReceiveToBody(
      {
        id: 'pmo-ip-1',
        paid_amount: 150000,
        received_amount: 150000,
        references: [{ reference_doctype: 'Sales Invoice', reference_name: 'ACC-SINV-2026-00001', allocated_amount: 150000 }],
      },
      CTX,
    );
    expect(body).toEqual({
      payment_type: 'Receive',
      party_type: 'Customer',
      party: 'Spike Customer',
      paid_amount: 150000,
      received_amount: 150000,
      paid_from: 'Debtors - PSC', // default_receivable_account
      paid_to: 'Cash - PSC', // default_cash_account (bank fallback not needed here)
      references: [{ reference_doctype: 'Sales Invoice', reference_name: 'ACC-SINV-2026-00001', allocated_amount: 150000 }],
    });
    // OQ-SAR-1 #3: reference_no is PMO-owned anchor — NEVER sent by body
    expect((body as Record<string, unknown>).reference_no).toBeUndefined();
    // OQ-SAR-1 #3: received_amount mandatory even same-currency
    expect((body as Record<string, unknown>).received_amount).toBe(150000);
  });

  it('peReceiveToBody falls back to default_bank_account when default_cash_account is null', () => {
    const ctxNoCash: ErpCtx = {
      refs: { customer: 'Spike Customer' },
      config: {
        default_receivable_account: 'Debtors - PSC',
        default_income_account: 'Sales - PSC',
        default_cash_account: null,
        default_bank_account: 'Bank - PSC',
      },
    };
    const body = peReceiveToBody({ id: 'pmo-ip-2', paid_amount: 100000 }, ctxNoCash);
    expect((body as Record<string, unknown>).paid_to).toBe('Bank - PSC');
  });

  it('peReceiveToBody defaults references to empty array for on-account receipt', () => {
    const body = peReceiveToBody({ id: 'pmo-ip-3', paid_amount: 50000 }, CTX);
    expect((body as Record<string, unknown>).references).toEqual([]);
  });

  it('peReceiveFromDoc mirrors paid_amount/reference_no as the money oracle', () => {
    const canonical = peReceiveFromDoc({
      name: 'ACC-PAY-2026-00060',
      reference_no: 'SAR-PE-ANCHOR-001',
      paid_amount: 150000,
      docstatus: 1,
      modified: '2026-07-14 11:00:00.000000',
      amended_from: null,
    });
    expect(canonical).toMatchObject({
      id: 'ACC-PAY-2026-00060',
      ip_number: 'ACC-PAY-2026-00060',
      reference_number: 'SAR-PE-ANCHOR-001',
      amount: '150000.00',
      erp_docstatus: 1,
      erp_modified: '2026-07-14 11:00:00.000000',
      erp_amended_from: null,
    });
  });

  it('Luna BLOCK A3: peReceiveFromDoc carries customer/posting_date/references so an inbound-adopted PE-receive resolves customer_id + sales_invoice_id (not NULL)', () => {
    const canonical = peReceiveFromDoc({
      name: 'ACC-PAY-2026-00060',
      party: 'Spike Customer',
      posting_date: '2026-07-14',
      reference_no: 'SAR-PE-ANCHOR-001',
      paid_amount: 150000,
      docstatus: 1,
      modified: '2026-07-14 11:00:00.000000',
      amended_from: null,
      references: [{ reference_doctype: 'Sales Invoice', reference_name: 'ACC-SINV-2026-00001', allocated_amount: 150000 }],
    });
    expect(canonical).toMatchObject({
      customer: 'Spike Customer',
      date: '2026-07-14',
      references: [{ reference_doctype: 'Sales Invoice', reference_name: 'ACC-SINV-2026-00001', allocated_amount: 150000 }],
    });
  });

  it('peReceiveFromDoc handles null optional fields', () => {
    const canonical = peReceiveFromDoc({
      name: 'ACC-PAY-2026-00061',
      reference_no: null,
      paid_amount: '75000.00',
      docstatus: 0,
      modified: null,
      amended_from: null,
    });
    expect(canonical).toMatchObject({
      id: 'ACC-PAY-2026-00061',
      reference_number: null,
      amount: '75000.00',
      erp_docstatus: 0,
      erp_modified: null,
      erp_amended_from: null,
      customer: null,
      date: null,
      references: [],
    });
  });
});
describe('erpnext/bodies — #895 manual journal (AC-MJE-004) and its reversal posted as a swapped journal (V-ACD3 pending)', () => {
  const ORIGINAL_ID = '123e4567-e89b-12d3-a456-426614174000';
  const REVERSAL_ID = '223e4567-e89b-12d3-a456-426614174000';
  const JCTX: ErpCtx = { refs: {}, config: { company: 'Test Co' } };
  const original: LedgerJournal = {
    key: journalKey(ORIGINAL_ID), date: '2026-11-10', memo: 'Accrual November',
    lines: [
      { account: 'Rent - TC', debit: '100.00', credit: '0.00', label: 'rent', analytic: 'PROJ-0001' },
      { account: 'Accrued - TC', debit: '0.00', credit: '100.00', label: 'accrual' },
    ],
  };
  const reversal: LedgerJournal = {
    key: journalReversalKey(REVERSAL_ID), date: '2026-12-01', memo: 'Reversal of Accrual November',
    lines: original.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
    reverses: { externalRecordId: 'ACC-JV-2026-00001', reason: 'accrual reversed' },
  };
  const rec = (journal: LedgerJournal, id: string) => ({ id, erp_doc_kind: 'manual-journal', journal });
  type Body = { company: string; voucher_type: string; posting_date: string; title: string; user_remark: string; accounts: Array<Record<string, unknown>> };

  it('AC-MJE-004 a manual journal: debit/credit in account currency per row, the project where set, the key in user_remark', () => {
    const body = manualJournalToBody(rec(original, ORIGINAL_ID), JCTX) as Body;
    expect(body).toEqual({
      company: 'Test Co', voucher_type: 'Journal Entry', posting_date: '2026-11-10', title: 'Accrual November', user_remark: journalKey(ORIGINAL_ID),
      accounts: [
        { account: 'Rent - TC', debit_in_account_currency: 100, credit_in_account_currency: 0, project: 'PROJ-0001', user_remark: 'rent' },
        { account: 'Accrued - TC', debit_in_account_currency: 0, credit_in_account_currency: 100, user_remark: 'accrual' },
      ],
    });
  });

  it('AC-MJE-001 refuses an unbalanced journal, a partner line (no party type on ERPNext yet) and a missing company, before any write', () => {
    const unbalanced = { ...original, lines: [original.lines[0], { ...original.lines[1], credit: '99.99' }] };
    expect(() => manualJournalToBody(rec(unbalanced, ORIGINAL_ID), JCTX)).toThrow(/does not balance by 0.01/);
    expect(() => manualJournalToBody(rec({ ...original, lines: [{ ...original.lines[0], partner: 'Supplier A' }, original.lines[1]] }, ORIGINAL_ID), JCTX)).toThrow(AdapterError);
    expect(() => manualJournalToBody(rec(original, ORIGINAL_ID), { refs: {}, config: {} })).toThrow(AdapterError);
    expect(() => manualJournalToBody({ id: ORIGINAL_ID, erp_doc_kind: 'manual-journal' }, JCTX)).toThrow(AdapterError);
  });

  it('the reversal is a new manual journal with swapped sides, its own key, and the original named in user_remark', () => {
    const forward = manualJournalToBody(rec(original, ORIGINAL_ID), JCTX) as Body;
    const body = manualJournalReversalToBody(rec(reversal, REVERSAL_ID), JCTX) as Body;
    expect(body.accounts.map((r) => [r.account, r.debit_in_account_currency, r.credit_in_account_currency]))
      .toEqual(forward.accounts.map((r) => [r.account, r.credit_in_account_currency, r.debit_in_account_currency]));
    expect(body.user_remark.startsWith(journalReversalKey(REVERSAL_ID))).toBe(true);
    expect(body.user_remark).toContain('ACC-JV-2026-00001');
    // the original's PMO key never appears: the anchor probe is `like %key%`, so naming it would let the original's recovery adopt the reversal
    expect(JSON.stringify(body)).not.toContain(journalKey(ORIGINAL_ID));
    expect(body.posting_date).toBe('2026-12-01');
    // manualJournalToBody routes a reversal journal to the same body
    expect(manualJournalToBody(rec(reversal, REVERSAL_ID), JCTX)).toEqual(body);
    expect(() => manualJournalReversalToBody(rec(original, ORIGINAL_ID), JCTX)).toThrow(AdapterError);
  });

  it('reads a submitted Journal Entry back as the dispatch result: posted on the ledger\'s own date; anything unsubmitted holds', () => {
    expect(manualJournalFromDoc({ name: 'ACC-JV-2026-00007', docstatus: 1, posting_date: '2026-11-10', modified: 'm' })).toEqual({
      id: 'ACC-JV-2026-00007', status: 'posted', external_record_id: 'ACC-JV-2026-00007', ledger_name: 'ACC-JV-2026-00007', posted_date: '2026-11-10',
      erp_name: 'ACC-JV-2026-00007', erp_docstatus: 1, erp_modified: 'm',
    });
    for (const docstatus of [0, 2]) {
      expect(() => manualJournalFromDoc({ name: 'ACC-JV-1', docstatus, posting_date: '2026-11-10' })).toThrow(expect.objectContaining({ code: 'command-held' }));
    }
  });
});
