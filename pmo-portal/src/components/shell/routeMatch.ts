import { matchPath } from 'react-router-dom';
import type { IconName } from '@/src/components/ui/icons';
import type { BreadcrumbPart } from './Breadcrumb';
import { PLACEHOLDER_TITLES } from './deriveBreadcrumb';
import { DASHBOARD_TAB, type WorkspaceTab } from './workspaceTabs';

interface ModuleDef {
  module: string;
  icon: IconName;
  label: string;
  /** Index route path. */
  path: string;
  /** Detail route pattern (record drill) + the param name carrying the id. */
  detail?: { pattern: string; param: string };
}

/** The module IA — index + detail routes the workspace strip tracks. */
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

/** Record-tab icon per owning module. */
const RECORD_ICON: Record<string, IconName> = {
  sales: 'pipe',
  procurement: 'cart',
  projects: 'folder',
};

/**
 * Derive the workspace tab a URL maps to (URL is the source of truth).
 * Detail routes become `record` tabs; index routes become `module` tabs.
 * Returns null when the path matches no tracked module (router falls back to
 * the dashboard route, which maps to the dashboard tab via the `/` match).
 */
export function tabForPath(pathname: string): WorkspaceTab | null {
  for (const m of MODULES) {
    // Detail route → record tab (check before the index so /sales/:id wins).
    if (m.detail) {
      const match = matchPath({ path: m.detail.pattern, end: true }, pathname);
      if (match) {
        const id = match.params[m.detail.param] ?? '';
        return {
          id: `${m.module}:${id}`,
          kind: 'record',
          path: pathname,
          icon: RECORD_ICON[m.module] ?? 'doc',
          label: id, // hydrated to a human label by the consuming surface
          code: id,
          module: m.module,
        };
      }
    }
    // Index route → module tab.
    if (matchPath({ path: m.path, end: true }, pathname)) {
      if (m.module === 'dashboard') return { ...DASHBOARD_TAB };
      return {
        id: m.module,
        kind: 'module',
        path: m.path,
        icon: m.icon,
        label: m.label,
        module: m.module,
      };
    }
  }
  return null;
}

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
 *   cold deep-link (label not yet known) it shows a neutral "Loading…" — never
 *   the raw URL id (fixes the M3/M4 UUID leak).
 * - Placeholder route (`/companies`, `/tasks`, …) → its own page label, not
 *   "Dashboard" (AC-NAV-005), via the shared `PLACEHOLDER_TITLES` map.
 * - Unknown route → a single Dashboard crumb (the `*` route renders the
 *   dashboard).
 *
 * `navigate` is optional so the helper is testable in isolation; when omitted
 * the module-segment crumb carries a safe no-op `onClick` so it still renders as
 * a link.
 */
export function breadcrumbForPath(
  pathname: string,
  recordLabel?: string,
  navigate?: (path: string) => void,
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
        return [
          { label: m.label, onClick: () => navigate?.(m.path) },
          { label: recordLabel || 'Loading…' },
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

/** The module tab for a rail click. */
export function moduleTab(moduleKey: string): WorkspaceTab | null {
  const m = MODULES.find((x) => x.module === moduleKey);
  if (!m) return null;
  if (m.module === 'dashboard') return { ...DASHBOARD_TAB };
  return {
    id: m.module,
    kind: 'module',
    path: m.path,
    icon: m.icon,
    label: m.label,
    module: m.module,
  };
}
