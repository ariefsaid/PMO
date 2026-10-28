import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
import { Rail } from '../Rail';

let effectiveRole = 'Finance';
let revenue = true;
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole, realRole: effectiveRole, canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: { revenue }, isPending: false, isError: false }),
}));

const renderRail = () => render(<MemoryRouter><Rail /></MemoryRouter>);

describe('Finance area in the rail', () => {
  it('Finance sees the Finance destination with Revenue enabled', () => {
    effectiveRole = 'Finance';
    revenue = true;
    renderRail();
    expect(screen.getByRole('link', { name: 'Finance' })).toHaveAttribute('href', '/finance');
  });

  // AC-MMP-015 (ported): the management pack is now Finance › Reports. Finance sees it with Revenue
  // on; Engineers never do; nobody does when Revenue is off (the Finance hub itself stays).
  it('AC-MMP-015: Finance sees Reports (the management pack) linking to /finance/reports when Revenue is on', () => {
    effectiveRole = 'Finance';
    revenue = true;
    renderRail();
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/finance/reports');
  });

  it('AC-MMP-015: Engineers do not see Reports, and nobody does when Revenue is off', () => {
    effectiveRole = 'Engineer';
    revenue = true;
    const { unmount } = renderRail();
    expect(screen.queryByRole('link', { name: 'Reports' })).toBeNull();
    unmount();
    for (const role of ['Finance', 'Executive', 'Admin']) {
      effectiveRole = role;
      revenue = false;
      const view = renderRail();
      expect(screen.queryByRole('link', { name: 'Reports' })).toBeNull();
      view.unmount();
    }
  });

  it('Engineers do not see Finance; Finance sees it when Revenue is off', () => {
    effectiveRole = 'Engineer';
    revenue = true;
    const { unmount } = renderRail();
    expect(screen.queryByRole('link', { name: 'Finance' })).toBeNull();
    unmount();
    effectiveRole = 'Finance';
    revenue = false;
    renderRail();
    expect(screen.getByRole('link', { name: 'Finance' })).toHaveAttribute('href', '/finance');
  });
});
