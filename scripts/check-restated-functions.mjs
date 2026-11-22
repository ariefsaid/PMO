#!/usr/bin/env node
/**
 * Guard: a migration that restates a function keeps every line of the previous definition, or says what
 * it drops (#2744, architecture pass C1).
 * Why: five migrations in the 15-Dec round (1296, 1325, 1333, 1417, 1450) exist only to put back a change
 * that a parallel lane's whole-body restatement had silently dropped. A reviewer cannot see the change
 * when it is one line inside 30–180 copied lines, and the merge is green either way. This turns the next
 * silent drop into a red check: `create or replace function` is compared with the newest earlier definition
 * of the same name + argument types, and a line of that definition missing from the new body fails.
 *
 * The escape hatch is deliberate and visible: a migration may carry `-- drops: <reason>` (anywhere in the
 * file, reason non-empty). Then its restatements are an ACCEPTED exemption, and the guard still prints
 * which function lost which lines and where they came from, so the reviewer sees it in the CI log.
 *
 * HISTORY: migrations numbered below FLOOR (the first one written with this rule in place) are exempt —
 * they are already applied, and retro-fitting a marker into them would rewrite the migration history the
 * readers rely on. They still count as a *previous definition* for everything after them, so the first
 * enforced restatement is compared against the real head. `--floor 0` audits the whole history (it reports
 * the round's drops; it is not a merge gate).
 *
 * Scope and limits, stated so nobody trusts it further than it goes: it is textual (grep-level, like
 * check-date-formatting), it reads `create [or replace] function` bodies only (a function rewritten by
 * dynamic SQL is invisible), it compares trimmed lines with blank and comment-only lines ignored, and it
 * treats a line recurring twice as a line the restatement must carry twice.
 *
 * Run: node scripts/check-restated-functions.mjs [--floor N] [--verbose] [--self-test]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATIONS = path.join(REPO, 'supabase', 'migrations');

/** The first migration written after this guard existed. Below it, history. */
export const FLOOR = 1490;

/** Every forward migration, in apply order (number, then file name). rollback/ is not a forward migration. */
export function listMigrations(dir = MIGRATIONS) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => ({ name: entry.name, number: Number.parseInt(entry.name, 10) }))
    .filter((file) => Number.isFinite(file.number))
    .sort((a, b) => a.number - b.number || a.name.localeCompare(b.name));
}

export function readMigrations(dir = MIGRATIONS) {
  return listMigrations(dir).map((file) => ({ ...file, sql: fs.readFileSync(path.join(dir, file.name), 'utf8') }));
}

/** Index of the `)` closing the `(` at `open`, or -1. Aware of nesting and of single-quoted strings. */
function closingParen(text, open) {
  let depth = 0;
  let quoted = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === "'") {
        if (text[i + 1] === "'") i++;
        else quoted = false;
      }
      continue;
    }
    if (c === "'") quoted = true;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

/** Normalise a parameter list to the function's identity: `p_id uuid, p_note text default ''` -> `uuid,text`. */
export function normaliseArgs(args) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const c of args) {
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += c;
  }
  parts.push(current);
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      // Drop `default …` / `= …` (top level only: a default may contain a comma, already split out of sight).
      const withoutDefault = part.replace(/\bdefault\b[\s\S]*$/i, '').replace(/=(?!=)[\s\S]*$/, '').trim();
      const words = withoutDefault.split(/\s+/);
      // Drop a parameter mode (`out`, `inout`, `variadic`) and the parameter NAME; keep the type.
      while (words.length > 1 && /^(in|out|inout|variadic)$/i.test(words[0])) words.shift();
      if (words.length > 1) words.shift();
      return words.join(' ').toLowerCase().replace(/\s+/g, ' ').replace(/\s*\[\s*\]/g, '[]');
    })
    .join(',');
}

/** The lines of a body that count as content: trimmed, blank and comment-only lines dropped. */
export function bodyLines(body) {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--'));
}

/**
 * Every `create [or replace] function` in one migration text: {name, args, orReplace, body}. The body is
 * the dollar-quoted block after `as`; a function whose body cannot be delimited is skipped (reported by
 * the caller's count, never guessed at).
 */
export function parseDefinitions(sql) {
  const definitions = [];
  const head = /create\s+(or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  for (const match of sql.matchAll(head)) {
    const open = match.index + match[0].length - 1;
    const close = closingParen(sql, open);
    if (close < 0) continue;
    const args = normaliseArgs(sql.slice(open + 1, close));
    const rest = sql.slice(close + 1);
    const tag = rest.match(/\$([a-z_]*)\$/i);
    if (!tag) continue;
    const bodyStart = close + 1 + tag.index + tag[0].length;
    const bodyEnd = sql.indexOf(tag[0], bodyStart);
    if (bodyEnd < 0) continue;
    definitions.push({
      name: match[2].toLowerCase(),
      args,
      orReplace: Boolean(match[1]),
      body: sql.slice(bodyStart, bodyEnd),
    });
  }
  return definitions;
}

/** Line counts a multiset is short by, in order of first appearance. */
export function droppedLines(before, after) {
  const have = new Map();
  for (const line of after) have.set(line, (have.get(line) ?? 0) + 1);
  const missing = [];
  for (const line of before) {
    const left = have.get(line) ?? 0;
    if (left > 0) have.set(line, left - 1);
    else missing.push(line);
  }
  return missing;
}

/** `-- drops: <reason>` markers with a non-empty reason. */
export function dropMarkers(sql) {
  return [...sql.matchAll(/^[ \t]*--[ \t]*drops:[ \t]*(.*)$/gim)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

/**
 * files: [{name, number, sql}] in apply order. Returns {problems, exemptions, checked, scanned}.
 * A problem is a line the restated body dropped without the file carrying a marker; an exemption is the
 * same, with the marker present (reported so the CI log shows it).
 */
export function analyze(files, { floor = FLOOR } = {}) {
  const problems = [];
  const exemptions = [];
  const seen = new Map();
  let checked = 0;
  for (const file of files) {
    const markers = dropMarkers(file.sql);
    const droppedNames = new Set(
      [...file.sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)]
        .map((match) => match[1].toLowerCase()),
    );
    for (const definition of parseDefinitions(file.sql)) {
      const key = `${definition.name}(${definition.args})`;
      const previous = seen.get(key);
      const restates = definition.orReplace || droppedNames.has(definition.name);
      if (previous && restates) {
        const lines = bodyLines(definition.body);
        const missing = droppedLines(previous.lines, lines);
        if (missing.length > 0) {
          const where = `${file.name} ${definition.name}(${definition.args || ''}) drops ${missing.length} line${missing.length === 1 ? '' : 's'} of its definition in ${previous.file}`;
          const sample = missing.slice(0, 3).map((line) => JSON.stringify(line.slice(0, 100))).join(', ');
          const detail = `${where}: ${sample}${missing.length > 3 ? `, … ${missing.length - 3} more` : ''}`;
          if (file.number >= floor) {
            if (markers.length > 0) exemptions.push(`${detail} — exempt: -- drops: ${markers[0]}`);
            else problems.push(`supabase/migrations/${detail} — add one \`-- drops: <reason>\` line naming what the restatement removes`);
          }
        }
        checked++;
      }
      seen.set(key, { file: file.name, number: file.number, lines: bodyLines(definition.body) });
    }
  }
  problems.sort();
  exemptions.sort();
  return { problems, exemptions, checked, scanned: files.length };
}

/** The --self-test: fixtures through the same functions the real run uses, both directions. */
export function selfTestProblems() {
  const failures = [];
  const fn = (body, extra = '') => `${extra}create or replace function public.t_fn(p_id uuid) returns boolean
language plpgsql stable security invoker set search_path=public as $$
${body}
$$;`;
  const at = (number, sql) => ({ name: `${number}_t.sql`, number, sql });
  const check = (label, condition, detail = '') => {
    if (!condition) failures.push(`${label}${detail ? ` (${detail})` : ''}`);
  };
  const kept = analyze([at(1490, fn('begin\n  return true;\nend;')), at(1491, fn('begin\n  return true;\nend;'))]);
  check('kept body passes', kept.problems.length === 0, kept.problems.join('; '));
  const dropped = analyze([at(1490, fn('begin\n  return true;\n  return false;\nend;')), at(1491, fn('begin\n  return true;\nend;'))]);
  check('planted drop is caught', dropped.problems.length === 1, `problems=${dropped.problems.length}`);
  check('planted drop names the line', /return false/.test(dropped.problems[0] ?? ''), dropped.problems[0] ?? '');
  const excused = analyze([
    at(1490, fn('begin\n  return true;\n  return false;\nend;')),
    at(1491, fn('begin\n  return true;\nend;', '-- drops: the second arm became a registry row\n')),
  ]);
  check('marker exempts it', excused.problems.length === 0 && excused.exemptions.length === 1, excused.problems.join('; '));
  const history = analyze([at(1413, fn('begin\n  return true;\n  return false;\nend;')), at(1417, fn('begin\n  return true;\nend;'))]);
  check('below-floor restatement is history', history.problems.length === 0, history.problems.join('; '));
  return failures;
}

export function run({ floor = FLOOR, verbose = false } = {}) {
  const result = analyze(readMigrations(), { floor });
  for (const line of result.exemptions) console.log(`• exempt ${line}`);
  for (const problem of result.problems) console.error(`✗ ${problem}`);
  if (result.problems.length > 0) {
    console.error(`✗ restated-function guard: ${result.problems.length} restatement(s) dropped lines without a \`-- drops:\` marker`);
    return 1;
  }
  if (verbose) {
    for (const line of result.exemptions) console.log(`  ${line}`);
  }
  console.log(
    `✓ restated-function guard: ${result.checked} restatement(s) checked across ${result.scanned} migrations, ` +
      `${result.exemptions.length} exempt by marker (floor ${floor})`,
  );
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    const failures = selfTestProblems();
    if (failures.length > 0) {
      console.error(`✗ restated-function guard self-test: ${failures.join('; ')}`);
      process.exitCode = 1;
    } else console.log('✓ restated-function guard self-test: drop caught, marker honoured, history skipped');
  } else {
    const floorAt = argv.indexOf('--floor');
    const floor = floorAt >= 0 ? Number.parseInt(argv[floorAt + 1], 10) : FLOOR;
    if (!Number.isFinite(floor)) {
      console.error('✗ restated-function guard: --floor needs a migration number');
      process.exitCode = 1;
    } else process.exitCode = run({ floor, verbose: argv.includes('--verbose') });
  }
}
