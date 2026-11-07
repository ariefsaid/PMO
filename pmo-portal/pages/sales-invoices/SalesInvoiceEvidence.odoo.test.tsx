import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { clearOwnershipCache, setTaskOwnership } from '@/src/lib/adapterSeam/ownershipCache';

const h = vi.hoisted(() => ({
  evidence: { data: { lines: [], contact: null }, isPending: false, isError: false, refetch: vi.fn() },
  payments: { data: [], isError: false },
  commands: { data: [] as unknown[], isError: false },
  creditNotes: { data: [] as unknown[], isPending: false, isError: false },
  connection: { unreachable: false, lastOkAt: null as string | null },
  evidenceEnabled: [] as boolean[],
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoiceEvidence: (_id: string | undefined, enabled: boolean) => { h.evidenceEnabled.push(enabled); return h.evidence; },
  useIncomingPayments: () => h.payments,
}));
vi.mock('@/src/hooks/useOdooRevenue', () => ({
  useOdooRevenueCommands: () => h.commands,
  useOdooRevenueCreditNotes: () => h.creditNotes,
  useResolveHeldRevenueCommand: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/useOdooPurchase', () => ({
  useOdooUnreachable: () => h.connection,
  useOdooPurchaseCommands: () => ({ data: [], isError: false }),
  useResolveHeldPayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance' }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-me' } }) }));

import { SalesInvoiceEvidenceSection } from './SalesInvoiceEvidence';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';

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
  h.evidenceEnabled = [];
  setTaskOwnership([{ domain: 'revenue', externalTier: 'odoo' }]);
});
afterEach(() => { cleanup(); clearOwnershipCache(); });

describe('AC-OCI-090/091 Sales invoice evidence', () => {
  it('shows the Odoo invoice outcome with its read age and no held-by-Odoo wording', () => {
    mount();
    expect(screen.getByText('In Odoo')).toBeInTheDocument();
    expect(screen.getByText(/Read/)).toBeInTheDocument();
    expect(screen.queryByText(/held by odoo/i)).toBeNull();
  });

  it('with a hand-recorded e-Faktur, says the ERP generates none and the recorded number stands', () => {
    mount(invoice({ efaktur_number: '010.001-26.12345678', efaktur_date: '2026-11-03' }));
    expect(screen.getByText('010.001-26.12345678', { exact: false })).toBeInTheDocument();
    expect(screen.getByTestId('odoo-tax-document')).toHaveTextContent('Odoo generates no tax document. The e-Faktur number recorded above stands.');
    expect(screen.queryByText('Tax documents are unavailable in Odoo.')).toBeNull();
  });

  it('shows a held invoice and its next step in plain words, once', () => {
    h.commands = { data: [{ id: 'c1', recordId: 'si-1', kind: 'sales-invoice', state: 'held', lastError: 'uncertain', updatedAt: '2026-11-03T10:00:00Z', actorUserId: 'u2' }], isError: false };
    mount(invoice({ odoo_state: null, odoo_read_at: null }));
    expect(screen.getAllByText('Needs a decision')).toHaveLength(1);
    expect(screen.getByTestId('odoo-outcome-next')).toHaveTextContent(/Admin or Finance/);
    expect(screen.queryByText(/uncertain/)).toBeNull();
  });

  it('keeps the last invoice read visible while the Odoo connection is down', () => {
    h.connection = { unreachable: true, lastOkAt: '2026-11-03T08:00:00Z' };
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('Odoo is unavailable');
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

describe('AC-OCI-090/091 review fixes', () => {
  it('has no "line details not available" caveat for an Odoo invoice, where there are never ERP lines to fetch', () => {
    mount();
    expect(screen.queryByText('Line details are not available.')).toBeNull();
    expect(screen.queryByText('Invoice lines')).toBeNull();
  });

  it('never asks the ERP evidence read for an Odoo invoice, so no permanent load error shows', () => {
    h.evidence = { data: undefined as never, isPending: false, isError: true, refetch: vi.fn() };
    mount();
    expect(h.evidenceEnabled.every((enabled) => enabled === false)).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Couldn't load the invoice lines/)).toBeNull();
  });

  it('says once that Odoo is unreachable', () => {
    h.connection = { unreachable: true, lastOkAt: '2026-11-03T08:00:00Z' };
    mount();
    expect(screen.getAllByText(/Odoo (cannot be reached|is unavailable)/)).toHaveLength(1);
  });

  it('leaves an unsettled command to the Waiting on Odoo card instead of repeating it here', () => {
    h.commands = { data: [{ id: 'c1', recordId: 'si-1', kind: 'sales-invoice', state: 'held', lastError: null, updatedAt: '2026-11-03T10:00:00Z', actorUserId: 'u2' }], isError: false };
    mount(invoice({ odoo_state: null, odoo_read_at: null }));
    expect(screen.getAllByTestId('odoo-outcome')).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Waiting on Odoo' })).toBeInTheDocument();
  });

  it('explains a flagged invoice and shows the figure PMO sent', () => {
    mount(invoice({ odoo_attention: 'total-mismatch', odoo_sent_total: 100 }));
    expect(screen.getByTestId('odoo-outcome-reason')).toHaveTextContent(/not what PMO sent/);
    expect(screen.getByTestId('odoo-outcome-reason')).toHaveTextContent(/PMO sent.*100/);
  });
});

describe('AC-OCI-082b/083 Tax document absence', () => {
  it('renders the tax document as unavailable in plain words and offers no download control', () => {
    mount();
    expect(screen.getByText('Tax document')).toBeInTheDocument();
    expect(screen.getByText('Tax documents are unavailable in Odoo.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull();
  });
});
