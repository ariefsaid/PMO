import { matchPath } from 'react-router-dom';
import type { IconName } from '@/src/components/ui/icons';
import type { BreadcrumbPart } from './Breadcrumb';

interface ModuleDef {
  module: string;
  icon: IconName;
  label: string;
  /** Index route path. */
  path: string;
  /** Detail route pattern (record drill) + the param name carrying the id. */
  detail?: { pattern: string; param: string };
}

/** The module IA — the index + detail routes the rail and ⌘K palette read. */
export const MODULES: ModuleDef[] = [
  { module: 'dashboard', icon: 'grid', label: 'Dashboard', path: '/' },
  {
    module: 'sales',
    icon: 'pipe',
    label: 'Sales Pipeline',
    path: '/sales',
    detail: { pattern: '/sales/:opportunityId', param: 'opportunityId' },
  },
  {
    module: 'procurement',
    icon: 'cart',
    label: 'Procurement',
    path: '/procurement',
    detail: { pattern: '/procurement/:procurementId', param: 'procurementId' },
  },
  {
    module: 'projects',
    icon: 'folder',
    label: 'Projects',
    path: '/projects',
    detail: { pattern: '/projects/:projectId', param: 'projectId' },
  },
  { module: 'timesheets', icon: 'clock', label: 'Timesheets', path: '/timesheets' },
];

/**
 * C5 — placeholder route titles. These routes are intentionally NOT registered
 * as modules (they have no rail entry / ⌘K target yet), so a URL-derived
 * breadcrumb has no module to resolve and would otherwise fall back to
 * "Dashboard". This map is the single source of their page title, kept in sync
 * with the placeholder `<Route>` titles in App.tsx.
 */
export const PLACEHOLDER_TITLES: Record<string, string> = {
  '/tasks': 'Tasks',
  '/companies': 'Companies',
  '/incidents': 'Incidents',
  '/work-orders': 'Work Orders',
  '/reports': 'Reports',
  '/administration': 'Administration',
};

/**
 * Route-derived top-bar breadcrumb (URL is the single source of truth — the
 * existing invariant, preserved without the tab-state machine).
 *
 * - Module index route (`/projects`)  → a single current crumb `[Projects]`
 *   (AC-NAV-003).
 * - Detail route (`/projects/:id`, incl. the `/budget` deep-link variant)
 *   → `[Projects (link) > <record>]`, where the module segment navigates to its
 *   index via the passed-in `navigate` fn so the helper stays pure (AC-NAV-004).
 *   The record segment uses `recordLabel` once the cached list resolves it; on a
 *   cold deep-link while the list is still loading it shows a neutral "Loading…"
 *   — never the raw URL id (fixes the M3/M4 UUID leak). Once the list has
 *   RESOLVED but the record is still absent (a genuine not-found, e.g. a bad id),
 *   it resolves to a friendly "Not found" label instead of a perpetual
 *   "Loading…" (item I) — driven by the `recordResolved` flag.
 * - Placeholder route (`/companies`, `/tasks`, …) → its own page label, not
 *   "Dashboard" (AC-NAV-005), via the `PLACEHOLDER_TITLES` map.
 * - Unknown route → a single Dashboard crumb (the `*` route renders the
 *   dashboard).
 *
 * `navigate` is optional so the helper is testable in isolation; when omitted
 * the module-segment crumb carries a safe no-op `onClick` so it still renders as
 * a link. `recordResolved` defaults to false (still loading) so callers that
 * don't pass it keep the prior cold-deep-link "Loading…" behavior.
 */
export function breadcrumbForPath(
  pathname: string,
  recordLabel?: string,
  navigate?: (path: string) => void,
  recordResolved = false,
): BreadcrumbPart[] {
  // Placeholder routes win first — they are not tracked modules, so they would
  // otherwise fall through to the Dashboard fallback (AC-NAV-005).
  const placeholderTitle = PLACEHOLDER_TITLES[pathname];
  if (placeholderTitle) return [{ label: placeholderTitle }];

  for (const m of MODULES) {
    // Detail route → [module link > record]. The dashboard has no detail route.
    if (m.detail) {
      const indexMatch = matchPath({ path: m.path, end: true }, pathname);
      // A path under the module index with a further segment is a detail route
      // (covers `/projects/:id` and the `/projects/:id/budget` deep-link).
      const isDetail = !indexMatch && pathname.startsWith(`${m.path}/`);
      if (isDetail) {
        // recordLabel resolved → the record name; still loading → "Loading…";
        // resolved-but-absent (bad id / deleted) → "Not found", never a
        // perpetual "Loading…" once the error card has rendered (item I).
        const recordCrumb = recordLabel || (recordResolved ? 'Not found' : 'Loading…');
        return [
          { label: m.label, onClick: () => navigate?.(m.path) },
          { label: recordCrumb },
        ];
      }
    }
    // Index route → a single current crumb.
    if (matchPath({ path: m.path, end: true }, pathname)) {
      return [{ label: m.label }];
    }
  }

  // Unknown route → the dashboard (matches the router's `*` fallback).
  return [{ label: 'Dashboard' }];
}

/** Cached index lists the breadcrumb reads to resolve a detail route's name. */
export interface RecordLists {
  projects?: { id: string; name: string }[];
  opportunities?: { id: string; name: string }[];
  procurements?: { id: string; title: string }[];
}

/**
 * Resolves a detail route's record name from the cached index lists (the same
 * lists the ⌘K palette indexes) — the breadcrumb's `recordLabel` source. Pure:
 * it reads the passed-in lists, never a query. Returns the human title, or
 * `undefined` when the path is not a detail route or the record is not yet
 * cached (a cold deep-link) — never the raw URL id (fixes M3/M4).
 */
export function recordLabelForPath(
  pathname: string,
  lists: RecordLists,
): string | undefined {
  const idFrom = (prefix: string): string | undefined => {
    if (!pathname.startsWith(`${prefix}/`)) return undefined;
    // segment after the module prefix, dropping any trailing `/budget` etc.
    return pathname.slice(prefix.length + 1).split('/')[0] || undefined;
  };

  const projectId = idFrom('/projects');
  if (projectId) return lists.projects?.find((p) => p.id === projectId)?.name;

  const salesId = idFrom('/sales');
  if (salesId) return lists.opportunities?.find((o) => o.id === salesId)?.name;

  const procurementId = idFrom('/procurement');
  if (procurementId) return lists.procurements?.find((p) => p.id === procurementId)?.title;

  return undefined;
}
