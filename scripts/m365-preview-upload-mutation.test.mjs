// Tests for the preview/upload mutation-witness harness itself (logic only; no deno run).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { MUTATIONS, staticWiringProblems } from './m365-preview-upload-mutation.mjs';

const read = (file) => readFileSync(resolve(import.meta.dirname, '..', file), 'utf8');
const CUSTODY = 'supabase/functions/m365-token-custody';

test('every mutation names a tag that exists and changes its line', () => {
  const ids = new Set();
  for (const m of MUTATIONS) {
    assert.ok(!ids.has(m.id), `duplicate id ${m.id}`);
    ids.add(m.id);
    const line = read(m.file).split('\n').find((l) => l.includes(m.tag));
    assert.ok(line, `${m.id}: tag ${m.tag} missing in ${m.file}`);
    assert.notEqual(m.apply(line), line, `${m.id}: apply is a no-op`);
  }
});

test('the shipped wiring passes the static pins', () => {
  assert.deepEqual(
    staticWiringProblems(read(`${CUSTODY}/graphRead.ts`), read(`${CUSTODY}/graphPreview.ts`), read(`${CUSTODY}/graphFileUpload.ts`)),
    [],
  );
});

test('the static pins catch a moved allowlist, an exported credential getter and an impure builder', () => {
  const read0 = read(`${CUSTODY}/graphRead.ts`);
  const moved = read0.replace('if (!previewAllowed(request, context)) return { kind: "unavailable" };', '');
  assert.ok(staticWiringProblems(moved, '', '').some((p) => p.includes('previewItem must call')));
  const leaky = `${read0}\nexport async function token() {}`;
  assert.ok(staticWiringProblems(leaky, '', '').some((p) => p.includes('must not export token')));
  const impure = staticWiringProblems(read0, 'const r = await fetch(url)', '');
  assert.ok(impure.some((p) => p.includes('graphPreview.ts must stay pure')));
});
