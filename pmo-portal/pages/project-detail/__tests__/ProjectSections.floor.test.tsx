import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { renderWithQueryClient } from '@/test/renderWithQueryClient';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';


// Same mock set as ProjectPosition.test.tsx (the overview harness), trimmed to the
// primary state action row under test.
const state = vi.hoisted(() => ({
  role: 'Finance',
  orgDay: '2026-10-27',
  invoices: [] as unknown[],
  invoicesPending: false,
  invoicesError: false,
  finances: null as unknown,
  billing: { contractLines: [] as unknown[] },
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => {
    if (entity === 'salesInvoice' && action === 'create') return ['Admin', 'Executive', 'Finance'].includes(state.role);
    if (entity === 'salesInvoice' && action === 'view') return state.role !== 'Engineer';
    return true;
  },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'viewer-1', org_id: 'org-1' }, role: state.role }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.role }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: state.invoices, isPending: state.invoicesPending, isError: state.invoicesError, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: state.orgDay, isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectFinances', () => ({
  useProjectFinances: () => ({ data: state.finances, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProgressBilling', () => ({
  useProjectBilling: () => ({ data: state.billing, isPending: false, isError: false, refetch: vi.fn() }),
}));

import { PrimaryProjectAction } from '../ProjectSections';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const project = {
  id: 'p1', status: 'Ongoing Project', currency: 'USD', contract_value: 1_000,
  contract_date: '2026-10-10', tax_treatment: null,
} as ProjectWithRefs;

const invoice = {
  id: 'inv-1', status: 'Submitted', invoice_date: '2026-10-01', erp_due_date: '2026-10-20',
  erp_payment_terms_days: 30, erp_outstanding_amount: '50', grand_total: '9999',
};

const SearchProbe = () => <output data-testid="dest">{useLocation().search}</output>;

beforeEach(() => {
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  state.role = 'Finance';
  state.orgDay = '2026-10-27';
  state.invoices = [];
  state.invoicesPending = false;
  state.invoicesError = false;
  state.finances = { remaining_to_invoice: 500 };
  state.billing = { contractLines: [] };
});

describe('ProjectSections floor', () => {
  it('floor: Chase payment opens Receivables filtered to this project\'s overdue invoices', async () => {
    state.invoices = [{ ...invoice, erp_due_date: '2026-10-20', erp_outstanding_amount: '50' }];
    renderWithQueryClient(
      <MemoryRouter initialEntries={['/projects/p1/overview']}>
        <Routes>
          <Route path="/projects/p1/overview" element={<PrimaryProjectAction project={project} isPipeline={false} />} />
          <Route path="/finance/receivables" element={<SearchProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Chase payment' }));
    expect(screen.getByTestId('dest')).toHaveTextContent('?project=p1&overdue=true');
  });
});
