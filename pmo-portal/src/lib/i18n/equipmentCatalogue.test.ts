import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** NFR-EQU-005: en and id ship together. Same keys, no empty id value, same interpolation tokens, and every key the equipment screens reference exists. */
const root = join(__dirname, '..', '..', '..');
const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8')) as Record<string, unknown>;
const flat = (d: Record<string, unknown>, pre = ''): Record<string, string> =>
  Object.entries(d).reduce<Record<string, string>>((a, [k, v]) =>
    typeof v === 'object' && v !== null ? { ...a, ...flat(v as Record<string, unknown>, `${pre}${k}.`) } : { ...a, [`${pre}${k}`]: String(v) }, {});
const en = flat(read('public/locales/en/equipment.json'));
const id = flat(read('public/locales/id/equipment.json'));
const hasKey = (catalogue: Record<string, string>, key: string, count: boolean) =>
  key in catalogue || (count && `${key}_one` in catalogue && `${key}_other` in catalogue);
const tokens = (s: string) => (s.match(/{{\w+}}/g) ?? []).sort().join();

describe('NFR-EQU-005 equipment catalogue', () => {
  it('NFR-EQU-005 id mirrors en: same keys, none empty, same interpolation tokens', () => {
    expect(Object.keys(id).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries(id)) {
      expect(v, k).not.toBe('');
      expect(tokens(v), k).toBe(tokens(en[k]));
    }
  });

  it('NFR-EQU-005 every equipment key the screens reference exists in en', () => {
    const files = ['pages/project-detail/ProjectEquipmentPanel.tsx', 'src/components/shell/Rail.tsx', 'src/components/shell/routeMatch.ts',
      ...readdirSync(join(root, 'pages/equipment')).filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.')).map((f) => `pages/equipment/${f}`)];
    const used = new Set<string>();
    const countKeys = new Set<string>();
    for (const f of files) {
      const source = readFileSync(join(root, f), 'utf8');
      for (const m of source.matchAll(/['"]equipment:([\w.]+)['"]/g)) used.add(m[1]);
      for (const m of source.matchAll(/t\(\s*['"]equipment:([\w.]+)['"]([^)]*)\)/g)) {
        if (/\bcount\s*:/.test(m[2])) countKeys.add(m[1]);
      }
    }
    expect(used.size).toBeGreaterThan(100);
    expect([...used].filter((k) => !hasKey(en, k, countKeys.has(k)))).toEqual([]);
  });

  it('recognizes complete plural forms only for count calls and rejects missing keys', () => {
    const catalogue = { 'item_one': 'one', 'item_other': 'many' };
    expect(hasKey(catalogue, 'item', true)).toBe(true);
    expect(hasKey(catalogue, 'item', false)).toBe(false);
    expect(hasKey(catalogue, 'missing', true)).toBe(false);
    expect(hasKey({ item_one: 'one' }, 'item', true)).toBe(false);
  });

  it('NFR-EQU-005 a screen never builds an equipment key at run time (the gate could not see it)', () => {
    const dynamic = ['pages/equipment', 'pages/project-detail/ProjectEquipmentPanel.tsx'].flatMap((p) =>
      (p.endsWith('.tsx') ? [p] : readdirSync(join(root, p)).filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.')).map((f) => `${p}/${f}`)));
    for (const f of dynamic) expect(readFileSync(join(root, f), 'utf8'), f).not.toMatch(/`equipment:[^`]*\$\{/);
  });
});
