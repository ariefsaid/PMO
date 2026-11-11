import { describe, expect, it } from 'vitest';
import { breadcrumbForPath, ADMINISTRATION_SECTION_LABELS, CHILD_PAGE_CRUMB, MODULES } from '../routeMatch';
import { ALL_ITEMS } from '../Rail';

describe('place-name coherence (R2-NAMES-FIX)', () => {
  it('for each fixed top-level route, the top-bar name equals the navigation label', () => {
    const fixedTopLevelRoutes = [
      { path: '/companies?type=Vendor', expected: 'Suppliers' },
      { path: '/stock', expected: 'Stock' },
      { path: '/finance/statements', expected: 'Statements' },
      { path: '/procurement', expected: 'Procurement' },
    ] as const;

    for (const { path, expected } of fixedTopLevelRoutes) {
      const crumbs = breadcrumbForPath(path);
      const topBarName = crumbs[crumbs.length - 1].label;
      const navItem = ALL_ITEMS.find((item) => item.to === path);
      expect(navItem, `Nav item for ${path} must exist in Rail ALL_ITEMS`).toBeDefined();
      expect(topBarName, `Top-bar name for ${path}`).toBe(navItem!.text);
      expect(topBarName, `Top-bar name for ${path}`).toBe(expected);

      const moduleEntry = MODULES.find((m) => m.path === path);
      expect(moduleEntry, `Module entry for ${path} must exist in MODULES`).toBeDefined();
      expect(moduleEntry!.label, `Module label for ${path}`).toBe(expected);
    }
  });

  it('for each fixed Administration section route, the top-bar crumb equals the section nav label', () => {
    const fixedAdminSections = [
      ['/administration/users', 'users', 'Users'],
      ['/administration/integrations', 'integrations', 'Organization integrations'],
      ['/administration/accounting', 'accounting', 'Accounting setup'],
      ['/administration/projects', 'projects', 'Project setup'],
      ['/administration/plan', 'plan', 'Your plan'],
      ['/administration/credits', 'credits', 'Credits'],
      ['/administration/usage', 'usage', 'Usage'],
      ['/administration/features', 'features', 'Features'],
      ['/administration/exchange-rates', 'exchange-rates', 'Exchange rates'],
      ['/administration/cost-attribution', 'cost-attribution', 'Cost attribution'],
    ] as const;

    for (const [path, section, expected] of fixedAdminSections) {
      const crumbs = breadcrumbForPath(path);
      const topBarName = crumbs[crumbs.length - 1].label;
      const navLabel = ADMINISTRATION_SECTION_LABELS[section as keyof typeof ADMINISTRATION_SECTION_LABELS];
      expect(topBarName, `Top-bar name for ${path}`).toBe(navLabel);
      expect(topBarName, `Top-bar name for ${path}`).toBe(expected);
    }
  });

  it('for each fixed stock/equipment sub-route, the top-bar current crumb equals the tab/child nav label', () => {
    const fixedChildRoutes = [
      { path: '/stock/documents', expected: 'Documents' },
      { path: '/stock/ledger', expected: 'Ledger' },
      { path: '/stock/reorder', expected: 'Reorder' },
      { path: '/equipment/assets', expected: 'Assets' },
    ] as const;

    for (const { path, expected } of fixedChildRoutes) {
      const crumbs = breadcrumbForPath(path);
      const topBarName = crumbs[crumbs.length - 1].label;
      const childConfig = CHILD_PAGE_CRUMB[path];
      expect(childConfig, `CHILD_PAGE_CRUMB config for ${path}`).toBeDefined();
      expect(topBarName, `Top-bar name for ${path}`).toBe(childConfig.label);
      expect(topBarName, `Top-bar name for ${path}`).toBe(expected);
    }
  });
});
