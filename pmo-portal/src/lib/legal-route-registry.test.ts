import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * AC-LEG-026 — every legal route is covered by BOTH layout oracles:
 * no-horizontal-bleed (AC-MOBILE-OVERFLOW-001) and oversized-icon (AC-VISUAL-ICON-001).
 *
 * The original two monolithic gate specs were consolidated into per-route layout sweeps:
 * `e2e/layout/*.layout.spec.ts` files call `registerLayoutSweep({ path, label, icons, … })`
 * (support/layout-sweep.ts), which generates for each route a bleed test (unconditional)
 * and icon tests (gated on `icons`). This unit test pins that contract statically, so a
 * legal route losing its sweep registration — or registering with `icons: false` — goes
 * red here instead of silently dropping out of coverage.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const E2E_DIR = resolve(__dirname, '../../e2e');
const LAYOUT_DIR = join(E2E_DIR, 'layout');
const SWEEP_SRC = readFileSync(join(E2E_DIR, 'support', 'layout-sweep.ts'), 'utf8');

/** The legal routes (footer pages) whose layout coverage AC-LEG-026 pins. */
const LEGAL_ROUTES = ['/terms', '/privacy'];

interface Registration {
  file: string;
  /** Literal `path:` from the registerLayoutSweep call; null when built dynamically. */
  path: string | null;
  /** `icons:` flag; undefined when the call omits it (the scan stays lenient). */
  icons?: boolean;
}

/** Slice every `registerLayoutSweep({ … })` argument out of `e2e/layout/*.layout.spec.ts`. */
function scanRegistrations(): Registration[] {
  const files = readdirSync(LAYOUT_DIR)
    .filter((f) => f.endsWith('.layout.spec.ts'))
    .sort();
  expect(files.length, 'e2e/layout/: no *.layout.spec.ts files found').toBeGreaterThan(0);
  const regs: Registration[] = [];
  for (const file of files) {
    const src = readFileSync(join(LAYOUT_DIR, file), 'utf8');
    for (const call of src.matchAll(/registerLayoutSweep\(\{([\s\S]*?)\}\)/g)) {
      const args = call[1];
      const path = args.match(/\bpath:\s*'([^']+)'/)?.[1] ?? null;
      const icons = args.match(/\bicons:\s*(true|false)\b/)?.[1];
      regs.push({ file, path, icons: icons === undefined ? undefined : icons === 'true' });
    }
  }
  return regs;
}

let cachedRegistrations: Registration[] | null = null;
function registrations(): Registration[] {
  cachedRegistrations ??= scanRegistrations();
  return cachedRegistrations;
}

describe('AC-LEG-026 — layout-sweep oracle wiring', () => {
  it('no-horizontal-bleed oracle runs unconditionally for every registered route', () => {
    const call = SWEEP_SRC.indexOf('await assertNoBleed(page, width);');
    expect(call, 'layout-sweep.ts: the per-width sweep never calls assertNoBleed').toBeGreaterThan(-1);
    // Anchor at the test body (the generated TITLE legitimately mentions route.icons for the
    // AC tag, so scan from the first statement after the arrow, not from `test(`).
    const bodyStart = SWEEP_SRC.indexOf('async ({ page }) => {', SWEEP_SRC.lastIndexOf('test(', call));
    expect(bodyStart, 'layout-sweep.ts: unexpected sweep test shape').toBeGreaterThan(-1);
    const bodyBeforeBleed = SWEEP_SRC.slice(bodyStart, call);
    expect(bodyBeforeBleed, 'layout-sweep.ts: the bleed oracle must NOT be gated on `icons`').not.toMatch(
      /route\.icons/,
    );
  });

  it('oversized-icon oracle is gated on `icons`', () => {
    expect(
      SWEEP_SRC,
      'layout-sweep.ts: the per-width icon oracle must stay behind `if (route.icons && width === 390)`',
    ).toMatch(/if \(route\.icons && width === 390\) \{[\s\S]*?await assertIconSizes\(page\);/);
    expect(
      SWEEP_SRC,
      'layout-sweep.ts: the desktop icon test must stay behind `if (route.icons)`',
    ).toMatch(/if \(route\.icons\) \{[\s\S]*?await assertIconSizes\(page\);/);
    const callSites = SWEEP_SRC.match(/await assertIconSizes\(page\);/g) ?? [];
    expect(callSites, 'layout-sweep.ts: assertIconSizes gained or lost a call site').toHaveLength(2);
  });
});

describe('AC-LEG-026 — legal routes covered by both layout oracles', () => {
  for (const route of LEGAL_ROUTES) {
    it(`registerLayoutSweep covers ${route} with both oracles (icons: true)`, () => {
      const hits = registrations().filter((r) => r.path === route);
      expect(
        hits.length,
        `no e2e/layout/*.layout.spec.ts registers path '${route}' — the legal route lost its layout coverage`,
      ).toBeGreaterThan(0);
      for (const hit of hits) {
        expect(
          hit.icons,
          `${hit.file}: '${route}' must register with icons: true so the oversized-icon oracle also covers it`,
        ).toBe(true);
      }
    });
  }
});
