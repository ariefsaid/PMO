// Tests for the mutation-witness harness itself (logic only: a fake runner stands in for deno).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MUTATIONS, runMutationWitness, staticWiringProblems } from './m365-record-folder-write-mutation.mjs';

const CUSTODY = 'supabase/functions/m365-token-custody';
const READ = `
export function validateGraphProxyInput(req) {
  const browserMethodAllowed = normalizeGraphMethod(req.method) === "GET"; // mutation-witness:browser-get-only
}
export function scopeCoversPath(scopes, method, path) {
  if (normalizedMethod !== "GET") return false; // mutation-witness:scope-get-only
}
const createFolder = async () => {
  if (!folderWriteAllowed(request, context)) return { kind: "unavailable" };
  return await sendFolderRequest(
    url,
    "POST",
    bearer,
  );
};
`;
const WRITE = `
export function folderWriteAllowed(request, context) { // mutation-witness:allowlist-always-true
  if (request.method !== "POST") return false; // mutation-witness:method-post
  if (match[1] !== encodeURIComponent(context.driveId)) return false; // mutation-witness:drive-equality
  return true;
}
`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'm365-witness-'));
  mkdirSync(join(root, CUSTODY), { recursive: true });
  writeFileSync(join(root, CUSTODY, 'graphRead.ts'), READ);
  writeFileSync(join(root, CUSTODY, 'graphFolderWrite.ts'), WRITE);
  return root;
}
const killedOutput = (step) => `${step} ... FAILED\nAssertionError: boom`;

test('kills every mutant on its assertion, then restores byte-identical sources', () => {
  const root = fixture();
  let call = 0;
  const seen = [];
  const result = runMutationWitness({
    root, log: () => {},
    run: () => {
      const index = call++;
      if (index === 0) return { code: 0, output: 'ok' };
      const mutation = MUTATIONS[index - 1];
      seen.push(readFileSync(join(root, mutation.file), 'utf8'));
      return { code: 1, output: killedOutput(mutation.killedBy) };
    },
  });
  assert.equal(result.mutants, MUTATIONS.length);
  assert.equal(seen.length, MUTATIONS.length);
  assert.ok(seen.every((text, i) => text !== (MUTATIONS[i].file.endsWith('graphRead.ts') ? READ : WRITE)), 'each run saw a mutated file');
  assert.equal(readFileSync(join(root, CUSTODY, 'graphRead.ts'), 'utf8'), READ);
  assert.equal(readFileSync(join(root, CUSTODY, 'graphFolderWrite.ts'), 'utf8'), WRITE);
});

test('a surviving mutant fails the witness and sources are still restored', () => {
  const root = fixture();
  let call = 0;
  assert.throws(() => runMutationWitness({ root, log: () => {}, run: () => (call++ === 0 || call === 2 ? { code: 0, output: 'ok' } : { code: 1, output: killedOutput(MUTATIONS[call - 2].killedBy) }) }), /SURVIVED/);
  assert.equal(readFileSync(join(root, CUSTODY, 'graphFolderWrite.ts'), 'utf8'), WRITE);
});

test('a compile error is not a kill', () => {
  const root = fixture();
  let call = 0;
  assert.throws(() => runMutationWitness({ root, log: () => {}, run: () => (call++ === 0 ? { code: 0, output: 'ok' } : { code: 1, output: 'error: Type checking failed.\nTS2304' }) }), /wrong reason/);
});

test('a red baseline aborts before mutating and a throw inside the runner still restores', () => {
  const root = fixture();
  assert.throws(() => runMutationWitness({ root, log: () => {}, run: () => ({ code: 1, output: 'red' }) }), /baseline/);
  assert.equal(readFileSync(join(root, CUSTODY, 'graphRead.ts'), 'utf8'), READ);
  let call = 0;
  assert.throws(() => runMutationWitness({ root, log: () => {}, run: () => { if (call++ === 0) return { code: 0, output: 'ok' }; throw new Error('runner crashed'); } }), /runner crashed/);
  assert.equal(readFileSync(join(root, CUSTODY, 'graphFolderWrite.ts'), 'utf8'), WRITE);
});

test('static wiring pins: allowlist before the one POST transport, no exported credential/transport', () => {
  assert.deepEqual(staticWiringProblems(READ, WRITE), []);
  assert.match(staticWiringProblems(READ.replace('folderWriteAllowed(request, context)', 'true'), WRITE).join('\n'), /before sendFolderRequest/);
  assert.match(staticWiringProblems(`${READ}\nexport async function loadFreshAccessToken() {}`, WRITE).join('\n'), /must not export loadFreshAccessToken/);
  assert.match(staticWiringProblems(`${READ}\nexport const sendFolderRequest = 1;`, WRITE).join('\n'), /must not export sendFolderRequest/);
  assert.match(staticWiringProblems(`${READ}\n  await sendFolderRequest(\n    url,\n    "POST",\n    x,\n  );`, WRITE).join('\n'), /exactly one POST/);
});

test('the real shipped sources satisfy the static wiring pins', () => {
  const read = readFileSync(new URL('../supabase/functions/m365-token-custody/graphRead.ts', import.meta.url), 'utf8');
  const write = readFileSync(new URL('../supabase/functions/m365-token-custody/graphFolderWrite.ts', import.meta.url), 'utf8');
  assert.deepEqual(staticWiringProblems(read, write), []);
  for (const mutation of MUTATIONS) {
    const text = mutation.file.endsWith('graphRead.ts') ? read : write;
    const line = text.split('\n').find((candidate) => candidate.includes(mutation.tag));
    assert.ok(line, `${mutation.id}: tag present`);
    assert.notEqual(mutation.apply(line), line, `${mutation.id}: mutation changes the line`);
  }
});
