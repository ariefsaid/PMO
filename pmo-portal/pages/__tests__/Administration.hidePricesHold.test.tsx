/** DD-R1125-16: the owner released the price setting; it belongs to an always-listed Administration section. */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

const access = vi.hoisted(() => ({ canManageAccounting: true, clearanceEnabled: false }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, subject: string) => action === 'manage' && subject === 'orgAccounting' ? access.canManageAccounting : true,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'fixture-admin', org_id: 'fixture-org' }, role: 'Admin' }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({
  useIsOperator: () => false,
  useOperatorMembership: () => ({ isOperator: false, isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useOrgSwitch', () => ({
  useOrgSwitch: (key: string) => ({ data: key === 'clearance' ? access.clearanceEnabled : false }),
  useModuleOn: () => true,
  useSetOrgSwitch: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null }),
}));
vi.mock('@/src/lib/repositories/hidePrices', () => ({
  hidePricesRepository: { getEnabled: vi.fn().mockResolvedValue(false), setEnabled: vi.fn().mockResolvedValue(undefined), getMaySee: vi.fn().mockResolvedValue(true) },
}));
vi.mock('../admin/Clearance', () => ({ default: () => <div>Clearance panel</div> }));
vi.mock('../admin/LeaveRequestsSetting', () => ({ default: () => <div>Leave requests panel</div> }));

import Administration from '../Administration';

afterEach(() => {
  cleanup();
  access.canManageAccounting = true;
  access.clearanceEnabled = false;
});

function renderAdministration(role: 'Admin' | 'Executive') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ImpersonationProvider realRole={role}>
        <MemoryRouter initialEntries={['/administration/accounting']}>
          <ToastProvider>
            <Administration />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
}

describe('Administration — hide prices setting release (#2790)', () => {
  it.each([false, true])('shows the hide-prices card to an Admin in Accounting when Clearance is %s', async (clearanceEnabled) => {
    access.clearanceEnabled = clearanceEnabled;
    renderAdministration('Admin');

    expect(screen.getAllByRole('heading', { name: 'Accounting setup' }).length).toBeGreaterThan(0);
    const card = document.getElementById('org-hide-prices');
    expect(card).toBeInTheDocument();
    expect(card?.closest('[data-testid="administration-panel-accounting"]')).toBeInTheDocument();
    expect(await within(card as HTMLElement).findByRole('button', { name: 'Hide prices from requesters' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Accounting setup' })).toHaveAttribute('href', '/administration/accounting');
    if (clearanceEnabled) expect(screen.getByRole('link', { name: 'Clearance' })).toBeInTheDocument();
    else expect(screen.queryByRole('link', { name: 'Clearance' })).toBeNull();
  });

  it('shows the card to an Executive but keeps the setting toggle Admin-only', async () => {
    access.canManageAccounting = false;
    renderAdministration('Executive');

    const card = document.getElementById('org-hide-prices');
    expect(card).toBeInTheDocument();
    expect(await within(card as HTMLElement).findByText('Only an Admin can change this.')).toBeInTheDocument();
    expect(within(card as HTMLElement).queryByRole('button', { name: /prices/i })).toBeNull();
  });
});
