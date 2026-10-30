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
    data: { crm: true, procurement: true, timesheets: true, revenue: true },
    isPending: false,
    isError: false,
  }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));

import { Rail } from '../Rail';

function renderRail(realRole: string, effectiveRole = realRole, entry = '/') {
  roles.realRole = realRole;
  roles.effectiveRole = effectiveRole;
  return render(<MemoryRouter initialEntries={[entry]}><Rail /></MemoryRouter>);
}

afterEach(() => {
  cleanup();
  roles.realRole = 'Finance';
  roles.effectiveRole = 'Finance';
});

describe('Rail Finance navigation', () => {
  it.each(['Admin', 'Executive', 'Finance'])('%s sees all five Finance destinations when features are enabled', (role) => {
    renderRail(role);
    const expected = [
      ['Finance', '/finance'],
      ['Receivables', '/finance/receivables'],
      ['Payables', '/finance/payables'],
      ['Reports', '/finance/reports'],
      ['Statements', '/finance/statements'],
    ];
    for (const [name, href] of expected) expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    expect(screen.queryByRole('link', { name: 'Sales Invoices' })).not.toBeInTheDocument();
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

  it('only the exact Finance area item is active for its path', () => {
    renderRail('Finance', 'Finance', '/finance/payables');
    expect(screen.getByRole('link', { name: 'Payables' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Finance' })).not.toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Reports' })).not.toHaveAttribute('aria-current', 'page');
  });

  it('Finance links use the real role and hide from a PM previewing Finance', () => {
    renderRail('Project Manager', 'Finance');
    expect(screen.queryByRole('link', { name: 'Finance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Statements' })).not.toBeInTheDocument();
  });
});
