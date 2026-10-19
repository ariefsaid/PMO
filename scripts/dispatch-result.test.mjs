import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const classifierPath = fileURLToPath(new URL('./lib/dispatch-result.sh', import.meta.url));
const tempDirectory = mkdtempSync(join(tmpdir(), 'dispatch-result-'));
const bashPath = '/bin/bash';
const testEnvironment = { PATH: '/usr/bin:/bin', LC_ALL: 'C' };
let logNumber = 0;

after(() => rmSync(tempDirectory, { recursive: true, force: true }));

function saveLog(contents) {
  const logPath = join(tempDirectory, `report-${logNumber++}.log`);
  writeFileSync(logPath, contents, 'utf8');
  return logPath;
}

function runBash(script, args) {
  const result = spawnSync(
    bashPath,
    ['--noprofile', '--norc', '-c', script, 'dispatch-result-test', ...args],
    { encoding: 'utf8', env: testEnvironment },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return result.stdout.trim();
}

function classify(report, { exitCode = 0, minimumBytes = '' } = {}) {
  const logPath = saveLog(report);
  return runBash(
    'source "$1"; classify "$2" "$3" "$4"',
    [classifierPath, String(exitCode), logPath, String(minimumBytes)],
  );
}

function fullReport(marker) {
  return [
    'The report reviewed each assigned check and recorded its outcome.',
    'Synthetic data retained the values 429, 500, 502, and 503 for review.',
    'Quoted diagnostics include "unauthorized", "fetch failed", and "HTTP status: 503".',
    marker,
    'The report is complete and ready for one delivery.',
  ].join('\n');
}

test('complete terminal reports with numeric fixtures and quoted diagnostics are delivered', async (t) => {
  const markers = [
    ['ALL-TASKS-DONE with a semicolon suffix', 'ALL-TASKS-DONE; all checks are recorded'],
    ['bold ALL-TASKS-DONE', '**ALL-TASKS-DONE**'],
    ['ordinary Verdict: SHIP', 'Verdict: SHIP'],
    ['bold Verdict: FIX', '**Verdict: FIX**'],
    ['heading Verdict with a conditional suffix', '# Review — verdict: **SHIP, conditional on the listed follow-up**'],
    ['case-insensitive heading Verdict: FIX', '## Review — VERDICT: FIX — findings are listed below'],
  ];

  for (const [name, marker] of markers) {
    await t.test(name, () => {
      assert.equal(classify(fullReport(marker)), 'ok');
    });
  }
});

test('a terminal report causes one fake dispatch and one final delivery', () => {
  const reportPath = saveLog('');
  const harness = [
    'source "$1"',
    'attempts=0',
    'deliveries=0',
    'result=next',
    'while [ "$attempts" -lt 3 ]; do',
    '  attempts=$((attempts + 1))',
    '  printf %s "$4" > "$5"',
    '  result=$(classify "$2" "$5" "$3")',
    '  case "$result" in',
    '    ok) deliveries=$((deliveries + 1)); break ;;',
    '    next) break ;;',
    '  esac',
    'done',
    'printf "%s:%s:%s\\n" "$attempts" "$deliveries" "$result"',
  ].join('\n');

  const outcome = runBash(harness, [
    classifierPath,
    '0',
    '120',
    fullReport('# Review — verdict: **SHIP, conditional on the listed follow-up**'),
    reportPath,
  ]);

  assert.equal(outcome, '1:1:ok');
});

test('quoted, fenced, and ordinary prose examples do not become terminal markers', () => {
  const report = [
    'This complete diagnostic report records why the earlier attempt did not finish.',
    '> Verdict: SHIP',
    '````markdown',
    '```text',
    'ALL-TASKS-DONE',
    'Verdict: FIX',
    '```',
    '````',
    'The example text mentions Verdict: SHIP as prose, not as this report verdict.',
    'HTTP status: 503',
    'More diagnostic context is retained for review.',
  ].join('\n');

  assert.equal(classify(report), 'retry');
});

test('standalone numeric fixtures in a sufficiently complete report are not transport errors', () => {
  const report = [
    'The reviewed fixture records standalone numeric values 429, 500, 502, and 503 without HTTP framing.',
    'The values are reference data only and do not describe a failed request.',
    'No terminal marker is needed for the legacy complete-response fallback.',
  ].join('\n');

  assert.equal(classify(report), 'ok');
});

test('only explicitly framed HTTP statuses and actual transport diagnostics retry', async (t) => {
  const retrySignals = [
    ['HTTP 429', 'HTTP 429 Too Many Requests'],
    ['HTTP status 500', 'HTTP status: 500'],
    ['status_code 502', 'status_code=502'],
    ['error code 503', 'error code: 503'],
    ['status phrase', '503 Service Unavailable'],
    ['provider congestion', 'ResourceExhausted'],
    ['worker request limit', 'Worker local total request limit reached'],
    ['retry-after detail', 'try again in 20 seconds'],
    ['fetch failure', 'fetch failed'],
    ['overload', 'overloaded'],
    ['connection failure', 'connection error'],
    ['connection reset', 'ECONNRESET'],
    ['timeout', 'ETIMEDOUT'],
  ];

  for (const [name, signal] of retrySignals) {
    await t.test(name, () => {
      assert.equal(classify(`${signal}\n${'diagnostic detail '.repeat(12)}`), 'retry');
    });
  }
});

test('quota, authentication, and silent no-op forms keep their next-rung result', async (t) => {
  const nextSignals = [
    ['quota message', 'Usage limit reached for 5 hour'],
    ['quota code', 'response body: "code": 1308'],
    ['invalid credential response', 'invalid api key'],
    ['authorization response', 'unauthorized'],
  ];

  for (const [name, signal] of nextSignals) {
    await t.test(name, () => {
      assert.equal(classify(`${signal}\n${'diagnostic detail '.repeat(12)}`), 'next');
    });
  }

  await t.test('short model-not-found response', () => {
    assert.equal(classify('model not found'), 'next');
  });
});

test('nonzero, short, and bare-number responses do not falsely complete', async (t) => {
  await t.test('nonzero exit with a terminal marker', () => {
    assert.equal(classify(fullReport('Verdict: SHIP'), { exitCode: 1 }), 'next');
  });

  await t.test('short terminal report below the default 120-byte minimum', () => {
    assert.equal(classify('Verdict: SHIP'), 'next');
  });

  await t.test('bare numeric status alone', () => {
    assert.equal(classify('429'), 'next');
  });

  await t.test('explicit minimum permits a short, otherwise valid report', () => {
    assert.equal(classify('Verdict: FIX', { minimumBytes: 10 }), 'ok');
  });

  await t.test('a complete report exactly at the default byte threshold', () => {
    assert.equal(classify(`Verdict: SHIP\n${'x'.repeat(106)}`), 'ok');
  });
});
