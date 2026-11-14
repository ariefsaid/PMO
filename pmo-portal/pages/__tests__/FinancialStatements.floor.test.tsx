import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '@supabase/supabase-js';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { repositories } from '@/src/lib/repositories';
import FinancialStatements from '../FinancialStatements';

/**
 * Floor test for the statements page's bespoke denied card (floor-tests/finance-statements.md 11).
 * Row 8 (Retry ledger mode) is already driven on ux/fanout-1 by FinancialStatements.odoo.test.tsx.
 */

const authValue = (role: string): AuthContextValue => ({
  session: { user: { id: 'user-1' } } as Session,
  currentUser: { id: 'user-1', org_id: 'org-1', role, status: 'active' } as AuthContextValue['currentUser'],
  role: role as AuthContextValue['role'],
  loading: false,
  profileError: null,
  profileErrorKind: null,
  signInWithPassword: vi.fn(),
  signInWithMagicLink: vi.fn(),
  signInWithMicrosoft: vi.fn(),
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
  resendEmailConfirmation: vi.fn(),
  signOut: vi.fn(),
  refreshCurrentUser: vi.fn(),
});

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
};

function renderDenied() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={authValue('Project Manager')}>
        <ImpersonationProvider realRole="Project Manager">
          <MemoryRouter initialEntries={['/finance/statements']}>
            <Routes>
              <Route path="/finance/statements" element={<FinancialStatements />} />
              <Route path="*" element={<div data-testid="dashboard">Dashboard</div>} />
            </Routes>
            <LocationProbe />
          </MemoryRouter>
        </ImpersonationProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

let catalogueSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  catalogueSpy = vi.spyOn(repositories.financialStatements, 'catalogue').mockResolvedValue({
    state: 'complete',
    companyLabel: 'Catalogue Company Label',
    generation: {
      snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sourceGeneration: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      asOf: '2026-10-17T13:00:00.000Z',
      captureStartedAt: '2026-10-17T12:00:00.000Z',
      captureCompletedAt: '2026-10-17T13:00:00.000Z',
      currency: 'IDR' as const,
      presentation: { precision: 2, roundingMethod: 'Commercial Rounding' as const },
      delayed: false,
    },
    periods: [],
    scopes: [{ scopeKind: 'company' as const, projectId: null, statements: ['trial_balance' as const], viewKinds: ['account_breakdown' as const] }],
  });
  vi.spyOn(repositories.project, 'getMany').mockResolvedValue([]);
  vi.spyOn(repositories.company, 'list').mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Financial statements — floor', () => {
  it("floor: the denied card's Back to dashboard opens the dashboard (floor-tests/finance-statements.md 11)", async () => {
    renderDenied();

    expect(await screen.findByText("You don't have access to financial statements")).toBeInTheDocument();
    expect(catalogueSpy).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }));

    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });
});
