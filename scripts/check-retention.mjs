#!/usr/bin/env node
/**
 * Guard: every log/queue/history-shaped table and every pg_cron job is declared in docs/retention.md
 * with a purge (job name + keep period) or `keep: <reason>` (#1755, Map #1533).
 * Why: cron.job_run_details grew to 37% of the database before anyone noticed.
 *
 * Table/job sets are replayed from supabase/migrations/*.sql in order (rollback/ ignored, SQL
 * comments stripped): latest definition wins, dropped tables / unscheduled jobs drop out.
 * Unlisted fails; a stale entry (names nothing in the migrations) fails; a malformed decision fails.
 * Entries with a dot (`cron.job_run_details`, `net._http_response`) live outside the migrations and
 * skip the stale check; a trailing `*` matches any table by prefix.
 *
 * Run: node scripts/check-retention.mjs [--self-test]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOGLIKE = /(_log|_events|_runs|_inbox|_outbox|_history|_usage|_attempts|_fires)$|^notifications$/;

const strip = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const ident = String.raw`(?:public\.)?"?([a-z_][a-z0-9_]*)"?`;

/** sqls: migration texts in apply order -> { tables:Set, jobs:Set } as of head. */
export function scan(sqls) {
  const tables = new Set();
  const jobs = new Set();
  const ops = [
    [new RegExp(String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?${ident}`, 'gi'), (m) => tables.add(m[1])],
    [new RegExp(String.raw`drop\s+table\s+(?:if\s+exists\s+)?${ident}`, 'gi'), (m) => tables.delete(m[1])],
    [
      new RegExp(String.raw`alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${ident}\s+rename\s+to\s+"?([a-z_][a-z0-9_]*)"?`, 'gi'),
      (m) => { if (tables.delete(m[1])) tables.add(m[2]); },
    ],
    [/cron\.schedule\(\s*'([^']+)'/gi, (m) => jobs.add(m[1])],
    [/cron\.unschedule\(\s*'([^']+)'/gi, (m) => jobs.delete(m[1])],
  ];
  for (const sql of sqls) {
    const hits = [];
    for (const [re, fn] of ops) for (const m of strip(sql).matchAll(re)) hits.push([m.index, m, fn]);
    hits.sort((a, b) => a[0] - b[0]).forEach(([, m, fn]) => fn(m));
  }
  return { tables, jobs };
}

/** Table rows whose first cell is a backticked name -> Map(name -> decision cell). */
export function parseDoc(md) {
  const entries = new Map();
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|/);
    if (m) entries.set(m[1], m[2]);
  }
  return entries;
}

export function check({ tables, jobs }, entries) {
  const errors = [];
  const required = [...tables].filter((t) => LOGLIKE.test(t)).concat([...jobs]);
  for (const name of required) if (!entries.has(name)) errors.push(`unlisted: ${name} (add it to docs/retention.md)`);
  for (const [name, decision] of entries) {
    const known = name.includes('.') || tables.has(name) || jobs.has(name) ||
      (name.endsWith('*') && [...tables].some((t) => t.startsWith(name.slice(0, -1))));
    if (!known) errors.push(`stale: ${name} (names no table or cron job in the migrations)`);
    if (/^purge\b/i.test(decision)) {
      const job = decision.match(/`([a-z0-9_-]+)`/);
      if (!job || !jobs.has(job[1])) errors.push(`bad purge: ${name} (needs a \`job-name\` that is scheduled)`);
      if (!/\d+\s*(day|month)/i.test(decision)) errors.push(`bad purge: ${name} (needs a keep period, e.g. "30 days")`);
    } else if (!/^keep:\s*\S/i.test(decision) && !/^self-cleaning\b/i.test(decision)) {
      errors.push(`bad decision: ${name} (must start "purge", "keep: <reason>" or "self-cleaning")`);
    }
  }
  return errors;
}

function selfTest() {
  const assert = (c, msg) => { if (!c) { console.error(`self-test FAIL: ${msg}`); process.exit(1); } };
  const head = scan([
    'create table public.foo_log (id int); create table old_events (id int);',
    "drop table old_events; select cron.schedule('a-job','* * * * *','x'); -- cron.schedule('commented','x','y')\nselect cron.schedule('b-job','x','y'); select cron.unschedule('b-job');",
    'alter table foo_log rename to foo_history;',
  ]);
  assert(head.tables.has('foo_history') && !head.tables.has('foo_log') && !head.tables.has('old_events'), 'table replay');
  assert([...head.jobs].join() === 'a-job', 'job replay');
  const ok = new Map([['foo_history', 'keep: audit'], ['a-job', 'keep: tick only']]);
  assert(check(head, ok).length === 0, 'complete doc is green');
  const missing = new Map([['a-job', 'keep: tick only']]);
  assert(check(head, missing).some((e) => e.startsWith('unlisted: foo_history')), 'unlisted table must be red');
  assert(check(head, new Map([...ok, ['ghost_log', 'keep: x']])).some((e) => e.startsWith('stale: ghost_log')), 'stale entry must be red');
  assert(check(head, new Map([...ok, ['foo_history', 'maybe']])).length > 0, 'bad decision must be red');
  const purged = new Map([['foo_history', 'purge, 30 days (`a-job`)'], ['a-job', 'keep: tick only']]);
  assert(check(head, purged).length === 0, 'valid purge is green');
  assert(check(head, new Map([...purged, ['foo_history', 'purge, 30 days (`nope`)']])).length > 0, 'purge naming an unscheduled job must be red');
  assert(parseDoc('| `x` | keep: y |\n| h | z |').get('x') === 'keep: y', 'parseDoc');
  console.log('check-retention self-test OK');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    const dir = join(REPO, 'supabase/migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const head = scan(files.map((f) => readFileSync(join(dir, f), 'utf8')));
    const errors = check(head, parseDoc(readFileSync(join(REPO, 'docs/retention.md'), 'utf8')));
    if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
    console.log(`check-retention OK (${head.tables.size} tables, ${head.jobs.size} jobs scanned)`);
  }
}
