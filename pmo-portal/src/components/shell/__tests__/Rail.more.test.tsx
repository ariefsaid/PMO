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

  it('shows the fixed ordered destinations and all groups expanded by default', () => {
    renderRail();
    for (const name of ['Dashboard', 'Approvals', 'Projects', 'Procurement', 'Finance', 'Receivables', 'Payables']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    for (const group of ['My work', 'Delivery', 'Sales', 'Finance']) {
      expect(screen.getByRole('button', { name: group })).toHaveAttribute('aria-expanded', 'true');
    }
    expect(screen.getByRole('link', { name: 'Contacts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My work' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'My work' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Delivery' })).toHaveAttribute('aria-expanded', 'true');
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
