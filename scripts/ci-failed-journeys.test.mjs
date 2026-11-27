import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { failedJourneys, summarise } from './ci-failed-journeys.mjs';

const spec = (file, title, status) => ({ file, title, tests: [{ status }] });
const report = { suites: [{ file: 'a.spec.ts', specs: [spec('a.spec.ts', 'AC-1 ok', 'expected'), spec('a.spec.ts', 'AC-2 skip', 'skipped')],
  suites: [{ specs: [spec('b.spec.ts', 'AC-3 bad', 'unexpected'), spec('b.spec.ts', 'AC-4 flaky', 'flaky')] }] }] };

test('lists only specs that did not pass or skip, nested suites included', () => {
  assert.deepEqual(failedJourneys(report), ['b.spec.ts › AC-3 bad', 'b.spec.ts › AC-4 flaky']);
});

test('summary groups by lane and marks a clean lane ok', () => {
  const d = mkdtempSync(join(tmpdir(), 'cfj-'));
  mkdirSync(join(d, 'x'));
  writeFileSync(join(d, 'x', 'pw-serial.json'), JSON.stringify(report));
  writeFileSync(join(d, 'x', 'pw-consent.json'), JSON.stringify({ suites: [] }));
  const s = summarise(d);
  assert.match(s, /consent: ok/);
  assert.match(s, /serial: 2 failed\n {2}✗ b\.spec\.ts › AC-3 bad/);
});
