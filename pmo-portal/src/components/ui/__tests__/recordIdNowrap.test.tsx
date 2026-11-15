import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// jsdom does not load index.css: assert on the shipped rules themselves.
const css = readFileSync(join(process.cwd(), 'index.css'), 'utf8');
const rule = (sel: string) => new RegExp(`${sel}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

describe('record-id role: a record number never breaks mid-token and never overflows', () => {
  it('is nowrap and truncates with an ellipsis inside a narrow container', () => {
    const r = rule('\\.record-id');
    expect(r).toMatch(/white-space:\s*nowrap/);
    expect(r).toMatch(/overflow:\s*hidden/);
    expect(r).toMatch(/text-overflow:\s*ellipsis/);
    expect(r).toMatch(/max-width:\s*100%/);
  });
  it('tabular figures carry no nowrap (money and flex-wrap rows must be able to wrap)', () => {
    expect(rule('\\.tabular, \\.tnum')).not.toMatch(/white-space/);
  });
});
