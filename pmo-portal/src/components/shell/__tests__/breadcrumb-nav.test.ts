import { describe, it, expect, vi } from 'vitest';
import { breadcrumbForPath, recordLabelForPath } from '../routeMatch';
import { PLACEHOLDER_TITLES } from '../deriveBreadcrumb';

/**
 * Route-derived breadcrumb helper (supersedes the tab-backed `deriveBreadcrumb`
 * once the tab layer is removed). The helper is pure: a module-segment crumb's
 * `onClick` is built from a `navigate` fn passed in, so the helper never reaches
 * into the router itself. URL is the single source of truth (the existing
 * invariant) — the crumbs are derived from `pathname`, never from tab state.
 *
 * AC-NAV-003 (module route → single current crumb)
 * AC-NAV-004 (detail route → [module link > record current], module navigates)
 * AC-NAV-005 (placeholder route → its own page label, not "Dashboard")
 */
describe('breadcrumbForPath (route-derived breadcrumb)', () => {
  it('AC-NAV-003: a module index route renders a single current crumb', () => {
    expect(breadcrumbForPath('/projects')).toEqual([{ label: 'Projects' }]);
    expect(breadcrumbForPath('/sales')).toEqual([{ label: 'Sales Pipeline' }]);
    expect(breadcrumbForPath('/procurement')).toEqual([{ label: 'Procurement' }]);
    expect(breadcrumbForPath('/timesheets')).toEqual([{ label: 'Timesheets' }]);
  });

  it('AC-NAV-003: the dashboard root renders the Dashboard crumb', () => {
    expect(breadcrumbForPath('/')).toEqual([{ label: 'Dashboard' }]);
  });

  it('AC-NAV-004: a detail route with a resolved record name renders [module link > record current]', () => {
    const navigate = vi.fn();
    const crumbs = breadcrumbForPath('/projects/abc', 'Alpha', navigate);
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0].label).toBe('Projects');
    expect(typeof crumbs[0].onClick).toBe('function');
    // the module segment navigates to the module index (not the detail route)
    crumbs[0].onClick!();
    expect(navigate).toHaveBeenCalledWith('/projects');
    // the record segment is the current crumb (no onClick)
    expect(crumbs[1]).toEqual({ label: 'Alpha' });
  });

  it('AC-NAV-004: every detail-bearing module derives its parent crumb', () => {
    const navigate = vi.fn();
    expect(breadcrumbForPath('/sales/o1', 'Acme Deal', navigate)[0].label).toBe('Sales Pipeline');
    expect(breadcrumbForPath('/procurement/pr1', 'Crane hire', navigate)[0].label).toBe('Procurement');
  });

  it('AC-NAV-004: a detail route WITHOUT a resolved record name shows a neutral "Loading…" current segment (never a raw id)', () => {
    const crumbs = breadcrumbForPath('/projects/9f3a-uuid');
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0].label).toBe('Projects');
    expect(crumbs[1].label).toBe('Loading…');
    // the raw URL id must never leak into a visible label (fixes M3/M4)
    expect(crumbs[1].label).not.toContain('9f3a-uuid');
  });

  it('AC-NAV-004: the module segment is a no-op-safe crumb when no navigate fn is provided', () => {
    const crumbs = breadcrumbForPath('/projects/abc', 'Alpha');
    expect(crumbs[0].label).toBe('Projects');
    // onClick is still callable (a safe no-op) so the Breadcrumb renders it as a link
    expect(typeof crumbs[0].onClick).toBe('function');
    expect(() => crumbs[0].onClick!()).not.toThrow();
  });

  it('AC-NAV-005: a placeholder route reads its OWN page label, not "Dashboard"', () => {
    expect(breadcrumbForPath('/companies')).toEqual([{ label: 'Companies' }]);
    expect(breadcrumbForPath('/tasks')).toEqual([{ label: 'Tasks' }]);
    expect(breadcrumbForPath('/work-orders')).toEqual([{ label: 'Work Orders' }]);
    expect(breadcrumbForPath('/reports')).toEqual([{ label: 'Reports' }]);
    expect(breadcrumbForPath('/administration')).toEqual([{ label: 'Administration' }]);
  });

  it('AC-NAV-005: every placeholder route in the title map resolves to a non-Dashboard crumb', () => {
    for (const [path, title] of Object.entries(PLACEHOLDER_TITLES)) {
      expect(breadcrumbForPath(path)).toEqual([{ label: title }]);
      expect(title).not.toBe('Dashboard');
    }
  });

  it('an unknown route falls back to a single Dashboard crumb', () => {
    expect(breadcrumbForPath('/totally-unknown')).toEqual([{ label: 'Dashboard' }]);
  });

  it('the /budget deep-link route resolves under the Projects module', () => {
    // /projects/:id/budget is a detail variant — it still derives [Projects > record]
    const navigate = vi.fn();
    const crumbs = breadcrumbForPath('/projects/abc/budget', 'Alpha', navigate);
    expect(crumbs[0].label).toBe('Projects');
    expect(crumbs[1]).toEqual({ label: 'Alpha' });
  });
});

/**
 * `recordLabelForPath` resolves a detail route's record name from the cached
 * index lists (the same lists the ⌘K palette indexes) — the breadcrumb's
 * `recordLabel` source. Pure: it reads the passed-in lists, never a query.
 * It must return the human title, never a raw URL id (fixes M3/M4).
 */
describe('recordLabelForPath (cached-list label resolution)', () => {
  const lists = {
    projects: [
      { id: 'p1', name: 'Innovate HQ Fit-Out' },
      { id: 'p2', name: 'Northwind ERP' },
    ],
    opportunities: [{ id: 'o1', name: 'Acme Deal' }],
    procurements: [{ id: 'pr1', title: 'Crane hire' }],
  };

  it('resolves a project detail route to the project name', () => {
    expect(recordLabelForPath('/projects/p1', lists)).toBe('Innovate HQ Fit-Out');
  });

  it('resolves the /budget deep-link to the same project name', () => {
    expect(recordLabelForPath('/projects/p2/budget', lists)).toBe('Northwind ERP');
  });

  it('resolves an opportunity detail route to the opportunity name', () => {
    expect(recordLabelForPath('/sales/o1', lists)).toBe('Acme Deal');
  });

  it('resolves a procurement detail route to the procurement title', () => {
    expect(recordLabelForPath('/procurement/pr1', lists)).toBe('Crane hire');
  });

  it('returns undefined for a module index route (no record)', () => {
    expect(recordLabelForPath('/projects', lists)).toBeUndefined();
    expect(recordLabelForPath('/', lists)).toBeUndefined();
  });

  it('returns undefined (never the raw id) for an unresolved detail route — cold deep-link', () => {
    expect(recordLabelForPath('/projects/9f3a-not-cached', lists)).toBeUndefined();
  });
});
