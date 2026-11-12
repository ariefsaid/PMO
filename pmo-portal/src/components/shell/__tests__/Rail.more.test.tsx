/**
 * Rail groups use one fixed order. Every group starts expanded, can be collapsed by keyboard or
 * pointer, remembers its state on this device, and the active group stays open on route changes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { Rail } from '../Rail';
import { RailDrawerContext } from '../railDrawerContext';

const roleState = vi.hoisted(() => ({ role: 'Executive' }));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: roleState.role, realRole: roleState.role }),
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({
    data: { crm: true, procurement: true, timesheets: true, revenue: true, management_pack: true, financial_statements: true, imprest: true, stock: true, sales_pipeline: true, incidents: true },
    isPending: false,
    isError: false,
  }) }));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: [] }),
  useReopenableApprovedTimesheets: () => ({ data: [] }),
}));
vi.mock('../ApprovalsNavCount', () => ({ ApprovalsNavCount: () => null }));
vi.mock('@/src/hooks/useOverdueInvoiceCount', () => ({ useOverdueInvoiceCount: () => ({ isPending: true }) }));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => false }));

const renderRail = (entry = '/', drawer = false) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <RailDrawerContext.Provider value={drawer}>
        <Rail />
      </RailDrawerContext.Provider>
    </MemoryRouter>,
  );

beforeEach(() => { roleState.role = 'Executive'; });

describe('Rail navigation groups', () => {
  beforeEach(() => localStorage.removeItem('shell.navigation.collapsedGroups'));

  it.each([
    ['Executive', ['/approvals', '/', '/sales', '/companies', '/contacts', '/projects', '/procurement', '/stock', '/equipment', '/incidents', '/meetings', '/calendar', '/finance', '/finance/receivables', '/finance/payables', '/finance/reports', '/finance/statements', '/timesheets', '/expenses', '/imprest']],
    ['Project Manager', ['/approvals', '/', '/sales', '/companies', '/contacts', '/projects', '/procurement', '/stock', '/equipment', '/incidents', '/meetings', '/calendar', '/timesheets', '/expenses', '/imprest', '/my-tasks']],
    ['Finance', ['/approvals', '/', '/sales', '/companies', '/contacts', '/projects', '/procurement', '/stock', '/equipment', '/incidents', '/meetings', '/calendar', '/finance', '/finance/receivables', '/finance/payables', '/finance/reports', '/finance/statements', '/expenses', '/imprest', '/my-tasks']],
    ['Engineer', ['/', '/projects', '/stock', '/equipment', '/incidents', '/meetings', '/calendar', '/timesheets', '/expenses', '/my-tasks']],
    ['Admin', ['/approvals', '/', '/sales', '/companies', '/contacts', '/projects', '/procurement', '/stock', '/equipment', '/incidents', '/meetings', '/calendar', '/finance', '/finance/receivables', '/finance/payables', '/finance/reports', '/finance/statements', '/timesheets', '/expenses', '/imprest', '/my-tasks']],
  ] as const)('%s keeps the pre-redesign destination set and restored order', (role, expectedHrefs) => {
    roleState.role = role;
    renderRail();
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    const pinned = nav.querySelector('[data-rail-pinned-approvals]');
    const scrollRegion = nav.querySelector('[data-rail-scroll-region]');
    const hrefs = [...nav.querySelectorAll('a[href]')].map((link) => link.getAttribute('href'));

    // Exact href membership is the pre-redesign destination-set baseline; sequence asserts the
    // requested order while also proving the role and feature gates did not add or remove items.
    expect(new Set(hrefs)).toEqual(new Set(expectedHrefs));
    expect(hrefs).toEqual(expectedHrefs);
    if (expectedHrefs.some((href) => href === '/approvals')) {
      expect(pinned).not.toBeNull();
      expect([...pinned!.querySelectorAll('a[href]')].map((link) => link.getAttribute('href'))).toEqual(['/approvals']);
      expect(nav.firstElementChild).toBe(pinned);
    } else {
      expect(pinned).toBeNull();
    }
    expect(scrollRegion).not.toBeNull();
    for (const group of ['My work', 'Delivery', 'Sales', 'Finance']) {
      const heading = screen.queryByRole('button', { name: group });
      if (heading) expect(heading).toHaveAttribute('aria-expanded', 'true');
    }
  });

  it('opens the current group and scrolls its active item into view', () => {
    const scrollIntoView = vi.fn();
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    try {
      renderRail('/contacts');
      expect(screen.getByRole('link', { name: 'Contacts' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sales' })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: 'Sales' })).toHaveAttribute('aria-disabled', 'true');
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });

  it('keeps the current group open even when this device saved it as collapsed', () => {
    localStorage.setItem('shell.navigation.collapsedGroups', JSON.stringify(['Delivery']));
    renderRail('/projects');
    expect(screen.getByRole('button', { name: 'Delivery' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
  });

  it('collapses a group by keyboard and persists the choice on this device', async () => {
    const first = renderRail();
    const delivery = screen.getByRole('button', { name: 'Delivery' });
    delivery.focus();
    await userEvent.keyboard('{Enter}');
    expect(delivery).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Procurement' })).not.toBeInTheDocument();
    expect(localStorage.getItem('shell.navigation.collapsedGroups')).toContain('Delivery');
    first.unmount();
    renderRail();
    expect(screen.getByRole('button', { name: 'Delivery' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not let the current group collapse', async () => {
    renderRail('/projects');
    const delivery = screen.getByRole('button', { name: 'Delivery' });
    expect(delivery).toHaveAttribute('aria-expanded', 'true');
    expect(delivery).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(delivery);
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
  });

  it('keeps the full ordered groups available to an Engineer', () => {
    roleState.role = 'Engineer';
    renderRail();
    expect(screen.getByRole('link', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Procurement' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
  });
});
