// #2734: with no accounting system connected, Statements leads to the management profit and loss.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const h = vi.hoisted(() => ({ noErp: true as boolean | 'unknown', role: 'Finance' }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, currentUser: { id: 'u1', org_id: 'org-1', role: h.role, status: 'active' }, loading: false, profileError: null }),
}));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => true }));
vi.mock('@/src/hooks/useNoAccountingSystem', () => ({ useNoAccountingSystem: () => h.noErp }));
vi.mock('@/src/hooks/useOdooLedger', () => ({ useOdooLedgerMode: () => ({ odoo: false, onLedger: false, pending: false, error: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useFinancialStatements', () => ({
  useFinancialStatementCatalogue: () => ({ eligible: true, isPending: false, isError: false, data: { state: 'unavailable', scopes: [], periods: [] }, refetch: vi.fn() }),
  useFinancialStatement: () => ({ eligible: false, isPending: false, isFetching: false, isError: false, data: undefined, refetch: vi.fn() }),
}));

import FinancialStatements from '../FinancialStatements';

const mount = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <FinanceI18nTestProvider>
      <ImpersonationProvider realRole={h.role as 'Finance'}>
        <MemoryRouter initialEntries={['/finance/statements']}>
          <Routes>
            <Route path="/finance/statements" element={<FinancialStatements />} />
            <Route path="/finance/reports" element={<div>reports-destination</div>} />
            <Route path="/administration/integrations" element={<div>integrations-destination</div>} />
            <Route path="/administration/accounting" element={<div>accounting-destination</div>} />
          </Routes>
        </MemoryRouter>
      </ImpersonationProvider>
    </FinanceI18nTestProvider>
  </QueryClientProvider>,
);
beforeEach(() => { h.noErp = true; h.role = 'Finance'; });
afterEach(cleanup);

describe('Statements with no accounting system', () => {
  it('AC-NEF-001/002 shows the management profit and loss card and Open reports goes to Reports', async () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Management profit and loss' })).toBeInTheDocument();
    expect(screen.getByText(/come from an accounting system when one is connected/)).toBeInTheDocument();
    expect(screen.queryByText('No statements yet')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open reports' }));
    expect(screen.getByText('reports-destination')).toBeInTheDocument();
  });

  it('AC-NEF-003 Finance sees no set-up or margin-setting pointer; Admin sees both', async () => {
    mount();
    expect(screen.queryByRole('button', { name: 'Set up accounting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Profit per discipline' })).not.toBeInTheDocument();
    cleanup();
    h.role = 'Admin';
    mount();
    expect(screen.getByRole('button', { name: 'Set up accounting' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Profit per discipline' }));
    expect(screen.getByText('accounting-destination')).toBeInTheDocument();
  });

  it('AC-NEF-004/005 unknown or connected keeps today\'s empty state and no card', () => {
    for (const value of ['unknown', false] as const) {
      h.noErp = value;
      mount();
      expect(screen.getByText('No statements yet')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Management profit and loss' })).not.toBeInTheDocument();
      cleanup();
    }
  });
});
