import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// perf/vendor-chunk M2: pins the POINT of the lazy panel + shim split. Needs a build (dist/);
// CI's verify job builds first. Skipped locally only when dist/ is absent.
const dist = resolve(__dirname, '../../../dist');
const html = resolve(dist, 'index.html');
describe.skipIf(!existsSync(html))('entry modulepreload list', () => {
  const readPreloads = () =>
    [...readFileSync(html, 'utf8').matchAll(/<link rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]);

  it('does not preload recharts, markdown or the viewspec compiler', () => {
    const preloads = readPreloads();
    expect(preloads.length).toBeGreaterThan(0);
    for (const bad of [/vendor-recharts/, /markdown/i, /compiler/, /\/AssistantPanel-/]) {
      expect(preloads.filter((p) => bad.test(p)), String(bad)).toEqual([]);
    }
  });

  // #2096: the repositories barrel used to ship the WHOLE data layer in one modulepreloaded chunk
  // (402 kB raw / 107 kB gzip, on every first load incl. sign-in). One chunk carrying every domain's
  // DAL is the aggregated data layer by construction — it must never ride the entry preloads again.
  // Markers are PostgREST table/rpc literals, which survive minification. Each named domain is one
  // that is NOT used by the app shell, so none of them may legitimately sit in a preloaded chunk.
  const DATA_LAYER_MARKERS: Array<[string, RegExp]> = [
    ['stock', /stock_warehouses/],
    ['imprest', /imprest_floats/],
    ['equipment', /equipment_assets/],
    ['time & materials', /assemble_tm_claim/],
    ['budget', /budget_line_items/],
    ['procurement', /procurement_open_commitments/],
  ];

  it('does not preload a chunk containing the aggregated data layer (#2096)', () => {
    for (const preload of readPreloads()) {
      const chunk = readFileSync(resolve(dist, preload.slice(1)), 'utf8');
      const carried = DATA_LAYER_MARKERS.filter(([, re]) => re.test(chunk)).map(([name]) => name);
      expect(carried, `${preload} carries domains: ${carried.join(', ')}`).not.toHaveLength(
        DATA_LAYER_MARKERS.length,
      );
    }
  });

  // #2096 sub-item: the fx DAL was the only non-assistant zod user; after the typeof/Number.isInteger
  // guard, zod must not ride any first-load chunk (it stays with the lazy assistant panel).
  it('does not preload zod (#2096)', () => {
    for (const preload of readPreloads()) {
      const chunk = readFileSync(resolve(dist, preload.slice(1)), 'utf8');
      expect(chunk, preload).not.toMatch(/__zod_globalRegistry|ZodError/);
    }
  });
});
