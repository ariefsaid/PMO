import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIT_DIRS, collectFound, evaluate } from './audit-prod.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const planted = {
  vulnerabilities: {
    pkg: { severity: 'high', via: [{ title: 't', url: 'https://example.test/advisories/GHSA-test-test-test' }] },
    low: { severity: 'low', via: [{ title: 'l', url: 'https://example.test/advisories/GHSA-low-low-low' }] },
  },
};

test('AC-2319 audit covers the scripts folder and the app', () => {
  const dirs = AUDIT_DIRS.map((d) => path.resolve(d));
  assert.ok(dirs.includes(path.resolve(HERE)), 'scripts/ must be audited');
  assert.ok(dirs.includes(path.resolve(HERE, '..', 'pmo-portal')), 'pmo-portal/ must be audited');
});

test('AC-2319 planted high advisory is unwaived and fails; low is ignored', () => {
  const found = collectFound(planted);
  assert.deepEqual([...found.keys()], ['GHSA-test-test-test']);
  assert.equal(evaluate(found, [], '2026-01-01').unwaived.length, 1);
});

test('AC-2319 waiver suppresses until expiry, then fails as expired', () => {
  const found = collectFound(planted);
  const w = [{ ghsa: 'GHSA-test-test-test', package: 'pkg', reason: 'r', expires: '2026-06-01' }];
  const ok = evaluate(found, w, '2026-05-01');
  assert.equal(ok.unwaived.length, 0);
  assert.equal(ok.active.length, 1);
  const late = evaluate(found, w, '2026-07-01');
  assert.equal(late.expired.length, 1);
  assert.equal(late.unwaived.length, 1);
});
