// #1507 S7: the statements page picks its section by tier. An Odoo organisation reads the Odoo ledger; the saved-report path is not asked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const h = vi.hoisted(() => ({ odoo: false, catalogue: vi.fn(), mode: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, currentUser: { id: 'u1', org_id: 'org-1', role: 'Admin', status: 'active' }, loading: false, profileError: null }),
}));
vi.mock('@/src/hooks/useOdooLedger', () => ({ useOdooLedgerMode: (...a: unknown[]) => { h.mode(...a); return { odoo: h.odoo, onLedger: h.odoo, pending: false, error: false }; } }));
vi.mock('@/src/components/financial-statements/OdooStatementsSection', () => ({ OdooStatementsSection: () => <div data-testid="odoo-statements-stub" /> }));
vi.mock('@/src/hooks/useFinancialStatements', () => ({
  useFinancialStatementCatalogue: (...a: unknown[]) => { h.catalogue(...a); return { eligible: true, isPending: true, isError: false, data: undefined, refetch: vi.fn() }; },
  useFinancialStatement: () => ({ eligible: true, isPending: false, isFetching: false, isError: false, data: undefined, refetch: vi.fn() }),
}));

import FinancialStatements from '../FinancialStatements';

const mount = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <ImpersonationProvider realRole="Admin"><MemoryRouter><FinancialStatements /></MemoryRouter></ImpersonationProvider>
  </QueryClientProvider>,
);
beforeEach(() => { h.catalogue.mockClear(); h.mode.mockClear(); });
afterEach(cleanup);

describe('FinancialStatements by tier', () => {
  it('an Odoo organisation gets the Odoo section and the saved-report catalogue is not requested', () => {
    h.odoo = true;
    mount();
    expect(screen.getByTestId('odoo-statements-stub')).toBeInTheDocument();
    expect(h.catalogue).toHaveBeenLastCalledWith({ kind: 'company' }, false);
  });

  it('any other organisation keeps the saved-report path untouched', () => {
    h.odoo = false;
    mount();
    expect(screen.queryByTestId('odoo-statements-stub')).not.toBeInTheDocument();
    expect(h.catalogue).toHaveBeenLastCalledWith({ kind: 'company' }, true);
  });
});
