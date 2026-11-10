/**
 * Rail "More": each role sees its own jobs at once; the rest sit under one collapsed group that
 * stays reachable (opens on click, opens by itself when its page is current, always open in the
 * phone drawer). Screen rule: the sidebar fits 1440x900 without scrolling for every role.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

describe('Rail More group', () => {
  it('shows an executive their jobs at once and keeps the rest one click away', async () => {
    renderRail();
    for (const name of ['Dashboard', 'Projects', 'Procurement', 'Finance', 'Receivables', 'Payables', 'Approvals']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('link', { name: 'Contacts' })).not.toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('group', { name: 'More' });
    for (const name of ['Contacts', 'Meetings', 'Calendar', 'Timesheets', 'Expenses', 'Statements']) {
      expect(within(group).getByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('opens by itself when the current page lives under More', () => {
    renderRail('/contacts');
    expect(screen.getByRole('link', { name: 'Contacts' })).toBeInTheDocument();
  });

  it('is always open in the phone drawer', () => {
    renderRail('/', true);
    expect(screen.getByRole('link', { name: 'Contacts' })).toBeInTheDocument();
  });

  it('does not collapse a short list: an engineer sees everything and no More', () => {
    roleState.role = 'Engineer';
    renderRail();
    expect(screen.getByRole('link', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });
});
