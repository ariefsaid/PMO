/**
 * Rail — Views collection and saved shortcut unit tests.
 * AC-VR-014, AC-VR-015, AC-VR-017 (FR-VR-060, FR-VR-061, FR-VR-062, FR-VR-064, FR-VR-065)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';

// ── Mocks (hoisted before imports) ──────────────────────────────────────────
// Use vi.hoisted() so these refs are available when vi.mock factories run.
const { featureEnabled, userViewsData } = vi.hoisted(() => {
  const featureEnabled: Record<string, boolean> = { userViews: true };
  const userViewsData: { id: string; name: string; description: string | null }[] = [];
  return { featureEnabled, userViewsData };
});

vi.mock('@/src/lib/features', () => ({
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
      user_views: false,
    },
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Admin', realRole: 'Admin' }),
}));

vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));

import { Rail } from './Rail';

function renderRail() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Rail />
    </MemoryRouter>
  );
}

describe('Rail — Views collection and shortcuts (AC-VR-014, AC-VR-015, AC-VR-017)', () => {
  it('AC-VR-014: renders the Views doorway and saved shortcut when feature=true and views exist', () => {
    userViewsData.splice(0, userViewsData.length,
      { id: 'v1', name: 'My Dashboard', description: null }
    );
    featureEnabled.userViews = true;
    renderRail();
    expect(screen.getByRole('group', { name: 'Views' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Views' })).toHaveAttribute('href', '/views');
    expect(screen.getByRole('link', { name: 'My Dashboard' })).toHaveAttribute('href', '/views/v1');
  });

  it('AC-VR-014: does NOT render "My Views" group when feature=false', () => {
    userViewsData.splice(0, userViewsData.length,
      { id: 'v1', name: 'My Dashboard', description: null }
    );
    featureEnabled.userViews = false;
    renderRail();
    expect(screen.queryByRole('group', { name: 'Views' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'My Dashboard' })).not.toBeInTheDocument();
    // restore
    featureEnabled.userViews = true;
  });

  it('AC-VR-015: keeps a Views doorway when enabled with zero saved views', () => {
    userViewsData.splice(0, userViewsData.length);
    featureEnabled.userViews = true;
    renderRail();
    expect(screen.getByRole('group', { name: 'Views' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Views' })).toHaveAttribute('href', '/views');
    expect(screen.queryByRole('link', { name: 'My Dashboard' })).not.toBeInTheDocument();
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
    // The collection remains alongside the new job groups and their destinations.
    expect(screen.getByRole('group', { name: 'Views' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Deliver projects' })).toBeInTheDocument();
  });

  it('AC-VR-014: caps saved shortcuts at six so the Views group including its doorway has at most seven items', () => {
    const views = Array.from({ length: 12 }, (_, i) => ({ id: `v${i}`, name: `View ${i}`, description: null }));
    userViewsData.splice(0, userViewsData.length, ...views);
    featureEnabled.userViews = true;
    renderRail();
    const group = screen.getByRole('group', { name: 'Views' });
    const savedLinks = within(group).getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('/views/'));
    expect(savedLinks).toHaveLength(6);
    expect(within(group).getAllByRole('link')).toHaveLength(7);
  });
});
