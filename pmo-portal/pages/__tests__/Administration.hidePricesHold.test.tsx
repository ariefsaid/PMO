/**
 * #2699 release hold — the "Hide prices from requesters" setting ships with the next release, so this release's Administration
 * page offers no card for it. The card's own component tests keep rendering it directly and are unchanged.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'fixture-admin', org_id: 'fixture-org' }, role: 'Admin' }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({
  useIsOperator: () => false,
  useOperatorMembership: () => ({ isOperator: false, isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useClearance', () => ({ useClearanceEnabled: () => ({ data: true }) }));
vi.mock('@/src/lib/repositories/hidePrices', () => ({
  hidePricesRepository: { getEnabled: vi.fn().mockResolvedValue(false), setEnabled: vi.fn().mockResolvedValue(undefined), getMaySee: vi.fn().mockResolvedValue(true) },
}));
vi.mock('../admin/Clearance', () => ({ default: () => <div>Clearance panel</div> }));
vi.mock('../admin/LeaveRequestsSetting', () => ({ default: () => <div>Leave requests panel</div> }));

import Administration from '../Administration';

describe('Administration — hide prices setting held back (#2699)', () => {
  it('offers no hide prices card in this release', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ImpersonationProvider realRole="Admin">
          <MemoryRouter initialEntries={['/administration/clearance']}>
            <ToastProvider>
              <Administration />
            </ToastProvider>
          </MemoryRouter>
        </ImpersonationProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByText('Clearance panel')).toBeInTheDocument();
    expect(document.getElementById('org-hide-prices')).toBeNull();
    expect(screen.queryByRole('heading', { name: /hide prices from requesters/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /prices/i })).toBeNull();
  });
});
