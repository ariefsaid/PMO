/**
 * Rail — "My Views" group unit tests.
 * AC-VR-014, AC-VR-015, AC-VR-017 (FR-VR-060, FR-VR-061, FR-VR-062, FR-VR-064, FR-VR-065)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';

// ── Mocks (hoisted before imports) ──────────────────────────────────────────
// Use vi.hoisted() so these refs are available when vi.mock factories run.
const { featureEnabled, userViewsData, roleState, eligibility } = vi.hoisted(() => {
  const featureEnabled: Record<string, boolean> = { userViews: true };
  const userViewsData: { id: string; name: string; description: string | null }[] = [];
  const roleState = { role: 'Admin' };
  // Subscribable like the real react-query hooks: a change re-renders Rail without new props (React.memo).
  const listeners = new Set<() => void>();
  const eligibility = {
    pending: [] as unknown[], corrections: [] as unknown[], pendingError: false, correctionError: false,
    version: 0,
    subscribe: (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    update(patch: Partial<{ pending: unknown[]; corrections: unknown[] }>) {
      Object.assign(eligibility, patch);
      eligibility.version += 1;
      listeners.forEach((cb) => cb());
    },
  };
  return { featureEnabled, userViewsData, roleState, eligibility };
});

vi.mock('@/src/lib/features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/features')>()),
  isFeatureEnabled: (key: string) => featureEnabled[key] ?? false,
  FEATURES: featureEnabled,
  // Rail resolves each gated item's fallback via FEATURE_ENV_DEFAULT[key] (Rail.tsx) — the mock must
  // expose it or the new revenue-gated nav items throw on an undefined lookup.
  FEATURE_ENV_DEFAULT: featureEnabled,
}));

vi.mock('@/src/hooks/useUserViews', () => ({
  useUserViews: () => ({ data: userViewsData, isPending: false, isError: false }),
}));

// S6 entitlement rewire: Rail now calls useOrgFeatures() (which calls useAuth).
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({
    data: {
      incidents: false,
      crm: true,
      procurement: true,
      timesheets: true,
      import_export: true,
      agent_assistant: false,
      user_views: featureEnabled.userViews,
    },
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: roleState.role, realRole: roleState.role }),
}));

vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => {
    React.useSyncExternalStore(eligibility.subscribe, () => eligibility.version);
    return { data: eligibility.pending, isError: eligibility.pendingError };
  },
  useReopenableApprovedTimesheets: () => {
    React.useSyncExternalStore(eligibility.subscribe, () => eligibility.version);
    return { data: eligibility.corrections, isError: eligibility.correctionError };
  },
}));
vi.mock('./ApprovalsNavCount', () => ({ ApprovalsNavCount: () => null }));
vi.mock('@/src/hooks/useOverdueInvoiceCount', () => ({ useOverdueInvoiceCount: () => ({ isPending: true }) }));

vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));

import { Rail } from './Rail';
import { RailDrawerContext } from './railDrawerContext';

function renderRail() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <RailDrawerContext.Provider value><Rail /></RailDrawerContext.Provider>
    </MemoryRouter>
  );
}

describe('Rail — My Views group (AC-VR-014, AC-VR-015, AC-VR-017)', () => {
  it('AC-VR-014: renders "My Views" group and nav link when feature=true and views exist', () => {
    userViewsData.splice(0, userViewsData.length,
      { id: 'v1', name: 'My Dashboard', description: null }
    );
    featureEnabled.userViews = true;
    renderRail();
    expect(screen.getByRole('group', { name: /my views/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My Dashboard' })).toHaveAttribute('href', '/views/v1');
  });

  it('AC-VR-014: does NOT render "My Views" group when feature=false', () => {
    userViewsData.splice(0, userViewsData.length,
      { id: 'v1', name: 'My Dashboard', description: null }
    );
    featureEnabled.userViews = false;
    renderRail();
    expect(screen.queryByRole('group', { name: /my views/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'My Dashboard' })).not.toBeInTheDocument();
    // restore
    featureEnabled.userViews = true;
  });

  it('AC-VR-015: does NOT render "My Views" group when feature=true but views array is empty', () => {
    userViewsData.splice(0, userViewsData.length);
    featureEnabled.userViews = true;
    renderRail();
    expect(screen.queryByRole('group', { name: /my views/i })).not.toBeInTheDocument();
  });

  it('AC-VR-017: ALL_ITEMS entries are still present; no existing group is replaced', () => {
    userViewsData.splice(0, userViewsData.length,
      { id: 'v1', name: 'My Dashboard', description: null }
    );
    featureEnabled.userViews = true;
    renderRail();
    // Existing static nav items remain (just check a few)
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    // "My Views" group is additional, not replacing "Overview"/"CRM"/"Delivery"/"Workforce"
    expect(screen.getByRole('group', { name: /my views/i })).toBeInTheDocument();
  });

  it('AC-VR-014: caps rail entries at MAX_NAV_VIEWS (8)', () => {
    const views = Array.from({ length: 12 }, (_, i) => ({ id: `v${i}`, name: `View ${i}`, description: null }));
    userViewsData.splice(0, userViewsData.length, ...views);
    featureEnabled.userViews = true;
    renderRail();
    const group = screen.getByRole('group', { name: /my views/i });
    const links = within(group).getAllByRole('link');
    expect(links).toHaveLength(8);
  });
});


describe('#1834 nav-link preload (onPreloadHref)', () => {
  it('fires with the link href on pointerover, focus and pointerdown', () => {
    const onPreloadHref = vi.fn();
    render(
      <MemoryRouter initialEntries={['/']}>
        <RailDrawerContext.Provider value><Rail onPreloadHref={onPreloadHref} /></RailDrawerContext.Provider>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Procurement' });
    fireEvent.pointerOver(link);
    fireEvent.focus(link);
    fireEvent.pointerDown(link);
    expect(onPreloadHref.mock.calls.map((call) => call[0])).toEqual(['/procurement', '/procurement', '/procurement']);
  });

  it('ignores non-link targets (group headings) — no href, no preload', () => {
    const onPreloadHref = vi.fn();
    render(
      <MemoryRouter initialEntries={['/']}>
        <RailDrawerContext.Provider value><Rail onPreloadHref={onPreloadHref} /></RailDrawerContext.Provider>
      </MemoryRouter>,
    );
    fireEvent.pointerOver(screen.getByText('Delivery'));
    expect(onPreloadHref).not.toHaveBeenCalled();
  });
});


describe('timesheet approval navigation', () => {
  it('shows the entry for an engineer with an eligible correction and hides it when none exist', () => {
    roleState.role = 'Engineer';
    eligibility.corrections = [{ id: 'eligible' }];
    const auth = {} as AuthContextValue;
    const tree = () => <AuthContext.Provider value={auth}><MemoryRouter><RailDrawerContext.Provider value><Rail /></RailDrawerContext.Provider></MemoryRouter></AuthContext.Provider>;
    render(tree());
    expect(screen.getByRole('link', { name: 'Approvals' })).toHaveAttribute('href', '/approvals');
    act(() => eligibility.update({ corrections: [] }));
    expect(screen.queryByRole('link', { name: 'Approvals' })).not.toBeInTheDocument();
    roleState.role = 'Admin';
  });
});


it('keeps the approvals recovery route available when eligibility cannot be loaded', () => {
  roleState.role = 'Engineer';
  eligibility.pendingError = true;
  const auth = { currentUser: { id: 'me', org_id: 'org-1' }, role: 'Engineer' } as AuthContextValue;
  render(<AuthContext.Provider value={auth}><MemoryRouter><RailDrawerContext.Provider value><Rail /></RailDrawerContext.Provider></MemoryRouter></AuthContext.Provider>);
  expect(screen.getByRole('link', { name: /approvals/i })).toHaveAttribute('href', '/approvals');
  eligibility.pendingError = false;
  roleState.role = 'Admin';
});
