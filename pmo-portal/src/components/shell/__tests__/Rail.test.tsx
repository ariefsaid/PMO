import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { Rail } from '../Rail';

let effectiveRole = 'Executive';

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole,
    realRole: 'Admin',
    canImpersonate: effectiveRole === 'Admin',
    viewAs: vi.fn(),
  }),
}));

const renderRail = () =>
  render(
    <MemoryRouter>
      <Rail />
    </MemoryRouter>
  );

describe('Rail role-gating (preserves getNavItems — AC-AUTH-003/009/010/011, AC-NAV-008/009)', () => {
  it('Executive sees Dashboard/Projects/Sales/Procurement/Timesheets/Approvals/Companies/Incidents', () => {
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
      'Incidents',
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    // Reports is demoted from the rail until the module ships (AC-IXD-DASH-004 / IA F8).
    expect(screen.queryByText('Reports')).not.toBeInTheDocument();
  });

  // AC-IN-006: Incidents is visible to EVERY role (any member may file) — incl. Engineer,
  // who otherwise has the most restricted nav (rbac-visibility.md §A).
  it('AC-IN-006: Incidents nav is shown for Engineer (all roles see Incidents)', () => {
    effectiveRole = 'Engineer';
    renderRail();
    expect(screen.getByRole('link', { name: /Incidents/ })).toBeInTheDocument();
  });

  it('Engineer sees the Engineer subset, not the restricted nav', () => {
    effectiveRole = 'Engineer';
    renderRail();
    // Tasks is no longer a top-level nav (it lives in the project Tasks tab).
    for (const name of ['Dashboard', 'Projects', 'Timesheets', 'Incidents']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.queryByText('Tasks')).not.toBeInTheDocument();
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

  // AC-NAV-009: the rail re-gates when the effective (impersonated) role changes.
  it('AC-NAV-009: re-gates the item set under role impersonation', () => {
    effectiveRole = 'Engineer';
    const { unmount } = renderRail();
    // Engineer cannot see Sales Pipeline.
    expect(screen.queryByText('Sales Pipeline')).not.toBeInTheDocument();
    unmount();
    // Impersonate Executive → Sales Pipeline becomes visible.
    effectiveRole = 'Executive';
    renderRail();
    expect(screen.getByText('Sales Pipeline')).toBeInTheDocument();
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
    // Dashboard is active at the default `/` route (URL is the source of truth).
    const dash = screen.getByRole('link', { name: /Dashboard/ });
    expect(dash).toHaveAttribute('aria-current', 'page');
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
