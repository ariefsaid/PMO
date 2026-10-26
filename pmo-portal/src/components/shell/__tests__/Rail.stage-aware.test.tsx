import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';

/** Every project record keeps one canonical current destination: Projects. */

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole: 'Project Manager',
    realRole: 'Project Manager',
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
// CRM enabled so the Sales Pipeline item is visible (Project Manager role).
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
    },
    isPending: false,
    isError: false,
  }),
}));

// useIsOperator is queried by Rail's real-Operator Administration footer; default to false
// (plain role) unless a specific test overrides it. Avoids a QueryClient in the harness.
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
import { Rail } from '../Rail';

/** Render Rail at a /projects/:id URL so NavLink URL-based logic would otherwise pick Projects. */
const renderRail = (override: 'projects' | null) =>
  render(
    <MemoryRouter initialEntries={['/projects/some-uuid']}>
      <Rail railActiveOverride={override} />
    </MemoryRouter>,
  );

describe('Rail — canonical project record destination', () => {
  it('keeps Projects as the only current destination for a project record', () => {
    renderRail('projects');
    expect(screen.getByRole('link', { name: /^projects$/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /sales pipeline/i })).not.toHaveAttribute('aria-current', 'page');
  });

  it('keeps Projects current during a cold load with no override', () => {
    renderRail(null);
    expect(screen.getByRole('link', { name: /^projects$/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /sales pipeline/i })).not.toHaveAttribute('aria-current', 'page');
  });
});
