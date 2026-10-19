#!/usr/bin/env node

import { closeSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEMA_VERSION = 1;
const RESERVATION_STATUSES = new Set([
  'reserved', 'accepted-unresolved', 'linked-active', 'linked-terminal', 'rejected', 'unknown',
]);
const REMOTE_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending', 'completed']);
const REQUEST_KINDS = new Set(['normal', 'bugfix-proof', 'owner-ok']);
const DEFAULT_ALIASES = Object.freeze({
  pmo: 'ariefsaid/PMO',
  'ariefsaid/pmo': 'ariefsaid/PMO',
  mos: 'ariefsaid/gordi-mos',
  'gordi-mos': 'ariefsaid/gordi-mos',
  'ariefsaid/gordi-mos': 'ariefsaid/gordi-mos',
});
const RESERVATION_KEYS = new Set([
  'requestId', 'repo', 'workflow', 'branch', 'head', 'startedAt', 'baselineRunIds',
  'kind', 'quote', 'pr', 'status', 'runId', 'finishedAt',
]);

function fail(message) {
  throw new Error(message);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty string`);
  return value;
}

function isUtcIso(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function validTime(value, label) {
  if (!isUtcIso(value)) fail(`${label} must be a UTC ISO timestamp`);
  return value;
}

function validRunId(value, label = 'run ID') {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive safe integer`);
  return value;
}

function validHead(value, label = 'head') {
  if (typeof value !== 'string' || !/^[a-f0-9]{40,64}$/i.test(value)) fail(`${label} must be an immutable commit SHA`);
  return value.toLowerCase();
}

function canonicalRepositoryShape(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}

export function canonicalRepo(value, aliases = DEFAULT_ALIASES) {
  requireString(value, 'repository');
  const aliasTable = { ...DEFAULT_ALIASES, ...aliases };
  const alias = aliasTable[value.trim().toLowerCase()];
  if (alias) {
    if (!canonicalRepositoryShape(alias)) fail('repository alias must resolve to owner/repository');
    return alias;
  }
  if (!canonicalRepositoryShape(value)) fail('repository must be an explicit owner/repository identity or alias');
  const normalized = value.split('/').map((part) => part.toLowerCase()).join('/');
  const canonicalKnown = DEFAULT_ALIASES[normalized];
  return canonicalKnown ?? normalized;
}

function validateReservation(value, index, aliases = DEFAULT_ALIASES) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`reservation ${index} must be an object`);
  const unknown = Object.keys(value).filter((key) => !RESERVATION_KEYS.has(key));
  if (unknown.length) fail(`reservation ${index} contains unsupported fields`);
  for (const key of RESERVATION_KEYS) {
    if (!Object.hasOwn(value, key)) fail(`reservation ${index} is missing ${key}`);
  }
  if (typeof value.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)) {
    fail(`reservation ${index} has an invalid request ID`);
  }
  const repo = canonicalRepo(value.repo, aliases);
  const workflow = requireString(value.workflow, `reservation ${index} workflow`);
  const branch = requireString(value.branch, `reservation ${index} branch`);
  const head = validHead(value.head, `reservation ${index} head`);
  const startedAt = validTime(value.startedAt, `reservation ${index} start time`);
  if (!Array.isArray(value.baselineRunIds)) fail(`reservation ${index} baseline IDs must be an array`);
  const baselineRunIds = value.baselineRunIds.map((id) => validRunId(id, `reservation ${index} baseline run ID`));
  if (new Set(baselineRunIds).size !== baselineRunIds.length) fail(`reservation ${index} has duplicate baseline run IDs`);
  if (!REQUEST_KINDS.has(value.kind)) fail(`reservation ${index} has an invalid approval kind`);
  if (typeof value.quote !== 'string') fail(`reservation ${index} quote must be text`);
  if (value.pr !== null && (!Number.isSafeInteger(value.pr) || value.pr < 1)) fail(`reservation ${index} PR must be null or a positive integer`);
  if (!RESERVATION_STATUSES.has(value.status)) fail(`reservation ${index} has an invalid status`);
  const runId = value.runId === null ? null : validRunId(value.runId, `reservation ${index} linked run ID`);
  const finishedAt = value.finishedAt === null ? null : validTime(value.finishedAt, `reservation ${index} finish time`);
  if (value.status.startsWith('linked-') !== (runId !== null)) fail(`reservation ${index} linked status and run ID disagree`);
  if (value.status === 'rejected' && runId !== null) fail(`reservation ${index} rejected request cannot have a run ID`);
  if (value.status === 'reserved' && finishedAt !== null) fail(`reservation ${index} reserved request cannot have a finish time`);
  return {
    requestId: value.requestId,
    repo,
    workflow,
    branch,
    head,
    startedAt,
    baselineRunIds,
    kind: value.kind,
    quote: value.quote,
    pr: value.pr,
    status: value.status,
    runId,
    finishedAt,
  };
}

export function parseLedger(text, aliases = DEFAULT_ALIASES) {
  if (typeof text !== 'string') fail('ledger contents must be text');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('ledger JSON is malformed');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('ledger must be an object');
  if (Object.keys(parsed).some((key) => key !== 'schemaVersion' && key !== 'reservations')) {
    fail('ledger contains unsupported fields');
  }
  if (parsed.schemaVersion !== SCHEMA_VERSION) fail('ledger schema version is unsupported');
  if (!Array.isArray(parsed.reservations)) fail('ledger reservations must be an array');
  const reservations = parsed.reservations.map((reservation, index) => validateReservation(reservation, index, aliases));
  const requestIds = new Set();
  const linkedRunIds = new Set();
  for (const reservation of reservations) {
    if (requestIds.has(reservation.requestId)) fail('ledger contains duplicate request IDs');
    requestIds.add(reservation.requestId);
    if (reservation.runId !== null) {
      const identity = `${reservation.repo.toLowerCase()}#${reservation.runId}`;
      if (linkedRunIds.has(identity)) fail('ledger links one remote run to multiple reservations');
      linkedRunIds.add(identity);
    }
  }
  return { schemaVersion: SCHEMA_VERSION, reservations };
}

export function loadLedger(file, aliases = DEFAULT_ALIASES) {
  let contents;
  try {
    contents = readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { schemaVersion: SCHEMA_VERSION, reservations: [] };
    throw error;
  }
  return parseLedger(contents, aliases);
}

function validateAuditRow(row, index = 'new row', aliases = DEFAULT_ALIASES) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail(`audit ${index} must be an object`);
  const at = validTime(row.at, `audit ${index} timestamp`);
  const repo = canonicalRepo(row.repo, aliases);
  const branchPr = requireString(row.branchPr, `audit ${index} branch/PR`);
  const separator = branchPr.lastIndexOf('#');
  if (separator < 1) fail(`audit ${index} branch/PR must end in #<number> or #-`);
  const branch = branchPr.slice(0, separator);
  const pr = branchPr.slice(separator + 1);
  if (!branch || !(pr === '-' || /^[1-9]\d*$/.test(pr))) fail(`audit ${index} branch/PR is malformed`);
  if (!REQUEST_KINDS.has(row.kind)) fail(`audit ${index} approval kind is invalid`);
  if (typeof row.quote !== 'string') fail(`audit ${index} quote must be text`);
  return { at, repo, branchPr, kind: row.kind, quote: row.quote };
}

export function parseAudit(text, aliases = DEFAULT_ALIASES) {
  if (typeof text !== 'string') fail('audit contents must be text');
  const rows = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line === '') continue;
    const columns = line.split('\t');
    if (columns.length !== 5) fail(`audit row ${index + 1} must have five columns`);
    rows.push(validateAuditRow({ at: columns[0], repo: columns[1], branchPr: columns[2], kind: columns[3], quote: columns[4] }, index + 1, aliases));
  }
  return rows;
}

function validateLedgerObject(ledger) {
  return parseLedger(JSON.stringify(ledger));
}

export function saveLedger(file, ledger) {
  const normalized = validateLedgerObject(ledger);
  const directory = path.dirname(file);
  const temp = path.join(directory, `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temp, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temp, file);
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* preserve the original filesystem error */ }
    }
    try { unlinkSync(temp); } catch { /* only the current attempt's temporary file is removed */ }
    throw error;
  }
}

function sanitizeCell(value) {
  return value.replace(/[\t\r\n]/g, ' ');
}

export function appendAudit(file, row) {
  const valid = validateAuditRow(row);
  const serialized = [valid.at, valid.repo, valid.branchPr, valid.kind, valid.quote]
    .map(sanitizeCell)
    .join('\t') + '\n';
  let descriptor;
  try {
    descriptor = openSync(file, 'a', 0o600);
    writeFileSync(descriptor, serialized, 'utf8');
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function identityKey(repo, runId) {
  return `${canonicalRepo(repo).toLowerCase()}#${runId}`;
}

function validateRemoteRun(run, index) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) fail(`remote run ${index} must be an object`);
  const repo = canonicalRepo(run.repo);
  const workflow = requireString(run.workflow, `remote run ${index} workflow`);
  const runId = validRunId(run.runId, `remote run ${index} ID`);
  const event = requireString(run.event, `remote run ${index} event`);
  const branch = requireString(run.branch, `remote run ${index} branch`);
  const head = validHead(run.head, `remote run ${index} head`);
  const createdAt = validTime(run.createdAt, `remote run ${index} creation time`);
  if (!REMOTE_STATUSES.has(run.status)) fail(`remote run ${index} has an unsupported status`);
  return { repo, workflow, runId, event, branch, head, createdAt, status: run.status };
}

function normalizedRemoteRuns(remoteRuns) {
  if (!Array.isArray(remoteRuns)) fail('remote runs must be an array');
  const byIdentity = new Map();
  for (const [index, item] of remoteRuns.entries()) {
    const run = validateRemoteRun(item, index + 1);
    const key = identityKey(run.repo, run.runId);
    const previous = byIdentity.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(run)) fail('remote run identity has contradictory observations');
    byIdentity.set(key, run);
  }
  return [...byIdentity.values()];
}

function roundDownSecond(instant) {
  return Math.floor(instant / 1000) * 1000;
}

function roundUpSecond(instant) {
  return Math.ceil(instant / 1000) * 1000;
}

function matchesReservation(reservation, run, observedAt) {
  if (run.event !== 'workflow_dispatch') return false;
  if (run.repo.toLowerCase() !== reservation.repo.toLowerCase()) return false;
  if (run.workflow !== reservation.workflow || run.branch !== reservation.branch || run.head !== reservation.head) return false;
  const created = Date.parse(run.createdAt);
  return created >= roundDownSecond(Date.parse(reservation.startedAt))
    && created <= roundUpSecond(Date.parse(observedAt))
    && !reservation.baselineRunIds.includes(run.runId);
}

function linkedStatus(run) {
  return run.status === 'completed' ? 'linked-terminal' : 'linked-active';
}

export function reconcile({ reservations, remoteRuns, queryComplete, observedAt }) {
  if (queryComplete !== true) fail('remote observation is incomplete');
  validTime(observedAt, 'observation cutoff');
  if (!Array.isArray(reservations)) fail('reservations must be an array');
  const ledger = parseLedger(JSON.stringify({ schemaVersion: SCHEMA_VERSION, reservations }));
  const remotes = normalizedRemoteRuns(remoteRuns);
  const remoteByIdentity = new Map(remotes.map((run) => [identityKey(run.repo, run.runId), run]));
  const output = ledger.reservations.map((reservation) => ({ ...reservation, baselineRunIds: [...reservation.baselineRunIds] }));

  for (const reservation of output) {
    if (reservation.runId === null) continue;
    const run = remoteByIdentity.get(identityKey(reservation.repo, reservation.runId));
    if (run) reservation.status = linkedStatus(run);
  }

  const eligible = output.filter((reservation) =>
    reservation.runId === null && ['reserved', 'accepted-unresolved', 'unknown'].includes(reservation.status),
  );
  const candidatesByRequest = new Map();
  const candidateRequestCounts = new Map();
  const alreadyLinked = new Set(output.filter((reservation) => reservation.runId !== null)
    .map((reservation) => identityKey(reservation.repo, reservation.runId)));
  for (const reservation of eligible) {
    const candidates = remotes.filter((run) =>
      !alreadyLinked.has(identityKey(run.repo, run.runId)) && matchesReservation(reservation, run, observedAt),
    );
    candidatesByRequest.set(reservation.requestId, candidates);
    for (const run of candidates) {
      const key = identityKey(run.repo, run.runId);
      candidateRequestCounts.set(key, (candidateRequestCounts.get(key) ?? 0) + 1);
    }
  }
  const candidatesByIdentity = new Map(remotes.map((run) => [identityKey(run.repo, run.runId), run]));
  for (const reservation of eligible) {
    const candidates = candidatesByRequest.get(reservation.requestId) ?? [];
    if (candidates.length !== 1) continue;
    const candidate = candidates[0];
    const key = identityKey(candidate.repo, candidate.runId);
    if (candidateRequestCounts.get(key) !== 1) continue;
    const run = candidatesByIdentity.get(key);
    reservation.runId = run.runId;
    reservation.status = linkedStatus(run);
  }
  return {
    reservations: output,
    remoteRuns: remotes,
    queryComplete: true,
    observedAt,
  };
}

function currentBusyIdentities(state) {
  const busy = new Set();
  for (const run of state.remoteRuns) {
    if (run.event === 'workflow_dispatch' && run.status !== 'completed') busy.add(identityKey(run.repo, run.runId));
  }
  for (const reservation of state.reservations) {
    if (reservation.status === 'reserved' || reservation.status === 'accepted-unresolved' || reservation.status === 'unknown') {
      if (reservation.runId === null) busy.add(`request#${reservation.requestId}`);
      else busy.add(identityKey(reservation.repo, reservation.runId));
    } else if (reservation.status === 'linked-active') {
      busy.add(identityKey(reservation.repo, reservation.runId));
    }
  }
  return busy;
}

function startOfUtcDay(timestamp) {
  return new Date(Date.parse(timestamp)).toISOString().slice(0, 10);
}

function runTimeForReservation(reservation, remoteByIdentity) {
  if (reservation.runId !== null) {
    const run = remoteByIdentity.get(identityKey(reservation.repo, reservation.runId));
    if (run) return run.createdAt;
  }
  return reservation.startedAt;
}

function dispatchHistoryCount(state, repo, branch, day) {
  const identities = new Set();
  const remoteByIdentity = new Map(state.remoteRuns.map((run) => [identityKey(run.repo, run.runId), run]));
  for (const run of state.remoteRuns) {
    if (run.event !== 'workflow_dispatch' || run.repo.toLowerCase() !== repo.toLowerCase()) continue;
    const runBranch = run.branch;
    if ((day === null || startOfUtcDay(run.createdAt) === day) && (branch === null || runBranch === branch)) {
      identities.add(identityKey(run.repo, run.runId));
    }
  }
  for (const reservation of state.reservations) {
    if (reservation.repo.toLowerCase() !== repo.toLowerCase() || reservation.status === 'rejected') continue;
    const time = runTimeForReservation(reservation, remoteByIdentity);
    if ((day !== null && startOfUtcDay(time) !== day) || (branch !== null && reservation.branch !== branch)) continue;
    identities.add(reservation.runId === null ? `request#${reservation.requestId}` : identityKey(reservation.repo, reservation.runId));
  }
  const legacy = state.auditRows.filter((row) => {
    if (row.repo.toLowerCase() !== repo.toLowerCase() || (day !== null && startOfUtcDay(row.at) !== day)) return false;
    return branch === null || row.branchPr.slice(0, row.branchPr.lastIndexOf('#')) === branch;
  }).length;
  return Math.max(legacy, identities.size);
}

export function decide({ state, policy, request }) {
  if (!state || state.queryComplete !== true) fail('admission requires a complete observation');
  if (!Array.isArray(state.reservations) || !Array.isArray(state.remoteRuns) || !Array.isArray(state.auditRows)) {
    fail('admission state is incomplete');
  }
  const capacity = Number(policy?.capacity);
  const dailyCap = Number(policy?.dailyCap);
  if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isSafeInteger(dailyCap) || dailyCap < 1) fail('admission policy is invalid');
  const repo = canonicalRepo(request?.repo);
  const workflow = requireString(request?.workflow, 'request workflow');
  const branch = requireString(request?.branch, 'request branch');
  const head = validHead(request?.head, 'request head');
  const startedAt = validTime(request?.startedAt, 'request start time');
  const kind = request?.kind;
  if (!REQUEST_KINDS.has(kind)) fail('request approval kind is invalid');
  const busy = currentBusyIdentities(state);
  if (busy.size >= capacity) return { allowed: false, reason: `capacity occupied (${busy.size}/${capacity})` };

  const day = startOfUtcDay(startedAt);
  const today = dispatchHistoryCount(state, repo, null, day);
  const onBranch = dispatchHistoryCount(state, repo, branch, null);
  if (today >= dailyCap && kind !== 'owner-ok') {
    return { allowed: false, reason: `${today} dispatches in this repository today (cap ${dailyCap}) requires owner approval` };
  }
  if (onBranch >= 2 && kind !== 'owner-ok') {
    return { allowed: false, reason: `${onBranch} dispatches already on this branch requires owner approval` };
  }
  if (onBranch === 1 && kind === 'normal') {
    return { allowed: false, reason: 'a second dispatch on this branch requires bugfix proof or owner approval' };
  }
  const reservation = validateReservation({
    requestId: request.requestId,
    repo,
    workflow,
    branch,
    head,
    startedAt,
    baselineRunIds: request.baselineRunIds ?? [],
    kind,
    quote: request.quote ?? '',
    pr: request.pr ?? null,
    status: 'reserved',
    runId: null,
    finishedAt: null,
  }, 0);
  return { allowed: true, reason: 'ok', reservation, today, onBranch };
}

function checkedGh(args, options = {}, label = 'GitHub read') {
  const ghPath = options.ghPath ?? 'gh';
  const result = spawnSync(ghPath, args, {
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) {
    const started = result.error.code !== 'ENOENT' && result.error.code !== 'ENOTDIR';
    const error = new Error(`${label} could not be completed`);
    error.processStarted = started;
    error.cause = result.error;
    throw error;
  }
  if (result.status !== 0) {
    const error = new Error(`${label} failed`);
    error.processStarted = true;
    error.exitCode = result.status;
    error.signal = result.signal;
    throw error;
  }
  return result.stdout ?? '';
}

function parseJsonOutput(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} returned malformed JSON`);
  }
}

function repoPath(repo) {
  return canonicalRepo(repo).split('/').map(encodeURIComponent).join('/');
}

function workflowPath(workflow) {
  return encodeURIComponent(workflow);
}

function apiGet(pathname, options, { paginate = false } = {}) {
  const args = ['api', '--method', 'GET'];
  if (paginate) args.push('--paginate', '--slurp');
  args.push(pathname);
  return checkedGh(args, options, 'required GitHub read');
}

function parseRunList(output, repo, workflow, label) {
  const pages = parseJsonOutput(output, label);
  if (!Array.isArray(pages) || pages.length === 0) fail(`${label} returned no complete page set`);
  let totalCount;
  const rows = [];
  for (const page of pages) {
    if (!page || typeof page !== 'object' || Array.isArray(page) || !Number.isSafeInteger(page.total_count) || page.total_count < 0 || !Array.isArray(page.workflow_runs)) {
      fail(`${label} returned a malformed page`);
    }
    if (totalCount !== undefined && totalCount !== page.total_count) fail(`${label} page totals disagree`);
    totalCount = page.total_count;
    for (const raw of page.workflow_runs) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`${label} contains a malformed run`);
      rows.push({
        repo,
        workflow,
        runId: raw.id,
        event: raw.event,
        branch: raw.head_branch,
        head: raw.head_sha,
        createdAt: raw.created_at,
        status: raw.status,
      });
    }
  }
  const normalized = normalizedRemoteRuns(rows);
  if (normalized.length !== totalCount) fail(`${label} pagination is incomplete`);
  return normalized;
}

function workflowRunsEndpoint(repo, workflow, query) {
  const params = new URLSearchParams({ event: 'workflow_dispatch', per_page: '100', ...query });
  return `repos/${repoPath(repo)}/actions/workflows/${workflowPath(workflow)}/runs?${params}`;
}

function readRunList(repo, workflow, query, options) {
  const endpoint = workflowRunsEndpoint(repo, workflow, query);
  return parseRunList(apiGet(endpoint, options, { paginate: true }), canonicalRepo(repo), workflow, `run list for ${repo} ${workflow}`);
}

function workflowPathMatches(actual, configured) {
  const repositoryPath = configured.startsWith('.github/workflows/')
    ? configured
    : `.github/workflows/${configured}`;
  return actual === configured || actual === repositoryPath;
}

function readRun(repo, workflow, runId, options) {
  validRunId(runId);
  const endpoint = `repos/${repoPath(repo)}/actions/runs/${runId}`;
  const raw = parseJsonOutput(apiGet(endpoint, options), `linked run ${runId}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`linked run ${runId} is malformed`);
  if (raw.id !== runId || typeof raw.path !== 'string' || !workflowPathMatches(raw.path, workflow)) fail(`linked run ${runId} identity changed`);
  return validateRemoteRun({
    repo,
    workflow,
    runId: raw.id,
    event: raw.event,
    branch: raw.head_branch,
    head: raw.head_sha,
    createdAt: raw.created_at,
    status: raw.status,
  }, runId);
}

function readBranchHead(repo, branch, options) {
  const endpoint = `repos/${repoPath(repo)}/git/ref/heads/${encodeURIComponent(branch)}`;
  const result = parseJsonOutput(apiGet(endpoint, options), 'branch head lookup');
  if (!result || typeof result !== 'object' || typeof result.ref !== 'string' || !result.object || result.object.type !== 'commit') {
    fail('branch head lookup returned malformed evidence');
  }
  return validHead(result.object.sha, 'branch head');
}

function readPullRequest(repo, branch, options) {
  const output = checkedGh([
    'pr', 'list', '-R', canonicalRepo(repo), '--head', branch, '--state', 'all', '--json', 'number', '--limit', '1',
  ], options, 'required pull request lookup');
  const rows = parseJsonOutput(output, 'pull request lookup');
  if (!Array.isArray(rows)) fail('pull request lookup returned malformed JSON');
  if (rows.length === 0) return null;
  const number = rows[0]?.number;
  if (!Number.isSafeInteger(number) || number < 1) fail('pull request lookup returned an invalid number');
  return number;
}

function observationTime(options) {
  const value = typeof options.clock === 'function' ? options.clock() : options.now;
  return value === undefined ? new Date().toISOString() : validTime(value, 'observation time');
}

export async function collectObservation(options) {
  const repo = canonicalRepo(options?.repo);
  const workflow = requireString(options?.workflow, 'workflow');
  const branch = requireString(options?.branch, 'branch');
  if (!Array.isArray(options?.observe) || options.observe.length === 0) fail('at least one configured workflow observation is required');
  const observations = options.observe.map((entry, index) => {
    if (!entry || typeof entry !== 'object') fail(`configured workflow ${index + 1} is malformed`);
    return { repo: canonicalRepo(entry.repo), workflow: requireString(entry.workflow, `configured workflow ${index + 1}`) };
  });
  const resultRuns = [];
  for (const observed of observations) {
    for (const status of ['queued', 'in_progress', 'waiting', 'requested', 'pending']) {
      resultRuns.push(...readRunList(observed.repo, observed.workflow, { status }, options));
    }
  }
  const start = options.now ?? new Date().toISOString();
  validTime(start, 'history lower bound');
  const day = startOfUtcDay(start);
  const daily = readRunList(repo, workflow, { created: `>=${day}` }, options);
  const branchHistory = readRunList(repo, workflow, { branch, per_page: '100' }, options);
  resultRuns.push(...daily, ...branchHistory);
  const priorRunIds = [...new Set(branchHistory.map((run) => run.runId))].sort((a, b) => a - b);

  for (const reservation of options.reservations ?? []) {
    if (reservation.runId === null || reservation.status !== 'linked-active') continue;
    resultRuns.push(readRun(reservation.repo, reservation.workflow, reservation.runId, options));
  }
  const remoteRuns = normalizedRemoteRuns(resultRuns);
  const head = readBranchHead(repo, branch, options);
  const pr = readPullRequest(repo, branch, options);
  return {
    remoteRuns,
    queryComplete: true,
    observedAt: observationTime(options),
    head,
    pr,
    baselineRunIds: priorRunIds,
  };
}

function auditContents(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

function ledgerPathForLog(log) {
  return `${log}.reservations.json`;
}

function sameReservations(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function branchPr(branch, pr) {
  return `${branch}#${pr ?? '-'}`;
}

function shellSafeStatus(kind, decision) {
  const suffix = decision.allowed ? 'allowed' : `refused: ${decision.reason}`;
  return `ci-e2e: ${kind} ${suffix}`;
}

function dispatchArgs(repo, workflow, branch, pr) {
  const runPgtap = pr === null ? 'true' : 'false';
  return ['workflow', 'run', workflow, '-R', repo, '--ref', branch, '-f', `run_pgtap=${runPgtap}`];
}

function updateStatus(ledger, requestId, status, finishedAt = null) {
  const reservation = ledger.reservations.find((item) => item.requestId === requestId);
  if (!reservation) fail('reservation disappeared during dispatch transaction');
  reservation.status = status;
  reservation.finishedAt = finishedAt;
}

function resultForDispatchFailure(reason, code = 2) {
  process.stderr.write(`ci-e2e: coordination failed: ${reason}\n`);
  return code;
}

// The CLI is invoked by ci-e2e.sh while its machine-global lock is held; module helpers never own that lock.
export async function coordinate(options) {
  let ledgerFile;
  try {
    const repo = canonicalRepo(options.repo);
    const workflow = requireString(options.workflow, 'workflow');
    const branch = requireString(options.branch, 'branch');
    const log = requireString(options.log, 'audit log path');
    const kind = options.kind;
    if (!REQUEST_KINDS.has(kind)) fail('approval kind is invalid');
    const quote = options.quote ?? '';
    if (kind !== 'normal') requireString(quote, 'approval evidence');
    if (!Array.isArray(options.observe) || options.observe.length === 0) fail('configured workflows are required');
    ledgerFile = ledgerPathForLog(log);
    let ledger = loadLedger(ledgerFile);
    const auditRows = parseAudit(auditContents(log));
    const collected = await collectObservation({
      repo,
      workflow,
      branch,
      observe: options.observe,
      reservations: ledger.reservations,
      env: options.env,
      ghPath: options.ghPath,
      clock: options.clock,
    });
    const previousReservations = ledger.reservations;
    const state = reconcile({
      reservations: ledger.reservations,
      remoteRuns: collected.remoteRuns,
      queryComplete: collected.queryComplete,
      observedAt: collected.observedAt,
    });
    ledger = { schemaVersion: SCHEMA_VERSION, reservations: state.reservations };
    const now = options.clock ? options.clock() : new Date().toISOString();
    const request = {
      requestId: randomUUID(),
      repo,
      workflow,
      branch,
      head: collected.head,
      startedAt: now,
      baselineRunIds: collected.baselineRunIds,
      kind,
      quote,
      pr: collected.pr,
    };
    const decision = decide({
      state: { ...state, auditRows, now },
      policy: { capacity: options.capacity, dailyCap: options.dailyCap },
      request,
    });
    if (options.dryRun) {
      process.stdout.write(`${shellSafeStatus('dry-run', decision)}\n`);
      return decision.allowed ? 0 : 3;
    }
    if (!sameReservations(previousReservations, state.reservations)) saveLedger(ledgerFile, ledger);
    if (!decision.allowed) {
      process.stderr.write(`ci-e2e: ${decision.reason}\n`);
      return 3;
    }

    ledger.reservations.push(decision.reservation);
    saveLedger(ledgerFile, ledger);
    try {
      appendAudit(log, {
        at: request.startedAt,
        repo,
        branchPr: branchPr(branch, collected.pr),
        kind,
        quote: request.quote,
      });
    } catch {
      try { updateStatus(ledger, request.requestId, 'rejected'); saveLedger(ledgerFile, ledger); } catch { /* reserved state remains durable */ }
      return resultForDispatchFailure('audit append failed before dispatch');
    }
    updateStatus(ledger, request.requestId, 'unknown');
    saveLedger(ledgerFile, ledger);

    const args = dispatchArgs(repo, workflow, branch, collected.pr);
    let dispatch;
    let started = false;
    try {
      const ghPath = options.ghPath ?? 'gh';
      dispatch = spawnSync(ghPath, args, {
        encoding: 'utf8',
        env: { ...(options.env ?? process.env), CI_E2E_PARENT_PID: String(process.pid) },
        maxBuffer: 1024 * 1024,
      });
      started = !dispatch.error || (dispatch.error.code !== 'ENOENT' && dispatch.error.code !== 'ENOTDIR');
    } catch {
      started = true;
      dispatch = { status: null, signal: null, error: new Error('dispatch process failed') };
    }
    const finishedAt = options.clock ? options.clock() : new Date().toISOString();
    if (!started) {
      updateStatus(ledger, request.requestId, 'rejected', null);
      saveLedger(ledgerFile, ledger);
      return resultForDispatchFailure('dispatch process could not start');
    }
    const dispatchSucceeded = !dispatch.error && dispatch.status === 0 && !dispatch.signal;
    updateStatus(ledger, request.requestId, dispatchSucceeded ? 'accepted-unresolved' : 'unknown', finishedAt);
    saveLedger(ledgerFile, ledger);

    try {
      const after = await collectObservation({
        repo,
        workflow,
        branch,
        observe: options.observe,
        reservations: ledger.reservations,
        env: options.env,
        ghPath: options.ghPath,
        clock: options.clock,
      });
      if (after.head !== request.head) fail('branch head changed during dispatch; reservation remains unresolved');
      const reconciled = reconcile({
        reservations: ledger.reservations,
        remoteRuns: after.remoteRuns,
        queryComplete: after.queryComplete,
        observedAt: after.observedAt,
      });
      ledger = { schemaVersion: SCHEMA_VERSION, reservations: reconciled.reservations };
      saveLedger(ledgerFile, ledger);
      if (!dispatchSucceeded) return resultForDispatchFailure('dispatch transport outcome is uncertain');
      const finalReservation = ledger.reservations.find((item) => item.requestId === request.requestId);
      process.stdout.write(finalReservation?.runId === null
        ? 'ci-e2e: dispatch accepted; run pending reconciliation\n'
        : `ci-e2e: dispatch accepted; run #${finalReservation.runId} linked\n`);
      return 0;
    } catch (error) {
      return resultForDispatchFailure(error.message || 'post-dispatch observation failed');
    }
  } catch (error) {
    return resultForDispatchFailure(error.message || 'required observation or persistence failed');
  }
}

function parseCli(argv) {
  if (argv[0] !== 'coordinate') fail('expected coordinate command');
  const values = {};
  const observe = [];
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--dry-run') {
      if (values.dryRun) fail('duplicate --dry-run');
      values.dryRun = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || (value.startsWith('--') && !(flag === '--quote' && value === ''))) fail(`${flag} needs a value`);
    index += 1;
    if (flag === '--observe') {
      const separator = value.indexOf(':');
      if (separator < 1 || separator === value.length - 1) fail('--observe must be <repo>:<workflow>');
      observe.push({ repo: canonicalRepo(value.slice(0, separator)), workflow: value.slice(separator + 1) });
    } else if (['--repo', '--workflow', '--branch', '--kind', '--quote', '--log', '--capacity', '--daily-cap'].includes(flag)) {
      if (Object.hasOwn(values, flag)) fail(`duplicate ${flag}`);
      values[flag] = value;
    } else {
      fail(`unsupported argument ${flag}`);
    }
  }
  const required = ['--repo', '--workflow', '--branch', '--kind', '--quote', '--log', '--capacity', '--daily-cap'];
  for (const key of required) if (!Object.hasOwn(values, key)) fail(`missing ${key}`);
  if (observe.length === 0) fail('at least one --observe is required');
  const capacity = Number(values['--capacity']);
  const dailyCap = Number(values['--daily-cap']);
  if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isSafeInteger(dailyCap) || dailyCap < 1) fail('capacity limits must be positive integers');
  return {
    repo: values['--repo'],
    workflow: values['--workflow'],
    branch: values['--branch'],
    kind: values['--kind'],
    quote: values['--quote'],
    log: values['--log'],
    capacity,
    dailyCap,
    observe,
    dryRun: values.dryRun ?? false,
  };
}

async function main() {
  try {
    const options = parseCli(process.argv.slice(2));
    process.exitCode = await coordinate(options);
  } catch (error) {
    process.stderr.write(`ci-e2e: ${error.message || 'invalid arguments'}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
