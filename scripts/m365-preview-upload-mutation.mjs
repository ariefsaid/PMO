#!/usr/bin/env node
/**
 * Mutation witness for the document-preview and record-file-upload custody actions (ADR-0095, #1474).
 *
 * "A suite that stays green while the handler is broken is not a suite." This harness breaks the ACTUAL
 * shipped predicates one at a time (the exact-match allowlists, every authorization step, the size/type
 * policy, the request deadlines) and requires documentPreview.test.ts / recordFileUpload.test.ts to go red
 * on the matching ASSERTION (not on a compile error). Each mutation is applied to an isolated run and the
 * original bytes are restored in `finally` and on SIGINT/SIGTERM; restoration is verified by SHA-256.
 *
 * It also statically pins the production wiring: each allowlist is called immediately before its one
 * network call, and graphRead.ts exports no credential getter or generic authenticated request.
 *
 * Run: node scripts/m365-preview-upload-mutation.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CUSTODY = 'supabase/functions/m365-token-custody';
export const TEST_FILES = [`${CUSTODY}/documentPreview.test.ts`, `${CUSTODY}/recordFileUpload.test.ts`];
const PREVIEW = `${CUSTODY}/graphPreview.ts`;
const UPLOAD = `${CUSTODY}/graphFileUpload.ts`;
const READ = `${CUSTODY}/graphRead.ts`;
const INDEX = `${CUSTODY}/index.ts`;
const HANDLE_PREVIEW = `${CUSTODY}/documentPreview.ts`;
const HANDLE_UPLOAD = `${CUSTODY}/recordFileUpload.ts`;

const ALWAYS_TRUE = (line) => line.replace('{ // mutation-witness', '{ if (Date.now() > 0) return true; // mutation-witness');
const NO_RETURN = (line) => line.replace('return false;', 'void 0;');
const SHAPES = 'every other request shape is refused';

/** Each mutation neutralizes ONE tagged line; `killedBy` is the test (step) that must report FAILED. */
export const MUTATIONS = [
  // ── preview allowlist ──
  { id: 'preview-allowlist-always-true', file: PREVIEW, tag: 'mutation-witness:preview-allowlist-always-true', apply: ALWAYS_TRUE, killedBy: SHAPES },
  { id: 'preview-method-post', file: PREVIEW, tag: 'mutation-witness:preview-method-post', apply: NO_RETURN, killedBy: SHAPES },
  { id: 'preview-drive-equality', file: PREVIEW, tag: 'mutation-witness:preview-drive-equality',
    apply: (line) => line.replace('m[1] !== encodeURIComponent(c.driveId)', 'false'), killedBy: SHAPES },
  { id: 'preview-body-empty', file: PREVIEW, tag: 'mutation-witness:preview-body-empty',
    apply: (line) => line.replace(' && Object.keys(request.body).length === 0', ''), killedBy: SHAPES },
  // ── preview authorization order ──
  { id: 'preview-membership', file: HANDLE_PREVIEW, tag: 'mutation-witness:preview-membership',
    apply: (line) => line.replace('await authorizeFolderCaller(deps, () => true)', '{ orgId: "mutant" } as Awaited<ReturnType<typeof authorizeFolderCaller>>'),
    killedBy: 'organisation not entitled' },
  { id: 'preview-org-equality', file: HANDLE_PREVIEW, tag: 'mutation-witness:preview-org-equality',
    apply: (line) => line.replace('row.org_id !== orgId', 'false'), killedBy: 'row in another org' },
  { id: 'preview-source-onedrive', file: HANDLE_PREVIEW, tag: 'mutation-witness:preview-source-onedrive',
    apply: (line) => line.replace('row.source !== "onedrive"', 'false'), killedBy: 'private upload row' },
  { id: 'preview-source-required', file: HANDLE_PREVIEW, tag: 'mutation-witness:preview-source-required',
    apply: (line) => line.replace('return NOT_AVAILABLE();', 'return UNREADABLE();'), killedBy: 'RLS hides the row' },
  { id: 'preview-child-parent', file: HANDLE_PREVIEW, tag: 'mutation-witness:preview-child-parent',
    apply: (line) => line.replace('parent.id !== source.itemId', 'false'),
    killedBy: 'parent id differs (a file elsewhere in the library) fails closed with no preview POST' },
  { id: 'refreshed-preview-grant', file: READ, tag: 'mutation-witness:refreshed-preview-grant',
    apply: (line) => line.replace('requireScope && !requireScope(connection.scopes ?? [])', 'false'),
    killedBy: 'document-preview AC-003 a refresh that drops the Files read grant is re-checked before the preview' },
  { id: 'preview-request-deadline', file: INDEX, tag: 'mutation-witness:preview-request-deadline',
    apply: (line) => line.replace('scope?.limit(12_000)', 'scope?.limit(60_000)'), killedBy: 'served preview bounds a pending record read' },
  // ── upload allowlist and policy ──
  { id: 'upload-allowlist-always-true', file: UPLOAD, tag: 'mutation-witness:upload-allowlist-always-true', apply: ALWAYS_TRUE, killedBy: SHAPES },
  { id: 'upload-method-put', file: UPLOAD, tag: 'mutation-witness:upload-method-put', apply: NO_RETURN, killedBy: SHAPES },
  { id: 'upload-conflict-rename', file: UPLOAD, tag: 'mutation-witness:upload-conflict-rename', apply: NO_RETURN, killedBy: SHAPES },
  { id: 'upload-size-cap', file: UPLOAD, tag: 'mutation-witness:upload-size-cap',
    apply: (line) => line.replace('c.bytes <= MAX_FILE_SIZE_BYTES', 'true'), killedBy: 'unsafe contexts never build or validate' },
  { id: 'upload-extension-allowlist', file: UPLOAD, tag: 'mutation-witness:upload-extension-allowlist',
    apply: (line) => line.replace('ALLOWED_FILE_TYPES.includes(ext)', 'true'), killedBy: 'unsafe contexts never build or validate' },
  { id: 'parse-size-cap', file: HANDLE_UPLOAD, tag: 'mutation-witness:upload-size-cap',
    apply: (line) => line.replace('bytes.byteLength > MAX_FILE_SIZE_BYTES', 'false'), killedBy: 'rejects everything else' },
  { id: 'parse-extension-allowlist', file: HANDLE_UPLOAD, tag: 'mutation-witness:upload-extension-allowlist',
    apply: (line) => line.replace('!validUploadFileName(fileName)', 'false'), killedBy: 'rejects everything else' },
  // ── upload authorization order ──
  { id: 'upload-writer-role', file: HANDLE_UPLOAD, tag: 'mutation-witness:upload-writer-role',
    apply: (line) => line.replace('!WRITER_ROLES.has(caller.role)', 'false'), killedBy: 'read-only role' },
  { id: 'upload-org-equality', file: HANDLE_UPLOAD, tag: 'mutation-witness:upload-org-equality',
    apply: (line) => line.replace('row.org_id !== caller.orgId', 'false'), killedBy: 'other-org project document' },
  { id: 'upload-draft-only', file: HANDLE_UPLOAD, tag: 'mutation-witness:upload-draft-only',
    apply: (line) => line.replace('row.status === "Draft"', 'true'), killedBy: 'non-Draft document' },
  { id: 'upload-author-or-admin', file: HANDLE_UPLOAD, tag: 'mutation-witness:upload-author-or-admin',
    apply: (line) => line.replace('(row.author_id === deps.userId || caller.role === "Admin")', 'true'), killedBy: "someone else's Draft as a non-Admin" },
  { id: 'upload-folder-required', file: HANDLE_UPLOAD, tag: 'mutation-witness:upload-folder-required',
    apply: (line) => line.replace('return NO_FOLDER(', 'return UNREADABLE(); NO_FOLDER('),
    killedBy: 'a missing folder, an unset library or a folder outside the library is a recovery state with no Graph call' },
  { id: 'upload-folder-in-library', file: HANDLE_UPLOAD, tag: 'mutation-witness:upload-folder-in-library',
    apply: (line) => line.replace('folder.driveId !== snapshot.drive_id', 'false'),
    killedBy: 'a missing folder, an unset library or a folder outside the library is a recovery state with no Graph call' },
  { id: 'upload-quota', file: HANDLE_UPLOAD, tag: 'mutation-witness:upload-quota',
    apply: (line) => line.replace('if (!rate.exceeded)', 'if (true || !rate.exceeded)'),
    killedBy: 'the upload quota answers 429 before any connection or Graph call' },
  { id: 'refreshed-upload-grant', file: READ, tag: 'mutation-witness:refreshed-upload-grant',
    apply: (line) => line.replace('requireScope && !requireScope(connection.scopes ?? [])', 'false'),
    killedBy: 'a refresh that drops the Sites.Selected grant is re-checked before the write' },
  { id: 'upload-request-deadline', file: INDEX, tag: 'mutation-witness:upload-request-deadline',
    apply: (line) => line.replace('scope?.limit(30_000)', 'scope?.limit(120_000)'), killedBy: 'served upload bounds a pending record read' },
];

const sha = (text) => createHash('sha256').update(text).digest('hex');
const stripAnsi = (text) => text.replace(/\u001b\[[0-9;]*m/g, '');

/** Real runner: deno test of both witness files. Returns { code, output }. */
export function denoRunner(root) {
  return () => {
    const result = spawnSync('deno', [
      'test', '--config', `${CUSTODY}/deno.json`, '--allow-env', '--allow-net', '--allow-read', ...TEST_FILES,
    ], { cwd: root, encoding: 'utf8', timeout: 240_000 });
    return { code: result.status ?? 1, output: stripAnsi(`${result.stdout ?? ''}\n${result.stderr ?? ''}`) };
  };
}

const between = (source, from, to) => {
  const start = source.indexOf(from);
  const end = start < 0 ? -1 : source.indexOf(to, start);
  return start < 0 || end < 0 ? null : source.slice(start, end);
};

/** Static wiring pins (cannot be observed by behaviour alone). Returns a list of problems. */
export function staticWiringProblems(readSource, previewSource, uploadSource) {
  const problems = [];
  for (const [label, start, allow, send] of [
    ['previewItem', 'const previewItem = async', 'previewAllowed(request, context)', 'sendPreviewRequest('],
    ['uploadFile', 'const uploadFile = async', 'uploadAllowed(request, context)', 'sendUploadRequest('],
  ]) {
    const head = readSource.indexOf(start);
    const allowAt = readSource.indexOf(allow, head);
    const sendAt = readSource.indexOf(send, allowAt);
    if (head < 0 || allowAt < 0 || sendAt < 0) {
      problems.push(`${label} must call ${allow} before ${send}`);
      continue;
    }
    const gap = readSource.slice(allowAt, sendAt);
    if (/await\s+fetch|fetchMicrosoftJson|token\(\)/u.test(gap)) problems.push(`a network call or token fetch sits between the ${label} allowlist and its transport`);
    if ((readSource.match(new RegExp(`await ${send.replace('(', '\\(')}`, 'gu')) ?? []).length !== 1) {
      problems.push(`exactly one ${send} call is allowed in graphRead.ts`);
    }
  }
  if (!between(readSource, 'async function sendPreviewRequest', 'async function sendGraphRequest')?.includes('method: "POST"')) {
    problems.push('the preview transport must be the POST');
  }
  if ((readSource.match(/method: "PUT"/gu) ?? []).length !== 1) problems.push('exactly one PUT is allowed in graphRead.ts');
  for (const banned of ['sendPreviewRequest', 'sendUploadRequest', 'sendFolderRequest', 'sendGraphRequest', 'loadFreshAccessToken', 'openOwnConnection', 'token']) {
    if (new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${banned}\\b`, 'u').test(readSource)) {
      problems.push(`graphRead.ts must not export ${banned}`);
    }
  }
  for (const [name, source] of [['graphPreview.ts', previewSource], ['graphFileUpload.ts', uploadSource]]) {
    if (/\bfetch\w*\s*\(|export\s+(async\s+)?function\s+\w*(send|post|fetch)\w*\(/iu.test(source)) {
      problems.push(`${name} must stay pure (no transport)`);
    }
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
    failures.push(...staticWiringProblems(original.get(READ), original.get(PREVIEW), original.get(UPLOAD)));

    const baseline = run();
    if (baseline.code !== 0) throw new Error(`baseline must pass before mutating:\n${baseline.output.slice(-2000)}`);
    log('baseline: green');

    for (const mutation of MUTATIONS) {
      const lines = original.get(mutation.file).split('\n');
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
    console.log(`✓ preview/upload custody actions: baseline green, ${mutants}/${mutants} mutants killed on assertions, sources restored`);
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  }
}
