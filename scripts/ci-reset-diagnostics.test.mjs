#!/usr/bin/env node
// Contract tests for the failure-only database-reset diagnostics (#1196).
//
// These are isolated tooling tests: no Docker, no Supabase, no database. The CLI is exercised
// against a fake `docker` binary placed first on PATH, plus injected exec/probe fakes for the
// pure collectors, so the tests prove the SAFETY properties the issue requires:
//   * only allow-listed container health/status/exit fields are read (no logs, no env, no inspect
//     without a field template),
//   * output is bounded and redacted,
//   * the helper can never change the job outcome (always exits 0 when it collects),
//   * ci.yml keeps the reset step's failure status and gates diagnostics on that specific step.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci-reset-diagnostics.mjs');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'ci.yml');

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLXZhbHVl';
const DB_URL = 'postgresql://postgres:sup3rs3cret@127.0.0.1:54322/postgres';

async function api() {
  return import(new URL('./ci-reset-diagnostics.mjs', import.meta.url).href);
}

function makeTempDir(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'ci-reset-diagnostics-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeFakeDocker(directory, callsPath) {
  const fake = path.join(directory, 'docker');
  writeFileSync(
    fake,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALLS"
case "$1" in
  ps)
    printf 'supabase_auth_pmo-portal\\nsupabase_db_pmo-portal\\n'
    exit 0
    ;;
  inspect)
    case "$4" in
      supabase_auth_pmo-portal)
        printf '/supabase_auth_pmo-portal|exited|unhealthy|1|false|3|2026-11-03T00:00:00Z|2026-11-03T00:00:12Z\\n'
        ;;
      supabase_db_pmo-portal)
        printf '/supabase_db_pmo-portal|running|healthy|0|false|0|${JWT}|${DB_URL}\\n'
        ;;
      *)
        printf 'Error: No such object: %s\\n' "$4" >&2
        exit 1
        ;;
    esac
    exit 0
    ;;
esac
printf 'unsupported docker invocation: %s\\n' "$*" >&2
exit 1
`,
  );
  chmodSync(fake, 0o755);
  writeFileSync(callsPath, '');
}

test('redact masks credentials and keeps ordinary status text readable', async () => {
  const { redact } = await api();
  const redacted = redact(`exited unhealthy ${JWT} ${DB_URL} SUPABASE_SERVICE_ROLE_KEY=abc123 service_role_key: xyz`);
  assert.ok(!redacted.includes(JWT), 'JWT is masked');
  assert.ok(!redacted.includes('sup3rs3cret'), 'database password is masked');
  assert.ok(!redacted.includes('abc123'), 'env-style key is masked');
  assert.ok(!redacted.includes('xyz'), 'service role key assignment is masked');
  assert.match(redacted, /exited unhealthy/);
  assert.match(redacted, /\[redacted/);
});

test('sanitizeField strips control characters and truncates deterministically', async () => {
  const { sanitizeField } = await api();
  assert.equal(sanitizeField('a\u0000b\tc  d'), 'a b c d');
  assert.equal(sanitizeField('   '), 'unknown');
  const truncated = sanitizeField('x'.repeat(500), 20);
  assert.equal(truncated.length, 20);
  assert.ok(truncated.endsWith('…'));
});

test('parseInspect reads exactly the eight allow-listed fields', async () => {
  const { parseInspect } = await api();
  const row = parseInspect('/supabase_db_pmo-portal|exited|unhealthy|1|false|4|2026-11-03T00:00:00Z|2026-11-03T00:00:12Z');
  assert.deepEqual(row, {
    name: 'supabase_db_pmo-portal',
    state: 'exited',
    health: 'unhealthy',
    exitCode: '1',
    oomKilled: 'false',
    restarts: '4',
    startedAt: '2026-11-03T00:00:00Z',
    finishedAt: '2026-11-03T00:00:12Z',
  });
  assert.equal(parseInspect(''), null);
  assert.equal(parseInspect('/only-two|fields'), null);
  assert.ok(!parseInspect(`/x|running|none|0|false|0|${JWT}|${DB_URL}`).startedAt.includes(JWT));
});

test('collectContainerDiagnostics asks Docker only for allow-listed state fields', async () => {
  const { collectContainerDiagnostics, INSPECT_TEMPLATE } = await api();
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    if (args[0] === 'ps') return { status: 0, stdout: 'supabase_b\nsupabase_a\nsupabase_a\n', stderr: '' };
    return { status: 0, stdout: `/${args.at(-1)}|running|healthy|0|false|0|t0|t1\n`, stderr: '' };
  };

  const { containers, notes } = collectContainerDiagnostics({ exec });

  assert.deepEqual(calls[0], ['ps', '-a', '--filter', 'name=supabase_', '--format', '{{.Names}}']);
  assert.deepEqual(containers.map((container) => container.name), ['supabase_a', 'supabase_b'], 'sorted and de-duplicated');
  assert.deepEqual(notes, []);
  assert.equal(calls.length, 3);
  for (const call of calls.slice(1)) {
    assert.equal(call[0], 'inspect');
    assert.equal(call[1], '--format', 'inspect always carries an explicit field template');
    assert.equal(call[2], INSPECT_TEMPLATE);
  }
  for (const field of ['.State.Status', '.State.Health.Status', '.State.ExitCode', '.State.OOMKilled', '.RestartCount', '.State.StartedAt', '.State.FinishedAt']) {
    assert.ok(INSPECT_TEMPLATE.includes(field), `template includes ${field}`);
  }
  for (const forbidden of ['.Config', '.Env', '.Mounts', '.Args', '.NetworkSettings']) {
    assert.ok(!INSPECT_TEMPLATE.includes(forbidden), `template excludes ${forbidden}`);
  }
});

test('collectContainerDiagnostics bounds the container count and records it', async () => {
  const { collectContainerDiagnostics, DEFAULT_LIMITS } = await api();
  const exec = (args) => {
    if (args[0] === 'ps') return { status: 0, stdout: 'supabase_1\nsupabase_2\nsupabase_3\nsupabase_4\n', stderr: '' };
    return { status: 0, stdout: `/${args.at(-1)}|running|healthy|0|false|0|t0|t1\n`, stderr: '' };
  };
  const { containers, notes } = collectContainerDiagnostics({ exec, limits: { ...DEFAULT_LIMITS, maxContainers: 2 } });
  assert.deepEqual(containers.map((container) => container.name), ['supabase_1', 'supabase_2']);
  assert.ok(notes.some((note) => /showing 2 of 4/.test(note)));
});

test('collectContainerDiagnostics reports bounded, redacted notes when Docker fails', async () => {
  const { collectContainerDiagnostics } = await api();
  const exec = () => ({
    status: 1,
    stdout: '',
    stderr: `Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running? ${JWT}\nsecond line`,
  });
  const { containers, notes } = collectContainerDiagnostics({ exec });
  assert.deepEqual(containers, []);
  assert.equal(notes.length, 1);
  assert.ok(notes[0].length <= 240);
  assert.match(notes[0], /Cannot connect to the Docker daemon/);
  assert.ok(!notes[0].includes(JWT));
  assert.ok(!notes[0].includes('second line'), 'only the first failure line is retained');
});

test('collectProbeResults keeps status codes and never body content', async () => {
  const { collectProbeResults, DEFAULT_PROBE_URLS } = await api();
  const results = await collectProbeResults({
    probe: async (url) => ({ status: url.endsWith('/rest/v1/') ? 502 : 200, body: `secret ${JWT}` }),
  });
  assert.equal(results.length, DEFAULT_PROBE_URLS.length);
  assert.ok(results.every((entry) => /^HTTP \d{3}$/.test(entry.result)));
  assert.ok(results.some((entry) => entry.result === 'HTTP 502'));
  assert.ok(!JSON.stringify(results).includes(JWT));

  const failed = await collectProbeResults({
    probe: async () => {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:54321'), { code: 'ECONNREFUSED' });
    },
  });
  assert.ok(failed.every((entry) => /^no response \(ECONNREFUSED\)$/.test(entry.result)));
});

test('httpProbe keeps the status code and never surfaces the response body', async () => {
  const { httpProbe } = await api();
  const server = http.createServer((request, response) => {
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'upstream', leaked: JWT }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const outcome = await httpProbe(`http://127.0.0.1:${port}/auth/v1/health`);
    assert.deepEqual(outcome, { status: 502 });
    assert.ok(!JSON.stringify(outcome).includes(JWT));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('renderReport is bounded, table-escaped and states what it never collects', async () => {
  const { renderReport, DEFAULT_LIMITS, DEFAULT_PROBE_URLS } = await api();
  const report = renderReport({
    generatedAt: '2026-11-03T00:00:00.000Z',
    containers: [{
      name: 'supabase_a|b',
      state: 'exited',
      health: 'unhealthy',
      exitCode: '1',
      oomKilled: 'false',
      restarts: '4',
      startedAt: 't0',
      finishedAt: 't1',
    }],
    probes: [{ url: DEFAULT_PROBE_URLS[0], result: 'HTTP 502' }],
    notes: [],
  });
  assert.match(report, /^# CI database reset diagnostics/m);
  assert.match(report, /No environment variables, credentials, database rows, response bodies or container logs/);
  assert.match(report, /supabase_a\\\|b/);
  assert.match(report, /\| supabase_a\\\|b \| exited \| unhealthy \| 1 \|/);
  assert.match(report, /HTTP 502/);

  const long = renderReport({
    generatedAt: '2026-11-03T00:00:00.000Z',
    containers: Array.from({ length: 200 }, (_, index) => ({
      name: `supabase_${index}`,
      state: 'running',
      health: 'healthy',
      exitCode: '0',
      oomKilled: 'false',
      restarts: '0',
      startedAt: 't0',
      finishedAt: 't1',
    })),
    probes: [],
    notes: [],
    limits: { ...DEFAULT_LIMITS, maxReportChars: 600 },
  });
  assert.ok(long.length <= 600 + 200, `report stays bounded (was ${long.length})`);
  assert.match(long, /Truncated/);
});

test('the CLI writes a redacted report and only calls allow-listed Docker commands', async (t) => {
  const directory = makeTempDir(t);
  const callsPath = path.join(directory, 'calls.log');
  writeFakeDocker(directory, callsPath);
  const outPath = path.join(directory, 'out', 'ci-reset-diagnostics.md');

  const run = spawnSync(process.execPath, [SCRIPT, '--out', outPath], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, DOCKER_CALLS: callsPath },
    timeout: 30_000,
  });

  assert.equal(run.status, 0, `diagnostics must never alter the job outcome (stderr: ${run.stderr})`);
  assert.ok(existsSync(outPath), 'report is written for the artifact upload');
  const report = readFileSync(outPath, 'utf8');
  assert.equal(report.trim(), run.stdout.trim(), 'the job log and the artifact carry the same report');
  assert.match(report, /supabase_auth_pmo-portal/);
  assert.match(report, /unhealthy/);
  assert.match(report, /HTTP \d{3}|no response/);
  assert.ok(!report.includes(JWT), 'JWT from a container field is redacted');
  assert.ok(!report.includes('sup3rs3cret'), 'connection string from a container field is redacted');

  const calls = readFileSync(callsPath, 'utf8').split('\n').filter(Boolean);
  assert.ok(calls.length >= 3);
  for (const call of calls) {
    assert.match(call, /^(ps -a --filter name=supabase_ --format \{\{\.Names\}\}|inspect --format .+)/, `allow-listed docker call: ${call}`);
    assert.ok(!/\blogs\b/.test(call), 'container logs are never read');
    assert.ok(!/(^| )env( |$)/.test(call), 'container environment is never read');
    assert.ok(!/--format $/.test(call), 'inspect is never called without a field template');
  }
});

test('the CLI still succeeds and reports when Docker is absent and the report cannot be written', async (t) => {
  const directory = makeTempDir(t);
  const emptyBin = path.join(directory, 'bin');
  mkdirSync(emptyBin);
  const blockedParent = path.join(directory, 'blocked');
  writeFileSync(blockedParent, 'a file where a directory is needed');

  const run = spawnSync(process.execPath, [SCRIPT, '--out', path.join(blockedParent, 'ci-reset-diagnostics.md')], {
    encoding: 'utf8',
    env: { ...process.env, PATH: emptyBin, DOCKER_CALLS: path.join(directory, 'calls.log') },
    timeout: 30_000,
  });

  assert.equal(run.status, 0, `stderr: ${run.stderr}`);
  assert.match(run.stdout, /docker ps unavailable/);
  assert.match(run.stderr, /could not write ci-reset-diagnostics\.md/);
});

test('the CLI rejects unknown arguments without collecting', async () => {
  const run = spawnSync(process.execPath, [SCRIPT, '--nope'], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /unknown argument --nope/);
});

// ─── ci.yml contract ────────────────────────────────────────────────────────────────────────────
// Text-level assertions on purpose: the repo's YAML is the artifact that decides CI behaviour, and
// no YAML parser is installed at the repo root. The checks are structural (job → step blocks), not
// whitespace-global regexes.

function jobsIn(workflowText) {
  const jobs = new Map();
  let insideJobs = false;
  let current = null;
  for (const line of workflowText.split('\n')) {
    if (line === 'jobs:') {
      insideJobs = true;
      continue;
    }
    if (!insideJobs) continue;
    const header = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      current = header[1];
      jobs.set(current, []);
      continue;
    }
    if (current) jobs.get(current).push(line);
  }
  return jobs;
}

function stepsIn(jobLines) {
  const steps = [];
  let current = null;
  for (const line of jobLines) {
    if (/^      - /.test(line)) {
      if (current) steps.push(current);
      current = [line];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) steps.push(current);
  return steps;
}

test('ci.yml runs the diagnostics only after that job\'s own reset failure and keeps its status', () => {
  const workflow = readFileSync(WORKFLOW, 'utf8');
  const jobs = jobsIn(workflow);
  const resetJobs = [];

  for (const [jobName, jobLines] of jobs) {
    for (const step of stepsIn(jobLines)) {
      const stepText = step.join('\n');
      if (!stepText.includes('name: Reset DB (migrations + seed)')) continue;
      resetJobs.push(jobName);

      assert.match(stepText, /^ {8}id: reset_db$/m, `${jobName}: the reset step declares an id so diagnostics can be scoped to it`);
      assert.doesNotMatch(stepText, /continue-on-error/, `${jobName}: the reset step must keep its exit status`);
      assert.doesNotMatch(stepText, /retry/i, `${jobName}: no retries are added to the reset`);
      assert.match(stepText, /^ {8}run: supabase db reset --yes$/m, `${jobName}: the reset command is unchanged`);

      const diagnostics = stepsIn(jobLines).find((candidate) => candidate.join('\n').includes('node scripts/ci-reset-diagnostics.mjs'));
      assert.ok(diagnostics, `${jobName}: a reset-diagnostics step exists`);
      const diagnosticsText = diagnostics.join('\n');
      assert.match(diagnosticsText, /^ {8}if: failure\(\) && steps\.reset_db\.outcome == 'failure'$/m, `${jobName}: diagnostics run only for a reset failure`);
      assert.match(diagnosticsText, /^ {8}continue-on-error: true$/m, `${jobName}: diagnostics can never change the job outcome`);
      const out = /--out (\S+)/.exec(diagnosticsText);
      assert.ok(out, `${jobName}: diagnostics write a report file`);
      assert.doesNotMatch(diagnosticsText, /::\s*error/, `${jobName}: diagnostics do not fake a step failure`);

      const upload = stepsIn(jobLines).find((candidate) => {
        const text = candidate.join('\n');
        return text.includes('upload-artifact') && text.includes(out[1]);
      });
      assert.ok(upload, `${jobName}: the report is uploaded as an artifact`);
      const uploadText = upload.join('\n');
      assert.match(uploadText, /^ {8}if: failure\(\) && steps\.reset_db\.outcome == 'failure'$/m, `${jobName}: the artifact is failure-only`);
      assert.match(uploadText, /^ {10}if-no-files-found: ignore$/m, `${jobName}: a missing report never fails the job further`);
    }
  }

  assert.deepEqual(
    resetJobs.sort(),
    ['browser-chromium', 'integration', 'pgtap'],
    'every job that resets the database before/with browser work carries the failure diagnostics',
  );

  const required = stepsIn(jobs.get('integration')).find((step) => step.join('\n').includes('Required integration result'));
  assert.ok(required, 'the required-result step is still present');
  assert.doesNotMatch(required.join('\n'), /reset|diagnostic/i, 'diagnostics never become a required result');

  assert.doesNotMatch(workflow, /^ {2}schedule:/m, 'no scheduled runs are introduced');
});
