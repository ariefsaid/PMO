import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ROLES, parseArgs, assignRoles, seedVars, crewWorkers, shellCalls } from './perf/load-mix.mjs';
import { seedId } from './perf/load-run.mjs';

test('seedId is the uuid Postgres md5(name)::uuid gives', () => {
  assert.match(seedId('x'), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(seedId('x').replaceAll('-', ''), '9dd4e461268c8034f5c8564e155c67a6'); // md5('x')
});
test('role shares add up to the whole', () => {
  assert.equal(Math.round(Object.values(ROLES).reduce((s, r) => s + r.share, 0) * 100), 100);
});
test('assignRoles: 500 users is the seeded account set exactly; 100 keeps the proportions', () => {
  const count = (vus) => vus.reduce((m, v) => ({ ...m, [v.role]: (m[v.role] || 0) + 1 }), {});
  assert.deepEqual(count(assignRoles(500)), { field_user: 220, foreman: 150, site_supervisor: 45, storekeeper: 20, project_manager: 30, finance_officer: 20, executive: 10, administrator: 5 });
  assert.deepEqual(count(assignRoles(100)), { field_user: 44, foreman: 30, site_supervisor: 9, storekeeper: 4, project_manager: 6, finance_officer: 4, executive: 2, administrator: 1 });
  assert.equal(assignRoles(7).length, 7);
  const v = assignRoles(500);
  assert.equal(new Set(v.map((x) => `${x.role}-${x.n}`)).size, 500); // every user its own account
});
test('seedVars names the account\'s own seeded rows', () => {
  const f = seedVars('field_user', 301);
  assert.equal(f.wo, 1); assert.equal(f.workOrderId, seedId('lf-wo-1')); assert.equal(f.crewId, seedId('lf-crew-1'));
  assert.equal(f.personId, seedId(`lf-person-${seedId('lf-user-field_user-301')}`));
  const fm = seedVars('foreman', 7);
  assert.deepEqual([fm.wo, fm.wo2], [7, 157]);
  assert.equal(seedVars('project_manager', 3).warehouseId, seedId('lf-wh-3'));
});
test('crewWorkers lists the crew\'s 10 workers and its field users', () => {
  assert.equal(crewWorkers(1).length, 11); // field user 1
  assert.equal(crewWorkers(221).length, 10); // no field user lands in crews past 220
  assert.equal(crewWorkers(2)[0], seedId('lf-person-11'));
});
test('shellCalls: calls every screen of a login makes are its shell', () => {
  const c = (path) => ({ method: 'GET', path });
  const fx = {
    a: { email: 'x', calls: [c('/p'), c('/a')] }, b: { email: 'x', calls: [c('/p'), c('/b')] },
    s: { email: 'y', calls: [c('/p'), c('/s')] },
  };
  const { sig, shell } = shellCalls(fx);
  assert.deepEqual([...shell.x], [sig(c('/p'))]);
  assert.deepEqual([...shell.y], [sig(c('/p'))]); // one screen: calls that 80% of all screens make
});
test('parseArgs refuses a remote target', () => {
  assert.throws(() => parseArgs(['--url', 'https://example.supabase.co']), /non-localhost/);
  assert.equal(parseArgs(['--users', '500']).users, 500);
  assert.throws(() => parseArgs(['--users', '0']));
});
test('every screen the mix names is in the captured fixture, with no capture-time ids', () => {
  const fx = JSON.parse(fs.readFileSync(new URL('./perf/load-mix-routes.json', import.meta.url), 'utf8'));
  for (const r of Object.values(ROLES)) for (const k of Object.keys(r.screens)) assert.ok(fx[k], k);
  const raw = JSON.stringify(fx);
  for (const id of [seedId('lf-wo-1'), seedId('lf-user-field_user-1'), '00000000-0000-0000-0000-000000000001']) assert.ok(!raw.includes(id), id);
  assert.doesNotMatch(raw, /\b20\d\d-\d\d-\d\d\b/);
});
