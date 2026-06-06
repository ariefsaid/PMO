import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { Rail } from '../Rail';

let effectiveRole = 'Executive';
const openModule = vi.fn();

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole,
    realRole: 'Admin',
    canImpersonate: effectiveRole === 'Admin',
    viewAs: vi.fn(),
  }),
}));
vi.mock('../WorkspaceTabsProvider', async (orig) => {
  const actual = await orig<typeof import('../WorkspaceTabsProvider')>();
  return {
    ...actual,
    useWorkspaceTabsOptional: () => ({
      tabs: [
        { id: 'dashboard', kind: 'module', path: '/', icon: 'grid', label: 'Dashboard', module: 'dashboard' },
      ],
      activeId: 'dashboard',
      openModule,
      openRecord: vi.fn(),
      closeTab: vi.fn(),
      selectTab: vi.fn(),
      setDirty: vi.fn(),
    }),
  };
});

const renderRail = () =>
  render(
    <MemoryRouter>
      <Rail />
    </MemoryRouter>
  );

beforeEach(() => {
  openModule.mockClear();
});

describe('Rail role-gating (preserves getNavItems — AC-AUTH-003/009/010/011)', () => {
  it('Executive sees Dashboard/Projects/Sales/Procurement/Timesheets/Approvals/Companies/Reports', () => {
    effectiveRole = 'Executive';
    renderRail();
    for (const name of [
      'Dashboard',
      'Projects',
      'Sales Pipeline',
      'Procurement',
      'Timesheets',
      'Approvals',
      'Companies',
      'Reports',
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('Engineer sees the Engineer subset, not the restricted nav', () => {
    effectiveRole = 'Engineer';
    renderRail();
    for (const name of ['Dashboard', 'Projects', 'Timesheets', 'Tasks']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    for (const name of ['Sales Pipeline', 'Procurement', 'Companies', 'Reports']) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
  });

  it('Admin shows the Administration foot item; Finance does not', () => {
    effectiveRole = 'Admin';
    const { unmount } = renderRail();
    expect(screen.getByText('Administration')).toBeInTheDocument();
    unmount();
    effectiveRole = 'Finance';
    renderRail();
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
  });

  it('renders Overline group labels', () => {
    effectiveRole = 'Executive';
    renderRail();
    for (const group of ['Overview', 'Sales', 'Delivery', 'Workforce']) {
      expect(screen.getByText(group)).toBeInTheDocument();
    }
  });

  // AC-AUTH-003: nav items MUST be anchors (role=link) so e2e getByRole('link') works
  // and screen readers announce "link" not "button"; cmd/middle-click also requires <a>.
  it('nav items are rendered as links (role=link), not buttons — AC-AUTH-003', () => {
    effectiveRole = 'Executive';
    renderRail();
    // Primary nav items must be anchors
    expect(screen.getByRole('link', { name: /Dashboard/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sales Pipeline/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Projects/ })).toBeInTheDocument();
  });

  it('Administration foot item is a link (role=link)', () => {
    effectiveRole = 'Admin';
    renderRail();
    expect(screen.getByRole('link', { name: /Administration/ })).toBeInTheDocument();
  });

  it('active item carries aria-current=page — AC-AUTH-003', () => {
    effectiveRole = 'Executive';
    renderRail();
    // Dashboard is active (activeId=dashboard, module=dashboard)
    const dash = screen.getByRole('link', { name: /Dashboard/ });
    expect(dash).toHaveAttribute('aria-current', 'page');
  });

  // Clicking a rail item with a moduleKey must still call openModule for tab state
  it('clicking a rail item calls openModule for workspace tab sync', async () => {
    effectiveRole = 'Executive';
    renderRail();
    await userEvent.click(screen.getByRole('link', { name: /Sales Pipeline/ }));
    expect(openModule).toHaveBeenCalledWith('sales');
  });

  // Items without a moduleKey (Approvals, Tasks, Companies, Reports) do NOT call openModule
  it('clicking an item without moduleKey does not call openModule', async () => {
    effectiveRole = 'Executive';
    renderRail();
    await userEvent.click(screen.getByRole('link', { name: /Approvals/ }));
    expect(openModule).not.toHaveBeenCalled();
  });

  it('onNavigate callback fires when a nav link is clicked', async () => {
    effectiveRole = 'Executive';
    const onNavigate = vi.fn();
    render(
      <MemoryRouter>
        <Rail onNavigate={onNavigate} />
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole('link', { name: /Projects/ }));
    expect(onNavigate).toHaveBeenCalledOnce();
  });
});
