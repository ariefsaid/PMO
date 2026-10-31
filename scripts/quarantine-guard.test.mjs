import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const e2eDir = fileURLToPath(new URL('../pmo-portal/e2e/', import.meta.url));

test('quarantine guard: quarantined e2e specs have documented QUARANTINE markers and tracked count', () => {
  const specs = [
    ['AC-IN-001-incidents-crud.spec.ts', 2],
    ['AC-INC-001-incident-detail.spec.ts', 1],
  ];
  let total = 0;
  for (const [name, expected] of specs) {
    const content = readFileSync(`${e2eDir}/${name}`, 'utf8');
    assert.match(content, /\/\/\s*QUARANTINE:/i);
    assert.match(content, /un-skip when/i);
    const count = (content.match(/test\.skip\(\s*'QUARANTINE:/g) || []).length;
    assert.equal(count, expected, name);
    total += count;
  }
  assert.equal(total, 3);
});
