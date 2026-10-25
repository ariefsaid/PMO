import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
// useIsOperator is queried by Rail's real-Operator Administration footer; default to false
// (plain role) unless a specific test overrides it. Avoids a QueryClient in the harness.
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
// useIsOperator statically imports the repositories index (→ orgFeatures → FEATURE_KEYS).
// Spread the real features module (the pattern the other Rail suites use) so that chain resolves
// FEATURE_KEYS; without it, this suite uniquely errors on the features mock missing the export.
vi.mock('@/src/lib/features', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/lib/features')>();
  return { ...real };
});

import { Rail } from '../Rail';

let effectiveRole = 'Executive';
let realRole = 'Admin';

// S6 entitlement rewire: m365_integration defaults OFF (FEATURE_ENV_DEFAULT false), so the personal
// "My integrations" rail item is hidden for every role here. The per-test override below lets a
// dedicated test opt that entitlement on and assert the disambiguated label (AC-ADMIA-006).
let featureOverrides: Record<string, boolean> = {};

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole,
    realRole,
    canImpersonate: effectiveRole === 'Admin',
    viewAs: vi.fn(),
  }),
}));

// useUserViews calls useAuth internally; mock the whole hook so Rail tests
// that predate the My Views group don't need an AuthProvider.
vi.mock('@/src/hooks/useUserViews', () => ({
  useUserViews: () => ({ data: [], isPending: false, isError: false }),
}));

// S6 entitlement rewire: Rail now calls useOrgFeatures() (which calls useAuth).
// Mock it so these pre-entitlement tests don't need an AuthProvider. Defaults
// mirror FEATURE_ENV_DEFAULT except CRM is enabled so the original assertions
// (Executive sees Sales Pipeline / Companies) still hold — CRM is now entitlement-
// driven, and these tests' intent predates that gate (the org has CRM enabled).
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({
    data: {
      incidents: false,
      crm: true,
      procurement: true,
      timesheets: true,
      import_export: true,
      agent_assistant: false,
      user_views: false,
      ...featureOverrides,
    },
    isPending: false,
    isError: false,
  }),
}));

const renderRail = () =>
  render(
    <MemoryRouter>
      <Rail />
    </MemoryRouter>
  );

describe('Rail role-gating (preserves getNavItems — AC-AUTH-003/009/010/011, AC-NAV-008/009)', () => {
  it('places brand, navigation, and footer within one complementary landmark', () => {
    effectiveRole = 'Executive';
    renderRail();
    const rail = screen.getByRole('complementary');
    expect(within(rail).getByText('PMO Portal')).toBeInTheDocument();
    expect(within(rail).getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
  });
  it('Executive sees Dashboard/Projects/Sales/Procurement/Timesheets/Approvals/Companies (Incidents hidden by flag)', () => {
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
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    // Incidents is hidden by the interim UI feature flag (FEATURES.incidents = false).
    // Flip the flag in src/lib/features.ts to re-enable. See Rail.features.test.tsx.
    expect(screen.queryByText('Incidents')).not.toBeInTheDocument();
    // Reports is demoted from the rail until the module ships (AC-IXD-DASH-004 / IA F8).
    expect(screen.queryByText('Reports')).not.toBeInTheDocument();
  });

  // AC-IN-006 (original): Incidents was visible to EVERY role when the module was active.
  // Updated: Incidents is now hidden by the interim UI feature flag (FEATURES.incidents = false).
  // The flag-on two-sided proof lives in Rail.features.test.tsx.
  it('AC-IN-006 (flag-off): Incidents nav is NOT shown for any role while the feature flag is off', () => {
    effectiveRole = 'Engineer';
    renderRail();
    expect(screen.queryByRole('link', { name: /Incidents/i })).toBeNull();
  });

  it('Engineer sees the Engineer subset, not the restricted nav (Incidents hidden by flag)', () => {
    effectiveRole = 'Engineer';
    renderRail();
    // Tasks is no longer a top-level nav (it lives in the project Tasks tab).
    for (const name of ['Dashboard', 'Projects', 'Timesheets']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    // Incidents is hidden by the interim UI feature flag.
    expect(screen.queryByText('Incidents')).not.toBeInTheDocument();
    expect(screen.queryByText('Tasks')).not.toBeInTheDocument();
    for (const name of ['Sales Pipeline', 'Procurement', 'Companies', 'Reports']) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
  });

  it('AC-FX-010: Admin keeps the Administration destination; Finance gets the direct FX section link', () => {
    effectiveRole = 'Admin';
    const { unmount } = renderRail();
    expect(screen.getByRole('link', { name: 'Administration' })).toHaveAttribute('href', '/administration');
    unmount();
    effectiveRole = 'Finance';
    renderRail();
    expect(screen.getByRole('link', { name: 'Administration' })).toHaveAttribute('href', '/administration/exchange-rates');
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

  it('renders the job group labels in the target IA', () => {
    effectiveRole = 'Executive';
    renderRail();
    for (const group of ['My work', 'Deliver projects', 'Manage money', 'Work with partners']) {
      expect(screen.getByText(group)).toBeInTheDocument();
    }
  });

  it.each([
    ['Admin', ['My work', 'Deliver projects', 'Manage money', 'Work with partners', 'Workspace setup']],
    ['Executive', ['My work', 'Deliver projects', 'Manage money', 'Work with partners', 'Workspace setup']],
    ['Finance', ['My work', 'Manage money', 'Deliver projects', 'Work with partners', 'Workspace setup']],
    ['Project Manager', ['My work', 'Deliver projects', 'Work with partners', 'Manage money']],
    ['Engineer', ['My work', 'Deliver projects']],
  ])('orders visible job groups for %s', (role, expectedGroups) => {
    effectiveRole = role;
    realRole = role;
    renderRail();
    const rail = screen.getByRole('complementary');
    const headings = Array.from(rail.querySelectorAll<HTMLElement>('[data-nav-group-heading]'))
      .map((heading) => heading.dataset.navGroupHeading);
    expect(headings).toEqual(expectedGroups);
  });

  it.each([
    ['Admin', ['/', '/approvals', '/my-tasks', '/timesheets', '/expenses', '/projects', '/meetings', '/incidents', '/sales-invoices', '/incoming-payments', '/procurement', '/revenue-by-project', '/financial-statements', '/reports', '/sales', '/companies', '/contacts', '/views']],
    ['Executive', ['/', '/approvals', '/timesheets', '/expenses', '/projects', '/meetings', '/incidents', '/sales-invoices', '/incoming-payments', '/procurement', '/revenue-by-project', '/financial-statements', '/reports', '/sales', '/companies', '/contacts', '/views']],
    ['Finance', ['/', '/approvals', '/my-tasks', '/expenses', '/sales-invoices', '/incoming-payments', '/procurement', '/revenue-by-project', '/financial-statements', '/reports', '/projects', '/meetings', '/incidents', '/sales', '/companies', '/contacts', '/views']],
    ['Project Manager', ['/', '/approvals', '/my-tasks', '/timesheets', '/expenses', '/projects', '/meetings', '/incidents', '/sales', '/companies', '/contacts', '/sales-invoices', '/incoming-payments', '/procurement', '/revenue-by-project', '/reports', '/views']],
    ['Engineer', ['/', '/my-tasks', '/timesheets', '/expenses', '/projects', '/meetings', '/incidents', '/views']],
  ])('keeps destination order by job and role for %s', (role, expectedHrefs) => {
    effectiveRole = role;
    realRole = role;
    featureOverrides = { crm: true, incidents: true, procurement: true, timesheets: true, revenue: true };
    renderRail();
    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    const actualHrefs = within(navigation).getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(actualHrefs).toEqual(expectedHrefs);
    featureOverrides = {};
  });

  it('keeps Approvals as the first destination in My work', () => {
    effectiveRole = 'Executive';
    renderRail();
    const work = screen.getByRole('group', { name: 'My work' });
    expect(within(work).getAllByRole('link')[0]).toHaveAccessibleName(/Approvals/);
  });

  it('keeps one current destination when Vendors is opened by its query route', () => {
    effectiveRole = 'Project Manager';
    featureOverrides = { crm: false };
    const { container } = render(
      <MemoryRouter initialEntries={['/companies?type=Vendor']}>
        <Rail />
      </MemoryRouter>,
    );
    const current = container.querySelectorAll('nav a[aria-current="page"]');
    const currentHref = current[0]?.getAttribute('href');
    featureOverrides = {};
    expect(current).toHaveLength(1);
    expect(currentHref).toBe('/companies?type=Vendor');
  });

  it('collapses to labelled icons and expands without changing the current route or destinations', async () => {
    const user = userEvent.setup();
    const CollapseProbe = () => {
      const [collapsed, setCollapsed] = React.useState(true);
      const location = useLocation();
      return (
        <>
          <output data-testid="rail-route">{location.pathname}</output>
          <Rail collapsed={collapsed} onToggleCollapse={() => setCollapsed((value) => !value)} />
        </>
      );
    };
    const { container } = render(
      <MemoryRouter initialEntries={['/projects']}>
        <CollapseProbe />
      </MemoryRouter>,
    );
    const rail = screen.getByRole('complementary');
    const destinationsBefore = Array.from(rail.querySelectorAll<HTMLAnchorElement>('nav a[href]')).map((link) => link.getAttribute('href'));
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('title', 'Projects');
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Expand navigation' }));
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('rail-route')).toHaveTextContent('/projects');
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
    expect(Array.from(container.querySelectorAll<HTMLAnchorElement>('nav a[href]')).map((link) => link.getAttribute('href')))
      .toEqual(destinationsBefore);
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

  // AC-ADMIA-006: the PERSONAL connect rail item is labelled "My integrations" (agreeing with the
  // breadcrumb + H1) — never the bare "Integrations", which would blur it with the ORGANIZATION
  // surface at /administration/integrations.
  it('AC-ADMIA-006 FIN-S9: the rail carries neither the personal "My integrations" item nor a bare "Integrations"', () => {
    effectiveRole = 'Executive';
    featureOverrides = { m365_integration: true };
    renderRail();
    expect(screen.queryByRole('link', { name: /my integrations/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Integrations$/i })).not.toBeInTheDocument();
    featureOverrides = {};
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

  // AC-ACCT-001 (retired placement): Profile & preferences is NO LONGER a primary rail item — the
  // personal surface lives in the account menu. Assert it is absent from the rail for EVERY role,
  // including while `/settings/profile` is the current route (the account-menu link owns it now).
  it('AC-ACCT-001: Profile & preferences is absent from the rail for every role and current route', () => {
    for (const role of ['Executive', 'Engineer', 'Finance', 'Project Manager', 'Admin']) {
      effectiveRole = role;
      const { unmount } = renderRail();
      expect(screen.queryByRole('link', { name: /profile & preferences/i })).toBeNull();
      expect(screen.queryByText(/profile settings/i)).toBeNull();
      unmount();
    }
    // Even when the profile URL is current, no rail item is marked active for it.
    effectiveRole = 'Executive';
    render(
      <MemoryRouter initialEntries={['/settings/profile']}>
        <Rail />
      </MemoryRouter>
    );
    expect(screen.queryByRole('link', { name: /profile & preferences/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /profile settings/i })).toBeNull();
  });
});

describe('Rail — routes that live under a module without sharing its URL', () => {
  it('review 7: /erp-purchases highlights Procurement', () => {
    effectiveRole = 'Finance';
    render(
      <MemoryRouter initialEntries={['/erp-purchases']}>
        <Rail />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Procurement' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current', 'page');
  });
});

