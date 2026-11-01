import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** FR-IMP-074: en and id ship together. The imprest namespace sits outside the launch-scope gate, so this pins it:
 *  same keys, no empty id value, same interpolation tokens, and every key the screens reference exists. */
const root = join(__dirname, '..', '..', '..');
const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8')) as Record<string, unknown>;
const flat = (d: Record<string, unknown>, pre = ''): Record<string, string> =>
  Object.entries(d).reduce<Record<string, string>>((a, [k, v]) =>
    typeof v === 'object' && v !== null ? { ...a, ...flat(v as Record<string, unknown>, `${pre}${k}.`) } : { ...a, [`${pre}${k}`]: String(v) }, {});
const en = flat(read('public/locales/en/imprest.json'));
const id = flat(read('public/locales/id/imprest.json'));
const tokens = (s: string) => (s.match(/{{\w+}}/g) ?? []).sort().join();

describe('FR-IMP-074 imprest catalogue', () => {
  it('FR-IMP-074 id mirrors en: same keys, none empty, same interpolation tokens', () => {
    expect(Object.keys(id).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries(id)) {
      expect(v, k).not.toBe('');
      expect(tokens(v), k).toBe(tokens(en[k]));
    }
  });
  it('FR-IMP-074 every imprest key the screens reference exists in en', () => {
    const files = ['pages/ImprestFloats.tsx', 'pages/ImprestFloatDetail.tsx', 'pages/ExpenseClaimNew.tsx', 'pages/ExpenseClaimDetail.tsx',
      'pages/approvals/ImprestApprovalSection.tsx', 'pages/approvals/ExpenseClaimApprovalSection.tsx', 'src/components/shell/Rail.tsx', 'src/components/shell/routeMatch.ts',
      ...readdirSync(join(root, 'pages/imprest')).filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.')).map((f) => `pages/imprest/${f}`)];
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(join(root, f), 'utf8').matchAll(/['"]imprest:([\w.]+)['"]/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(100);
    expect([...used].filter((k) => !(k in en))).toEqual([]);
  });
});
