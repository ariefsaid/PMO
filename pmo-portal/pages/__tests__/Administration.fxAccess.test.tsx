import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Role } from '@/src/auth/AuthContext';

const state = vi.hoisted(() => ({
  role: 'Finance' as Role,
  operator: false,
  pending: false,
  error: false,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    currentUser: { id: 'synthetic-user', org_id: 'synthetic-org', role: state.role },
    role: state.role,
  }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: state.role, effectiveRole: state.role }),
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => {
    if (entity === 'fxRate' && action === 'view')
      return state.role === 'Finance' || state.role === 'Admin';
    if (entity === 'user' && action === 'view')
      return state.role === 'Executive' || state.role === 'Admin';
    return false;
  },
}));
vi.mock('@/src/auth/useIsOperator', () => ({
  useOperatorMembership: () => ({
    isOperator: state.operator && !state.error,
    isPending: state.pending,
    isError: state.error,
    retry: vi.fn(),
  }),
  useIsOperator: () => state.operator && !state.error,
}));
vi.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => ({ data: [], isPending: false, isError: false }),
  useUserMutations: () => ({}),
}));
vi.mock('@/src/hooks/useUsage', () => ({
  useUsage: () => ({ data: [], isPending: false, isError: false }),
  useAgentRunStats: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: {} }) }));
vi.mock('../AdministrationExchangeRates', () => ({
  default: () => <div>Exchange rates panel</div>,
}));

import Administration from '../Administration';

function Location() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}
function renderPage(path: string, role: Role, operator = false, pending = false, error = false) {
  state.role = role;
  state.operator = operator;
  state.pending = pending;
  state.error = error;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <Administration />
                <Location />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

describe('AC-FX-010 Administration access', () => {
  it('Finance lands on FX only and settled operator status does not gate it', async () => {
    renderPage('/administration/exchange-rates', 'Finance', false, true);
    expect(await screen.findByTestId('administration-panel-exchange-rates')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Exchange rates' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByText(/Checking your Administration access/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('administration-panel-users')).not.toBeInTheDocument();
  });

  it('Finance cannot reach other Administration panels or use their route to mount them', () => {
    renderPage('/administration/accounting', 'Finance');
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument();
    expect(screen.queryByTestId('administration-panel-accounting')).not.toBeInTheDocument();
    expect(screen.queryByTestId('administration-panel-exchange-rates')).not.toBeInTheDocument();
  });

  it.each([
    ['Executive', false],
    ['Engineer', false],
    ['Engineer', true],
  ] as const)('%s cannot reach FX, even with operator=%s', async (role, operator) => {
    renderPage('/administration/exchange-rates', role, operator);
    await waitFor(() =>
      expect(
        screen.getByText(/don't have access|Operator-only access|Exchange rates are available/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('administration-panel-exchange-rates')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Exchange rates' })).not.toBeInTheDocument();
  });

  it('Finance FX page is independent of operator membership errors', async () => {
    renderPage('/administration/exchange-rates', 'Finance', false, false, true);
    expect(await screen.findByTestId('administration-panel-exchange-rates')).toBeInTheDocument();
    expect(screen.queryByText('Could not verify access')).not.toBeInTheDocument();
  });
});
