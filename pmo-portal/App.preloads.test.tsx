import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

const permissionState = vi.hoisted(() => ({ role: 'Finance' }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => action === 'view' && entity === 'finance' && ['Finance', 'Executive', 'Admin'].includes(permissionState.role),
}));

// These tests assert WHAT a route preloads, never that a chunk really downloads. Loading the real
// pages here starts ~30 s of module graph for no assertion — and leaves imports resolving after the
// environment is torn down.
vi.mock('@/src/lib/lazyWithPreload', () => {
  const inert = () => ({ preload: async () => ({}) });
  return { lazyWithPreload: inert };
});

import { preloadsForPath, namespacesForPath, preloadForPath } from './App';
import { i18next } from '@/src/lib/i18n';
import { appRouteConfig } from './App';
import fs from 'node:fs';
import path from 'node:path';
import { NAMESPACES } from '@/src/lib/i18n';

afterEach(cleanup);

describe('#2097: route preload rules load the route namespace in parallel with its chunk', () => {
  it.each([
    ['/projects', ['projects']],
    // PH1 "one home at every width": / is the phone's landing route too, and its bottom bar
    // labels (PhoneNavBar) come from `home`, so the dashboard's first paint needs that catalogue.
    ['/', ['dashboard', 'home']],
    ['/procurement', ['procurement', 'procurementList']],
    ['/finance/receivables', ['finance', 'financeHub']],
    ['/administration/users', ['administration', 'costAttribution', 'plans', 'procurement']],
    ['/settings/profile', ['profilePreferences']],
    ['/stock/ledger', ['stock']],
  ])('%s preloads %j', (route, expected) => {
    expect(namespacesForPath(route)).toEqual(expected);
  });

  it('preloadForPath asks i18next for the route namespaces (they ride with the chunk)', () => {
    const loadNamespaces = vi.spyOn(i18next, 'loadNamespaces').mockResolvedValue({} as never);
    preloadForPath('/projects');
    expect(loadNamespaces).toHaveBeenCalledWith(['projects']);
    loadNamespaces.mockRestore();
  });

  it('a route with no namespace of its own asks for none', () => {
    const loadNamespaces = vi.spyOn(i18next, 'loadNamespaces').mockResolvedValue({} as never);
    preloadForPath('/views');
    expect(loadNamespaces).not.toHaveBeenCalled();
    loadNamespaces.mockRestore();
  });

  it('every namespace a rule names is a real catalogue in en AND id', () => {
    const routes = [
      '/', '/projects', '/projects/new', '/projects/p1/budget', '/projects/p1/contract',
      '/projects/p1', '/sales', '/sales/s1', '/procurement', '/procurement/new',
      '/procurement/p1', '/procurement/p1/overview', '/timesheets', '/approvals', '/companies',
      '/master-data/users', '/companies/c1', '/contacts', '/contacts/c1', '/incidents',
      '/incidents/i1', '/my-tasks', '/calendar', '/meetings', '/meetings/new', '/meetings/m1',
      '/expenses', '/expenses/new', '/expenses/e1', '/imprest', '/imprest/i1', '/equipment',
      '/equipment/assets', '/equipment/assets/a1', '/reports', '/administration',
      '/administration/users', '/finance', '/finance/receivables', '/finance/payables',
      '/finance/reports', '/finance/statements', '/sales-invoices', '/sales-invoices/i1',
      '/incoming-payments', '/incoming-payments/r1', '/revenue-by-project', '/erp-purchases',
      '/financial-statements', '/integrations', '/views', '/views/new', '/views/v1/edit',
      '/views/v1', '/settings/profile', '/stock', '/stock/setup', '/stock/documents',
      '/stock/documents/d1', '/stock/documents/d1/edit', '/stock/ledger', '/stock/reorder',
      '/stock/new/po', '/definitely/not/a/route',
    ];
    const named = new Set(routes.flatMap((route) => namespacesForPath(route)));
    expect(named.size).toBeGreaterThan(10);
    for (const namespace of named) {
      expect(NAMESPACES as readonly string[]).toContain(namespace);
      for (const locale of ['en', 'id']) {
        const file = path.join(process.cwd(), 'public', 'locales', locale, `${namespace}.json`);
        expect(fs.existsSync(file), `${locale}/${namespace}.json`).toBe(true);
      }
    }
  });

  it('every route the app serves has a preload rule (a raw route without one shows English chrome)', () => {
    for (const route of appRouteConfig) {
      const pathname = route.path?.startsWith('/') ? route.path.replace(/\/$/, '') || '/' : null;
      if (pathname === null) continue;
      expect(preloadsForPath(pathname).length, pathname).toBeGreaterThan(0);
    }
  });
});

describe('preloadsForPath (#1834 route-entry preload rules)', () => {
  it('maps static routes to their single route chunk', () => {
    expect(preloadsForPath('/procurement')).toHaveLength(1);
    expect(preloadsForPath('/timesheets')).toHaveLength(1);
    expect(preloadsForPath('/meetings')).toHaveLength(1);
  });

  it('search and hash are ignored; trailing slash normalises to the same rule', () => {
    const plain = preloadsForPath('/procurement');
    expect(preloadsForPath('/procurement?tab=all')).toEqual(plain);
    expect(preloadsForPath('/procurement/#section')).toEqual(plain);
    expect(preloadsForPath('/procurement/')).toEqual(plain);
  });

  it('meeting detail includes the MinutesEditor chunk — and both meeting routes share ONE memoized loader', () => {
    const detail = preloadsForPath('/meetings/ab27e123-0000-0000-0000-000000000001');
    const create = preloadsForPath('/meetings/new');
    expect(detail).toHaveLength(2);
    expect(create).toHaveLength(2);
    // The shared lazyMinutesEditor module: same preload handle everywhere, so the
    // editor chunk downloads once no matter which route fires first.
    expect(detail[1].preload).toBe(create[1].preload);
  });

  it('project detail preloads the overview S-curve alongside the page chunk', () => {
    expect(preloadsForPath('/projects/41000000-0000-0000-0000-000000000001')).toHaveLength(2);
  });

  it('a deep-linked lazy tab pulls the tab chunks in the same batch', () => {
    expect(preloadsForPath('/projects/p1/budget')).toHaveLength(3);
    // Contract renders cascade + billing tools + work orders together.
    expect(preloadsForPath('/projects/p1/contract')).toHaveLength(5);
  });

  it('literal routes beat params: /projects/new is the create page, not the detail bundle', () => {
    expect(preloadsForPath('/projects/new')).toHaveLength(1);
  });

  it('redirect routes preload the TARGET page chunks', () => {
    expect(preloadsForPath('/reports')).toHaveLength(1);
    expect(preloadsForPath('/sales-invoices')).toHaveLength(1);
    expect(preloadsForPath('/financial-statements')).toHaveLength(1);
  });

  it('unknown paths fall through to the catch-all chunk', () => {
    expect(preloadsForPath('/definitely/not/a/route')).toHaveLength(1);
  });

  it('every appRouteConfig path has a preload rule — spot-checks across the table', () => {
    const covered = [
      '/', '/sales', '/sales/sp-1', '/procurement/new', '/procurement/p-1', '/procurement/p-1/overview',
      '/approvals', '/companies', '/master-data/users', '/companies/c-1', '/contacts', '/contacts/c-1',
      '/incidents', '/incidents/i-1', '/my-tasks', '/expenses', '/expenses/new', '/expenses/x-1',
      '/imprest', '/imprest/f-1', '/equipment', '/equipment/assets', '/equipment/assets/a-1',
      '/administration/users', '/administration', '/finance', '/finance/receivables', '/finance/payables',
      '/finance/reports', '/finance/statements', '/sales-invoices/inv-1', '/incoming-payments',
      '/incoming-payments/r-1', '/revenue-by-project', '/erp-purchases', '/integrations',
      '/views', '/views/new', '/views/v-1/edit', '/views/v-1', '/settings/profile',
      '/stock', '/stock/setup', '/stock/documents', '/stock/documents/d-1', '/stock/documents/d-1/edit',
      '/stock/ledger', '/stock/reorder', '/stock/new/po',
    ];
    for (const path of covered) {
      expect(preloadsForPath(path).length, path).toBeGreaterThan(0);
    }
  });
});
