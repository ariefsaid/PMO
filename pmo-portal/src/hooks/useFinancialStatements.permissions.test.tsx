import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue, type Profile, type Role } from '@/src/auth/AuthContext';
import { ImpersonationProvider, useEffectiveRole } from '@/src/auth/impersonation';
import { AppError } from '@/src/lib/appError';
import type {
  FinancialStatementCatalogue,
  FinancialStatementNativePayload,
  FinancialStatementNativeReport,
  FinancialStatementNativeReportPeriod,
  FinancialStatementRead,
} from '@/src/lib/financialStatements';
import { repositories } from '@/src/lib/repositories';
import type { GetFinancialStatementInput } from '@/src/lib/db/financialStatements';
import {
  useFinancialStatement,
  useFinancialStatementCatalogue,
} from './useFinancialStatements';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ORG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROJECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_PROJECT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const SESSION: Session = {
  access_token: 'unit-test-token',
  refresh_token: 'unit-test-refresh-token',
  expires_in: 3600,
  expires_at: 1_900_000_000,
  token_type: 'bearer',
  user: {
    id: USER_ID,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2025-01-01T00:00:00.000Z',
  },
};

function profile(role: Role, overrides: Partial<Profile> = {}): Profile {
  return {
    id: USER_ID,
    org_id: ORG_ID,
    role,
    avatar_url: null,
    company_id: null,
    created_at: '2025-01-01T00:00:00.000Z',
    email: '',
    full_name: '',
    locale: null,
    location: null,
    manager_id: null,
    number_locale: null,
    skills: [],
    status: 'active',
    timezone: null,
    title: null,
    updated_at: '2025-01-01T00:00:00.000Z',
    utilization: null,
    ...overrides,
  };
}

function authContext(options: {
  role?: Role;
  currentUser?: Profile | null;
  sessionUserId?: string | null;
  loading?: boolean;
  profileError?: string | null;
  session?: Session | null;
} = {}): AuthContextValue {
  const role = options.role ?? 'Admin';
  const user = options.currentUser === undefined ? profile(role) : options.currentUser;
  const sessionUserId = options.sessionUserId === undefined ? USER_ID : options.sessionUserId;
  const session = options.session === undefined
    ? sessionUserId === null
      ? null
      : { ...SESSION, user: { ...SESSION.user, id: sessionUserId } }
    : options.session;
  return {
    session,
    currentUser: user,
    role: user?.role ?? null,
    loading: options.loading ?? false,
    profileError: options.profileError ?? null,
    profileErrorKind: options.profileError === null || options.profileError === undefined ? null : 'load_error',
    signInWithPassword: async () => ({ error: null }),
    signInWithMagicLink: async () => ({ error: null }),
    signInWithMicrosoft: async () => ({ error: null }),
    requestPasswordReset: async () => ({ error: null }),
    updatePassword: async () => ({ error: null }),
    resendEmailConfirmation: async () => ({ error: null }),
    signOut: async () => undefined,
    refreshCurrentUser: async () => ({ error: null }),
  };
}

const PERIOD = {
  kind: 'month',
  currentStart: '2026-01-01',
  currentEnd: '2026-01-31',
  priorStart: '2025-12-01',
  priorEnd: '2025-12-31',
} as const;

const CURRENT_NATIVE_PERIOD: FinancialStatementNativeReportPeriod = {
  fromDate: PERIOD.currentStart,
  toDate: PERIOD.currentEnd,
  fromFiscalYear: 'FY2026',
  toFiscalYear: 'FY2026',
  kind: 'month',
  columnLabel: 'Jan 2026',
};
const PRIOR_NATIVE_PERIOD: FinancialStatementNativeReportPeriod = {
  fromDate: PERIOD.priorStart,
  toDate: PERIOD.priorEnd,
  fromFiscalYear: 'FY2025',
  toFiscalYear: 'FY2025',
  kind: 'month',
  columnLabel: 'Dec 2025',
};
const NATIVE_PERIOD_PAIR = { current: CURRENT_NATIVE_PERIOD, prior: PRIOR_NATIVE_PERIOD };
const CAPTURE_STARTED_AT = '2026-02-01T12:00:00.000Z';
const CAPTURE_COMPLETED_AT = '2026-02-01T12:05:00.000Z';

function nativePayload(projectId: string | null = null): FinancialStatementNativePayload {
  const report = (side: 'current' | 'prior'): FinancialStatementNativeReport => {
    const period = NATIVE_PERIOD_PAIR[side];
    const amountField = period.toDate;
    return {
      reportName: 'Profit and Loss Statement',
      company: 'Test Company',
      side,
      period,
      periodPair: NATIVE_PERIOD_PAIR,
      project: projectId === null ? null : { projectId, erpProjectName: 'Test Project' },
      language: 'en',
      profile: { erpVersion: '16.33.0', frappeVersion: '16.31.0' },
      columns: [
        { fieldname: 'account', label: 'Account', type: 'text' },
        { fieldname: amountField, label: period.columnLabel ?? period.toDate, type: 'currency' },
      ],
      rows: [{ account: 'Revenue - Test Company', [amountField]: side === 'current' ? '11.00' : '9.00' }],
      summary: null,
      provenance: {
        endpoint: '/api/method/frappe.desk.query_report.run',
        method: 'GET',
        ignorePreparedReport: 1,
        rawSha256: side === 'current' ? 'a'.repeat(64) : 'b'.repeat(64),
        acquiredAt: side === 'current' ? '2026-02-01T12:02:00.000Z' : '2026-02-01T12:03:00.000Z',
        filters: { company: 'Test Company', from_date: period.fromDate, to_date: period.toDate },
      },
    };
  };
  return { current: report('current'), prior: report('prior') };
}

function readProvenance(payload: FinancialStatementNativePayload) {
  return {
    sourceReport: payload.current.reportName,
    reportVersion: payload.current.profile.erpVersion,
    filters: { current: payload.current.provenance.filters, prior: payload.prior.provenance.filters },
    settings: { precision: 2 },
  };
}

const COMPLETE_NATIVE_PAYLOAD = nativePayload();
const PROJECT_DETAIL_PAYLOAD = nativePayload(PROJECT_ID);
const COMPLETE_READ: FinancialStatementRead = {
  state: 'complete',
  companyLabel: 'Test Company',
  generation: {
    snapshotId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    sourceGeneration: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    asOf: CAPTURE_COMPLETED_AT,
    captureStartedAt: CAPTURE_STARTED_AT,
    captureCompletedAt: CAPTURE_COMPLETED_AT,
    currency: 'IDR',
    presentation: { precision: 2, roundingMethod: 'Commercial Rounding' },
    delayed: false,
  },
  selection: {
    periodKind: 'month',
    periodStart: '2026-01-01',
    statement: 'profit_and_loss',
    scopeKind: 'company',
    projectId: null,
    viewKind: 'account_breakdown',
  },
  result: {
    viewKind: 'account_breakdown',
    period: PERIOD,
    hasActivity: true,
    payload: COMPLETE_NATIVE_PAYLOAD,
    provenance: readProvenance(COMPLETE_NATIVE_PAYLOAD),
  },
};

const PROJECT_DETAIL_READ: FinancialStatementRead = {
  ...COMPLETE_READ,
  selection: { ...COMPLETE_READ.selection, scopeKind: 'project', projectId: PROJECT_ID },
  result: {
    viewKind: 'account_breakdown',
    period: PERIOD,
    hasActivity: true,
    payload: PROJECT_DETAIL_PAYLOAD,
    provenance: readProvenance(PROJECT_DETAIL_PAYLOAD),
  },
};

const PROJECT_TOTALS_READ: FinancialStatementRead = {
  ...COMPLETE_READ,
  selection: {
    ...COMPLETE_READ.selection,
    scopeKind: 'project',
    projectId: PROJECT_ID,
    statement: 'profit_and_loss',
    viewKind: 'project_totals',
  },
  result: {
    viewKind: 'project_totals',
    period: PERIOD,
    hasActivity: true,
    payload: {
      current: { income: '11.00', expense: '4.00', net: '7.00' },
      prior: { income: '9.00', expense: '3.00', net: '6.00' },
    },
  },
};

const UNAVAILABLE_CATALOGUE: FinancialStatementCatalogue = {
  state: 'unavailable',
  companyLabel: null,
  generation: null,
  periods: [],
  scopes: [],
};
const UNAVAILABLE_READ: FinancialStatementRead = {
  state: 'unavailable',
  companyLabel: null,
  generation: null,
  selection: COMPLETE_READ.selection,
  result: null,
};

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: Infinity, refetchOnWindowFocus: false },
    },
  });
}

function environment(initialAuth = authContext(), initialRealRole: Role | null = 'Admin', viewAs: Role | null = null) {
  const client = makeClient();
  let currentAuth = initialAuth;
  let realRole = initialRealRole;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={currentAuth}>
        <ImpersonationProvider realRole={realRole} demoEligibility="eligible">
          {viewAs && <SetViewAs role={viewAs} />}
          {children}
        </ImpersonationProvider>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
  return {
    client,
    wrapper,
    setAuth(next: AuthContextValue, nextRealRole: Role | null = next.currentUser?.role ?? null) {
      currentAuth = next;
      realRole = nextRealRole;
    },
  };
}

function SetViewAs({ role }: { role: Role }) {
  const { viewAs } = useEffectiveRole();
  useEffect(() => viewAs(role), [role, viewAs]);
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(repositories.financialStatements, 'catalogue').mockResolvedValue(UNAVAILABLE_CATALOGUE);
  vi.spyOn(repositories.financialStatements, 'get').mockResolvedValue(UNAVAILABLE_READ);
});

describe('financial statement query/auth/cache guards (AC-009)', () => {
  it.each([
    ['Admin', true, true],
    ['Executive', true, true],
    ['Finance', true, true],
    ['Project Manager', false, true],
    ['Engineer', false, true],
    [null, false, false],
  ] as const)(
    'AC-009: real role %s can query only its policy-approved company/project statement scope',
    async (role, companyAllowed, projectAllowed) => {
      const activeRole = role as Role | null;
      const env = environment(authContext({ role: activeRole ?? 'Admin' }), activeRole);
      const company = renderHook(() => useFinancialStatementCatalogue({ kind: 'company' }), { wrapper: env.wrapper });
      const project = renderHook(() => useFinancialStatementCatalogue({ kind: 'project', projectId: PROJECT_ID }), { wrapper: env.wrapper });

      await waitFor(() => expect(company.result.current.isFetched || !companyAllowed).toBe(true));
      await waitFor(() => expect(project.result.current.isFetched || !projectAllowed).toBe(true));

      expect(repositories.financialStatements.catalogue).toHaveBeenCalledTimes(Number(companyAllowed) + Number(projectAllowed));
      if (companyAllowed) {
        expect(repositories.financialStatements.catalogue).toHaveBeenCalledWith({});
      }
      if (projectAllowed) {
        expect(repositories.financialStatements.catalogue).toHaveBeenCalledWith({ projectId: PROJECT_ID });
      }
    },
  );

  it('AC-009: pending auth never reads and masks primed cache synchronously', async () => {
    const env = environment(authContext({ role: 'Admin', loading: true }), 'Admin');
    const hook = renderHook(() => useFinancialStatementCatalogue({ kind: 'company' }), { wrapper: env.wrapper });
    expect(hook.result.current.eligible).toBe(false);
    expect(hook.result.current.data).toBeUndefined();
    expect(repositories.financialStatements.catalogue).not.toHaveBeenCalled();
    await act(async () => {
      await hook.result.current.refetch();
    });
    expect(repositories.financialStatements.catalogue).not.toHaveBeenCalled();
  });

  it('AC-009: a profile load error disables company reads', () => {
    const env = environment(authContext({ role: 'Admin', profileError: 'profile unavailable' }), 'Admin');
    renderHook(() => useFinancialStatementCatalogue({ kind: 'company' }), { wrapper: env.wrapper });
    expect(repositories.financialStatements.catalogue).not.toHaveBeenCalled();
  });

  it('AC-009: an inactive profile denies before query admission', () => {
    const env = environment(authContext({
      role: 'Admin',
      currentUser: profile('Admin', { status: 'disabled' }),
    }), 'Admin');
    renderHook(() => useFinancialStatementCatalogue({ kind: 'company' }), { wrapper: env.wrapper });
    expect(repositories.financialStatements.catalogue).not.toHaveBeenCalled();
  });

  it('AC-009: a settled real-role/profile-role mismatch denies before query admission', () => {
    const env = environment(authContext({ role: 'Finance' }), 'Admin');
    const hook = renderHook(() => useFinancialStatementCatalogue({ kind: 'company' }), { wrapper: env.wrapper });
    expect(hook.result.current.eligible).toBe(false);
    expect(repositories.financialStatements.catalogue).not.toHaveBeenCalled();
  });

  it('AC-009: a session/profile user mismatch denies before query admission', () => {
    const env = environment(authContext({ role: 'Admin', sessionUserId: OTHER_USER_ID }), 'Admin');
    const hook = renderHook(() => useFinancialStatementCatalogue({ kind: 'company' }), { wrapper: env.wrapper });
    expect(hook.result.current.eligible).toBe(false);
    expect(repositories.financialStatements.catalogue).not.toHaveBeenCalled();
  });

  it('AC-009: an empty organization identity denies before query admission', () => {
    const env = environment(authContext({
      role: 'Admin',
      currentUser: profile('Admin', { org_id: '' }),
    }), 'Admin');
    renderHook(() => useFinancialStatementCatalogue({ kind: 'company' }), { wrapper: env.wrapper });
    expect(repositories.financialStatements.catalogue).not.toHaveBeenCalled();
  });

  it('AC-009: an eligible Admin viewing as Engineer retains real-role statement access', async () => {
    const env = environment(authContext({ role: 'Admin' }), 'Admin', 'Engineer');
    const hook = renderHook(() => useFinancialStatementCatalogue({ kind: 'company' }), { wrapper: env.wrapper });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(repositories.financialStatements.catalogue).toHaveBeenCalledTimes(1);
    expect(env.client.getQueryCache().findAll({ queryKey: ['financial-statements'] })[0]?.queryKey).toContain('Admin');
  });

  it('AC-009: an Admin viewing as Project Manager keeps project-total eligibility on the real role', async () => {
    const env = environment(authContext({ role: 'Admin' }), 'Admin', 'Project Manager');
    const hook = renderHook(() => useFinancialStatementCatalogue({ kind: 'project', projectId: PROJECT_ID }), { wrapper: env.wrapper });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(repositories.financialStatements.catalogue).toHaveBeenCalledWith({ projectId: PROJECT_ID });
    expect(env.client.getQueryCache().getAll()[0]?.queryKey).toContain('Admin');
  });

  it('AC-009: a non-Admin viewAsAdmin attempt is inert and cannot authorize company statements', () => {
    const env = environment(authContext({ role: 'Project Manager' }), 'Project Manager', 'Admin');
    const hook = renderHook(() => useFinancialStatementCatalogue({ kind: 'company' }), { wrapper: env.wrapper });
    expect(hook.result.current.eligible).toBe(false);
    expect(repositories.financialStatements.catalogue).not.toHaveBeenCalled();
  });

  it('AC-009: explicitly disabled query masks cached data and refetch cannot bypass the guard', async () => {
    const env = environment();
    const hook = renderHook(({ enabled }: { enabled: boolean }) =>
      useFinancialStatementCatalogue({ kind: 'company' }, enabled), {
      wrapper: env.wrapper,
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(hook.result.current.data).toBe(UNAVAILABLE_CATALOGUE);

    hook.rerender({ enabled: false });
    expect(hook.result.current.eligible).toBe(true);
    expect(hook.result.current.data).toBeUndefined();
    await act(async () => {
      await hook.result.current.refetch();
    });
    expect(repositories.financialStatements.catalogue).toHaveBeenCalledTimes(1);
  });

  it('AC-009: auth role loss masks cached company data and retires the old identity query', async () => {
    const env = environment();
    const hook = renderHook(() => useFinancialStatementCatalogue({ kind: 'company' }), { wrapper: env.wrapper });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(hook.result.current.data).toBe(UNAVAILABLE_CATALOGUE);

    env.setAuth(authContext({ role: 'Engineer' }), 'Engineer');
    hook.rerender();
    expect(hook.result.current.eligible).toBe(false);
    expect(hook.result.current.data).toBeUndefined();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(env.client.getQueryCache().getAll().every((query) => query.state.data === undefined)).toBe(true));
    expect(env.client.getQueryCache().getAll().some((query) => query.queryKey.includes('Admin'))).toBe(false);
    expect(repositories.financialStatements.catalogue).toHaveBeenCalledTimes(1);
  });

  it('AC-009: organization changes produce a new identity key without exposing the previous result', async () => {
    const env = environment();
    const hook = renderHook(() => useFinancialStatementCatalogue({ kind: 'company' }), { wrapper: env.wrapper });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    env.setAuth(authContext({ role: 'Admin', currentUser: profile('Admin', { org_id: OTHER_ORG_ID }) }), 'Admin');
    hook.rerender();
    expect(hook.result.current.data).toBeUndefined();
    await waitFor(() => expect(hook.result.current.data).toBe(UNAVAILABLE_CATALOGUE));
    const keys = env.client.getQueryCache().findAll({ queryKey: ['financial-statements'] }).map((query) => query.queryKey);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain(OTHER_ORG_ID);
  });

  it('AC-009: catalogue scope changes synchronously mask the old project result and use separate keys', async () => {
    const env = environment();
    const hook = renderHook(({ projectId }: { projectId: string }) =>
      useFinancialStatementCatalogue({ kind: 'project', projectId }), {
      wrapper: env.wrapper,
      initialProps: { projectId: PROJECT_ID },
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    hook.rerender({ projectId: OTHER_PROJECT_ID });
    expect(hook.result.current.data).toBeUndefined();
    await waitFor(() => expect(repositories.financialStatements.catalogue).toHaveBeenCalledTimes(2));
    expect(repositories.financialStatements.catalogue).toHaveBeenLastCalledWith({ projectId: OTHER_PROJECT_ID });
    await waitFor(() => expect(env.client.getQueryCache().findAll({ queryKey: ['financial-statements'] })).toHaveLength(1));
    expect(env.client.getQueryCache().getAll()[0]?.queryKey).toContain(OTHER_PROJECT_ID);
  });

  it('AC-009: detail and project totals have distinct keys and totals request native P&L totals only', async () => {
    vi.mocked(repositories.financialStatements.get)
      .mockResolvedValueOnce(PROJECT_DETAIL_READ)
      .mockResolvedValueOnce(PROJECT_TOTALS_READ);
    const env = environment();
    const detail = renderHook(() => useFinancialStatement({
      periodKind: 'month', periodStart: '2026-01-01', statement: 'profit_and_loss', projectId: PROJECT_ID,
    }), { wrapper: env.wrapper });
    await waitFor(() => expect(detail.result.current.data).toBe(PROJECT_DETAIL_READ));
    const totals = renderHook(() => useFinancialStatement({
      periodKind: 'month',
      periodStart: '2026-01-01',
      statement: 'profit_and_loss',
      projectId: PROJECT_ID,
      viewKind: 'project_totals',
    }), { wrapper: env.wrapper });
    await waitFor(() => expect(totals.result.current.data).toBe(PROJECT_TOTALS_READ));
    expect(repositories.financialStatements.get).toHaveBeenNthCalledWith(2, {
      periodKind: 'month',
      periodStart: '2026-01-01',
      statement: 'profit_and_loss',
      projectId: PROJECT_ID,
      viewKind: 'project_totals',
    });
    const readKeys = env.client.getQueryCache().findAll({ queryKey: ['financial-statements'] })
      .filter((query) => query.queryKey.includes('read'))
      .map((query) => query.queryKey);
    expect(readKeys).toHaveLength(2);
    expect(readKeys[0]).not.toEqual(readKeys[1]);
    expect(totals.result.current.data?.result?.viewKind).toBe('project_totals');
  });

  it('AC-009: an Engineer reads project totals but never company or project account detail', async () => {
    vi.mocked(repositories.financialStatements.get).mockResolvedValue(PROJECT_TOTALS_READ);
    const env = environment(authContext({ role: 'Engineer' }), 'Engineer');
    const company = renderHook(() => useFinancialStatement({
      periodKind: 'month', periodStart: '2026-01-01', statement: 'profit_and_loss',
    }), { wrapper: env.wrapper });
    const projectDetail = renderHook(() => useFinancialStatement({
      periodKind: 'month', periodStart: '2026-01-01', statement: 'profit_and_loss', projectId: PROJECT_ID,
    }), { wrapper: env.wrapper });
    const projectTotals = renderHook(() => useFinancialStatement({
      periodKind: 'month',
      periodStart: '2026-01-01',
      statement: 'profit_and_loss',
      projectId: PROJECT_ID,
      viewKind: 'project_totals',
    }), { wrapper: env.wrapper });

    await waitFor(() => expect(projectTotals.result.current.data).toBe(PROJECT_TOTALS_READ));
    expect(company.result.current.eligible).toBe(false);
    expect(projectDetail.result.current.eligible).toBe(false);
    expect(repositories.financialStatements.get).toHaveBeenCalledTimes(1);
    expect(repositories.financialStatements.get).toHaveBeenCalledWith({
      periodKind: 'month',
      periodStart: '2026-01-01',
      statement: 'profit_and_loss',
      projectId: PROJECT_ID,
      viewKind: 'project_totals',
    });
  });

  it.each(['trial_balance', 'balance_sheet'] as const)(
    'AC-009: project %s detail requests are denied by the mapped read scope', (statement) => {
      const env = environment();
      const hook = renderHook(() => useFinancialStatement({
        periodKind: 'month', periodStart: '2026-01-01', statement, projectId: PROJECT_ID,
      }), { wrapper: env.wrapper });
      expect(hook.result.current.eligible).toBe(false);
      expect(repositories.financialStatements.get).not.toHaveBeenCalled();
    },
  );

  it('AC-009: period changes never borrow data and late ignored-abort results cannot reseed the active cache', async () => {
    const first = deferred<FinancialStatementRead>();
    const second = deferred<FinancialStatementRead>();
    vi.mocked(repositories.financialStatements.get).mockImplementation((input) =>
      input.periodStart === '2026-01-01' ? first.promise : second.promise,
    );
    const env = environment();
    const hook = renderHook(({ periodStart }: { periodStart: string }) => useFinancialStatement({
      periodKind: 'month', periodStart, statement: 'profit_and_loss',
    }), {
      wrapper: env.wrapper,
      initialProps: { periodStart: '2026-01-01' },
    });
    await waitFor(() => expect(repositories.financialStatements.get).toHaveBeenCalledTimes(1));
    hook.rerender({ periodStart: '2026-02-01' });
    expect(hook.result.current.data).toBeUndefined();
    await waitFor(() => expect(repositories.financialStatements.get).toHaveBeenCalledTimes(2));
    const february: FinancialStatementRead = {
      ...UNAVAILABLE_READ,
      selection: { ...UNAVAILABLE_READ.selection, periodStart: '2026-02-01' },
    };
    await act(async () => second.resolve(february));
    await waitFor(() => expect(hook.result.current.data).toBe(february));
    const january: FinancialStatementRead = {
      ...UNAVAILABLE_READ,
      selection: { ...UNAVAILABLE_READ.selection, periodStart: '2026-01-01' },
    };
    await act(async () => first.resolve(january));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.data).toBe(february);
    const cachedReads = env.client.getQueryCache().findAll({ queryKey: ['financial-statements'] })
      .filter((query) => query.queryKey.includes('read'));
    expect(cachedReads.some((query) => query.state.data === january)).toBe(false);
  });

  it('AC-009: signout masks data and a late promise that ignores abort cannot restore it', async () => {
    const pending = deferred<FinancialStatementRead>();
    vi.mocked(repositories.financialStatements.get).mockReturnValue(pending.promise);
    const env = environment();
    const hook = renderHook(() => useFinancialStatement({
      periodKind: 'month', periodStart: '2026-01-01', statement: 'profit_and_loss',
    }), { wrapper: env.wrapper });
    await waitFor(() => expect(repositories.financialStatements.get).toHaveBeenCalledTimes(1));
    env.setAuth(authContext({ role: 'Admin', currentUser: null, sessionUserId: null }), null);
    hook.rerender();
    expect(hook.result.current.data).toBeUndefined();
    await act(async () => pending.resolve(COMPLETE_READ));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.data).toBeUndefined();
    expect(env.client.getQueryCache().getAll().every((query) => query.state.data !== COMPLETE_READ)).toBe(true);
  });

  it('AC-009: a profile error fences a late result while the disabled observer remains mounted', async () => {
    const pending = deferred<FinancialStatementRead>();
    vi.mocked(repositories.financialStatements.get).mockReturnValue(pending.promise);
    const env = environment();
    const hook = renderHook(() => useFinancialStatement({
      periodKind: 'month', periodStart: '2026-01-01', statement: 'profit_and_loss',
    }), { wrapper: env.wrapper });
    await waitFor(() => expect(repositories.financialStatements.get).toHaveBeenCalledTimes(1));
    env.setAuth(authContext({ role: 'Admin', profileError: 'profile load failed' }), 'Admin');
    hook.rerender();
    expect(hook.result.current.data).toBeUndefined();
    await act(async () => pending.resolve(COMPLETE_READ));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.data).toBeUndefined();
    expect(env.client.getQueryCache().getAll().every((query) => query.state.data !== COMPLETE_READ)).toBe(true);
  });

  it('AC-009: last-observer unmount consumes cancellation and fences an ignored-abort late result', async () => {
    const pending = deferred<FinancialStatementRead>();
    vi.mocked(repositories.financialStatements.get).mockReturnValue(pending.promise);
    const env = environment();
    const hook = renderHook(() => useFinancialStatement({
      periodKind: 'month', periodStart: '2026-01-01', statement: 'profit_and_loss',
    }), { wrapper: env.wrapper });
    await waitFor(() => expect(repositories.financialStatements.get).toHaveBeenCalledTimes(1));
    hook.unmount();
    await act(async () => pending.resolve(COMPLETE_READ));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(env.client.getQueryCache().getAll().every((query) => query.state.data !== COMPLETE_READ)).toBe(true);
  });

  it('AC-009: one same-identity observer unmount does not cancel another live observer request', async () => {
    const pending = deferred<FinancialStatementRead>();
    vi.mocked(repositories.financialStatements.get).mockReturnValue(pending.promise);
    const env = environment();
    const selection: GetFinancialStatementInput = {
      periodKind: 'month', periodStart: '2026-01-01', statement: 'profit_and_loss',
    };
    const first = renderHook(() => useFinancialStatement(selection), { wrapper: env.wrapper });
    const second = renderHook(() => useFinancialStatement(selection), { wrapper: env.wrapper });
    await waitFor(() => expect(repositories.financialStatements.get).toHaveBeenCalledTimes(1));
    first.unmount();
    await act(async () => pending.resolve(COMPLETE_READ));
    await waitFor(() => expect(second.result.current.data).toBe(COMPLETE_READ));
  });

  it('AC-009: same-key ordinary background failure retains the original complete object reference', async () => {
    vi.mocked(repositories.financialStatements.get)
      .mockResolvedValueOnce(COMPLETE_READ)
      .mockRejectedValueOnce(new Error('temporary transport failure'));
    const env = environment();
    const hook = renderHook(() => useFinancialStatement({
      periodKind: 'month', periodStart: '2026-01-01', statement: 'profit_and_loss',
    }), { wrapper: env.wrapper });
    await waitFor(() => expect(hook.result.current.data).toBe(COMPLETE_READ));
    await act(async () => {
      await hook.result.current.refetch();
    });
    expect(hook.result.current.data).toBe(COMPLETE_READ);
    await waitFor(() => expect(hook.result.current.error).toBeInstanceOf(Error));
    expect(repositories.financialStatements.get).toHaveBeenCalledTimes(2);
  });

  it('AC-009: a 42501 after cached success is access loss, not retained background data', async () => {
    vi.mocked(repositories.financialStatements.get)
      .mockResolvedValueOnce(COMPLETE_READ)
      .mockRejectedValueOnce(new AppError('sanitized test denial', '42501'));
    const env = environment();
    const hook = renderHook(() => useFinancialStatement({
      periodKind: 'month', periodStart: '2026-01-01', statement: 'profit_and_loss',
    }), { wrapper: env.wrapper });
    await waitFor(() => expect(hook.result.current.data).toBe(COMPLETE_READ));
    await act(async () => {
      await hook.result.current.refetch();
    });
    await waitFor(() => expect(hook.result.current.data).toBeUndefined());
    expect(hook.result.current.eligible).toBe(false);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await hook.result.current.refetch();
    });
    expect(repositories.financialStatements.get).toHaveBeenCalledTimes(2);
  });

  it('AC-009: JWT denial code retires cached catalogue data without inspecting error text', async () => {
    vi.mocked(repositories.financialStatements.catalogue)
      .mockResolvedValueOnce(UNAVAILABLE_CATALOGUE)
      .mockRejectedValueOnce(new AppError('opaque', 'PGRST301'));
    const env = environment();
    const hook = renderHook(() => useFinancialStatementCatalogue({ kind: 'company' }), { wrapper: env.wrapper });
    await waitFor(() => expect(hook.result.current.data).toBe(UNAVAILABLE_CATALOGUE));
    await act(async () => {
      await hook.result.current.refetch();
    });
    await waitFor(() => expect(hook.result.current.data).toBeUndefined());
    expect(hook.result.current.eligible).toBe(false);
    expect(repositories.financialStatements.catalogue).toHaveBeenCalledTimes(2);
  });

  it('AC-009: eligible Retry performs one new read while a denied manual refetch performs none', async () => {
    vi.mocked(repositories.financialStatements.catalogue)
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(UNAVAILABLE_CATALOGUE);
    const env = environment();
    const hook = renderHook(() => useFinancialStatementCatalogue({ kind: 'company' }), { wrapper: env.wrapper });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    await act(async () => {
      await hook.result.current.refetch();
    });
    expect(repositories.financialStatements.catalogue).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(hook.result.current.data).toBe(UNAVAILABLE_CATALOGUE));

    env.setAuth(authContext({ role: 'Engineer' }), 'Engineer');
    hook.rerender();
    await act(async () => {
      await hook.result.current.refetch();
    });
    expect(repositories.financialStatements.catalogue).toHaveBeenCalledTimes(2);
  });
});
