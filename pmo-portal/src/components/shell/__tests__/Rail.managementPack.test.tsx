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

describe('AC-MMP-015 canonical report home in the rail', () => {
  it('AC-MMP-015: Finance sees one report home and no retired report destinations', () => {
    effectiveRole = 'Finance';
    revenue = true;
    renderRail();
    expect(screen.getByRole('link', { name: 'Financial statements' })).toHaveAttribute('href', '/financial-statements');
    expect(screen.queryByRole('link', { name: /Management pack/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Revenue by Project/ })).not.toBeInTheDocument();
  });

  it('AC-MMP-015: PM reaches project revenue through the canonical home', () => {
    effectiveRole = 'Project Manager';
    revenue = true;
    renderRail();
    expect(screen.getByRole('link', { name: 'Project revenue' })).toHaveAttribute('href', '/financial-statements?section=project-revenue');
    expect(screen.queryByRole('link', { name: /Management pack|Revenue by Project/ })).not.toBeInTheDocument();
  });

  it('AC-MMP-015: Engineers do not, and nobody does when Revenue is off', () => {
    effectiveRole = 'Engineer';
    revenue = true;
    const { unmount } = renderRail();
    expect(screen.queryByRole('link', { name: /Management pack/ })).toBeNull();
    unmount();
    effectiveRole = 'Finance';
    revenue = false;
    renderRail();
    expect(screen.queryByRole('link', { name: /Management pack/ })).toBeNull();
  });
});
