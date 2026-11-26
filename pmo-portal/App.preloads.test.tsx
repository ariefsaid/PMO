import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';

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

import { preloadsForPath, namespacesForPath, preloadForPath, subscribeToRoutePreloads } from './App';
import { i18next } from '@/src/lib/i18n';
import { queryClient } from '@/src/lib/queryClient';
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
    ['/administration/users', ['administration', 'costAttribution', 'plans', 'procurement', 'safety']],
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

it('#2919 starts the work order record, steps, costs and allocations at route entry', () => {
  const prefetch = vi.spyOn(queryClient, 'prefetchQuery').mockResolvedValue(undefined);
  try {
    preloadForPath('/work-orders/w1#wo-cost', { orgId: 'o1', client: queryClient });
    expect(prefetch.mock.calls.map(([options]) => options.queryKey)).toEqual([
      ['work-order', 'o1', 'w1'],
      ['work-order-billing-steps', 'o1', 'w1'],
      ['work-order-cost-lines', 'o1', 'w1'],
      ['work-order-lines', 'o1', 'wo', 'w1'],
    ]);
    prefetch.mockClear();
    preloadForPath('/work-orders/w1');
    expect(prefetch).not.toHaveBeenCalled();
  } finally {
    prefetch.mockRestore();
  }
});

it('#2919 starts work order reads during navigation, before the new page can commit', async () => {
  let finishLoader!: () => void;
  const loader = new Promise<null>((resolve) => { finishLoader = () => resolve(null); });
  const router = createMemoryRouter([
    { path: '/' },
    { path: '/work-orders/:id', loader: () => loader },
  ]);
  const prefetch = vi.spyOn(queryClient, 'prefetchQuery').mockResolvedValue(undefined);
  let unsubscribe: (() => void) | undefined;
  try {
    unsubscribe = subscribeToRoutePreloads(router, (href) => preloadForPath(href, { orgId: 'o1', client: queryClient }));
    const navigation = router.navigate('/work-orders/w1');
    expect(router.state.location.pathname).toBe('/');
    expect(prefetch.mock.calls.map(([options]) => options.queryKey)).toContainEqual(['work-order', 'o1', 'w1']);
    finishLoader();
    await navigation;
    expect(prefetch).toHaveBeenCalledTimes(4);
  } finally {
    finishLoader();
    unsubscribe?.();
    router.dispose();
    prefetch.mockRestore();
  }
});

it('#2895 starts the project orders panel reads at entry and respects the billing extra switches', async () => {
  const orgId = 'o1';
  const fetch = vi.spyOn(queryClient, 'fetchQuery').mockResolvedValue(true);
  const prefetch = vi.spyOn(queryClient, 'prefetchQuery').mockResolvedValue(undefined);
  try {
    const context = {
      orgId, client: queryClient, canViewWorkOrderPlan: true,
      viewer: { org_id: orgId, id: 'u1', role: 'Finance' as const, manager_id: null },
    };
    preloadForPath('/projects/p1/orders', context);
    expect(prefetch.mock.calls.map(([options]) => options.queryKey)).toEqual(expect.arrayContaining([
      ['work-orders', orgId, 'p1', 'u1', 'Finance', null],
      ['work-order-plan-vs-actual', orgId, 'p1'],
    ]));
    expect(fetch.mock.calls.map(([options]) => options.queryKey)).toEqual([
      ['org-setting', orgId, 'moduleBillingExtras'],
      ['org-setting', orgId, 'disciplineProfit'],
    ]);
    await vi.waitFor(() => expect(prefetch.mock.calls.map(([options]) => options.queryKey)).toContainEqual(['earned-billed', orgId, 'p1']));

    fetch.mockResolvedValue(false);
    prefetch.mockClear();
    preloadForPath('/projects/p2/orders', context);
    await Promise.resolve();
    expect(prefetch.mock.calls.map(([options]) => options.queryKey)).not.toContainEqual(['earned-billed', orgId, 'p2']);
  } finally {
    fetch.mockRestore();
    prefetch.mockRestore();
  }
});

it.each(['/contract?openType=billingClaim', '/billing?openType=billingClaim', '/work-orders?openType=workOrderClaim'])(
  '#2893 starts claim stage and claim list reads together at %s',
  (suffix) => {
    const prefetch = vi.spyOn(queryClient, 'prefetchQuery').mockResolvedValue(undefined);
    try {
      const href = `/projects/p1${suffix}&open=c1#claims`;
      preloadForPath(href, { orgId: 'o1', client: queryClient, canReadClaims: true });
      expect(prefetch.mock.calls.map(([options]) => options.queryKey)).toContainEqual(['claim-billing-trace', 'o1', 'c1', 'p1']);
      expect(prefetch.mock.calls.map(([options]) => options.queryKey)).toContainEqual(['progress-claims', 'o1', 'p1']);

      prefetch.mockClear();
      preloadForPath(href, { orgId: 'o1', client: queryClient });
      expect(prefetch.mock.calls.map(([options]) => options.queryKey)).not.toContainEqual(['claim-billing-trace', 'o1', 'c1', 'p1']);
    } finally {
      prefetch.mockRestore();
    }
  },
);
