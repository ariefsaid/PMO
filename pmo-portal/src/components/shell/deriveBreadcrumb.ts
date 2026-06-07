import type { BreadcrumbPart } from './Breadcrumb';
import { MODULES } from './routeMatch';
import type { WorkspaceTab } from './workspaceTabs';

/**
 * C5 — placeholder route titles. These routes are intentionally NOT registered
 * as modules (they have no rail entry / ⌘K target yet), so the tab-derived
 * breadcrumb has no module to resolve and would otherwise fall back to
 * "Dashboard". This map is the single source of their page title, kept in sync
 * with the placeholder `<Route>` titles in App.tsx. The pathname → title
 * fallback is forward-compatible: it survives the planned tabbed-workspace
 * removal because it keys off the URL, not the tab model.
 */
export const PLACEHOLDER_TITLES: Record<string, string> = {
  '/tasks': 'Tasks',
  '/companies': 'Companies',
  '/work-orders': 'Work Orders',
  '/reports': 'Reports',
  '/administration': 'Administration',
};

/**
 * Derive the top-bar breadcrumb from the active workspace tab + the current
 * pathname. A record tab renders `[parent module > record]`; a module tab
 * renders a single crumb. When the active tab yields no meaningful crumb (a
 * placeholder route leaves the active tab on Dashboard / null), the pathname is
 * consulted via `PLACEHOLDER_TITLES` so the bar reads e.g. "Reports", not the
 * misleading "Dashboard". Pure + side-effect-free except the parent crumb's
 * `onClick`, which is delegated to `openModule`.
 */
export function deriveBreadcrumb(
  activeTab: WorkspaceTab | null | undefined,
  pathname: string,
  openModule: (module: string) => void,
): BreadcrumbPart[] {
  // A known placeholder route always wins over the tab fallback — its own tab
  // never updates (it is not a tracked module), so the tab would read stale.
  const placeholderTitle = PLACEHOLDER_TITLES[pathname];

  if (!activeTab) {
    return placeholderTitle ? [{ label: placeholderTitle }] : [{ label: 'Dashboard' }];
  }

  if (activeTab.kind === 'record') {
    const mod = MODULES.find((m) => m.module === activeTab.module);
    return [
      { label: mod?.label ?? activeTab.module, onClick: () => openModule(activeTab.module) },
      { label: activeTab.label },
    ];
  }

  // Module tab: a placeholder route still wins (the active module tab is stale
  // for an untracked route — e.g. landing on /reports with Dashboard active).
  if (placeholderTitle) return [{ label: placeholderTitle }];
  return [{ label: activeTab.label }];
}
