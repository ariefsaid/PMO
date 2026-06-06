import { matchPath } from 'react-router-dom';
import type { IconName } from '@/src/components/ui/icons';
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
