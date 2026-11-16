import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// A supplier's invoice is "faktur supplier" in every Indonesian string (#2422);
// "invoice supplier" and "tagihan supplier" must not name that document.
const dir = join(process.cwd(), 'public/locales/id');
const walk = (node: unknown, path: string): Array<[string, string]> =>
  typeof node === 'string' ? [[path, node]]
    : node && typeof node === 'object'
      ? Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => walk(v, `${path}.${k}`))
      : [];

describe('supplier invoice word (id)', () => {
  it('reads "faktur supplier", never "invoice supplier" or "tagihan supplier", in any id catalogue', () => {
    const all = readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) =>
      walk(JSON.parse(readFileSync(join(dir, f), 'utf8')), f));
    expect(all.filter(([, v]) => /\b(invoice|tagihan) supplier\b/i.test(v))).toEqual([]);
  });
});
