#!/usr/bin/env node
/**
 * Mutation witness for the Microsoft record-folder write allowlist (ADR-0089, AC-M365DOC-070).
 *
 * "A suite that stays green while the handler is broken is not a suite." This harness breaks the ACTUAL
 * shipped predicates one at a time and requires supabase/functions/m365-token-custody/recordFolderWrite.test.ts
 * to go red on the matching ASSERTION (not on a compile error):
 *   - folderWriteAllowed: always-true, method equality removed, default-drive equality removed
 *   - the browser graph_proxy GET-only guard (validateGraphProxyInput) and scopeCoversPath's GET pin
 * Each mutation is applied to an isolated run and the original bytes are restored in `finally` and on
 * SIGINT/SIGTERM; the harness verifies byte-identical restoration by SHA-256.
 *
 * It also statically pins the production wiring: the allowlist is called immediately before the one
 * folder fetch, and no credential getter / generic authenticated request is exported from graphRead.ts.
 *
 * Run: node scripts/m365-record-folder-write-mutation.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CUSTODY = 'supabase/functions/m365-token-custody';
export const TEST_FILE = `${CUSTODY}/recordFolderWrite.test.ts`;
const WRITE_FILE = `${CUSTODY}/graphFolderWrite.ts`;
const READ_FILE = `${CUSTODY}/graphRead.ts`;

/** Each mutation neutralizes ONE tagged line; `killedBy` is the test step that must report FAILED. */
export const MUTATIONS = [
  { id: 'allowlist-always-true', file: WRITE_FILE, tag: 'mutation-witness:allowlist-always-true',
    apply: (line) => line.replace('{ // mutation-witness', '{ if (Date.now() > 0) return true; // mutation-witness'),
    killedBy: 'every other request shape is refused' },
  { id: 'method-post', file: WRITE_FILE, tag: 'mutation-witness:method-post',
    apply: (line) => line.replace('return false;', 'void 0;'),
    killedBy: 'every other request shape is refused' },
  { id: 'drive-equality', file: WRITE_FILE, tag: 'mutation-witness:drive-equality',
    apply: (line) => line.replace('return false;', 'void 0;'),
    killedBy: 'every other request shape is refused' },
  { id: 'browser-get-only', file: READ_FILE, tag: 'mutation-witness:browser-get-only',
    apply: (line) => line.replace('normalizeGraphMethod(req.method) === "GET"', 'true'),
    killedBy: 'the browser proxy surface is GET-only and body-less' },
  { id: 'scope-get-only', file: READ_FILE, tag: 'mutation-witness:scope-get-only',
    apply: (line) => line.replace('return false;', 'void 0;'),
    killedBy: 'the browser proxy surface is GET-only and body-less' },
];

const sha = (text) => createHash('sha256').update(text).digest('hex');
// eslint-disable-next-line no-control-regex
const stripAnsi = (text) => text.replace(/\u001b\[[0-9;]*m/g, '');

/** Real runner: deno test of the witness file. Returns { code, output }. */
export function denoRunner(root) {
  return () => {
    const result = spawnSync('deno', [
      'test', '--config', `${CUSTODY}/deno.json`, '--allow-env', '--allow-net', '--allow-read', TEST_FILE,
    ], { cwd: root, encoding: 'utf8', timeout: 240_000 });
    return { code: result.status ?? 1, output: stripAnsi(`${result.stdout ?? ''}\n${result.stderr ?? ''}`) };
  };
}

/** Static wiring pins (cannot be observed by behaviour alone). Returns a list of problems. */
export function staticWiringProblems(readSource, writeSource) {
  const problems = [];
  const create = readSource.indexOf('const createFolder = async');
  const allow = readSource.indexOf('folderWriteAllowed(request, context)', create);
  const send = readSource.indexOf('sendFolderRequest(', allow);
  if (create < 0 || allow < 0 || send < 0 || !(create < allow && allow < send)) {
    problems.push('createFolder must call folderWriteAllowed(request, context) before sendFolderRequest');
  }
  const between = allow >= 0 && send >= 0 ? readSource.slice(allow, send) : '';
  if (/await\s+fetch|fetchBounded/u.test(between)) problems.push('a network call sits between the allowlist and the folder transport');
  if ((readSource.match(/sendFolderRequest\(\s*\n?\s*url,\s*\n?\s*"POST"/gu) ?? []).length !== 1) {
    problems.push('exactly one POST folder transport call is allowed in graphRead.ts');
  }
  for (const banned of ['sendFolderRequest', 'sendGraphRequest', 'loadFreshAccessToken', 'openOwnConnection', 'token']) {
    if (new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${banned}\\b`, 'u').test(readSource)) {
      problems.push(`graphRead.ts must not export ${banned}`);
    }
  }
  if (/\bfetch\w*\s*\(|export\s+(async\s+)?function\s+\w*(send|post|fetch)\w*\(/iu.test(writeSource)) {
    problems.push('graphFolderWrite.ts must stay pure (no transport)');
  }
  return problems;
}

/**
 * Runs the witness. `run` returns { code, output } for the current on-disk sources.
 * Throws (after restoring every file) if the baseline is red, a mutant survives or dies of the wrong cause.
 */
export function runMutationWitness({ root = REPO, run = denoRunner(root), log = console.log } = {}) {
  const files = [...new Set(MUTATIONS.map((m) => m.file))];
  const original = new Map(files.map((file) => [file, readFileSync(resolve(root, file), 'utf8')]));
  const hashes = new Map([...original].map(([file, text]) => [file, sha(text)]));
  const restore = () => { for (const [file, text] of original) writeFileSync(resolve(root, file), text); };
  const onSignal = (signal) => { restore(); process.exit(signal === 'SIGINT' ? 130 : 143); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const failures = [];
  try {
    const wiring = staticWiringProblems(original.get(READ_FILE), original.get(WRITE_FILE));
    failures.push(...wiring);

    const baseline = run();
    if (baseline.code !== 0) throw new Error(`baseline must pass before mutating:\n${baseline.output.slice(-2000)}`);
    log('baseline: green');

    for (const mutation of MUTATIONS) {
      const text = original.get(mutation.file);
      const lines = text.split('\n');
      const index = lines.findIndex((line) => line.includes(mutation.tag));
      if (index < 0) { failures.push(`${mutation.id}: tag ${mutation.tag} not found in ${mutation.file}`); continue; }
      const mutated = mutation.apply(lines[index]);
      if (mutated === lines[index]) { failures.push(`${mutation.id}: mutation did not change the tagged line`); continue; }
      lines[index] = mutated;
      try {
        writeFileSync(resolve(root, mutation.file), lines.join('\n'));
        const result = run();
        const killedOnAssertion = result.code !== 0
          && !/Type checking failed|TS\d{4}|error: Uncaught|SyntaxError/u.test(result.output)
          && result.output.split('\n').some((line) => line.includes(mutation.killedBy) && /\bFAILED\b/u.test(line));
        if (!killedOnAssertion) {
          failures.push(result.code === 0
            ? `${mutation.id}: SURVIVED — tests stayed green with the guard broken`
            : `${mutation.id}: died for the wrong reason (expected "${mutation.killedBy}" to fail on an assertion)`);
        } else log(`mutant ${mutation.id}: killed by "${mutation.killedBy}"`);
      } finally {
        restore();
      }
    }
  } finally {
    restore();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
  for (const [file, hash] of hashes) {
    if (sha(readFileSync(resolve(root, file), 'utf8')) !== hash) failures.push(`${file}: NOT restored byte-identical`);
  }
  if (failures.length) throw new Error(`mutation witness failed:\n- ${failures.join('\n- ')}`);
  return { mutants: MUTATIONS.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { mutants } = runMutationWitness();
    console.log(`✓ record-folder write allowlist: baseline green, ${mutants}/${mutants} mutants killed on assertions, sources restored`);
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  }
}
