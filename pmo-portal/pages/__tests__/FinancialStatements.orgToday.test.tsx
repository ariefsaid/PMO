import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { setActiveLocale, resetActiveLocale } from '@/src/lib/locale/activeLocale';

/**
 * #2088 (WIG, Locale & i18n) — the statements page's default period is the latest period that has
 * BEGUN as of the ORGANIZATION's day. The old code compared against the UTC day, so an org in
 * UTC+7 opening the page between 00:00 and 07:00 local (still "yesterday" in UTC) was held on the
 * previous period for the first hours of a new one.
 */

const h = vi.hoisted(() => ({
  catalogue: null as unknown,
}));
vi.mock('@/src/hooks/useFinancialStatements', () => ({
  // Sync data: the catalogue read is not what this test exercises — the DEFAULT PERIOD decision is.
  useFinancialStatementCatalogue: () => ({
    data: h.catalogue,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    eligible: true,
  }),
  useFinancialStatement: () => ({ data: undefined, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useOdooLedger', () => ({
  useOdooLedgerMode: () => ({ odoo: false, error: null, retry: vi.fn() }),
}));

const period = (start: string, end: string) => ({
  kind: 'month' as const,
  currentStart: start,
  currentEnd: end,
  priorStart: '2025-01-01',
  priorEnd: '2025-01-31',
});

const catalogue = {
  state: 'complete',
  companyLabel: 'Catalogue Company Label',
  generation: {
    snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sourceGeneration: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    asOf: '2026-06-01T13:00:00.000Z',
    captureStartedAt: '2026-06-01T12:00:00.000Z',
    captureCompletedAt: '2026-06-01T13:00:00.000Z',
    currency: 'IDR' as const,
    presentation: { precision: 2, roundingMethod: 'Commercial Rounding' as const },
    delayed: false,
  },
  periods: [period('2026-05-01', '2026-05-31'), period('2026-06-02', '2026-06-30')],
  scopes: [{ scopeKind: 'company' as const, projectId: null, statements: ['trial_balance' as const], viewKinds: ['account_breakdown' as const] }],
};

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

beforeEach(() => {
  vi.useFakeTimers();
  h.catalogue = catalogue;
});

afterEach(() => {
  vi.useRealTimers();
  resetActiveLocale();
  vi.restoreAllMocks();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={authValue('Project Manager')}>
        <ImpersonationProvider realRole="Project Manager">
          <MemoryRouter initialEntries={['/finance/statements']}>
            <FinancialStatements />
          </MemoryRouter>
        </ImpersonationProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

import FinancialStatements from '../FinancialStatements';

describe('#2088 Financial statements — the default period follows the organization day', () => {
  it('#2088: at 03:00 org-local on the 2nd the new period is already begun and is the default', () => {
    // 2026-06-01 20:00 UTC == 2026-06-02 03:00 in Asia/Jakarta: org day Jun 2, UTC day Jun 1.
    vi.setSystemTime(new Date('2026-06-01T20:00:00Z'));
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta' });
    renderPage();

    // The June period (starting on the org's today, Jun 2) has begun, so it outranks May as the
    // default. The UTC day (Jun 1) would exclude it and default to the May pair.
    expect(screen.getByLabelText('Period')).toHaveValue('2026-06-02');
  });
});
