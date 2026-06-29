import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { Rail } from '../Rail';

/**
 * AC-IXD-DASH-004 (Area 4, plan task 20): don't promote an unbuilt module to prime nav.
 * "Reports" renders an empty PlaceholderPage, so it is demoted/hidden from the Rail until the
 * module ships (the /reports route is kept for stray deep links). A role that sees the rail
 * does NOT see "Reports" as a top-slot nav item leading to an empty stub.
 */

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

const renderRail = () =>
  render(
    <MemoryRouter>
      <Rail />
    </MemoryRouter>,
  );

describe('Rail — Reports demoted until built (AC-IXD-DASH-004)', () => {
  it('AC-IXD-DASH-004: Reports is NOT a rail item for Executive (unbuilt module hidden)', () => {
    effectiveRole = 'Executive';
    renderRail();
    expect(screen.queryByRole('link', { name: /Reports/i })).toBeNull();
    expect(screen.queryByText(/Reports/i)).toBeNull();
  });

  it('AC-IXD-DASH-004: Reports is NOT a rail item for Finance either', () => {
    effectiveRole = 'Finance';
    renderRail();
    expect(screen.queryByRole('link', { name: /Reports/i })).toBeNull();
  });

  it('AC-IXD-DASH-004: the surviving Overview group still shows Dashboard', () => {
    effectiveRole = 'Executive';
    renderRail();
    // The module isn't gone wholesale — the real Overview item survives.
    expect(screen.getByRole('link', { name: /Dashboard/i })).toBeInTheDocument();
  });
});
