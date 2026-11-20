import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { baselineKey, routePattern } from './ux-proof-settings.mjs';

test('record baselines apply to other IDs while query views stay distinct', () => {
  const budget = JSON.parse(readFileSync(new URL('../docs/ux/word-budget.json', import.meta.url)));
  const route = '/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const key = baselineKey(budget, route, 390, 'pm@acme.test');
  assert.equal(budget[key], 133);
  assert.equal(budget.targets[key], 0);
  assert.equal(routePattern(`${route}/tasks?view=board&scope=all`), '/projects/:id/tasks?view=board&scope=all');
  const boardKey = baselineKey(budget, `${route}/tasks?view=board&scope=all`, 390, 'pm@acme.test');
  assert.equal(budget[boardKey], 70);
});

import { routeTablePaths, routePatternFor, baselineKey as bk } from './ux-proof-settings.mjs';

const TABLE = [
  '/', '/projects', '/projects/new', '/projects/:projectId/:tab', '/projects/:projectId',
  '/procurement/new', '/procurement/:procurementId', '/equipment/assets', '/equipment/assets/:assetId',
  '/master-data/:kind', '/work-orders', '/work-orders/:workOrderId', '/stock/new/:kind', '*',
];

test('routeTablePaths reads every path from the appRouteConfig block only', () => {
  const src = `const PRELOAD = [\n  { path: '/ignored/:x', chunks: [] },\n];\nexport const appRouteConfig: RouteObject[] = [\n  { path: '/', element: <A /> },\n  { path: "/work-orders/:workOrderId", element: <B /> },\n];\nexport const AppRoutes = 1;`;
  assert.deepEqual(routeTablePaths(src), ['/', '/work-orders/:workOrderId']);
  assert.throws(() => routeTablePaths('nothing'), /appRouteConfig/);
});

test('pattern normalisation: non-uuid ids, nested routes, query, trailing slash, hash', () => {
  const p = (r) => routePatternFor(r, TABLE);
  assert.equal(p('/work-orders/WO-1042'), '/work-orders/:id');
  assert.equal(p('/work-orders/1042/'), '/work-orders/:id');
  assert.equal(p('/equipment/assets/ast_77'), '/equipment/assets/:id');
  assert.equal(p('/projects/p-1/budget'), '/projects/:id/budget');
  assert.equal(p('/projects/p-1/tasks?view=board&scope=all#x'), '/projects/:id/tasks?view=board&scope=all');
  assert.equal(p('/projects/new'), '/projects/new');
  assert.equal(p('/procurement/new?have=need'), '/procurement/new?have=need');
  assert.equal(p('/projects'), '/projects');
  assert.equal(p('/projects/'), '/projects');
  assert.equal(p('/'), '/');
  assert.equal(p('/master-data/units'), '/master-data/units');
  assert.equal(p('/stock/new/receipt'), '/stock/new/receipt');
});

test('pattern normalisation falls back to uuid detection for routes outside the table', () => {
  assert.equal(routePatternFor('/mystery/3f2b8c1e-9d4a-4e7b-8a61-0c5d2e9f7a14', TABLE), '/mystery/:id');
  assert.equal(routePatternFor('/mystery/abc', TABLE), '/mystery/abc');
});

test('baselineKey: exact legacy key wins, else the pattern key shared by every record id', () => {
  const budget = { '/work-orders/:id@1440@exec': 50, '/work-orders/WO-1@1440@exec': 40 };
  assert.equal(bk(budget, '/work-orders/WO-1', 1440, 'exec', TABLE), '/work-orders/WO-1@1440@exec');
  assert.equal(bk(budget, '/work-orders/WO-2', 1440, 'exec', TABLE), '/work-orders/:id@1440@exec');
  assert.equal(bk({}, '/work-orders/WO-2', 390, 'exec', TABLE), '/work-orders/:id@390@exec');
});

test('shrink-only on a pattern key: another record id is compared against the shared baseline', () => {
  const budget = { '/work-orders/:id@1440@exec': 50 };
  const key = bk(budget, '/work-orders/WO-9', 1440, 'exec', TABLE);
  assert.equal(budget[key], 50);
  assert.ok(45 <= budget[key], 'fewer words passes');
  assert.ok(!(60 <= budget[key]), 'more words than the baseline fails');
});

test('the shipped App.tsx route table yields the work-order and asset detail patterns', async () => {
  const { readFileSync } = await import('node:fs');
  const paths = routeTablePaths(readFileSync(new URL('../pmo-portal/App.tsx', import.meta.url), 'utf8'));
  assert.ok(paths.includes('/projects/:projectId'));
  assert.equal(routePatternFor('/equipment/assets/abc-1', paths), '/equipment/assets/:id');
  assert.equal(routePatternFor('/projects/abc-1/budget', paths), '/projects/:id/budget');
});
