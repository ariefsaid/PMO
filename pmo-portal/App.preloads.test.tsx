import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

const permissionState = vi.hoisted(() => ({ role: 'Finance' }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => action === 'view' && entity === 'finance' && ['Finance', 'Executive', 'Admin'].includes(permissionState.role),
}));

import { preloadsForPath } from './App';

afterEach(cleanup);

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
