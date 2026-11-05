import { spawn as nodeSpawn } from 'node:child_process';

// Shared, side-effect-free session helpers for the 0644 two-session race proof.
//
// Extracted so the session lifecycle can be tested offline WITHOUT docker or a database: the harness
// passes a real `spawn`, the unit test passes a fake one. Everything here is pure apart from the
// injected spawn, which is what makes the barrier/keep-open/release lifecycle provable before runtime.

/** Every owned session carries the run namespace as its application name and bounded PG timeouts. */
export function sessionPrelude(applicationName) {
  return `set application_name='${applicationName}';
set statement_timeout='60s';
set lock_timeout='20s';
set idle_in_transaction_session_timeout='120s';
`;
}

/** Literal-prefix match. LIKE would treat `_` in a namespace as a wildcard. */
export function namespacePredicate(namespace, column = 'application_name') {
  const literal = String(namespace).replaceAll("'", "''");
  return `left(${column}, ${literal.length}) = '${literal}'`;
}

export function ownedBackendSql(namespace) {
  return `select count(*) from pg_stat_activity
  where ${namespacePredicate(namespace)} and pid <> pg_backend_pid();`;
}

export function ownedWaitersSql(namespace, needle) {
  const literal = String(needle).replaceAll("'", "''");
  return `select count(distinct pid) from pg_stat_activity
  where ${namespacePredicate(namespace)}
    and wait_event_type='Lock' and query ilike '%${literal}%';`;
}

/**
 * Start an owned psql session.
 *
 * `keepOpen` is the barrier guarantee: closing stdin makes psql exit and silently roll the transaction
 * back, which would release the very lock the contenders are supposed to queue on. A keep-open session
 * is closed only by `release(...)`.
 */
export function startSession({ spawn = nodeSpawn, dockerArgs, sql, applicationName, keepOpen = false, spawnImpl = spawn }) {
  const child = spawnImpl('docker', dockerArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding?.('utf8');
  child.stdout?.on?.('data', (chunk) => { stdout += chunk; output += chunk; });
  child.stderr?.setEncoding?.('utf8');
  child.stderr?.on?.('data', (chunk) => { stderr += chunk; output += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr, output }));
  });
  // A child that exits before we write (docker missing/failing) raises EPIPE on stdin; the exit status
  // and stderr still arrive via `done`, so swallow the stream error instead of crashing the process.
  child.stdin.on?.('error', () => {});
  child.stdin.write(sessionPrelude(applicationName) + sql);
  if (!keepOpen) child.stdin.end();
  return {
    child,
    done,
    applicationName,
    keepOpen,
    get output() { return output; },
    get stdinOpen() { return !child.stdin.writableEnded; },
    /** Close a keep-open session explicitly: commit/rollback first, then EOF. */
    release(terminator = 'commit;\n') {
      if (child.stdin.writableEnded) throw new Error('release called on an already closed session');
      if (terminator) child.stdin.write(terminator);
      child.stdin.end();
    },
  };
}

/** Node's TAP summary must show exactly two passing tests with nothing skipped or marked todo. */
export function parseRaceTap(text) {
  const number = (label) => {
    const match = text.match(new RegExp(`^# ${label} (\\d+)$`, 'm'));
    return match ? Number(match[1]) : null;
  };
  return {
    tests: number('tests'),
    pass: number('pass'),
    fail: number('fail'),
    skipped: number('skipped'),
    todo: number('todo'),
    notOk: [...text.matchAll(/^not ok \d+ - (.*)$/gm)].map((match) => match[1]),
    ok: [...text.matchAll(/^ok \d+ - (.*)$/gm)].map((match) => match[1]),
  };
}

export function raceTapProblems(tap, expectedTests = 2) {
  const problems = [];
  if (tap.tests !== expectedTests) problems.push(`expected ${expectedTests} tests, saw ${tap.tests}`);
  if (tap.pass !== expectedTests) problems.push(`expected ${expectedTests} passing, saw ${tap.pass}`);
  if (tap.fail !== 0) problems.push(`expected 0 failing, saw ${tap.fail}`);
  if (tap.skipped !== 0) problems.push(`expected 0 skipped, saw ${tap.skipped}`);
  if (tap.todo !== 0) problems.push(`expected 0 todo, saw ${tap.todo}`);
  if (tap.notOk.length) problems.push(`not ok: ${tap.notOk.join('; ')}`);
  return problems;
}

/** Cleanup runs in this order: stop our sessions, drain our daemon backends, delete only exact owned
 *  ids, then prove owned rows are gone and no foreign row digest moved. */
export const CLEANUP_ORDER = [
  'stop-sessions',
  'drain-owned-backends',
  'delete-exact-owned-ids',
  'assert-owned-zero-and-foreign-digests',
];

const RESOLVED_PHASES = new Set(['cleaned', 'absent', 'reconciled']);
const PENDING_PHASES = new Set(['creating', 'created']);

/**
 * Decide what an ownership record allows cleanup to delete.
 *
 * `creating` is written BEFORE the setup transaction runs, because psql's COMMIT can succeed while the
 * client still fails. Such a record must be reconciled exactly like `created` — otherwise committed
 * fixture rows leak while the schema DOWN destroys their parent tables. Anything malformed must fail
 * restoration instead of silently doing nothing.
 */
export function ownershipPlan(record, expectedOrgs) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('race ownership record is missing or malformed');
  }
  const { phase, orgs, pre_owned: preOwned } = record;
  if (RESOLVED_PHASES.has(phase)) return { deleteOrgs: [], phase };
  if (!PENDING_PHASES.has(phase)) {
    throw new Error(`race ownership phase ${JSON.stringify(phase)} cannot be reconciled`);
  }
  if (preOwned !== 0) {
    throw new Error('race ownership record does not prove the namespace was empty before creation');
  }
  if (!Array.isArray(orgs) || orgs.length !== expectedOrgs.length) {
    throw new Error('race ownership record does not name the declared fixture ids');
  }
  if (!orgs.every((org, index) => org === expectedOrgs[index])) {
    throw new Error('race ownership record names an id outside the declared fixture namespace');
  }
  return { deleteOrgs: orgs.slice(), phase };
}
