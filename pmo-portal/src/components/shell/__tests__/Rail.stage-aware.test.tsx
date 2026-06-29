import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
 * The active token is `bg-primary/10 font-semibold text-nav-active-text` (DESIGN.md §nav-item-active,
 * contrast-fixed: text-primary=#2563eb on primary/10 bg is 4.48:1 — just below AA 4.5:1;
 * text-nav-active-text=hsl(221 75% 38%)=#1a46aa gives 7.31:1 — AC-PR-026 fix).
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

import { Rail } from '../Rail';

/** Render Rail at a /projects/:id URL so NavLink URL-based logic would otherwise pick Projects. */
const renderRail = (override: 'salesPipeline' | 'projects' | null) =>
  render(
    <MemoryRouter initialEntries={['/projects/some-uuid']}>
      <Rail railActiveOverride={override} />
    </MemoryRouter>,
  );

const ACTIVE_CLASS_FRAGMENT = 'text-nav-active-text';

function isActive(el: HTMLElement): boolean {
  return el.className.includes(ACTIVE_CLASS_FRAGMENT);
}

describe('Rail — stage-aware rail highlight (Option A, Task D)', () => {
  it(
    'AC-IXD-PROJ-005 railActiveOverride=salesPipeline: Sales Pipeline is active, Projects is NOT',
    () => {
      const { unmount } = renderRail('salesPipeline');
      const salesLink = screen.getByRole('link', { name: /sales pipeline/i });
      const projectsLink = screen.getByRole('link', { name: /^projects$/i });

      expect(isActive(salesLink)).toBe(true);
      expect(isActive(projectsLink)).toBe(false);
      unmount();
    },
  );

  it(
    'railActiveOverride=projects: Projects is active, Sales Pipeline is NOT',
    () => {
      const { unmount } = renderRail('projects');
      const salesLink = screen.getByRole('link', { name: /sales pipeline/i });
      const projectsLink = screen.getByRole('link', { name: /^projects$/i });

      expect(isActive(projectsLink)).toBe(true);
      expect(isActive(salesLink)).toBe(false);
      unmount();
    },
  );

  it(
    'railActiveOverride=null (cold load): falls back to URL-based — Projects is active on /projects/:id',
    () => {
      renderRail(null);
      const projectsLink = screen.getByRole('link', { name: /^projects$/i });
      // URL prefix /projects matches → NavLink isActive=true → active class present
      expect(isActive(projectsLink)).toBe(true);
    },
  );
});
