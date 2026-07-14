/**
 * AC-SAR-030/031 — erpnext/bodies.test.ts: unit tests for the spike-frozen
 * salesInvoice + incomingPayment body maps. Proves the exact field shapes
 * sent to ERPNext and the canonical PMO shapes returned from ERP docs.
 */
import { describe, expect, it } from 'vitest';
import { siToBody, siFromDoc } from './bodies/salesInvoice.ts';
import { peReceiveToBody, peReceiveFromDoc } from './bodies/incomingPayment.ts';
import type { ErpCtx } from './doctypeRegistry.ts';

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
    });
  });
});