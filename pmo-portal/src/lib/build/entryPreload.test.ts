import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// perf/vendor-chunk M2: pins the POINT of the lazy panel + shim split. Needs a build (dist/);
// CI's verify job builds first. Skipped locally only when dist/ is absent.
const dist = resolve(__dirname, '../../../dist');
const html = resolve(dist, 'index.html');
describe.skipIf(!existsSync(html))('entry modulepreload list', () => {
  /**
   * Every file the browser fetches to BOOT the app: the `<link rel="modulepreload">` set PLUS the
   * entry `<script type="module" src>` itself (#2096 review — scanning only the preload links let
   * the entry chunk go unchecked, so a data layer returning inside `index-*.js` would still pass).
   */
  const readFirstLoadFiles = () => {
    const source = readFileSync(html, 'utf8');
    return [
      ...[...source.matchAll(/<link rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]),
      ...[...source.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]),
    ];
  };

  it('scans the entry module script as well as the modulepreload links (#2096)', () => {
    const scanned = readFirstLoadFiles();
    expect(scanned.filter((p) => /^\/assets\/index-[\w-]+\.js$/.test(p))).toHaveLength(1);
  });

  it('does not preload recharts, markdown or the viewspec compiler', () => {
    const preloads = readFirstLoadFiles();
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
    for (const preload of readFirstLoadFiles()) {
      const chunk = readFileSync(resolve(dist, preload.slice(1)), 'utf8');
      const carried = DATA_LAYER_MARKERS.filter(([, re]) => re.test(chunk)).map(([name]) => name);
      expect(carried, `${preload} carries domains: ${carried.join(', ')}`).not.toHaveLength(
        DATA_LAYER_MARKERS.length,
      );
    }
  });

  // #2096: the ⌘K live index (six entity hooks → their domain repositories) is mounted lazily from
  // the FIRST palette open; while closed it publishes the same empty snapshot the old
  // `enabled: paletteOpen` gating produced. If it crept back into the entry graph it would drag the
  // companies/contacts/incidents DAL into first load, so pin it out of the preload list — and pin
  // that the bridge really ships as a lazy chunk, so the assertion cannot pass vacuously.
  it('does not preload the ⌘K record-search data bridge (#2096)', () => {
    const assets = resolve(dist, 'assets');
    const BRIDGE_MARKER = /shell\.palette\.recordContact/;
    const carriers = readdirSync(assets)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => BRIDGE_MARKER.test(readFileSync(resolve(assets, f), 'utf8')));
    expect(carriers.length, 'the ⌘K live index must ship in some chunk').toBeGreaterThan(0);
    const preloaded = new Set(readFirstLoadFiles().map((p) => p.replace('/assets/', '')));
    expect(carriers.filter((c) => preloaded.has(c)), `preloaded: ${[...preloaded].join(', ')}`).toEqual([]);
  });

  // #2096 sub-item: the fx DAL was the only non-assistant zod user; after the typeof/Number.isInteger
  // guard, zod must not ride any first-load chunk (it stays with the lazy assistant panel).
  it('does not preload zod (#2096)', () => {
    for (const preload of readFirstLoadFiles()) {
      const chunk = readFileSync(resolve(dist, preload.slice(1)), 'utf8');
      expect(chunk, preload).not.toMatch(/__zod_globalRegistry|ZodError/);
    }
  });
});
