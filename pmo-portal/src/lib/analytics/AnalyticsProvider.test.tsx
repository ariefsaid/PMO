import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

// ── Mock analyticsClient ─────────────────────────────────────────────────
const analytics = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  register: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('./client', () => ({
  analyticsClient: analytics,
}));

// ── Mock config (stable reference so useEffect deps don't loop) ──────────
const mockConfig = vi.hoisted(() => ({
  enabled: true,
  demoMode: false,
  analyticsEnabled: true,
  replayAndAutocapture: false,
  posthogKey: 'ph_test',
  posthogHost: 'https://us.i.posthog.com',
  appEnv: 'test',
  isDev: false,
  isProd: false,
  demoAudience: 'internal' as 'prospect' | 'internal',
  demoAccount: 'local',
}));

const mockPersistDemoContext = vi.hoisted(() => vi.fn());

vi.mock('./config', () => ({
  getAnalyticsConfig: () => mockConfig,
  persistDemoContext: mockPersistDemoContext,
}));

// ── Mock useAuth ─────────────────────────────────────────────────────────
import { AuthContext } from '@/src/auth/AuthContext';
import type { AuthContextValue } from '@/src/auth/AuthContext';

import { AnalyticsProvider } from './AnalyticsProvider';

beforeEach(() => {
  vi.clearAllMocks();
});

/** Helper: build a minimal auth context value. */
function makeAuthCtx(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    session: null,
    currentUser: null,
    role: null,
    loading: false,
    profileError: null,
    signInWithPassword: vi.fn(),
    signInWithMagicLink: vi.fn(),
    requestPasswordReset: vi.fn(),
    updatePassword: vi.fn(),
    resendEmailConfirmation: vi.fn(),
    signOut: vi.fn(),
    ...overrides,
  };
}

/** Render the provider tree with a MemoryRouter and optional initial URL. */
function renderTree(
  authCtx: AuthContextValue,
  initialEntries: string[] = ['/projects'],
) {
  return render(
    <AuthContext.Provider value={authCtx}>
      <MemoryRouter initialEntries={initialEntries}>
        <AnalyticsProvider>
          <Routes>
            <Route path="*" element={<div data-testid="page">ok</div>} />
          </Routes>
        </AnalyticsProvider>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('AnalyticsProvider', () => {
  it('AC-PH-002: inits analyticsClient on mount', () => {
    renderTree(makeAuthCtx());
    expect(analytics.init).toHaveBeenCalledWith(mockConfig);
  });

  it('AC-PH-002: registers environment context on mount (non-demo)', () => {
    renderTree(makeAuthCtx());
    expect(analytics.register).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'test',
        demo_audience: undefined,
        demo_account: undefined,
      }),
    );
  });

  it('AC-PH-002: registers demo context when demoMode is on', () => {
    // Override config to simulate demo mode
    const originalDemoMode = mockConfig.demoMode;
    const originalAudience = mockConfig.demoAudience;
    const originalAccount = mockConfig.demoAccount;
    mockConfig.demoMode = true;
    mockConfig.demoAudience = 'prospect';
    mockConfig.demoAccount = 'comp1';

    renderTree(makeAuthCtx());
    expect(analytics.register).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'test',
        demo_audience: 'prospect',
        demo_account: 'comp1',
      }),
    );

    // Restore
    mockConfig.demoMode = originalDemoMode;
    mockConfig.demoAudience = originalAudience;
    mockConfig.demoAccount = originalAccount;
  });

  it('persists demo context when demoMode is on', () => {
    const originalDemoMode = mockConfig.demoMode;
    const originalAudience = mockConfig.demoAudience;
    const originalAccount = mockConfig.demoAccount;
    mockConfig.demoMode = true;
    mockConfig.demoAudience = 'prospect';
    mockConfig.demoAccount = 'comp1';

    renderTree(makeAuthCtx());
    expect(mockPersistDemoContext).toHaveBeenCalledWith(mockConfig, window.sessionStorage);

    // Restore
    mockConfig.demoMode = originalDemoMode;
    mockConfig.demoAudience = originalAudience;
    mockConfig.demoAccount = originalAccount;
  });

  it('does NOT persist demo context when demoMode is off', () => {
    renderTree(makeAuthCtx());
    expect(mockPersistDemoContext).not.toHaveBeenCalled();
  });

  it('AC-PH-011: initial /projects/<uuid>?x=y captures app_route_viewed with route "/projects/:projectId"', () => {
    renderTree(makeAuthCtx(), ['/projects/d0000000-0000-0000-0000-000000000001?x=y']);
    expect(analytics.capture).toHaveBeenCalledWith(
      'app_route_viewed',
      expect.objectContaining({
        route: '/projects/:projectId',
        module: 'projects',
      }),
    );
    // Ensure no raw UUID or query string leaks
    const calls = analytics.capture.mock.calls.filter(
      (c: unknown[]) => c[0] === 'app_route_viewed',
    );
    for (const call of calls) {
      const props = call[1] as Record<string, unknown>;
      expect(JSON.stringify(props)).not.toContain('d0000000');
      expect(JSON.stringify(props)).not.toContain('x=y');
    }
  });

  it('AC-PH-009: currentUser triggers identify with userId/role/orgId, no PII', async () => {
    const authCtx = makeAuthCtx({
      currentUser: {
        id: 'u1',
        full_name: 'Alice Manager',
        email: 'alice@acme.test',
        role: 'Project Manager',
        org_id: 'o1',
        company_id: null,
        avatar_url: null,
        title: null,
        location: null,
        manager_id: null,
        skills: [],
        utilization: null,
        created_at: '',
        updated_at: '',
      },
      role: 'Project Manager',
    });

    renderTree(authCtx);

    await waitFor(() => {
      expect(analytics.identify).toHaveBeenCalledWith({
        userId: 'u1',
        role: 'Project Manager',
        orgId: 'o1',
      });
    });

    // Verify no email/name in identify calls
    const identifyCalls = analytics.identify.mock.calls;
    for (const call of identifyCalls) {
      const arg = call[0] as Record<string, unknown>;
      expect(arg).not.toHaveProperty('email');
      expect(arg).not.toHaveProperty('full_name');
    }
  });

  it('AC-PH-010: transition from user to null calls reset() then re-registers base context', async () => {
    const profile = {
      id: 'u1',
      full_name: 'Alice Manager',
      email: 'alice@acme.test',
      role: 'Project Manager' as const,
      org_id: 'o1',
      company_id: null,
      avatar_url: null,
      title: null,
      location: null,
      manager_id: null,
      skills: [] as string[],
      utilization: null,
      created_at: '',
      updated_at: '',
    };

    const { rerender } = render(
      <AuthContext.Provider
        value={makeAuthCtx({ currentUser: profile, role: 'Project Manager' })}
      >
        <MemoryRouter>
          <AnalyticsProvider>
            <div />
          </AnalyticsProvider>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    // Should have identified the user
    await waitFor(() => {
      expect(analytics.identify).toHaveBeenCalled();
    });

    analytics.reset.mockClear();
    analytics.register.mockClear();

    // Transition to signed-out
    rerender(
      <AuthContext.Provider value={makeAuthCtx()}>
        <MemoryRouter>
          <AnalyticsProvider>
            <div />
          </AnalyticsProvider>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    await waitFor(() => {
      expect(analytics.reset).toHaveBeenCalledTimes(1);
    });

    // After reset, base context must be re-registered
    expect(analytics.register).toHaveBeenCalledWith({
      environment: 'test',
      demo_audience: undefined,
      demo_account: undefined,
    });

    // Verify order: reset was called before the final register
    const resetOrder = Math.max(...analytics.reset.mock.invocationCallOrder);
    const registerOrder = Math.max(...analytics.register.mock.invocationCallOrder);
    expect(resetOrder).toBeLessThan(registerOrder);
  });

  it('does not call reset on mount when no user was previously identified', () => {
    renderTree(makeAuthCtx());
    expect(analytics.reset).not.toHaveBeenCalled();
  });

  it('does not emit duplicate app_route_viewed when role hydrates on the same route', async () => {
    // First render: no user, role=null, route=/projects
    const authCtxNoUser = makeAuthCtx();
    const { rerender } = render(
      <AuthContext.Provider value={authCtxNoUser}>
        <MemoryRouter initialEntries={['/projects']}>
          <AnalyticsProvider>
            <div />
          </AnalyticsProvider>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    // Exactly one app_route_viewed for initial mount
    const routeCallsAfterMount = analytics.capture.mock.calls.filter(
      (c: unknown[]) => c[0] === 'app_route_viewed',
    );
    expect(routeCallsAfterMount).toHaveLength(1);
    expect(routeCallsAfterMount[0][1]).toMatchObject({
      route: '/projects',
      module: 'projects',
    });

    analytics.capture.mockClear();

    // Re-render with role hydrated (same route, different auth state)
    const profile = {
      id: 'u1',
      full_name: 'Alice Manager',
      email: 'alice@acme.test',
      role: 'Project Manager' as const,
      org_id: 'o1',
      company_id: null,
      avatar_url: null,
      title: null,
      location: null,
      manager_id: null,
      skills: [] as string[],
      utilization: null,
      created_at: '',
      updated_at: '',
    };
    rerender(
      <AuthContext.Provider value={makeAuthCtx({ currentUser: profile, role: 'Project Manager' })}>
        <MemoryRouter initialEntries={['/projects']}>
          <AnalyticsProvider>
            <div />
          </AnalyticsProvider>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    // Role hydrating on the SAME route must NOT emit another app_route_viewed
    const routeCallsAfterHydrate = analytics.capture.mock.calls.filter(
      (c: unknown[]) => c[0] === 'app_route_viewed',
    );
    expect(routeCallsAfterHydrate).toHaveLength(0);
  });

  it('AC-PH-011: route capture includes role when available', () => {
    renderTree(
      makeAuthCtx({
        currentUser: {
          id: 'u1',
          full_name: 'Alice',
          email: 'alice@acme.test',
          role: 'Project Manager',
          org_id: 'o1',
          company_id: null,
          avatar_url: null,
          title: null,
          location: null,
          manager_id: null,
          skills: [],
          utilization: null,
          created_at: '',
          updated_at: '',
        },
        role: 'Project Manager',
      }),
      ['/procurement/60000000-0000-0000-0000-000000000001'],
    );

    expect(analytics.capture).toHaveBeenCalledWith(
      'app_route_viewed',
      expect.objectContaining({
        route: '/procurement/:procurementId',
        module: 'procurement',
        role: 'Project Manager',
      }),
    );
  });
});
