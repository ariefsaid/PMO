import { describe, it, expect, vi } from 'vitest';
import { deriveBreadcrumb, PLACEHOLDER_TITLES } from '../deriveBreadcrumb';
import { DASHBOARD_TAB, type WorkspaceTab } from '../workspaceTabs';

const moduleTab = (module: string, label: string): WorkspaceTab => ({
  id: module,
  kind: 'module',
  path: `/${module}`,
  icon: 'grid',
  label,
  module,
});

const recordTab = (module: string, label: string): WorkspaceTab => ({
  id: `${module}:r1`,
  kind: 'record',
  path: `/${module}/r1`,
  icon: 'folder',
  label,
  code: 'r1',
  module,
});

describe('deriveBreadcrumb (App breadcrumb derivation)', () => {
  it('module tab renders a single crumb with the tab label', () => {
    const crumbs = deriveBreadcrumb(moduleTab('projects', 'Projects'), '/projects', vi.fn());
    expect(crumbs).toEqual([{ label: 'Projects' }]);
  });

  it('record tab renders [parent module > record] with a navigable parent', () => {
    const openModule = vi.fn();
    const crumbs = deriveBreadcrumb(recordTab('sales', 'Acme Deal'), '/sales/r1', openModule);
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0].label).toBe('Sales Pipeline');
    expect(typeof crumbs[0].onClick).toBe('function');
    crumbs[0].onClick!();
    expect(openModule).toHaveBeenCalledWith('sales');
    expect(crumbs[1]).toEqual({ label: 'Acme Deal' });
  });

  it('C5: a placeholder route reads its own page title, not "Dashboard"', () => {
    // At /reports the active tab yields no module match — the breadcrumb must
    // read the page label from the pathname, not fall back to Dashboard.
    expect(deriveBreadcrumb(DASHBOARD_TAB, '/reports', vi.fn())).toEqual([{ label: 'Reports' }]);
    expect(deriveBreadcrumb(DASHBOARD_TAB, '/tasks', vi.fn())).toEqual([{ label: 'Tasks' }]);
    expect(deriveBreadcrumb(null, '/administration', vi.fn())).toEqual([
      { label: 'Administration' },
    ]);
  });

  it('C5: every placeholder route in the title map resolves to a non-Dashboard crumb', () => {
    for (const [path, title] of Object.entries(PLACEHOLDER_TITLES)) {
      expect(deriveBreadcrumb(DASHBOARD_TAB, path, vi.fn())).toEqual([{ label: title }]);
      expect(title).not.toBe('Dashboard');
    }
  });

  it('falls back to Dashboard only when there is no active tab and no placeholder match', () => {
    expect(deriveBreadcrumb(null, '/', vi.fn())).toEqual([{ label: 'Dashboard' }]);
  });

  it('a real module route is unaffected by the placeholder fallback', () => {
    // /sales is a real module — the tab label wins, never a placeholder title.
    expect(deriveBreadcrumb(moduleTab('sales', 'Sales Pipeline'), '/sales', vi.fn())).toEqual([
      { label: 'Sales Pipeline' },
    ]);
  });
});
