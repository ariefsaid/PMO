import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Role } from '@/src/auth/AuthContext';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

const { roleState, operatorState, listState, mutations, panelMounts } = vi.hoisted(() => ({
  roleState: { value: 'Admin' as Role },
  operatorState: { value: false, pending: false },
  listState: {
    data: [
      {
        id: 'self-admin',
        full_name: 'Org Admin',
        email: 'admin@example.com',
        role: 'Admin',
        manager_id: null,
        org_id: 'org-1',
        status: 'active',
      },
    ] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutations: {
    updateRole: { mutateAsync: vi.fn(), isPending: false },
    assignManager: { mutateAsync: vi.fn(), isPending: false },
    invite: { mutateAsync: vi.fn(), isPending: false },
    setStatus: { mutateAsync: vi.fn(), isPending: false },
  },
  panelMounts: {
    integrations: 0,
    accounting: 0,
    credits: 0,
    usage: 0,
    features: 0,
  },
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    currentUser: { id: 'self-admin', org_id: 'org-1' },
    role: roleState.value,
  }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    realRole: roleState.value,
    effectiveRole: roleState.value,
    canImpersonate: false,
    viewAs: vi.fn(),
  }),
  useOptionalRealRole: () => roleState.value,
  ImpersonationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/src/auth/useIsOperator', () => ({
  useIsOperator: () => operatorState.value,
  useOperatorMembership: () => ({
    isOperator: operatorState.value,
    isPending: operatorState.pending,
    isError: false,
  }),
}));
vi.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => listState,
  useUserMutations: () => mutations,
}));
vi.mock('@/src/hooks/useUsage', () => ({
  useUsage: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useAgentRunStats: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: {} }),
}));

// The shell owns route selection. These child doubles make mount isolation observable without
// changing any of the existing panel contracts or hiding their query behavior behind assertions.
vi.mock('./AdministrationCredits', () => ({
  default: () => {
    panelMounts.credits += 1;
    return <div>Credits panel</div>;
  },
}));
vi.mock('./AdministrationUsage', () => ({
  AdministrationUsage: () => {
    panelMounts.usage += 1;
    return <div>Usage panel</div>;
  },
  default: () => {
    panelMounts.usage += 1;
    return <div>Usage panel</div>;
  },
}));
vi.mock('./AdministrationFeatures', () => ({
  default: () => {
    panelMounts.features += 1;
    return <div>Features panel</div>;
  },
}));
vi.mock('@/src/components/integrations/IntegrationsView', () => ({
  IntegrationsView: () => {
    panelMounts.integrations += 1;
    return <div>Organization integrations panel</div>;
  },
  default: () => {
    panelMounts.integrations += 1;
    return <div>Organization integrations panel</div>;
  },
}));
vi.mock('./admin/OrgTaxDefault', () => ({ default: () => <div>Tax default panel</div> }));
vi.mock('./admin/BudgetAccountMap', () => ({ default: () => {
  panelMounts.accounting += 1;
  return <div>Budget account map panel</div>;
} }));
vi.mock('@/src/components/admin/AgentCostMetrics', () => ({
  AgentCostMetrics: () => <div>Agent cost metrics</div>,
}));

import Administration from './Administration';

const LocationProbe: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location">
        {location.pathname}
        {location.hash}
      </output>
      <button type="button" onClick={() => navigate(-1)}>
        Browser back
      </button>
      <button type="button" onClick={() => navigate(1)}>
        Browser forward
      </button>
    </>
  );
};

const ShellHarness: React.FC<{ path: string }> = ({ path }) => {
  const [queryClient] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ImpersonationProvider realRole={roleState.value}>
        <MemoryRouter initialEntries={[path]}>
          <ToastProvider>
            <Routes>
              <Route
                path="*"
                element={
                  <>
                    <Administration />
                    <LocationProbe />
                  </>
                }
              />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>
  );
};

const renderShell = (path: string, role: Role = 'Admin', isOperator = false, pending = false) => {
  roleState.value = role;
  operatorState.value = isOperator;
  operatorState.pending = pending;
  return render(<ShellHarness path={path} />);
};

beforeEach(() => {
  roleState.value = 'Admin';
  operatorState.value = false;
  operatorState.pending = false;
  panelMounts.integrations = 0;
  panelMounts.accounting = 0;
  panelMounts.credits = 0;
  panelMounts.usage = 0;
  panelMounts.features = 0;
  listState.isPending = false;
  listState.isError = false;
});

afterEach(() => cleanup());

describe('Administration route-backed shell', () => {
  it('AC-ADMIA-001/002: an org Admin starts on Users with only the Users panel mounted', async () => {
    renderShell('/administration');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/administration/users'));
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.getByTestId('administration-panel-users')).toBeInTheDocument();
    expect(screen.queryByTestId('administration-panel-integrations')).not.toBeInTheDocument();
    expect(screen.queryByTestId('administration-panel-accounting')).not.toBeInTheDocument();
    expect(screen.queryByTestId('administration-panel-credits')).not.toBeInTheDocument();
    expect(screen.queryByTestId('administration-panel-usage')).not.toBeInTheDocument();
    expect(screen.queryByTestId('administration-panel-features')).not.toBeInTheDocument();
    expect(panelMounts.integrations).toBe(0);
    expect(panelMounts.accounting).toBe(0);
    expect(panelMounts.credits).toBe(0);
    expect(panelMounts.usage).toBe(0);
    expect(panelMounts.features).toBe(0);
  });

  it('AC-ADMIA-002: an Operator sees all six destinations and only mounts the requested panel', async () => {
    const usageView = renderShell('/administration/usage', 'Admin', true);

    await waitFor(() => expect(screen.getByTestId('administration-panel-usage')).toBeInTheDocument());
    expect(screen.getAllByRole('link')).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'Usage' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByTestId('administration-panel-users')).not.toBeInTheDocument();
    expect(screen.queryByTestId('administration-panel-features')).not.toBeInTheDocument();
    expect(panelMounts.usage).toBeGreaterThan(0);
    expect(panelMounts.features).toBe(0);
    usageView.unmount();

    renderShell('/administration/features', 'Admin', true);
    await waitFor(() => expect(screen.getByTestId('administration-panel-features')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Features' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByTestId('administration-panel-users')).not.toBeInTheDocument();
    expect(screen.queryByTestId('administration-panel-usage')).not.toBeInTheDocument();
    expect(panelMounts.features).toBeGreaterThan(0);
  });

  it('AC-ADMIA-002: a non-Operator direct Usage or Features URL is denied without mounting its panel', async () => {
    for (const section of ['usage', 'features']) {
      const view = renderShell(`/administration/${section}`, 'Admin', false);
      expect(await screen.findByRole('alert')).toHaveTextContent(/Operator-only/i);
      expect(screen.queryByTestId(`administration-panel-${section}`)).not.toBeInTheDocument();
      expect(section === 'usage' ? panelMounts.usage : panelMounts.features).toBe(0);
      view.unmount();
    }
  });

  it('AC-ADMIA-005: an Executive still gets the existing read-only Users directory notice', () => {
    renderShell('/administration/users', 'Executive');

    expect(screen.getByText(/only an Admin can add, edit, or disable users/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /invite user/i })).not.toBeInTheDocument();
  });

  it('AC-ADMIA-003: an unknown section is replaced with Users', async () => {
    renderShell('/administration/unknown');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/administration/users'));
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('administration-panel-users')).toBeInTheDocument();
  });

  it('AC-ADMIA-003: the historical budget-map fragment redirects to Accounting and preserves the target', async () => {
    renderShell('/administration#budget-account-map');

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/administration/accounting#budget-account-map',
      ),
    );
    expect(screen.getByRole('link', { name: 'Accounting setup' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('administration-panel-accounting')).toBeInTheDocument();
    expect(screen.getByText('Budget account map panel')).toBeInTheDocument();
  });

  it('AC-ADMIA-004: Back and Forward restore the URL, selected link, and mounted panel', async () => {
    const user = userEvent.setup();
    renderShell('/administration/users');

    await user.click(screen.getByRole('link', { name: 'Credits' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/administration/credits');
    expect(screen.getByRole('link', { name: 'Credits' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('administration-panel-credits')).toBeInTheDocument();
    expect(screen.queryByTestId('administration-panel-users')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Browser back' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/administration/users');
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('administration-panel-users')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Browser forward' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/administration/credits');
    expect(screen.getByTestId('administration-panel-credits')).toBeInTheDocument();
  });

  it('AC-ADMIA-002: an Operator-only direct URL stays pending while membership resolves', async () => {
    const view = renderShell('/administration/usage', 'Engineer', false, true);
    expect(screen.getByText(/checking your Administration access/i)).toBeInTheDocument();
    expect(screen.queryByTestId('administration-panel-usage')).not.toBeInTheDocument();

    operatorState.pending = false;
    operatorState.value = true;
    view.rerender(<ShellHarness path="/administration/usage" />);
    // The route must become available after the membership result settles; it must not have
    // committed a transient denial that survives the positive result.
    await waitFor(() => expect(screen.getByTestId('administration-panel-usage')).toBeInTheDocument());
  });
});
