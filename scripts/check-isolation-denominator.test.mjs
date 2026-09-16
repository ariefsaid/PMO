/**
 * Unit tests for check-isolation-denominator.mjs (issue #612 item 1) — the standing guard that
 * fails the build when the isolation probe's denominator doesn't name a surface that exists.
 *
 * Only the PURE comparator (and entry formatter) are tested here — no Docker, no psql, no disk.
 * The live catalog/discovery orchestration is exercised by the CLI's normal run and its --self-test.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { compareDenominators, formatEntry, validateDenominator } from './check-isolation-denominator.mjs';

const fixture = () => ({
  tables: [
    { table: 'alpha', has_org: true, pk: 'id' },
    { table: 'beta', has_org: false, pk: 'uuid' },
    { table: 'gamma', has_org: true, pk: 'id' },
  ],
  definer_functions: ['public.alpha()', 'public.beta(integer)'],
  edge_functions: ['agent-chat', 'health'],
  buckets: ['project-documents', 'procurement-files'],
});

test('AC-612-001: identical denominator passes despite array ordering', () => {
  const actual = fixture();
  const recorded = fixture();
  // Reverse every array independently so the comparison cannot depend on order.
  const reorder = (o) => ({
    tables: [...o.tables].reverse(),
    definer_functions: [...o.definer_functions].reverse(),
    edge_functions: [...o.edge_functions].reverse(),
    buckets: [...o.buckets].reverse(),
  });
  const findings = compareDenominators(actual, reorder(recorded));
  assert.deepEqual(findings, []);
});

test('AC-612-002: rejects a catalog table absent from the denominator', () => {
  const actual = fixture();
  actual.tables.push({ table: 'new_org_surface', has_org: true, pk: 'id' });
  const findings = compareDenominators(actual, fixture());
  const missing = findings.filter((f) => f.kind === 'missing' && f.category === 'tables');
  assert.equal(missing.length, 1);
  assert.deepEqual(missing[0].entry, { table: 'new_org_surface', has_org: true, pk: 'id' });
  assert.match(missing[0].addLine, /new_org_surface/);
  assert.match(missing[0].addLine, /"has_org"\s*:\s*true/);
  assert.match(missing[0].addLine, /"pk"\s*:\s*"id"/);
});

test('AC-612-003: rejects a stale definer function in the denominator', () => {
  const recorded = fixture();
  recorded.definer_functions.push('public.no_longer_exists()');
  const findings = compareDenominators(fixture(), recorded);
  const stale = findings.filter((f) => f.kind === 'stale' && f.category === 'definer_functions');
  assert.equal(stale.length, 1);
  assert.equal(stale[0].entry, 'public.no_longer_exists()');
});

test('tables that share a name but drift in has_org or pk are reported unlisted AND stale', () => {
  const actual = fixture();
  const recorded = fixture();
  // Same name, different classification — the probe's has_org/pk would be stale.
  recorded.tables[0] = { table: 'alpha', has_org: false, pk: 'uuid' };
  const findings = compareDenominators(actual, recorded);
  const missingAlpha = findings.filter((f) => f.kind === 'missing' && f.category === 'tables' && f.entry.table === 'alpha');
  const staleAlpha = findings.filter((f) => f.kind === 'stale' && f.category === 'tables' && f.entry.table === 'alpha');
  assert.equal(missingAlpha.length, 1);
  assert.deepEqual(missingAlpha[0].entry, { table: 'alpha', has_org: true, pk: 'id' });
  assert.equal(staleAlpha.length, 1);
  assert.deepEqual(staleAlpha[0].entry, { table: 'alpha', has_org: false, pk: 'uuid' });
});

test('missing edge function and bucket are each reported as missing', () => {
  const actual = fixture();
  actual.edge_functions.push('compose-view');
  actual.buckets.push('new-bucket');
  const findings = compareDenominators(actual, fixture());
  assert.ok(findings.some((f) => f.kind === 'missing' && f.category === 'edge_functions' && f.entry === 'compose-view'));
  assert.ok(findings.some((f) => f.kind === 'missing' && f.category === 'buckets' && f.entry === 'new-bucket'));
});

test('stale edge function and bucket are each reported as stale', () => {
  const recorded = fixture();
  recorded.edge_functions.push('retired-fn');
  recorded.buckets.push('retired-bucket');
  const findings = compareDenominators(fixture(), recorded);
  assert.ok(findings.some((f) => f.kind === 'stale' && f.category === 'edge_functions' && f.entry === 'retired-fn'));
  assert.ok(findings.some((f) => f.kind === 'stale' && f.category === 'buckets' && f.entry === 'retired-bucket'));
});

test('formatEntry renders a table object and a scalar on one line', () => {
  assert.equal(formatEntry('tables', { table: 'alpha', has_org: true, pk: 'id' }), JSON.stringify({ table: 'alpha', has_org: true, pk: 'id' }));
  // Scalars are JSON-encoded so an `add to`/`remove from` line is a valid manifest line.
  assert.equal(formatEntry('definer_functions', 'public.alpha()'), JSON.stringify('public.alpha()'));
});

test('formatEntry quotes scalar entries with JSON so they paste into the manifest exactly', () => {
  assert.equal(formatEntry('edge_functions', 'health'), '"health"');
  assert.equal(formatEntry('buckets', 'procurement-files'), '"procurement-files"');
});

test('validateDenominator accepts a well-formed manifest with all four arrays', () => {
  const out = validateDenominator(fixture());
  assert.equal(out.tables.length, 3);
  assert.deepEqual(out, fixture());
});

test('validateDenominator rejects an unexpected root key (manifest is exactly four arrays)', () => {
  assert.throws(() => validateDenominator({ ...fixture(), unexpected: [] }), /unexpected root key/);
});

test('validateDenominator rejects a table entry with an empty pk', () => {
  const bad = fixture();
  bad.tables[0] = { table: 'alpha', has_org: true, pk: '  ' };
  assert.throws(() => validateDenominator(bad), /pk/);
});