import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

const h = vi.hoisted(() => ({
  data: [] as unknown[],
  isError: false,
  enabled: [] as boolean[],
  refetch: vi.fn(),
  submit: vi.fn(async (_args: unknown): Promise<void> => undefined),
  userId: 'u-fin2',
  route: 'pmo' as 'pmo' | 'external',
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useNativeDraftInvoices: (enabled: boolean) => {
    h.enabled.push(enabled);
    return { data: h.isError ? undefined : h.data, isPending: false, isError: h.isError, refetch: h.refetch };
  },
  useRevenueMutations: () => ({ submitInvoice: { mutateAsync: h.submit, isPending: false } }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' } }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => h.route) }));
vi.mock('@/src/hooks/useCommandIntent', () => ({
  useCommandIntentMap: () => ({ intentFor: () => ({ id: 'i-1', idempotencyKey: 'k-1' }), release: vi.fn() }),
}));

import { SalesInvoiceApprovalSection } from './SalesInvoiceApprovalSection';
import { FinanceI18nTestProvider } from '../__tests__/financeI18nTestProvider';

const draft = (over: Partial<SalesInvoiceRow> = {}): SalesInvoiceRow => ({
  id: 'si-n1', org_id: 'org-1', project_id: 'proj-1', customer_id: 'cust-1', customer_name: 'Acme Energy',
  si_number: null, pmo_number: null, pmo_native: true, reference_number: null, invoice_date: null,
  amount: 1_000_000, currency: 'IDR', tax_treatment: 'exclusive', tax_amount: 110_000, tax_rate: 12,
  tax_base_numerator: 11, tax_base_denominator: 12, erp_outstanding_amount: null, status: 'Draft',
  erp_docstatus: null, erp_modified: null, erp_amended_from: null, erp_cancelled_at: null,
  created_at: '2026-10-07T00:00:00Z', author_user_id: 'u-fin1', author_user_ids: ['u-fin1'],
  erp_payment_terms_days: null, erp_due_date: null, received_date: null,
  native_lines: [{ item_code: 'SVC', description: 'Site survey', qty: 2, rate: 500_000, amount: 1_000_000 }], ...over,
}) as SalesInvoiceRow;

const renderSection = (role: Role = 'Finance') => render(
  <FinanceI18nTestProvider>
    <ImpersonationProvider realRole={role}>
      <ToastProvider>
        <SalesInvoiceApprovalSection />
      </ToastProvider>
    </ImpersonationProvider>
  </FinanceI18nTestProvider>,
);

beforeEach(() => {
  h.data = [draft()];
  h.isError = false;
  h.enabled = [];
  h.refetch.mockClear();
  h.submit.mockReset();
  h.submit.mockResolvedValue(undefined);
  h.userId = 'u-fin2';
  h.route = 'pmo';
});

describe('SalesInvoiceApprovalSection (#784)', () => {
  it('AC-NAR-002 lists a PMO draft the viewer did not raise, and approving it calls the approve path', async () => {
    const user = userEvent.setup();
    renderSection();
    expect(screen.getByRole('region', { name: 'Customer invoices awaiting you' })).toHaveTextContent('Site survey');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Approve invoice' }));
    expect(h.submit).toHaveBeenCalledWith({ siId: 'si-n1', intent: { id: 'i-1', idempotencyKey: 'k-1' } });
  });
  it('AC-NAR-002 the author never sees their own draft here', () => {
    h.userId = 'u-fin1';
    renderSection();
    expect(screen.queryByRole('region', { name: 'Customer invoices awaiting you' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
  it('AC-NAR-002 a Project Manager sees nothing — approval is Admin and Finance', () => {
    renderSection('Project Manager');
    expect(screen.queryByRole('region', { name: 'Customer invoices awaiting you' })).toBeNull();
    expect(h.enabled.every((e) => e === false)).toBe(true);
  });
  it('AC-NAR-004 once an ERP owns revenue the section shows nothing', () => {
    h.route = 'external';
    renderSection();
    expect(screen.queryByRole('region', { name: 'Customer invoices awaiting you' })).toBeNull();
    expect(h.enabled.every((e) => e === false)).toBe(true);
  });
  it('AC-NAR-002 the heading counts the drafts awaiting the viewer, and the row shows the customer and amount', () => {
    h.data = [draft(), draft({ id: 'si-n2', customer_name: 'Borealis Marine', author_user_id: 'u-fin1' })];
    renderSection();
    const region = screen.getByRole('region', { name: 'Customer invoices awaiting you' });
    expect(region).toHaveTextContent('Customer invoices awaiting you (2)');
    expect(region).toHaveTextContent('Acme Energy');
    expect(region).toHaveTextContent(/1,000,000/);
  });
  it('AC-NAR-002 a failed read says so (never a false "nothing waiting") and offers a retry', async () => {
    h.isError = true;
    const user = userEvent.setup();
    renderSection();
    expect(screen.getByText("Couldn't load invoices awaiting you")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(h.refetch).toHaveBeenCalled();
  });
  it('AC-NAR-002 a server refusal (approver must differ from author) is shown and the draft stays listed', async () => {
    const { AppError } = await import('@/src/lib/appError');
    h.submit.mockRejectedValue(new AppError('approver must differ from author (SoD)', '42501'));
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Approve invoice' }));
    expect(await screen.findByText(/approver must differ from author/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Customer invoices awaiting you' })).toHaveTextContent('Site survey');
  });
});
