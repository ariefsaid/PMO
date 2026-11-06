import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// perf/vendor-chunk M2: pins the POINT of the lazy panel + shim split. Needs a build (dist/);
// CI's verify job builds first. Skipped locally only when dist/ is absent.
const html = resolve(__dirname, '../../../dist/index.html');
describe.skipIf(!existsSync(html))('entry modulepreload list', () => {
  it('does not preload recharts, markdown or the viewspec compiler', () => {
    const preloads = [...readFileSync(html, 'utf8').matchAll(/<link rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(preloads.length).toBeGreaterThan(0);
    for (const bad of [/vendor-recharts/, /markdown/i, /compiler/, /\/AssistantPanel-/]) {
      expect(preloads.filter((p) => bad.test(p)), String(bad)).toEqual([]);
    }
  });
});
