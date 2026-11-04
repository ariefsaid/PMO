import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

const h = vi.hoisted(() => ({
  evidence: { data: { lines: [], contact: null }, isPending: false, isError: false, refetch: vi.fn() },
  payments: { data: [], isError: false },
  commands: { data: [] as unknown[], isError: false },
  creditNotes: { data: [] as unknown[], isPending: false, isError: false },
  connection: { unreachable: false, lastOkAt: null as string | null },
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoiceEvidence: () => h.evidence,
  useIncomingPayments: () => h.payments,
}));
vi.mock('@/src/hooks/useOdooRevenue', () => ({
  useOdooRevenueCommands: () => h.commands,
  useOdooRevenueCreditNotes: () => h.creditNotes,
}));
vi.mock('@/src/hooks/useOdooPurchase', () => ({ useOdooUnreachable: () => h.connection }));

import { SalesInvoiceEvidenceSection } from './SalesInvoiceEvidence';
import { FinanceI18nTestProvider } from '../__tests__/financeI18nTestProvider';

const invoice = (over: Partial<SalesInvoiceRow> = {}) => ({
  id: 'si-1', org_id: 'org-1', project_id: 'p-1', customer_id: 'c-1', customer_name: 'Northwind',
  si_number: 'INV-1', reference_number: null, invoice_date: '2026-11-01', amount: 120, currency: 'IDR',
  tax_treatment: 'inclusive', tax_amount: 0, erp_outstanding_amount: 120, status: 'Unpaid', erp_docstatus: 1,
  erp_modified: null, erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-11-01T00:00:00Z',
  author_user_id: 'u1', author_user_ids: ['u1'], billing_kind: 'contract', erp_payment_terms_days: null,
  erp_due_date: null, received_date: null, pmo_native: false, efaktur_number: null, efaktur_date: null,
  odoo_state: 'posted', odoo_attention: null, odoo_read_at: '2026-11-03T10:00:00Z', ...over,
} as SalesInvoiceRow);

const mount = (inv = invoice()) => render(<FinanceI18nTestProvider><SalesInvoiceEvidenceSection invoice={inv} odoo /></FinanceI18nTestProvider>);

beforeEach(() => {
  h.evidence = { data: { lines: [], contact: null }, isPending: false, isError: false, refetch: vi.fn() };
  h.payments = { data: [], isError: false };
  h.commands = { data: [], isError: false };
  h.creditNotes = { data: [], isPending: false, isError: false };
  h.connection = { unreachable: false, lastOkAt: null };
});
afterEach(cleanup);

describe('AC-OCI-090/091 Sales invoice evidence', () => {
  it('shows the Odoo invoice outcome with its read age and no held tax-document block', () => {
    mount();
    expect(screen.getByText('In Odoo')).toBeInTheDocument();
    expect(screen.getByText(/Read/)).toBeInTheDocument();
    expect(screen.queryByText(/tax document/i)).toBeNull();
  });

  it('shows a held invoice and its next step in plain words', () => {
    h.commands = { data: [{ id: 'c1', recordId: 'si-1', kind: 'sales-invoice', state: 'held', lastError: 'uncertain', updatedAt: '2026-11-03T10:00:00Z', actorUserId: 'u2' }], isError: false };
    mount(invoice({ odoo_state: null, odoo_read_at: null }));
    expect(screen.getByText('Needs a decision')).toBeInTheDocument();
    expect(screen.getByTestId('odoo-outcome-next')).toHaveTextContent(/Admin or Finance/);
    expect(screen.queryByText(/uncertain/)).toBeNull();
  });

  it('keeps the last invoice read visible while the Odoo connection is down', () => {
    h.connection = { unreachable: true, lastOkAt: '2026-11-03T08:00:00Z' };
    mount();
    expect(screen.getByTestId('odoo-unreachable')).toHaveTextContent('Odoo cannot be reached');
    expect(screen.getByText('In Odoo')).toBeInTheDocument();
  });

  it('shows a linked credit note, while a plain invoice remains without that section', async () => {
    h.creditNotes = { data: [{ id: 'cn-1', number: 'CN/2026/2', date: '2026-11-02', currency: 'IDR', amount: -20, status: 'Posted', readAt: '2026-11-03T10:00:00Z' }], isPending: false, isError: false };
    mount();
    expect(screen.getByRole('heading', { name: 'Credit notes' })).toBeInTheDocument();
    expect(screen.getByText('CN/2026/2')).toBeInTheDocument();
    cleanup();
    h.creditNotes = { data: [], isPending: false, isError: false };
    mount(invoice({ pmo_native: true, odoo_state: null, odoo_read_at: null }));
    expect(screen.queryByRole('heading', { name: 'Credit notes' })).toBeNull();
  });

  it('has no axe violations for the invoice outcome and credit note', async () => {
    h.creditNotes = { data: [{ id: 'cn-1', number: 'CN/2026/2', date: '2026-11-02', currency: 'IDR', amount: -20, status: 'Posted', readAt: '2026-11-03T10:00:00Z' }], isPending: false, isError: false };
    const { container } = mount();
    expect((await axe(container)).violations).toEqual([]);
  });
});
