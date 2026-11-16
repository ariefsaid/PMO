import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const id = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/expenseClaims.json'), 'utf8')) as { detail: { statusLine: Record<string, string> } };

// A claim line is "rincian" in Indonesian on every claim surface (panel, empty line, Submit hold, header count);
// "baris" is a table row and must not name it (compose-03 r3).
const walk = (node: unknown, path = ''): Array<[string, string]> =>
  typeof node === 'string' ? [[path, node]]
    : Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => walk(v, path ? `${path}.${k}` : k));

describe('claim line word (id)', () => {
  it('names a claim line "rincian", never "baris", in the expense-claim catalogue', () => {
    const strings = walk(id);
    expect(strings.filter(([, v]) => /\bbaris\b/i.test(v))).toEqual([]);
    expect(id.detail.statusLine.draft_other).toContain('rincian');
    expect(id.detail.statusLine.draft_one).toContain('rincian');
  });
});
