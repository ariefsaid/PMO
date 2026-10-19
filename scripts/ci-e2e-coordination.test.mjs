import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
const NODE_BIN = path.dirname(process.execPath);
const HELPER = path.join(ROOT, 'scripts/lib/ci-dispatch-reservations.mjs');
const WRAPPER = path.join(ROOT, 'scripts/ci-e2e.sh');
const LOCK_CORE = path.join(ROOT, 'scripts/lib/flock-run.sh');
const KNOWN_NOW = '2026-10-19T12:30:00.000Z';
const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);

async function api() {
  return import(new URL('./lib/ci-dispatch-reservations.mjs', import.meta.url).href);
}

function makeReservation(overrides = {}) {
  return {
    requestId: '11111111-1111-4111-8111-111111111111',
    repo: 'fixture/alpha',
    workflow: 'alpha.yml',
    branch: 'release/one',
    head: HEAD_A,
    startedAt: '2026-10-19T12:00:00.000Z',
    baselineRunIds: [],
    kind: 'normal',
    quote: '',
    pr: null,
    status: 'unknown',
    runId: null,
    finishedAt: null,
    ...overrides,
  };
}

function makeRun(overrides = {}) {
  return {
    repo: 'fixture/alpha',
    workflow: 'alpha.yml',
    runId: 701,
    event: 'workflow_dispatch',
    branch: 'release/one',
    head: HEAD_A,
    createdAt: '2026-10-19T12:01:00.000Z',
    status: 'in_progress',
    ...overrides,
  };
}

function makeLedger(reservations = []) {
  return { schemaVersion: 1, reservations };
}

function makeFixture(t, options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'pmo-ci-reservation-'));
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const stateFile = path.join(root, 'fake-state.json');
  const journalFile = path.join(root, 'journal.ndjson');
  const log = path.join(root, 'ci-e2e.log');
  const lock = path.join(root, 'ci-e2e.lock');
  const home = path.join(root, 'home');
  mkdirSync(home);
  const fakeGh = path.join(bin, 'gh');
  writeFileSync(fakeGh, fakeGhSource, { mode: 0o700 });
  chmodSync(fakeGh, 0o700);
  const state = {
    runs: [],
    heads: { 'fixture/alpha|release/one': HEAD_A, 'fixture/beta|release/one': HEAD_B },
    prs: {},
    failures: [],
    dispatchExitCode: 0,
    blockDispatch: false,
    killParentOnDispatch: false,
    ...options,
  };
  writeFileSync(stateFile, JSON.stringify(state));
  t.after(() => {
    try {
      chmodSync(root, 0o700);
      rmSync(root, { recursive: true, force: true });
    } catch { /* best-effort cleanup after process barriers have been released */ }
  });
  return {
    root, bin, stateFile, journalFile, log, ledger: `${log}.reservations.json`, lock, home, fakeGh,
    readState() { return JSON.parse(readFileSync(stateFile, 'utf8')); },
    writeState(next) { writeFileSync(stateFile, JSON.stringify(next)); },
    journal() {
      return existsSync(journalFile)
        ? readFileSync(journalFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
        : [];
    },
    env(extra = {}) {
      return {
        PATH: `${bin}:${NODE_BIN}:/usr/bin:/bin`,
        FAKE_GH_ROOT: root,
        TZ: 'UTC',
        HOME: home,
        ...extra,
      };
    },
  };
}

const fakeGhSource = String.raw`#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const root = process.env.FAKE_GH_ROOT;
if (!root) process.exit(91);
const journalPath = path.join(root, 'journal.ndjson');
const statePath = path.join(root, 'fake-state.json');
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const record = { args, pid: process.pid, at: new Date().toISOString() };
fs.appendFileSync(journalPath, JSON.stringify(record) + '\n', { mode: 0o600 });
function out(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
function fail(code = 71) { process.stderr.write('fixture read failure\n'); process.exit(code); }
function valueAfter(flag) { const at = args.indexOf(flag); return at < 0 ? null : args[at + 1]; }
function queryArg(endpoint) {
  const raw = args.find((arg) => typeof arg === 'string' && arg.startsWith('repos/'));
  return raw ? new URL('https://fixture.invalid/' + raw).searchParams : new URLSearchParams();
}
function decodePathPart(value) { try { return decodeURIComponent(value); } catch { fail(92); } }
if (args[0] === 'api') {
  if (valueAfter('--method') !== 'GET') fail(93);
  const endpoint = args.find((arg) => typeof arg === 'string' && arg.startsWith('repos/'));
  if (!endpoint) fail(94);
  if (state.malformedJson && endpoint.includes(state.malformedJson)) {
    process.stdout.write('{ malformed fixture JSON\n');
    process.exit(0);
  }
  if (state.failures.some((part) => endpoint.includes(part))
    || (state.dispatchSeen && state.failuresAfterDispatch?.some((part) => endpoint.includes(part)))) fail();
  const parts = endpoint.split('?')[0].split('/');
  const repo = decodePathPart(parts[1]) + '/' + decodePathPart(parts[2]);
  const runsAt = parts.indexOf('runs');
  if (runsAt >= 0 && parts[runsAt + 1] && /^\d+$/.test(parts[runsAt + 1])) {
    const runId = Number(parts[runsAt + 1]);
    const run = state.runs.find((item) => item.repo.toLowerCase() === repo.toLowerCase() && item.runId === runId);
    if (!run) fail(44);
    const workflowPath = state.workflowPathOverride ?? (run.workflow.startsWith('.github/workflows/') ? run.workflow : '.github/workflows/' + run.workflow);
    out({ id: run.runId, run_number: run.runId, event: run.event, head_branch: run.branch, head_sha: run.head, created_at: run.createdAt, status: run.status, conclusion: run.status === 'completed' ? 'success' : null, path: workflowPath });
  } else if (runsAt >= 0) {
    const workflow = decodePathPart(parts[parts.indexOf('workflows') + 1]);
    const qs = queryArg(endpoint);
    const status = qs.get('status');
    const event = qs.get('event');
    const branch = qs.get('branch');
    const created = qs.get('created');
    let rows = state.runs.filter((run) => run.repo.toLowerCase() === repo.toLowerCase() && run.workflow === workflow);
    if (event) rows = rows.filter((run) => run.event === event);
    if (status) rows = rows.filter((run) => run.status === status);
    if (branch) rows = rows.filter((run) => run.branch === branch);
    if (created?.startsWith('>=')) rows = rows.filter((run) => run.createdAt.slice(0, 10) >= created.slice(2));
    const workflowRuns = rows.map((run) => ({ id: run.runId, event: run.event, head_branch: run.branch, head_sha: run.head, created_at: run.createdAt, status: run.status, conclusion: run.status === 'completed' ? 'success' : null, path: run.workflow }));
    if (state.malformedRunField && workflowRuns[0]) delete workflowRuns[0][state.malformedRunField];
    const totalCount = state.totalCountOverride ?? rows.length;
    const pages = state.twoPages
      ? [workflowRuns.slice(0, 1), workflowRuns.slice(1)]
      : [workflowRuns];
    const bodies = pages.map((pageRuns) => ({ total_count: totalCount, workflow_runs: pageRuns }));
    out(args.includes('--slurp') ? bodies : bodies[0]);
  } else if (parts.includes('git') && parts.includes('ref')) {
    const refsAt = parts.indexOf('heads');
    const branch = decodePathPart(parts.slice(refsAt + 1).join('/'));
    const head = state.heads[repo + '|' + branch];
    if (!head) fail(44);
    out({ ref: 'refs/heads/' + branch, object: { sha: head, type: 'commit' } });
  } else {
    fail(95);
  }
} else if (args[0] === 'pr' && args[1] === 'list') {
  const branch = valueAfter('--head');
  const repo = valueAfter('-R') ?? valueAfter('--repo');
  if (!branch || !repo) fail(96);
  if (state.failures.includes('pr-list')) fail();
  out(state.prs[repo + '|' + branch] ?? []);
} else if (args[0] === 'workflow' && args[1] === 'run') {
  const repo = valueAfter('-R');
  const branch = valueAfter('--ref');
  const runPgtap = valueAfter('-f');
  if (!repo || !branch || !/^run_pgtap=(true|false)$/.test(runPgtap ?? '')) fail(97);
  state.dispatchSeen = true;
  if (state.changeHeadAfterDispatch) state.heads[repo + '|' + branch] = state.changeHeadAfterDispatch;
  fs.writeFileSync(statePath, JSON.stringify(state));
  if (state.chmodRootAfterDispatch) fs.chmodSync(root, 0o500);
  if (state.blockDispatch) {
    fs.writeFileSync(path.join(root, 'dispatch-entered'), String(process.pid), { mode: 0o600 });
    const release = path.join(root, 'dispatch-release');
    const interval = setInterval(() => {
      if (fs.existsSync(release)) { clearInterval(interval); process.exit(state.dispatchExitCode ?? 0); }
    }, 10);
  } else {
    process.stdout.write('fixture dispatch accepted\n');
    if (state.killParentOnDispatch && process.env.CI_E2E_PARENT_PID) {
      process.kill(Number(process.env.CI_E2E_PARENT_PID), 'SIGTERM');
    }
    process.exit(state.dispatchExitCode ?? 0);
  }
} else {
  fail(98);
}
`;

function coordinatorArgs(fx, overrides = {}) {
  const request = {
    repo: 'fixture/alpha',
    workflow: 'alpha.yml',
    branch: 'release/one',
    kind: 'normal',
    quote: '',
    capacity: '2',
    dailyCap: '3',
    log: fx.log,
    observe: ['fixture/alpha:alpha.yml', 'fixture/beta:beta.yml'],
    ...overrides,
  };
  const args = [HELPER, 'coordinate', '--repo', request.repo, '--workflow', request.workflow,
    '--branch', request.branch, '--kind', request.kind, '--quote', request.quote,
    '--log', request.log, '--capacity', request.capacity, '--daily-cap', request.dailyCap];
  for (const observation of request.observe) args.push('--observe', observation);
  if (request.dryRun) args.push('--dry-run');
  return args;
}

function runCoordinator(fx, overrides = {}, extraEnv = {}) {
  const args = coordinatorArgs(fx, overrides);
  const result = spawnSync(NODE, args, { encoding: 'utf8', env: fx.env(extraEnv), timeout: 15000 });
  return { ...result, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function makeRemoteRow(run) {
  return {
    repo: run.repo,
    workflow: run.workflow,
    runId: run.runId,
    event: run.event,
    branch: run.branch,
    head: run.head,
    createdAt: run.createdAt,
    status: run.status,
  };
}

test('AC-OPS-1133-2 ledger: only a missing file starts an empty versioned ledger', async (t) => {
  const { parseLedger, loadLedger } = await api();
  const fx = makeFixture(t);
  assert.deepEqual(parseLedger('{"schemaVersion":1,"reservations":[]}'), makeLedger());
  assert.deepEqual(loadLedger(path.join(fx.root, 'missing.json')), makeLedger());

  const invalidCases = [
    ['malformed JSON', '{'],
    ['unsupported version', '{"schemaVersion":2,"reservations":[]}'],
    ['unsupported ledger field', '{"schemaVersion":1,"reservations":[],"remoteResponse":[]}'],
    ['duplicate request id', JSON.stringify(makeLedger([makeReservation(), makeReservation()]))],
    ['invalid timestamp', JSON.stringify(makeLedger([makeReservation({ startedAt: 'yesterday' })]))],
    ['missing immutable head', JSON.stringify(makeLedger([makeReservation({ head: '' })]))],
  ];
  for (const [label, bytes] of invalidCases) {
    const file = path.join(fx.root, 'bad-ledger.json');
    writeFileSync(file, bytes);
    assert.throws(() => loadLedger(file), undefined, label);
    assert.equal(readFileSync(file, 'utf8'), bytes, `${label} must not replace the source bytes`);
  }
});

test('AC-OPS-1133-1 capacity: remote identities and unresolved reservations form one busy set', async () => {
  const { reconcile, decide } = await api();
  const state = (reservations, remoteRuns = []) => reconcile({
    reservations, remoteRuns, queryComplete: true, observedAt: KNOWN_NOW,
  });
  const request = makeReservation({ requestId: '22222222-2222-4222-8222-222222222222', branch: 'next-branch' });
  const policy = { capacity: 2, dailyCap: 3 };
  assert.equal(decide({ state: { ...state([]), auditRows: [], now: KNOWN_NOW }, policy, request }).allowed, true);
  assert.equal(decide({ state: { ...state([makeReservation()]), auditRows: [], now: KNOWN_NOW }, policy, request }).allowed, true);
  for (const status of ['reserved', 'unknown', 'accepted-unresolved']) {
    const occupied = [makeReservation({ status }), makeReservation({
      requestId: '33333333-3333-4333-8333-333333333333', status,
      repo: 'fixture/beta', workflow: 'beta.yml', head: HEAD_B,
    })];
    const decision = decide({ state: { ...state(occupied), auditRows: [], now: KNOWN_NOW }, policy, request: { ...request, kind: 'owner-ok' } });
    assert.equal(decision.allowed, false, `${status} reservations must consume capacity despite owner approval`);
  }
  const linked = makeReservation({ status: 'linked-active', runId: 701 });
  const linkedState = state([linked], [makeRemoteRow(makeRun())]);
  const linkedDecision = decide({ state: { ...linkedState, auditRows: [], now: KNOWN_NOW }, policy, request });
  assert.equal(linkedDecision.allowed, true, 'one linked run and its reservation count once');
  const duplicateRemote = state([], [makeRemoteRow(makeRun()), makeRemoteRow(makeRun())]);
  assert.equal(decide({ state: { ...duplicateRemote, auditRows: [], now: KNOWN_NOW }, policy, request }).allowed, true);
  assert.throws(() => reconcile({ reservations: [], remoteRuns: [], queryComplete: false, observedAt: KNOWN_NOW }));
});

test('AC-OPS-1133-1 identity: only reciprocal unique, post-baseline immutable matches link', async () => {
  const { reconcile } = await api();
  const first = makeReservation({ requestId: '11111111-1111-4111-8111-111111111111' });
  const linked = reconcile({ reservations: [first], remoteRuns: [makeRemoteRow(makeRun({ createdAt: '2026-10-19T12:31:00.000Z' }))], queryComplete: true, observedAt: '2026-10-19T12:32:00.000Z' });
  assert.equal(linked.reservations[0].status, 'linked-active', 'complete-observation cutoff includes run created after process finish metadata');
  assert.equal(linked.reservations[0].runId, 701);

  for (const mismatch of [
    { repo: 'fixture/beta', workflow: 'beta.yml', head: HEAD_B },
    { workflow: 'other.yml' },
    { event: 'push' },
    { head: HEAD_B },
    { branch: 'another-branch' },
    { createdAt: '2026-10-19T11:59:59.000Z' },
  ]) {
    const result = reconcile({ reservations: [first], remoteRuns: [makeRemoteRow(makeRun(mismatch))], queryComplete: true, observedAt: '2026-10-19T12:32:00.000Z' });
    assert.equal(result.reservations[0].runId, null, `mismatch must remain unresolved: ${JSON.stringify(mismatch)}`);
  }
  const baseline = reconcile({ reservations: [makeReservation({ baselineRunIds: [701] })], remoteRuns: [makeRemoteRow(makeRun())], queryComplete: true, observedAt: KNOWN_NOW });
  assert.equal(baseline.reservations[0].runId, null);

  const ambiguous = reconcile({ reservations: [first], remoteRuns: [makeRemoteRow(makeRun()), makeRemoteRow(makeRun({ runId: 702 }))], queryComplete: true, observedAt: KNOWN_NOW });
  assert.equal(ambiguous.reservations[0].runId, null, 'two candidate runs do not link greedily');
  const overlap = reconcile({ reservations: [first, makeReservation({ requestId: '33333333-3333-4333-8333-333333333333' })], remoteRuns: [makeRemoteRow(makeRun())], queryComplete: true, observedAt: KNOWN_NOW });
  assert.ok(overlap.reservations.every((item) => item.runId === null), 'one run eligible for two requests stays unassigned');
  const repeated = reconcile({ reservations: linked.reservations, remoteRuns: [makeRemoteRow(makeRun())], queryComplete: true, observedAt: '2026-10-19T12:33:00.000Z' });
  assert.deepEqual(repeated.reservations, linked.reservations, 'reconciliation is idempotent for the same evidence');
  assert.throws(() => reconcile({
    reservations: [first],
    remoteRuns: [makeRemoteRow(makeRun()), makeRemoteRow(makeRun({ status: 'completed' }))],
    queryComplete: true,
    observedAt: KNOWN_NOW,
  }), /contradictory/i, 'one remote identity with conflicting evidence is incomplete');
  const terminal = reconcile({ reservations: [first], remoteRuns: [makeRemoteRow(makeRun({ status: 'completed' }))], queryComplete: true, observedAt: KNOWN_NOW });
  assert.equal(terminal.reservations[0].status, 'linked-terminal');
  assert.equal(terminal.reservations[0].runId, 701, 'terminal linkage remains in history');
  const absent = reconcile({ reservations: [makeReservation({ status: 'linked-active', runId: 701 })], remoteRuns: [], queryComplete: true, observedAt: KNOWN_NOW });
  assert.equal(absent.reservations[0].status, 'linked-active', 'absence alone does not release a linked slot');
});

test('AC-OPS-1133-3 history: aliases, UTC buckets, legacy rows and approvals retain existing policy', async () => {
  const { canonicalRepo, parseAudit, reconcile, decide } = await api();
  assert.equal(canonicalRepo('PMO'), 'ariefsaid/PMO');
  assert.equal(canonicalRepo('ariefsaid/pmo'), 'ariefsaid/PMO');
  assert.equal(canonicalRepo('gordi-mos'), 'ariefsaid/gordi-mos');
  assert.throws(() => canonicalRepo('PMO-copy')); // no suffix/substring aliasing
  const bytes = [
    '2026-10-19T01:00Z\tPMO\trelease/one#-\tnormal\tfirst',
    '2026-10-19T02:00Z\tariefsaid/PMO\trelease/one#-\tbugfix-proof\tsecond',
  ].join('\n');
  const rows = parseAudit(`${bytes}\n`, { pmo: 'ariefsaid/PMO' });
  assert.equal(rows.length, 2);
  assert.throws(() => parseAudit(`${bytes}\nnot-five-columns`));

  const request = makeReservation({ requestId: '44444444-4444-4444-8444-444444444444', branch: 'release/one', startedAt: KNOWN_NOW });
  const baseState = reconcile({ reservations: [], remoteRuns: [], queryComplete: true, observedAt: KNOWN_NOW });
  const decideWith = (auditRows, prior, kind, startedAt = KNOWN_NOW) => decide({
    state: { ...baseState, reservations: prior, auditRows, now: startedAt },
    policy: { capacity: 2, dailyCap: 3 },
    request: { ...request, kind, startedAt },
  });
  const auditRows = [
    { at: '2026-10-19T01:00:00Z', repo: 'fixture/alpha', branchPr: 'release/one#-', kind: 'normal', quote: '' },
  ];
  assert.equal(decideWith(auditRows, [], 'normal').allowed, false, 'second branch attempt requires explicit approval');
  assert.equal(decideWith(auditRows, [], 'bugfix-proof').allowed, true);
  const twoPrior = [
    makeReservation({ requestId: '11111111-1111-4111-8111-111111111111', status: 'linked-terminal', runId: 701 }),
    makeReservation({ requestId: '22222222-2222-4222-8222-222222222222', status: 'linked-terminal', runId: 702, startedAt: '2026-10-19T12:05:00.000Z' }),
  ];
  assert.equal(decideWith([], twoPrior, 'bugfix-proof').allowed, false, 'third branch attempt requires owner approval');
  assert.equal(decideWith([], twoPrior, 'owner-ok').allowed, true);
  const threeToday = [1, 2, 3].map((n) => makeReservation({
    requestId: `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`,
    status: 'linked-terminal', runId: 800 + n,
    startedAt: `2026-10-19T0${n}:00:00.000Z`, branch: `old-${n}`,
  }));
  assert.equal(decideWith([], threeToday, 'normal').allowed, false, 'fourth UTC-day attempt requires owner approval');
  assert.equal(decideWith([], threeToday, 'owner-ok').allowed, true);
  assert.equal(decideWith([], twoPrior, 'owner-ok').reservation.branch, 'release/one');
  const fourthAcrossMidnight = [makeReservation({
    requestId: '66666666-6666-4666-8666-666666666666', status: 'linked-terminal', runId: 900,
    startedAt: '2026-10-18T23:59:00.000Z', branch: 'release/one',
  })];
  assert.equal(decideWith([], fourthAcrossMidnight, 'normal', '2026-10-19T00:01:00.000Z').allowed, false, 'branch history spans UTC days');
});

test('AC-OPS-1133-2 persistence: malformed destinations preserve bytes; audit fields stay five columns', async (t) => {
  const { saveLedger, appendAudit, parseAudit } = await api();
  const fx = makeFixture(t);
  const target = path.join(fx.root, 'ledger.json');
  const ledger = makeLedger([makeReservation()]);
  saveLedger(target, ledger);
  const firstBytes = readFileSync(target, 'utf8');
  saveLedger(target, makeLedger([makeReservation({ status: 'accepted-unresolved' })]));
  assert.notEqual(readFileSync(target, 'utf8'), firstBytes, 'atomic replacement changes the ledger');
  const directoryTarget = path.join(fx.root, 'existing-directory');
  mkdirSync(directoryTarget);
  writeFileSync(path.join(directoryTarget, 'keep.txt'), 'keep');
  assert.throws(() => saveLedger(directoryTarget, ledger));
  assert.equal(readFileSync(path.join(directoryTarget, 'keep.txt'), 'utf8'), 'keep');
  assert.throws(() => saveLedger(path.join(fx.root, 'missing', 'ledger.json'), ledger));

  const audit = path.join(fx.root, 'audit.log');
  appendAudit(audit, { at: KNOWN_NOW, repo: 'fixture/alpha', branchPr: 'release/one#-', kind: 'owner-ok', quote: 'line\tbreak\rreturn\nnext' });
  const text = readFileSync(audit, 'utf8');
  assert.equal(text.trimEnd().split('\t').length, 5);
  assert.match(text, /line break return next/);
  assert.equal(parseAudit(text)[0].quote, 'line break return next');
  assert.throws(() => appendAudit(path.join(fx.root, 'missing', 'audit.log'), { at: KNOWN_NOW, repo: 'fixture/alpha', branchPr: 'x#-', kind: 'normal', quote: '' }));
});

test('AC-OPS-1133-2 reads: incomplete pages, missing data and failed required reads reject', async (t) => {
  const { collectObservation, reconcile, decide } = await api();
  const fx = makeFixture(t);
  const options = {
    repo: 'fixture/alpha', workflow: 'alpha.yml', branch: 'release/one',
    observe: [{ repo: 'fixture/alpha', workflow: 'alpha.yml' }, { repo: 'fixture/beta', workflow: 'beta.yml' }],
    reservations: [], ghPath: fx.fakeGh, env: fx.env(), now: KNOWN_NOW,
  };
  const success = await collectObservation(options);
  assert.equal(success.queryComplete, true);
  assert.equal(success.head, HEAD_A);
  assert.equal(success.pr, null);
  assert.ok(fx.journal().every((entry) => entry.args[0] === 'api' ? entry.args.includes('--method') && entry.args[entry.args.indexOf('--method') + 1] === 'GET' : true));

  const paginated = makeFixture(t, { twoPages: true, runs: [
    makeRun({ runId: 601, status: 'queued' }),
    makeRun({ runId: 602, status: 'in_progress' }),
  ] });
  const twoPageObservation = await collectObservation({ ...options, ghPath: paginated.fakeGh, env: paginated.env() });
  assert.deepEqual(twoPageObservation.remoteRuns.map((run) => run.runId).sort(), [601, 602]);

  const badCount = fx.readState();
  badCount.totalCountOverride = 3;
  fx.writeState(badCount);
  await assert.rejects(() => collectObservation(options), /complete|count|incomplete/i);
  const failed = fx.readState();
  failed.totalCountOverride = undefined;
  failed.failures = ['workflows/alpha.yml/runs'];
  fx.writeState(failed);
  await assert.rejects(() => collectObservation(options));

  const historyFailure = fx.readState();
  historyFailure.failures = ['created='];
  fx.writeState(historyFailure);
  await assert.rejects(() => collectObservation(options), /read|failed/i);
  const branchFailure = fx.readState();
  branchFailure.failures = ['branch='];
  fx.writeState(branchFailure);
  await assert.rejects(() => collectObservation(options), /read|failed/i);
  const prFailure = fx.readState();
  prFailure.failures = ['pr-list'];
  fx.writeState(prFailure);
  await assert.rejects(() => collectObservation(options), /read|failed/i);
  const badJson = fx.readState();
  badJson.failures = [];
  badJson.malformedJson = 'workflows/alpha.yml/runs';
  fx.writeState(badJson);
  await assert.rejects(() => collectObservation(options), /malformed JSON/i);
  const missingField = fx.readState();
  missingField.malformedJson = undefined;
  missingField.runs = [makeRun({ status: 'queued' })];
  missingField.malformedRunField = 'head_sha';
  fx.writeState(missingField);
  await assert.rejects(() => collectObservation(options), /head/i);
  const malformed = fx.readState();
  malformed.malformedRunField = undefined;
  malformed.runs = [];
  malformed.failures = [];
  malformed.heads['fixture/alpha|release/one'] = null;
  fx.writeState(malformed);
  await assert.rejects(() => collectObservation(options));

  const linkedRead = makeFixture(t, { runs: [makeRun()] });
  const linkedOptions = {
    ...options,
    ghPath: linkedRead.fakeGh,
    env: linkedRead.env(),
    reservations: [makeReservation({ status: 'linked-active', runId: 701 })],
  };
  const linkedObservation = await collectObservation(linkedOptions);
  assert.deepEqual(linkedObservation.remoteRuns.map((run) => run.runId), [701],
    'a linked run with GitHub’s full workflow path is still a definitive observation');

  const wrongWorkflowPath = makeFixture(t, { runs: [makeRun()], workflowPathOverride: '.github/workflows/other.yml' });
  await assert.rejects(() => collectObservation({
    ...linkedOptions,
    ghPath: wrongWorkflowPath.fakeGh,
    env: wrongWorkflowPath.env(),
  }), /identity changed/i, 'a different full workflow path remains a failed identity check');

  const linkedFailure = linkedRead.readState();
  linkedFailure.failures = ['actions/runs/701'];
  linkedRead.writeState(linkedFailure);
  await assert.rejects(() => collectObservation(linkedOptions), /read|failed/i);

  const linkedMissing = makeFixture(t);
  const linkedLedger = JSON.stringify(makeLedger([makeReservation({ status: 'linked-active', runId: 701 })]));
  const linkedAudit = `${KNOWN_NOW}\tfixture/alpha\trelease/one#-\tnormal\tactive read required\n`;
  writeFileSync(linkedMissing.ledger, linkedLedger);
  writeFileSync(linkedMissing.log, linkedAudit);
  const activeRefusal = runCoordinator(linkedMissing);
  assert.notEqual(activeRefusal.status, 0, 'a missing linked-active run must fail closed');
  assert.equal(readFileSync(linkedMissing.ledger, 'utf8'), linkedLedger, 'failed active lookup retains the busy reservation');
  assert.equal(readFileSync(linkedMissing.log, 'utf8'), linkedAudit);
  assert.equal(linkedMissing.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 0);

  const terminalRead = makeFixture(t);
  const terminalReservation = makeReservation({ status: 'linked-terminal', runId: 701 });
  const terminalObservation = await collectObservation({
    ...options,
    ghPath: terminalRead.fakeGh,
    env: terminalRead.env(),
    reservations: [terminalReservation],
  });
  assert.equal(terminalObservation.queryComplete, true);
  assert.equal(terminalRead.journal().some((entry) => entry.args.includes('repos/fixture/alpha/actions/runs/701')), false,
    'a definitive terminal identity must not need an indefinitely retained run record');
  const terminalState = reconcile({
    reservations: [terminalReservation],
    remoteRuns: terminalObservation.remoteRuns,
    queryComplete: terminalObservation.queryComplete,
    observedAt: terminalObservation.observedAt,
  });
  assert.equal(terminalState.reservations[0].status, 'linked-terminal');
  assert.equal(decide({
    state: { ...terminalState, auditRows: [] },
    policy: { capacity: 2, dailyCap: 3 },
    request: makeReservation({ requestId: '44444444-4444-4444-8444-444444444444', branch: 'release/other' }),
  }).allowed, true, 'a retained terminal identity does not occupy a busy slot');

  const preRead = makeFixture(t);
  const priorLedger = JSON.stringify(makeLedger([makeReservation({ status: 'unknown' })]));
  const priorLog = `${KNOWN_NOW}\tfixture/alpha\tprior#-\tnormal\tkept\n`;
  writeFileSync(preRead.ledger, priorLedger);
  writeFileSync(preRead.log, priorLog);
  const preReadState = preRead.readState();
  preReadState.failures = ['workflows/alpha.yml/runs'];
  preRead.writeState(preReadState);
  const refusal = runCoordinator(preRead);
  assert.notEqual(refusal.status, 0);
  assert.equal(readFileSync(preRead.ledger, 'utf8'), priorLedger);
  assert.equal(readFileSync(preRead.log, 'utf8'), priorLog);
  assert.equal(preRead.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 0);
});

test('AC-OPS-1133-2 outcomes: one dispatch attempt leaves durable uncertainty on nonzero or interrupted transport', async (t) => {
  const missingApproval = makeFixture(t);
  const missingApprovalResult = runCoordinator(missingApproval, { kind: 'owner-ok' });
  assert.notEqual(missingApprovalResult.status, 0);
  assert.equal(missingApproval.journal().length, 0, 'approved admission requires a recorded quote before remote reads');
  assert.equal(existsSync(missingApproval.ledger), false);

  const fx = makeFixture(t);
  const result = runCoordinator(fx);
  assert.equal(result.status, 0, result.stderr);
  const ledger = JSON.parse(readFileSync(fx.ledger, 'utf8'));
  assert.equal(ledger.reservations.length, 1);
  assert.equal(ledger.reservations[0].status, 'accepted-unresolved');
  assert.equal(fx.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 1);
  assert.match(result.stdout, /dispatch accepted.*run pending/);

  const failed = makeFixture(t, { dispatchExitCode: 9 });
  const failedResult = runCoordinator(failed);
  assert.notEqual(failedResult.status, 0);
  assert.doesNotMatch(`${failedResult.stdout}${failedResult.stderr}`, /dispatch accepted/);
  assert.equal(JSON.parse(readFileSync(failed.ledger, 'utf8')).reservations[0].status, 'unknown');
  assert.equal(failed.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 1);

  const interrupted = makeFixture(t, { killParentOnDispatch: true });
  const interruptedResult = runCoordinator(interrupted);
  assert.equal(interruptedResult.signal, 'SIGTERM');
  assert.equal(JSON.parse(readFileSync(interrupted.ledger, 'utf8')).reservations[0].status, 'unknown');
  assert.equal(interrupted.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 1);

  const postRead = makeFixture(t, { failuresAfterDispatch: ['workflows/alpha.yml/runs'] });
  const postReadResult = runCoordinator(postRead);
  assert.notEqual(postReadResult.status, 0);
  assert.doesNotMatch(`${postReadResult.stdout}${postReadResult.stderr}`, /dispatch accepted/);
  assert.equal(JSON.parse(readFileSync(postRead.ledger, 'utf8')).reservations[0].status, 'accepted-unresolved',
    'successful dispatch remains durably unresolved when post-attempt reconciliation cannot complete');
  assert.equal(postRead.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 1);

  const changedHead = makeFixture(t, { changeHeadAfterDispatch: HEAD_B });
  const changedHeadResult = runCoordinator(changedHead);
  assert.notEqual(changedHeadResult.status, 0, 'a post-dispatch head change is an uncertain outcome');
  assert.doesNotMatch(`${changedHeadResult.stdout}${changedHeadResult.stderr}`, /dispatch accepted/);
  const changedHeadLedger = JSON.parse(readFileSync(changedHead.ledger, 'utf8'));
  assert.equal(changedHeadLedger.reservations[0].status, 'accepted-unresolved');
  assert.equal(changedHeadLedger.reservations[0].head, HEAD_A);
  assert.equal(changedHeadLedger.reservations[0].runId, null, 'a run under the moved head cannot be linked');
  assert.equal(changedHead.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 1);
  const reducedCapacityRefusal = runCoordinator(changedHead, {
    capacity: '1', kind: 'owner-ok', quote: 'synthetic retry approval',
  });
  assert.notEqual(reducedCapacityRefusal.status, 0, 'the unresolved reservation remains busy after the head change');
  assert.match(`${reducedCapacityRefusal.stdout}${reducedCapacityRefusal.stderr}`, /capacity/i);
  assert.equal(changedHead.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 1);

  const postSave = makeFixture(t, { chmodRootAfterDispatch: true });
  const postSaveResult = runCoordinator(postSave);
  assert.notEqual(postSaveResult.status, 0);
  assert.doesNotMatch(`${postSaveResult.stdout}${postSaveResult.stderr}`, /dispatch accepted/);
  assert.equal(JSON.parse(readFileSync(postSave.ledger, 'utf8')).reservations[0].status, 'unknown');
  assert.equal(postSave.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 1);

  const appendFailure = makeFixture(t);
  const originalLog = `${KNOWN_NOW}\tfixture/alpha\tprior#-\tnormal\tkept\n`;
  writeFileSync(appendFailure.log, originalLog, { mode: 0o400 });
  chmodSync(appendFailure.log, 0o400);
  const appendFailureResult = runCoordinator(appendFailure);
  assert.notEqual(appendFailureResult.status, 0);
  assert.equal(readFileSync(appendFailure.log, 'utf8'), originalLog);
  assert.equal(JSON.parse(readFileSync(appendFailure.ledger, 'utf8')).reservations[0].status, 'rejected');
  assert.equal(appendFailure.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 0);

  const reserveFailure = makeFixture(t);
  const missingLog = path.join(reserveFailure.root, 'missing', 'ci-e2e.log');
  const reserveFailureResult = runCoordinator(reserveFailure, { log: missingLog });
  assert.notEqual(reserveFailureResult.status, 0);
  assert.equal(existsSync(`${missingLog}.reservations.json`), false);
  assert.equal(existsSync(missingLog), false);
  assert.equal(reserveFailure.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 0);
});

test('AC-OPS-1133-2 pgtap: absent PR runs pgTAP and present PR skips it with literal branch arguments', async (t) => {
  const absent = makeFixture(t);
  const oddBranch = 'release/space and &quote';
  const state = absent.readState();
  state.heads[`fixture/alpha|${oddBranch}`] = HEAD_A;
  absent.writeState(state);
  const noPr = runCoordinator(absent, { branch: oddBranch, quote: 'owner said "go"; keep $literal' });
  assert.equal(noPr.status, 0, noPr.stderr);
  const dispatchArgs = absent.journal().find((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').args;
  assert.ok(dispatchArgs.includes(oddBranch), 'branch is one literal argv value');
  assert.ok(dispatchArgs.includes('run_pgtap=true'));
  assert.equal(readFileSync(absent.log, 'utf8').split('\t').length, 5);

  const present = makeFixture(t);
  const presentState = present.readState();
  presentState.prs['fixture/alpha|release/one'] = [{ number: 82 }];
  present.writeState(presentState);
  const withPr = runCoordinator(present);
  assert.equal(withPr.status, 0, withPr.stderr);
  const withPrArgs = present.journal().find((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').args;
  assert.ok(withPrArgs.includes('run_pgtap=false'));
});

test('AC-OPS-1133-2 stale: age and owner approval never clear two unresolved reservations', async (t) => {
  const fx = makeFixture(t);
  const stale = [
    makeReservation({ requestId: '11111111-1111-4111-8111-111111111111', startedAt: '2020-01-01T00:00:00.000Z', status: 'unknown' }),
    makeReservation({ requestId: '22222222-2222-4222-8222-222222222222', repo: 'fixture/beta', workflow: 'beta.yml', head: HEAD_B, branch: 'release/other', startedAt: '2020-01-01T00:00:00.000Z', status: 'accepted-unresolved' }),
  ];
  writeFileSync(fx.ledger, JSON.stringify(makeLedger(stale)));
  const before = readFileSync(fx.ledger, 'utf8');
  const result = runCoordinator(fx, { kind: 'owner-ok', quote: 'synthetic owner approval' });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /capacity|busy|two/i);
  assert.equal(readFileSync(fx.ledger, 'utf8'), before);
  assert.equal(fx.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 0);
});

test('AC-OPS-1133-3 wrapper: self-test is offline; dry-run is byte-stable and does not dispatch', async (t) => {
  const fx = makeFixture(t);
  const wrapperState = fx.readState();
  wrapperState.heads['ariefsaid/PMO|release/one'] = HEAD_A;
  fx.writeState(wrapperState);
  const self = spawnSync('bash', [WRAPPER, '--self-test'], { encoding: 'utf8', env: fx.env() });
  assert.equal(self.status, 0, self.stderr);
  assert.match(self.stdout, /ci-e2e self-test: ok/);
  assert.equal(fx.journal().length, 0);

  const dry = spawnSync('bash', [WRAPPER, 'release/one', '--dry-run'], {
    encoding: 'utf8', env: fx.env({ CI_E2E_LOG: fx.log, CI_E2E_LOCK: fx.lock, CI_E2E_LOCK_HELD: '1' }),
  });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(existsSync(fx.log), false);
  assert.equal(existsSync(fx.ledger), false);
  assert.equal(fx.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 0);

  const existingState = fx.readState();
  existingState.failures = [];
  fx.writeState(existingState);
  const originalLedger = JSON.stringify(makeLedger([makeReservation({
    repo: 'ariefsaid/PMO', workflow: 'ci.yml', status: 'unknown',
  })]));
  const originalLog = `${KNOWN_NOW}\tariefsaid/PMO\tprior#-\tnormal\tkept\n`;
  writeFileSync(fx.ledger, originalLedger);
  writeFileSync(fx.log, originalLog);
  const dryExisting = spawnSync('bash', [WRAPPER, 'release/one', '--dry-run'], {
    encoding: 'utf8', env: fx.env({ CI_E2E_LOG: fx.log, CI_E2E_LOCK: fx.lock, CI_E2E_LOCK_HELD: '1' }),
  });
  assert.equal(dryExisting.status, 3, dryExisting.stderr);
  assert.equal(readFileSync(fx.ledger, 'utf8'), originalLedger);
  assert.equal(readFileSync(fx.log, 'utf8'), originalLog);
  assert.equal(fx.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 0);

  const linkableClock = Date.now();
  const linkableReservation = makeReservation({
    status: 'unknown',
    startedAt: new Date(linkableClock - 10 * 60_000).toISOString(),
  });
  const linkableRun = makeRun({ createdAt: new Date(linkableClock - 5 * 60_000).toISOString() });
  const linkable = makeFixture(t, { runs: [linkableRun] });
  const linkableLedger = JSON.stringify(makeLedger([linkableReservation]));
  const linkableAudit = `${new Date(linkableClock - 2 * 60_000).toISOString()}\tfixture/alpha\trelease/one#-\tnormal\tprior attempt\n`;
  writeFileSync(linkable.ledger, linkableLedger);
  writeFileSync(linkable.log, linkableAudit);
  const { collectObservation, reconcile } = await api();
  const linkableObservation = await collectObservation({
    repo: 'fixture/alpha', workflow: 'alpha.yml', branch: 'release/one',
    observe: [{ repo: 'fixture/alpha', workflow: 'alpha.yml' }, { repo: 'fixture/beta', workflow: 'beta.yml' }],
    reservations: [linkableReservation], ghPath: linkable.fakeGh, env: linkable.env(), now: new Date().toISOString(),
  });
  const linkableState = reconcile({
    reservations: [linkableReservation], remoteRuns: linkableObservation.remoteRuns,
    queryComplete: linkableObservation.queryComplete, observedAt: linkableObservation.observedAt,
  });
  assert.equal(linkableState.reservations[0].status, 'linked-active', 'the dry-run fixture contains linkable remote evidence');
  const linkableDryRun = runCoordinator(linkable, {
    dryRun: true, kind: 'bugfix-proof', quote: 'synthetic dry-run proof',
  });
  assert.equal(linkableDryRun.status, 0, `${linkableDryRun.stdout}${linkableDryRun.stderr}`);
  assert.equal(readFileSync(linkable.ledger, 'utf8'), linkableLedger);
  assert.equal(readFileSync(linkable.log, 'utf8'), linkableAudit);
  assert.equal(linkable.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 0);

  writeFileSync(fx.ledger, JSON.stringify(makeLedger()));
  writeFileSync(fx.log, '');

  const accepted = spawnSync('bash', [WRAPPER, 'release/one'], {
    encoding: 'utf8', env: fx.env({ CI_E2E_LOG: fx.log, CI_E2E_LOCK: fx.lock, CI_E2E_LOCK_HELD: '1' }),
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(readFileSync(fx.ledger, 'utf8')).reservations.length, 1);
  assert.equal(fx.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 1);

  const approved = spawnSync('bash', [WRAPPER, 'release/one', '--bugfix-proof', 'fixed a synthetic bug'], {
    encoding: 'utf8', env: fx.env({ CI_E2E_LOG: fx.log, CI_E2E_LOCK: fx.lock, CI_E2E_LOCK_HELD: '1' }),
  });
  assert.equal(approved.status, 0, approved.stderr);
  assert.equal(JSON.parse(readFileSync(fx.ledger, 'utf8')).reservations.length, 2);
  const refused = spawnSync('bash', [WRAPPER, 'release/one', '--owner-ok', 'capacity cannot be overridden'], {
    encoding: 'utf8', env: fx.env({ CI_E2E_LOG: fx.log, CI_E2E_LOCK: fx.lock, CI_E2E_LOCK_HELD: '1' }),
  });
  assert.notEqual(refused.status, 0);
  assert.equal(fx.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 2);
});

test('AC-OPS-1133-1 process: two synthetic PMO protocol writers reserve before lock release', async (t) => {
  const fx = makeFixture(t);
  const common = { observe: ['fixture/alpha:alpha.yml', 'fixture/beta:beta.yml'] };
  const run = (repo, workflow, branch, head, kind = 'normal') => {
    const quote = kind === 'normal' ? '' : 'synthetic approval evidence';
    const args = coordinatorArgs(fx, { ...common, repo, workflow, branch, head, kind, quote });
    const env = fx.env({ CI_E2E_PARENT_PID: '' });
    return spawnSync('bash', [LOCK_CORE, 'ci-e2e-lock', fx.lock, '60', 'CI_E2E_LOCK_HELD', 'fixture admission', '--', NODE, ...args], { encoding: 'utf8', env, timeout: 15000 });
  };
  const first = run('fixture/alpha', 'alpha.yml', 'release/one', HEAD_A);
  assert.equal(first.status, 0, first.stderr);
  const second = run('fixture/beta', 'beta.yml', 'release/one', HEAD_B);
  assert.equal(second.status, 0, second.stderr);
  const third = run('fixture/alpha', 'alpha.yml', 'release/one', HEAD_A, 'owner-ok');
  assert.notEqual(third.status, 0);
  assert.equal(fx.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 2);

  const state = fx.readState();
  const createdAfterFinish = new Date().toISOString();
  state.runs = [
    makeRun({ runId: 701, createdAt: createdAfterFinish }),
    makeRun({ repo: 'fixture/beta', workflow: 'beta.yml', runId: 702, branch: 'release/one', head: HEAD_B, createdAt: createdAfterFinish }),
  ];
  fx.writeState(state);
  const afterVisible = run('fixture/alpha', 'alpha.yml', 'release/one', HEAD_A);
  assert.notEqual(afterVisible.status, 0, 'linked busy runs still occupy both slots');
  const ledger = JSON.parse(readFileSync(fx.ledger, 'utf8'));
  assert.deepEqual(ledger.reservations.map((reservation) => reservation.runId).sort(), [701, 702]);
  assert.deepEqual(ledger.reservations.map((reservation) => reservation.status), ['linked-active', 'linked-active']);

  state.runs[0].status = 'completed';
  fx.writeState(state);
  const oneCompleted = run('fixture/alpha', 'alpha.yml', 'release/one', HEAD_A, 'bugfix-proof');
  assert.equal(oneCompleted.status, 0, 'a definitively terminal linked identity frees one slot');
  const updated = JSON.parse(readFileSync(fx.ledger, 'utf8'));
  assert.equal(updated.reservations.find((reservation) => reservation.runId === 701).status, 'linked-terminal');
  assert.equal(updated.reservations.find((reservation) => reservation.runId === 702).status, 'linked-active');

  const peerActive = makeFixture(t, { runs: [
    makeRun({ runId: 901 }),
    makeRun({ repo: 'fixture/beta', workflow: 'beta.yml', runId: 902, head: HEAD_B }),
  ] });
  const peerResult = runCoordinator(peerActive, { kind: 'owner-ok', quote: 'synthetic peer coordination test' });
  assert.notEqual(peerResult.status, 0, 'a nonparticipating observed peer run still consumes shared remote capacity');
  assert.match(`${peerResult.stdout}${peerResult.stderr}`, /capacity/i);
  assert.equal(peerActive.journal().filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 0);
});

test('AC-OPS-1133-1 locking: second admission read waits for first state write under the existing lock', async (t) => {
  const fx = makeFixture(t, { blockDispatch: true });
  const args = coordinatorArgs(fx);
  const secondArgs = coordinatorArgs(fx, { branch: 'release/other' });
  const nextState = fx.readState();
  nextState.heads['fixture/alpha|release/other'] = HEAD_A;
  fx.writeState(nextState);
  const env = fx.env();
  const first = spawn('bash', [LOCK_CORE, 'ci-e2e-lock', fx.lock, '60', 'CI_E2E_LOCK_HELD', 'fixture admission', '--', NODE, ...args], {
    env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    try { writeFileSync(path.join(fx.root, 'dispatch-release'), 'release'); }
    catch { /* the fixture may already have removed its release marker */ }
  });
  await waitForFile(path.join(fx.root, 'dispatch-entered'), first);
  // Timeout 0 is the lock core's intentional blocking mode and reports the wait immediately.
  const second = spawn('bash', [LOCK_CORE, 'ci-e2e-lock', fx.lock, '0', 'CI_E2E_LOCK_HELD', 'fixture admission', '--', NODE, ...secondArgs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let secondStderr = '';
  second.stderr.on('data', (chunk) => { secondStderr += chunk; });
  const secondDone = childResult(second);
  const secondWaiting = waitForChildOutput(() => secondStderr, /waiting for fixture admission/, [first, second]);
  await secondWaiting;
  const beforeRelease = fx.journal();
  const readsBeforeRelease = beforeRelease.filter((entry) => entry.args[0] === 'api').length;
  assert.ok(readsBeforeRelease > 0, 'first writer completed its observation before entering dispatch');
  assert.equal(beforeRelease.filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run').length, 1);
  assert.equal(beforeRelease.filter((entry) => entry.args[0] === 'api' && entry.args.at(-1)?.includes('release%2Fother')).length, 0,
    'second writer cannot begin observation while first still holds the shared lock');
  assert.equal(existsSync(path.join(fx.root, 'dispatch-entered')), true);
  writeFileSync(path.join(fx.root, 'dispatch-release'), 'release');
  const firstResult = await childResult(first);
  const secondResult = await secondDone;
  assert.equal(firstResult.code, 0, firstResult.stderr);
  assert.equal(secondResult.code, 0, secondResult.stderr);
  const journal = fx.journal();
  const writes = journal.filter((entry) => entry.args[0] === 'workflow' && entry.args[1] === 'run');
  assert.equal(writes.length, 2, 'one write per invocation after serialized admission');
  const firstWriteAt = journal.indexOf(writes[0]);
  const secondWriterFirstRead = journal.findIndex((entry, index) => index > firstWriteAt && entry.args[0] === 'api' && entry.args.at(-1)?.includes('release%2Fother'));
  assert.ok(secondWriterFirstRead > firstWriteAt, 'second observation starts only after first writer dispatch and durable transaction');
});

async function waitForFile(file, ...children) {
  while (!existsSync(file)) {
    if (children.some((child) => child.exitCode !== null)) throw new Error(`process ended before fixture marker: ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForChildOutput(readOutput, pattern, children) {
  while (!pattern.test(readOutput())) {
    if (children.some((child) => child.exitCode !== null)) throw new Error('process ended before expected lock-wait marker');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function childResult(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}
