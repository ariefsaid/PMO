import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';

/**
 * Stage-aware rail highlight (Option A, Task D).
 *
 * When viewing a `/projects/:id` detail route, the rail must highlight the
 * nav item that matches the record's stage group — NOT just the URL prefix:
 *
 *  - pre-win / lost project  → "Sales Pipeline" is active, "Projects" is NOT
 *  - on-hand project         → "Projects" is active, "Sales Pipeline" is NOT
 *  - null (cold load)        → falls back to URL-based: "Projects" active
 *    (because `/projects/:id` prefix matches the Projects NavLink)
 *
 * Mechanism: `railActiveOverride` prop on <Rail>:
 *   'salesPipeline' | 'projects' | null
 *
 * Selected destinations expose `aria-current="page"` as well as the visual state.
 */

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
const renderRail = (override: 'salesPipeline' | 'projects' | null) =>
  render(
    <MemoryRouter initialEntries={['/projects/some-uuid']}>
      <Rail railActiveOverride={override} />
    </MemoryRouter>,
  );

function isCurrent(el: HTMLElement): boolean {
  return el.getAttribute('aria-current') === 'page';
}

describe('Rail — stage-aware rail highlight (Option A, Task D)', () => {
  it(
    'AC-IXD-PROJ-005 railActiveOverride=salesPipeline: Sales Pipeline is active, Projects is NOT',
    () => {
      const { unmount } = renderRail('salesPipeline');
      const salesLink = screen.getByRole('link', { name: /sales pipeline/i });
      const projectsLink = screen.getByRole('link', { name: /^projects$/i });

      expect(isCurrent(salesLink)).toBe(true);
      expect(isCurrent(projectsLink)).toBe(false);
      unmount();
    },
  );

  it(
    'railActiveOverride=projects: Projects is active, Sales Pipeline is NOT',
    () => {
      const { unmount } = renderRail('projects');
      const salesLink = screen.getByRole('link', { name: /sales pipeline/i });
      const projectsLink = screen.getByRole('link', { name: /^projects$/i });

      expect(isCurrent(projectsLink)).toBe(true);
      expect(isCurrent(salesLink)).toBe(false);
      unmount();
    },
  );

  it(
    'railActiveOverride=null (cold load): falls back to URL-based — Projects is active on /projects/:id',
    () => {
      renderRail(null);
      const projectsLink = screen.getByRole('link', { name: /^projects$/i });
      // URL prefix /projects matches and marks the current destination.
      expect(isCurrent(projectsLink)).toBe(true);
    },
  );
});
