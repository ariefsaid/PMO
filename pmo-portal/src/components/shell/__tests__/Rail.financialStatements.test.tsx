import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

const roles = vi.hoisted(() => ({ effectiveRole: 'Finance', realRole: 'Finance' }));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole: roles.effectiveRole,
    realRole: roles.realRole,
    canImpersonate: roles.realRole === 'Admin',
    viewAs: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({
    data: { crm: true, procurement: true, timesheets: true, revenue: false },
    isPending: false,
    isError: false,
  }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));

import { Rail } from '../Rail';

function renderRail(realRole: string, effectiveRole = realRole) {
  roles.realRole = realRole;
  roles.effectiveRole = effectiveRole;
  return render(<MemoryRouter><Rail /></MemoryRouter>);
}

afterEach(() => {
  cleanup();
  roles.realRole = 'Finance';
  roles.effectiveRole = 'Finance';
});

describe('Rail Finance navigation', () => {
  it.each(['Admin', 'Executive', 'Finance'])('%s discovers the Finance area even when Revenue is disabled', (role) => {
    renderRail(role);
    expect(screen.getByRole('link', { name: 'Finance' })).toHaveAttribute('href', '/finance');
    expect(screen.queryByRole('link', { name: 'Sales Invoices' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Financial statements' })).not.toBeInTheDocument();
  });

  it.each(['Project Manager', 'Engineer'])('%s has no Finance rail item', (role) => {
    renderRail(role);
    expect(screen.queryByRole('link', { name: 'Finance' })).not.toBeInTheDocument();
  });

  it('Finance visibility follows the selected navigation role', () => {
    renderRail('Admin', 'Engineer');
    expect(screen.queryByRole('link', { name: 'Finance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sales Pipeline' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Timesheets' })).toBeInTheDocument();
  });
});
