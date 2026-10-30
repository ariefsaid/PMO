import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
// useIsOperator is queried by Rail's real-Operator Administration footer; default to false
// (plain role) unless a specific test overrides it. Avoids a QueryClient in the harness.
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
import { Rail } from '../Rail';

/** Finance Reports is now a real child destination inside the Finance rail group. */

let effectiveRole = 'Executive';

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole,
    realRole: 'Admin',
    canImpersonate: effectiveRole === 'Admin',
    viewAs: vi.fn(),
  }),
}));

// useUserViews calls useAuth internally; mock the whole hook so Rail tests
// that predate the My Views group don't need an AuthProvider.
vi.mock('@/src/hooks/useUserViews', () => ({
  useUserViews: () => ({ data: [], isPending: false, isError: false }),
}));

// S6 entitlement rewire: Rail now calls useOrgFeatures() (which calls useAuth).
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({
    data: {
      incidents: false,
      crm: true,
      procurement: true,
      revenue: true,
      timesheets: true,
      import_export: true,
      agent_assistant: false,
      user_views: false,
    },
    isPending: false,
    isError: false,
  }),
}));

const renderRail = () =>
  render(
    <MemoryRouter>
      <Rail />
    </MemoryRouter>,
  );

describe('Rail — Finance Reports destination', () => {
  it('Executive sees Reports inside the Finance group', () => {
    effectiveRole = 'Executive';
    renderRail();
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/finance/reports');
    expect(screen.getByRole('link', { name: 'Finance' })).toHaveAttribute('href', '/finance');
  });

  it('Finance sees Reports as a child destination', () => {
    effectiveRole = 'Finance';
    renderRail();
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/finance/reports');
  });

  it('AC-IXD-DASH-004: the surviving Overview group still shows Dashboard', () => {
    effectiveRole = 'Executive';
    renderRail();
    // The module isn't gone wholesale — the real Overview item survives.
    expect(screen.getByRole('link', { name: /Dashboard/i })).toBeInTheDocument();
  });
});
