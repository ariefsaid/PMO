import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';

/**
 * B-2 (AC-W2-IXD-003): Role-shaped nav — the Approvals nav item must NOT be shown
 * to ICs who can never approve timesheets.
 *
 * Per OD-W2-2: Engineer approval stays OFF. The Approvals nav is limited to roles
 * that can approve (DELIVERY = Admin·Exec·PM). Engineers never have the Approve/Return
 * affordance so showing them a nav item leads to an empty queue — misleading.
 *
 * Two-sided invariant:
 *  - PM (authorized approver): /approvals nav present.
 *  - Engineer (IC): /approvals nav absent.
 */

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole: testRole,
    realRole: testRole,
    canImpersonate: false,
    viewAs: vi.fn(),
  }),
}));

// useUserViews calls useAuth internally; mock the whole hook so Rail tests
// that predate the My Views group don't need an AuthProvider.
vi.mock('@/src/hooks/useUserViews', () => ({
  useUserViews: () => ({ data: [], isPending: false, isError: false }),
}));

// S6 entitlement rewire: Rail now calls useOrgFeatures() (which calls useAuth).
const crmFeatureEnabled = true;
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({
    data: {
      incidents: false,
      crm: crmFeatureEnabled,
      procurement: true,
      timesheets: true,
      import_export: true,
      agent_assistant: false,
      user_views: false,
    },
    isPending: false,
    isError: false,
  }),
}));

let testRole: string = 'Project Manager';

// useIsOperator is queried by Rail's real-Operator Administration footer; default to false
// (plain role) unless a specific test overrides it. Avoids a QueryClient in the harness.
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
import { Rail } from '../Rail';

const renderRailAs = (role: string) => {
  testRole = role;
  return render(
    <MemoryRouter>
      <Rail />
    </MemoryRouter>,
  );
};

describe('Rail — Site cash (FR-IMP-074)', () => {
  it.each(['Finance', 'Project Manager', 'Admin', 'Executive'])('FR-IMP-074: %s sees the Site cash item', (role) => {
    renderRailAs(role);
    expect(screen.getByRole('link', { name: 'Site cash' })).toHaveAttribute('href', '/imprest');
  });
  it('FR-IMP-074: an Engineer does not see Site cash (no float is visible to them)', () => {
    renderRailAs('Engineer');
    expect(screen.queryByRole('link', { name: 'Site cash' })).not.toBeInTheDocument();
  });
});

describe('Rail — role-shaped nav Approvals (B-2, AC-W2-IXD-003)', () => {
  it('AC-W2-IXD-003: a PM sees the Approvals nav item (authorized approver)', () => {
    renderRailAs('Project Manager');
    expect(screen.getByRole('link', { name: /approvals/i })).toBeInTheDocument();
  });

  it('AC-W2-IXD-003: an Engineer does NOT see the Approvals nav item (IC — cannot approve)', () => {
    renderRailAs('Engineer');
    // OD-W2-2: Engineer approval stays OFF. An IC reaching Approvals only sees an empty queue
    // that says "from your reports" — misleading if they have no reports. Remove the nav item.
    expect(screen.queryByRole('link', { name: /approvals/i })).not.toBeInTheDocument();
  });

  it('AC-W2-IXD-003: an Executive sees the Approvals nav item', () => {
    renderRailAs('Executive');
    expect(screen.getByRole('link', { name: /approvals/i })).toBeInTheDocument();
  });

  it('AC-W2-IXD-003: an Admin sees the Approvals nav item', () => {
    renderRailAs('Admin');
    expect(screen.getByRole('link', { name: /approvals/i })).toBeInTheDocument();
  });

  it('UXS-007: a Project Manager can discover assigned work with its cross-project meaning in the rail', () => {
    renderRailAs('Project Manager');
    const link = screen.getByRole('link', { name: /^My Tasks$/ });
    expect(link).toHaveAttribute('href', '/my-tasks');
    // FIN-S9: the name says it; no sub-line, no description wiring.
    expect(link).not.toHaveAttribute('aria-describedby');
    expect(within(link).queryByText('Your assigned work across projects')).not.toBeInTheDocument();
  });

  it('AC-TASK-FIN-001: Finance gets the My Tasks doorway in the rail', () => {
    renderRailAs('Finance');
    expect(screen.getByRole('link', { name: /^My Tasks$/ })).toHaveAttribute('href', '/my-tasks');
  });

  it('UXS-007: the personal task doorway does not change Executive navigation', () => {
    renderRailAs('Executive');
    expect(screen.queryByRole('link', { name: 'My Tasks' })).not.toBeInTheDocument();
  });

  it('FIN-S9: there is no Suppliers rail item when CRM is enabled and no My integrations item', () => {
    renderRailAs('Admin');
    expect(screen.queryByRole('link', { name: 'Suppliers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /my integrations/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Companies' })).toHaveAttribute('href', '/companies');
  });
});
