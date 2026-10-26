import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const h = vi.hoisted(() => ({
  orgId: 'org-A' as string | null,
  realRole: 'Finance',
  canViewFinance: true,
  getProjectFinances: vi.fn(),
  mutations: {
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: h.orgId ? { id: 'user', org_id: h.orgId } : null, role: h.realRole }),
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => h.canViewFinance,
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    realRole: h.realRole,
    effectiveRole: h.realRole === 'Admin' ? 'Engineer' : h.realRole,
    canImpersonate: false,
    viewAs: vi.fn(),
  }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { revenue: { getProjectFinances: h.getProjectFinances } },
}));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/src/components/fx/FxEquivalent', () => ({ default: () => null }));
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 0, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProjectVatEditability', () => ({
  useProjectVatEditability: () => ({
    data: { eligible: false, reason: null, hasInvoices: false },
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({
    archive: h.mutations.archive,
    remove: h.mutations.remove,
    setContractValue: h.mutations.setContractValue,
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
  }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
}));

import ProjectDetailHeader from '../ProjectDetailHeader';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';

const projectForStatus = (status: string): ProjectWithRefs => ({
  id: `11111111-1111-4111-8111-${status.toLowerCase().replaceAll(/[^a-z]/g, '').padEnd(12, '0').slice(0, 12)}`,
  name: 'Sample project',
  status,
  currency: 'USD',
  contract_value: 100,
  budget: 100,
  tax_treatment: 'exclusive',
  client_id: null,
  project_manager_id: null,
}) as unknown as ProjectWithRefs;

function renderHeader(status: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <ProjectDetailHeader
            project={projectForStatus(status)}
          />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  h.orgId = 'org-A';
  h.realRole = 'Finance';
  h.canViewFinance = true;
  h.getProjectFinances.mockReset().mockImplementation(async (projectId: string) => ({
    project_id: projectId,
    contract_invoiced: '0.00',
    remaining_to_invoice: '100.00',
    invoices: [],
    budget: null,
    actuals: {
      currency: 'USD',
      as_of: null,
      total: '0.00',
      excludes_restricted_rows: false,
      categories: [{ category: 'Labor', mapped: true, amount: '0.00' }],
    },
  }));
});

describe('ProjectDetailHeader finance query demand', () => {
  it.each(['Leads', 'Loss Tender', 'Ongoing Project', 'Internal Project'])('AC-PMP-004 keeps finance reads out of the %s identity header', (status) => {
    renderHeader(status);

    expect(h.getProjectFinances).not.toHaveBeenCalled();
  });

  it('AC-PMP-004 keeps finance reads out of the identity header for Engineer too', () => {
    h.realRole = 'Engineer';
    renderHeader('Ongoing Project');

    expect(h.getProjectFinances).not.toHaveBeenCalled();
  });
});
