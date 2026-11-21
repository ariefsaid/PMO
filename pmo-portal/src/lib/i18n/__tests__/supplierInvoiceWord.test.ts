import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// In Indonesian an invoice is "invoice" (a supplier's is "invoice supplier", #2422).
// "Faktur" names only the tax invoice: e-Faktur / Faktur Pajak.
const dir = join(process.cwd(), 'public/locales/id');
const walk = (node: unknown, path: string): Array<[string, string]> =>
  typeof node === 'string' ? [[path, node]]
    : node && typeof node === 'object'
      ? Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => walk(v, `${path}.${k}`))
      : [];
const all = readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) =>
  walk(JSON.parse(readFileSync(join(dir, f), 'utf8')), f));

describe('invoice word (id)', () => {
  it('reads "invoice supplier", never "faktur supplier" or "tagihan supplier", in any id catalogue', () => {
    expect(all.filter(([, v]) => /\b(faktur|tagihan) supplier\b/i.test(v))).toEqual([]);
    expect(all.some(([, v]) => /\binvoice supplier\b/i.test(v))).toBe(true);
  });

  it('keeps "faktur" for the tax invoice only', () => {
    const taxInvoice = /e-?faktur\w*|faktur pajak/gi;
    expect(all.filter(([, v]) => /faktur/i.test(v.replace(taxInvoice, '')))).toEqual([]);
  });
});
