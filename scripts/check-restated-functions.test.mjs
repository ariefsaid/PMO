// check-restated-functions.test.mjs — the restated-function guard's own proof (#2744, architecture pass C1).
// The guard exists because five migrations in one round only put back a function arm a parallel lane's
// whole-body restatement had silently dropped. These tests pin both directions: a dropped line without a
// `-- drops:` marker is a failure (naming the line and the definition it came from), and the same drop
// with the marker is an accepted, reported exemption.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FLOOR, analyze, listMigrations, parseDefinitions, readMigrations, selfTestProblems,
} from './check-restated-functions.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A migration text with one function. `body` lines are the plpgsql body between the dollar quotes. */
const migration = (body, { name = 'demo_fn', args = 'p_id uuid', orReplace = true, marker = null, dropped = null } = {}) => [
  marker ? `-- drops: ${marker}` : null,
  dropped ? `drop function public.${name}(${args});` : null,
  `create ${orReplace ? 'or replace ' : ''}function public.${name}(${args}) returns boolean`,
  'language plpgsql stable security invoker set search_path=public as $$',
  body,
  '$$;',
].filter((line) => line !== null).join('\n');

const files = (entries) => entries.map(([number, sql]) => ({ name: `${number}_demo.sql`, number, sql }));

test('a restated function that keeps every line passes', () => {
  const body = 'begin\n  return true;\nend;';
  const { problems } = analyze(files([[1490, migration(body)], [1491, migration(body)]]));
  assert.deepEqual([...problems], []);
});

test('a restated function that only ADDS a line passes (the arm a feature adds)', () => {
  const before = 'begin\n  return true;\nend;';
  const after = 'begin\n  if p_id is null then return false; end if;\n  return true;\nend;';
  const { problems } = analyze(files([[1490, migration(before)], [1491, migration(after)]]));
  assert.deepEqual([...problems], []);
});

test('a dropped line without a marker fails, naming the line and the definition it came from', () => {
  const before = "begin\n  case p_entity_type\n    when 'project' then return true;\n    when 'task' then return true;\n  end case;\nend;";
  const after = 'begin\n  return true;\nend;';
  const { problems } = analyze(files([[1490, migration(before)], [1491, migration(after)]]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /1491_demo\.sql/);
  assert.match(problems[0], /demo_fn\(uuid\)/);
  assert.match(problems[0], /drops 4 line/);
  assert.match(problems[0], /when 'project' then return true/);
  assert.match(problems[0], /1490_demo\.sql/);
  assert.match(problems[0], /-- drops: <reason>/);
});

test('the same drop WITH a `-- drops: <reason>` marker is an accepted, reported exemption', () => {
  const before = 'begin\n  return exists(select 1 from public.projects where id=p_id);\nend;';
  const after = 'begin\n  return public.lookup(p_id);\nend;';
  const { problems, exemptions } = analyze(files([
    [1490, migration(before)],
    [1491, migration(after, { marker: 'the table now comes from the registry' })],
  ]));
  assert.deepEqual([...problems], []);
  assert.equal(exemptions.length, 1);
  assert.match(exemptions[0], /1491_demo\.sql.*demo_fn.*1490_demo\.sql/);
});

test('an empty `-- drops:` reason is not a marker', () => {
  const before = 'begin\n  return true;\nend;';
  const after = 'begin\n  return false;\nend;';
  const { problems, exemptions } = analyze(files([
    [1490, migration(before)],
    [1491, migration(after, { marker: '   ' })],
  ]));
  assert.equal(exemptions.length, 0);
  assert.equal(problems.length, 1);
});

test('history below the floor is skipped, and still feeds the definition it is the previous of', () => {
  const before = 'begin\n  return true;\nend;';
  const after = 'begin\n  return false;\nend;';
  const skipped = analyze(files([[1413, migration(before)], [1417, migration(after)]]));
  assert.deepEqual([...skipped.problems], []);
  assert.deepEqual([...skipped.exemptions], []);
  assert.equal(skipped.checked, 1, 'the below-floor restatement is still compared, only its verdict is skipped');
  const enforced = analyze(files([[1413, migration(before)], [FLOOR, migration(after)]]));
  assert.equal(enforced.problems.length, 1);
});

test('a new function has no previous definition to keep', () => {
  const { problems } = analyze(files([[1491, migration('begin\n  return true;\nend;')]]));
  assert.deepEqual([...problems], []);
});

test('whitespace, blank lines and comment-only lines are not differences', () => {
  const before = 'begin\n  -- the caller decides\n  return true;\nend;';
  const after = '  begin\n\n    return true;\n  end;';
  const { problems } = analyze(files([[1490, migration(before)], [1491, migration(after)]]));
  assert.deepEqual([...problems], []);
});

test('a comment in the parameter list — an apostrophe included — does not hide the definition', () => {
  // The real shape (0055/0168/0172 save_timesheet_week): an apostrophe inside a `--` comment in the
  // argument list made the quote tracking swallow the rest of the signature, so the definition (and its
  // restatements) went unparsed — a guard blind to its own hub function.
  const withArgs = (body) => `create or replace function public.demo_fn(
  p_id uuid,                 -- the caller's id
  p_note text default '')    -- a note, default empty
returns boolean language plpgsql stable security invoker set search_path=public as $$
${body}
$$;`;
  const { problems } = analyze(files([
    [1490, withArgs('begin\n  perform 1;\n  return true;\nend;')],
    [1491, withArgs('begin\n  return true;\nend;')],
  ]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /demo_fn\(uuid,text\)/, 'the identity is read from the commented signature');
});

test('a `create or replace function` named in prose is not a definition', () => {
  const prose = "-- A later lane may `create or replace function demo_fn(p_id uuid)` again; keep the arms.\n";
  const sql = prose + migration('begin\n  return true;\nend;');
  const { definitions, skipped } = parseDefinitions(sql);
  assert.equal(definitions.length, 1, 'the comment mention must not become a phantom baseline');
  assert.match(definitions[0].body, /return true;/);
  assert.deepEqual([...skipped], []);
});

test('a definition the guard cannot delimit is reported, not skipped', () => {
  const sql = "create or replace function public.demo_fn(p_id uuid) returns boolean language sql as 'select true';";
  const { unread, problems } = analyze(files([[1490, sql]]));
  assert.equal(unread.length, 1);
  assert.match(unread[0], /demo_fn/);
  assert.match(unread[0], /dollar-quoted/);
  assert.deepEqual([...problems], []);
});

test('a duplicated line is only kept if the restated body still has the same number of copies', () => {
  const before = 'begin\n  return true;\n  return true;\nend;';
  const after = 'begin\n  return true;\nend;';
  const { problems } = analyze(files([[1490, migration(before)], [1491, migration(after)]]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /drops 1 line/);
});

test('drop function + create function is a restatement too, not a hole to walk through', () => {
  const before = 'begin\n  return true;\nend;';
  const after = 'begin\n  return false;\nend;';
  const { problems } = analyze(files([
    [1490, migration(before)],
    [1491, migration(after, { orReplace: false, dropped: true })],
  ]));
  assert.equal(problems.length, 1);
});

test('two overloads of one name are compared separately, and a new overload is not a restatement', () => {
  const one = migration('begin\n  return true;\nend;', { args: 'p_id uuid' });
  const two = migration('begin\n  return false;\nend;', { args: 'p_id text' });
  const { problems } = analyze(files([[1490, one], [1491, two]]));
  assert.deepEqual([...problems], []);
});

test('the floor is the first migration written with the rule in place', () => {
  assert.equal(FLOOR, 1490);
});

test('readMigrations orders by number and ignores the rollback directory', () => {
  const listed = listMigrations(path.join(REPO, 'supabase', 'migrations'));
  assert.ok(listed.length > 800, `expected the whole migration history, got ${listed.length}`);
  assert.deepEqual(listed, [...listed].sort((a, b) => a.number - b.number || a.name.localeCompare(b.name)));
  assert.ok(!listed.some((f) => f.name.includes('/') || f.name.startsWith('rollback')), 'rollback/ is not a forward migration');
  const read = readMigrations(path.join(REPO, 'supabase', 'migrations'));
  assert.equal(read.length, listed.length);
});

test('the guard passes on the repository as it stands', () => {
  const { problems, exemptions, unread } = analyze(readMigrations(path.join(REPO, 'supabase', 'migrations')));
  assert.deepEqual([...problems], []);
  assert.deepEqual([...unread], [], 'no definition is skipped: a skipped one is a hole, not a pass');
  for (const line of exemptions) assert.match(line, /-- drops:/, `exemption must name its marker: ${line}`);
});

test('the --self-test catches its own planted drop and accepts its own marker', () => {
  assert.deepEqual(selfTestProblems(), []);
});

test('check:guards runs this guard, with its self-test', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'pmo-portal', 'package.json'), 'utf8'));
  assert.match(pkg.scripts['check:restated-functions'], /check-restated-functions\.mjs --self-test/);
  assert.match(pkg.scripts['check:guards'], /check:restated-functions/);
  const ci = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /npm run check:guards/, 'CI must run the guards list, not a hand-copied subset');
});
