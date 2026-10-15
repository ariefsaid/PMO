import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const h = vi.hoisted(() => ({
  role: 'Admin',
  currency: { currency: 'IDR', isResolved: true, isError: false },
  rate: {
    data: { rate: 16300, rate_date: '2026-10-09' },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  calls: [] as unknown[][],
  projectMutations: {
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'user-1', org_id: 'org-1' }, loading: false }),
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) =>
    entity === 'project' && h.role === 'Admin' && action !== 'delete',
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }),
}));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => h.currency }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: (enabled: boolean) => ({
    day: enabled ? '2026-10-12' : null,
    isPending: false,
    isError: false,
    retry: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useFxRates', () => ({
  useFxRate: (...args: unknown[]) => {
    h.calls.push(args);
    return h.rate;
  },
  useFxRateMutations: () => ({ upsert: { mutateAsync: vi.fn(), isPending: false } }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => h.projectMutations,
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 100, isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetVersions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectVatEditability', () => ({
  useProjectVatEditability: () => ({
    data: { eligible: true, reason: null, hasInvoices: false },
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectDrawdown: () => ({ data: null, isPending: true, isError: false, refetch: vi.fn() }),
}));

import ProjectDetailHeader from '../ProjectDetailHeader';
import OverviewTab from '../tabs/OverviewTab';

const project = (overrides: Partial<ProjectWithRefs> = {}): ProjectWithRefs =>
  ({
    id: 'project-1',
    org_id: 'org-1',
    name: 'USD Fit-out',
    code: 'P-101',
    status: 'Ongoing Project',
    client_id: 'client-1',
    project_manager_id: 'user-1',
    contract_value: 100,
    currency: 'USD',
    budget: 0,
    spent: 0,
    start_date: null,
    end_date: null,
    contract_date: '2026-10-10',
    customer_contract_ref: 'PO-101',
    tax_treatment: 'exclusive',
    tax_amount: 0,
    subject_to_vat: false,
    tax_rate: null,
    tax_base_numerator: 1,
    tax_base_denominator: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    client: { id: 'client-1', name: 'Client' },
    pm: { id: 'user-1', full_name: 'PM' },
    ...overrides,
  }) as ProjectWithRefs;

function renderSubject(child: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>{child}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.role = 'Admin';
  h.currency = { currency: 'IDR', isResolved: true, isError: false };
  h.rate = {
    data: { rate: 16300, rate_date: '2026-10-09' },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
  h.calls = [];
  Object.values(h.projectMutations).forEach((mutation) => {
    mutation.mutateAsync.mockReset();
    mutation.isPending = false;
  });
});
afterEach(() => cleanup());

describe('AC-FX-011 project contract equivalent', () => {
  it('renders a header equivalent using the contract date while naming the selected publication date; tax basis and editing remain', () => {
    renderSubject(<ProjectDetailHeader project={project()} committedSpend={10} />);
    expect(screen.getAllByTestId('stat-tile')[0]?.querySelector('.sr-only')).toHaveTextContent(
      '≈ Rp 1,630,000 (JISDOR 2026-10-09)',
    );
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toEqual(['USD', 'IDR', '2026-10-10', true]);
    expect(screen.getByTestId('contract-tile-tax-basis')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit contract value' }));
    expect(screen.getByLabelText('Contract value')).toBeInTheDocument();
  });

  it('shows the same contract equivalent in the Engineer overview without adding one to the other finance figures', () => {
    h.role = 'Engineer';
    const p = project();
    renderSubject(<OverviewTab project={p} committedSpend={10} showFinanceSummary />);
    expect(screen.getByTestId('financial-summary')).toHaveTextContent(
      /≈ Rp 1,630,000 \(JISDOR 2026-10-09\)/,
    );
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toEqual(['USD', 'IDR', '2026-10-10', true]);
  });

  it('shows a missing contract-date state and never offers an IDR-to-IDR equivalent', () => {
    renderSubject(
      <ProjectDetailHeader project={project({ contract_date: null })} committedSpend={10} />,
    );
    expect(screen.getByText(/No publication date is available/i)).toBeInTheDocument();
    expect(h.calls.at(-1)?.[3]).toBe(false);
    cleanup();
    h.calls = [];
    renderSubject(
      <ProjectDetailHeader project={project({ currency: 'IDR' })} committedSpend={10} />,
    );
    expect(screen.queryByText(/JISDOR/)).not.toBeInTheDocument();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.[3]).toBe(false);
  });
});
