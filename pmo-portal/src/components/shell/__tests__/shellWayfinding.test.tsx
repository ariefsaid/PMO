/**
 * Where am I, and how do I get to my work? The shell's wayfinding behaviour per role:
 * a record keeps its menu place lit, every visible destination has its own icon, and a breadcrumb
 * never offers a doorway to a page the person cannot open.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { Rail } from '../Rail';
import { Breadcrumb } from '../Breadcrumb';
import { RailDrawerContext } from '../railDrawerContext';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';

const roleState = vi.hoisted(() => ({ role: 'Executive' }));
const builtInRoleKeys = vi.hoisted(() => ({
  Executive: 'executive',
  'Project Manager': 'project_manager',
  Finance: 'finance_manager',
  Engineer: 'engineer',
  Admin: 'administrator',
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: roleState.role, realRole: roleState.role }),
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({
  data: { crm: true, procurement: true, timesheets: true, revenue: true, management_pack: true, financial_statements: true, imprest: true, stock: true, sales_pipeline: true, incidents: true },
  isPending: false,
  isError: false,
}) }));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({ useHasTimesheetApprovalWork: () => ({ data: false }) }));
vi.mock('../ApprovalsNavCount', () => ({ ApprovalsNavCount: () => null }));
vi.mock('@/src/hooks/useOverdueInvoiceCount', () => ({ useOverdueInvoiceCount: () => ({ isPending: true }) }));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => true,
  useBuiltInRoleKey: () => builtInRoleKeys[roleState.role as keyof typeof builtInRoleKeys] ?? null,
}));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => false }));

const renderWithRole = (ui: React.ReactElement) =>
  render(<AuthContext.Provider value={{ role: roleState.role } as AuthContextValue}>{ui}</AuthContext.Provider>);

const renderRail = (entry = '/') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <RailDrawerContext.Provider value={false}>
        <Rail />
      </RailDrawerContext.Provider>
    </MemoryRouter>,
  );

beforeEach(() => {
  roleState.role = 'Executive';
  localStorage.removeItem('shell.navigation.collapsedGroups');
});

describe('shell wayfinding', () => {
  it.each(['Engineer', 'Project Manager', 'Finance', 'Executive', 'Admin'])(
    '%s sees a distinct icon on every destination it can open',
    (role) => {
      roleState.role = role;
      renderRail();
      const icons = within(screen.getByRole('navigation', { name: 'Primary navigation' }))
        .getAllByRole('link')
        .map((link) => link.querySelector('svg')?.getAttribute('data-icon'));
      expect(icons.length).toBeGreaterThan(5);
      expect(new Set(icons).size).toBe(icons.length);
    },
  );

  it('keeps Companies marked while a company record is open, like its breadcrumb', () => {
    roleState.role = 'Project Manager';
    renderRail('/companies/c-1');
    expect(screen.getByRole('link', { name: 'Companies' })).toHaveAttribute('aria-current', 'page');
  });

  it('puts money first for Finance and site work first for an Engineer', () => {
    roleState.role = 'Finance';
    const { unmount } = renderRail();
    const groups = () => screen.getAllByRole('button', { expanded: true }).map((button) => button.textContent);
    expect(groups()[0]).toBe('Finance');
    unmount();
    roleState.role = 'Engineer';
    renderRail();
    expect(groups()).toEqual(['Delivery', 'My work']);
  });

  it('shows a project manager where an invoice lives without a doorway to the finance pages it cannot open', () => {
    roleState.role = 'Project Manager';
    renderWithRole(
      <Breadcrumb
        parts={[
          { label: 'Finance', href: '/finance', onClick: vi.fn() },
          { label: 'Receivables', href: '/finance/receivables', onClick: vi.fn() },
          { label: 'INV-1' },
        ]}
      />,
    );
    expect(screen.getByText('Finance').closest('a, button')).toBeNull();
    expect(screen.getByText('Receivables').closest('a, button')).toBeNull();
    expect(screen.getByText('Finance')).not.toHaveAttribute('aria-current');
    expect(screen.getByText('INV-1')).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the same crumbs as links for a Finance user', () => {
    roleState.role = 'Finance';
    renderWithRole(
      <Breadcrumb
        parts={[
          { label: 'Finance', href: '/finance', onClick: vi.fn() },
          { label: 'Receivables', href: '/finance/receivables', onClick: vi.fn() },
          { label: 'INV-1' },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Finance' })).toHaveAttribute('href', '/finance');
    expect(screen.getByRole('link', { name: 'Receivables' })).toHaveAttribute('href', '/finance/receivables');
  });
});
