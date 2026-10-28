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
