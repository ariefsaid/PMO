import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isSerialSpec, planPhases, printPhases, runPhases, serialTestMatch } from './affected-e2e.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, '..');
const e2eDir = path.join(repoRoot, 'pmo-portal', 'e2e');
const e2eLocal = path.join(scriptsDir, 'e2e-local.sh');

const CHROMIUM_SPEC = 'e2e/AC-CO-001-companies-crud.spec.ts';
// AC-CODE-002 temporarily rewrites the org-wide {CLIENT} project-number pattern, so it MUST NOT
// overlap another spec — the real failure that exposed `--run` running serial at 2 workers.
const SERIAL_SPEC = 'e2e/serial/AC-CODE-002-project-number-proposal.spec.ts';

function serialSpecsOnDisk() {
  return fs.readdirSync(path.join(e2eDir, 'serial'))
    .filter(name => name.endsWith('.spec.ts'))
    .map(name => `e2e/serial/${name}`);
}

// Records every spawn so the two-phase contract can be asserted without launching Playwright.
function recordingSpawn(statuses = []) {
  const calls = [];
  const spawnE2E = (script, phaseArgs, options) => {
    calls.push({ script, phaseArgs, workers: options?.env?.E2E_WORKERS, cwd: options?.cwd });
    return { status: statuses[calls.length - 1] ?? 0 };
  };
  return { calls, spawnE2E };
}

// Captures the printed plan (the operator copies these commands by hand).
function captureLog(run) {
  const lines = [];
  const real = console.log;
  console.log = (...parts) => { lines.push(parts.join(' ')); };
  try { run(); } finally { console.log = real; }
  return lines;
}

test('affected-e2e --run splits the selection into a chromium phase at 2 workers then a serial phase at 1 worker', () => {
  const phases = planPhases([CHROMIUM_SPEC, SERIAL_SPEC]);
  assert.deepEqual(phases.map(phase => phase.project), ['chromium', 'serial']);
  assert.deepEqual(phases.map(phase => phase.workers), ['2', '1']);
  // Partition, not duplication: the serial spec must leave the parallel phase.
  assert.deepEqual(phases[0].files, [CHROMIUM_SPEC]);
  assert.deepEqual(phases[1].files, [SERIAL_SPEC]);

  const { calls, spawnE2E } = recordingSpawn();
  const printed = captureLog(() => {
    printPhases(phases);
    assert.equal(runPhases(phases, spawnE2E), 0, 'two green phases must exit 0');
  });

  assert.equal(calls.length, 2, `expected one spawn per non-empty phase, got ${JSON.stringify(calls.map(call => call.phaseArgs))}`);
  assert.deepEqual(calls[0].phaseArgs, ['--project=chromium', CHROMIUM_SPEC]);
  assert.deepEqual(calls[1].phaseArgs, ['--project=serial', SERIAL_SPEC]);
  assert.ok(calls.every(call => call.script === e2eLocal), 'both phases must go through scripts/e2e-local.sh');
  assert.ok(calls.every(call => call.cwd === repoRoot));
  assert.deepEqual(calls.map(call => call.workers), ['2', '1'], 'workers travel through E2E_WORKERS (no stacked --workers flag)');

  assert.ok(printed.some(line => line.includes('--project=chromium') && line.includes('E2E_WORKERS=2')), `chromium command not printed: ${printed.join(' / ')}`);
  assert.ok(printed.some(line => line.includes('--project=serial') && line.includes('E2E_WORKERS=1')), `serial command not printed: ${printed.join(' / ')}`);
});

test('affected-e2e --run skips a phase with no selected specs instead of spawning an empty one', () => {
  const phases = planPhases([SERIAL_SPEC]);
  assert.deepEqual(phases.map(phase => phase.project), ['chromium', 'serial']);
  assert.deepEqual(phases[0].files, []);

  const { calls, spawnE2E } = recordingSpawn();
  assert.equal(runPhases(phases, spawnE2E), 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].phaseArgs, ['--project=serial', SERIAL_SPEC]);
  assert.equal(calls[0].workers, '1');

  // …and the skipped phase is still shown, so the operator sees the whole plan.
  const printed = captureLog(() => printPhases(phases));
  assert.ok(printed.some(line => line.includes('chromium') && /skipped/.test(line)), printed.join(' / '));
});

test('affected-e2e --run still runs the serial phase after a chromium failure and exits non-zero', () => {
  const { calls, spawnE2E } = recordingSpawn([1, 0]);
  const exit = captureLog(() => assert.equal(runPhases(planPhases([CHROMIUM_SPEC, SERIAL_SPEC]), spawnE2E), 1));
  assert.equal(calls.length, 2, 'phase 2 must run even when phase 1 failed');
  assert.deepEqual(calls.map(call => call.phaseArgs[0]), ['--project=chromium', '--project=serial']);
});

test('affected-e2e phase split follows playwright.config.ts: every e2e/serial spec lands in the workers=1 phase', () => {
  const match = serialTestMatch();
  const onDisk = serialSpecsOnDisk();
  assert.ok(onDisk.length > 0, 'no serial specs found on disk');
  const missed = onDisk.filter(file => !isSerialSpec(file, match));
  assert.deepEqual(missed, [], `serial specs the config matcher did not classify as serial: ${missed.join(', ')}`);
  // The parallel lane must not absorb any of them, and a plain chromium spec must stay parallel.
  const phases = planPhases([CHROMIUM_SPEC, ...onDisk], match);
  assert.equal(phases[1].files.length, onDisk.length);
  assert.deepEqual(phases[0].files, [CHROMIUM_SPEC]);
});

test('e2e-local.sh pass-through honours E2E_WORKERS (default 2) so a single phase can be pinned to 1 worker', () => {
  const script = fs.readFileSync(e2eLocal, 'utf8');
  const start = script.indexOf('if [ "$#" -gt 0 ]; then');
  assert.ok(start > 0, 'pass-through branch not found in scripts/e2e-local.sh');
  const block = script.slice(start, script.indexOf('\nfi\n', start));
  assert.match(block, /workers="\$\{E2E_WORKERS:-2\}"/, 'the pass-through default must stay 2 workers');
  assert.match(block, /exec npx playwright test "--workers=\$workers" "\$@"/, 'the pass-through must forward the resolved worker count');
  assert.doesNotMatch(block, /--workers=2/, 'the pass-through must not hard-code 2 workers (that is what forced serial to overlap)');

  const syntax = spawnSync('bash', ['-n', e2eLocal], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, `bash -n scripts/e2e-local.sh failed: ${syntax.stderr}`);
});
