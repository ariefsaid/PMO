import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

const h = vi.hoisted(() => ({
  data: [] as unknown[],
  isError: false,
  isPending: false,
  enabled: [] as boolean[],
  refetch: vi.fn(),
  submit: vi.fn(async (_args: unknown): Promise<void> => undefined),
  userId: 'u-fin2',
  route: 'pmo' as 'pmo' | 'external',
  deny: [] as string[],
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useNativeDraftInvoices: (enabled: boolean) => {
    h.enabled.push(enabled);
    return { data: h.isError ? undefined : h.data, isPending: h.isPending, isError: h.isError, refetch: h.refetch };
  },
  useRevenueMutations: () => ({ submitInvoice: { mutateAsync: h.submit, isPending: false } }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' } }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => h.route) }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: (h.route === 'external' ? [{ id: 'o-1', orgId: 'org-1', externalTier: 'erpnext', domain: 'revenue' }] : []), isError: false }) }));
vi.mock('@/src/auth/usePermission', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/auth/usePermission')>();
  return {
    usePermission: () => {
      const may = real.usePermission();
      return (...args: Parameters<typeof may>) => (h.deny.includes(args[0]) ? false : may(...args));
    },
  };
});
vi.mock('@/src/hooks/useFkOptions', () => ({
  useInvoiceProjectOptions: () => ({ data: [{ value: 'proj-1', label: 'Alpha Platform', clientId: 'cust-1', subjectToVat: true, taxRate: 12, archived: false }] }),
}));
vi.mock('@/src/hooks/useTasks', () => ({
  useAssignableProfiles: () => ({ data: [{ id: 'u-fin1', full_name: 'Fina Author' }] }),
}));
vi.mock('@/src/hooks/useCommandIntent', () => ({
  useCommandIntentMap: () => ({ intentFor: () => ({ id: 'i-1', idempotencyKey: 'k-1' }), release: vi.fn() }),
}));

import { SalesInvoiceApprovalSection } from './SalesInvoiceApprovalSection';
import { FinanceI18nTestProvider } from '../__tests__/financeI18nTestProvider';
import { MemoryRouter } from 'react-router';
import { within } from '@testing-library/react';

const draft = (over: Partial<SalesInvoiceRow> = {}): SalesInvoiceRow => ({
  id: 'si-n1', org_id: 'org-1', project_id: 'proj-1', customer_id: 'cust-1', customer_name: 'Acme Energy',
  si_number: null, pmo_number: null, pmo_native: true, reference_number: 'PO-77', invoice_date: null,
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
      <MemoryRouter>
        <ToastProvider>
          <SalesInvoiceApprovalSection />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>
  </FinanceI18nTestProvider>,
);

beforeEach(() => {
  h.data = [draft()];
  h.isError = false;
  h.isPending = false;
  h.enabled = [];
  h.refetch.mockClear();
  h.submit.mockReset();
  h.submit.mockResolvedValue(undefined);
  h.userId = 'u-fin2';
  h.route = 'pmo';
  h.deny = [];
});

const region = () => screen.getByRole('region', { name: 'Customer invoices awaiting you' });
async function expand(user: ReturnType<typeof userEvent.setup>, customer = 'Acme Energy') {
  await user.click(within(region()).getByRole('button', { name: `Show invoice details for ${customer}` }));
}

describe('SalesInvoiceApprovalSection (#784)', () => {
  it('shows loading instead of hiding the section while invoices are pending', () => {
    h.isPending = true;
    renderSection();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('AC-NAR-002 lists a PMO draft the viewer did not raise, and approving it calls the approve path', async () => {
    const user = userEvent.setup();
    renderSection();
    expect(region()).toHaveTextContent('Site survey');
    await expand(user);
    await user.click(within(region()).getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Approve invoice' }));
    expect(h.submit).toHaveBeenCalledWith({ siId: 'si-n1', intent: { id: 'i-1', idempotencyKey: 'k-1' } });
  });
  it('AC-NAR-002 (I-1) the approver sees the whole invoice before Approve — never approves blind', async () => {
    h.data = [draft({ native_lines: [
      { item_code: 'SVC', description: 'Site survey', qty: 2, rate: 400_000, amount: 800_000 },
      { item_code: 'TRV', description: null, qty: 1, rate: 200_000, amount: 200_000 },
    ] })];
    const user = userEvent.setup();
    renderSection();
    // Collapsed: no Approve is reachable until the invoice is open.
    expect(within(region()).queryByRole('button', { name: 'Approve' })).toBeNull();
    const toggle = within(region()).getByRole('button', { name: 'Show invoice details for Acme Energy' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expand(user);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    const p = within(panel);
    expect(p.getByRole('link', { name: /Alpha Platform/ })).toHaveAttribute('href', '/projects/proj-1');
    expect(panel).toHaveTextContent('Acme Energy');
    expect(panel).toHaveTextContent('PO-77');
    expect(panel).toHaveTextContent('Fina Author');
    const lines = p.getByRole('list', { name: 'Line items' });
    expect(within(lines).getAllByRole('listitem')).toHaveLength(2);
    expect(lines).toHaveTextContent(/Site survey.*SVC.*2 × .*400,000\.00.*800,000\.00/);
    expect(lines).toHaveTextContent(/TRV.*1 × .*200,000\.00/);
    expect(p.getByText('Net (before tax)').closest('div')).toHaveTextContent(/1,000,000\.00/);
    expect(p.getByText('Tax').closest('div')).toHaveTextContent(/110,000\.00/);
    expect(p.getByText('Total due').closest('div')).toHaveTextContent(/1,110,000\.00/);
    expect(p.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });
  it('AC-NAR-002 (M-8) the heading is an /approvals section heading with the count', () => {
    renderSection();
    expect(within(region()).getByRole('heading', { level: 2, name: 'Customer invoices awaiting you (1)' })).toBeInTheDocument();
  });
  it('AC-NAR-002 (M-4) a long customer name truncates and keeps the full name as a tooltip', () => {
    const long = 'A Very Long Customer Company Name That Will Not Fit On A Phone Screen Pty';
    h.data = [draft({ customer_name: long })];
    renderSection();
    expect(within(region()).getByTitle(long)).toHaveClass('truncate');
  });
  it('AC-NAR-002 the section gates on the approve (transition) permission, not on create', () => {
    h.deny = ['transition'];
    renderSection();
    expect(screen.queryByRole('region', { name: 'Customer invoices awaiting you' })).toBeNull();
    expect(h.enabled.every((e) => e === false)).toBe(true);
  });
  it('AC-NAR-004 a refusal because the ERP now owns revenue reads as a plain headline', async () => {
    const { AppError } = await import('@/src/lib/appError');
    h.submit.mockRejectedValue(new AppError('an ERP owns revenue for this org', 'erp-owns-revenue'));
    const user = userEvent.setup();
    renderSection();
    await expand(user);
    await user.click(within(region()).getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Approve invoice' }));
    expect(await screen.findByText('The connected ERP now raises and settles invoices')).toBeInTheDocument();
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
    await expand(user);
    await user.click(within(region()).getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Approve invoice' }));
    expect(await findToastAnnouncement('alert', /approver must differ from author/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Customer invoices awaiting you' })).toHaveTextContent('Site survey');
  });
});
