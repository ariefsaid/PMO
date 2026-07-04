/**
 * AC-PJ-DG-001 — Drawer-vs-detail guard (T21)
 *
 * Codifies the invariant the JTBD census verified clean:
 * No *Detail.tsx page and no list page (Companies / Contacts / Incidents /
 * Projects / Procurement) may import the <Drawer> component.
 *
 * These pages use routable /entity/:id detail routes — not drawers — so that
 * every record is deep-linkable, shareable, and back-navigation works correctly
 * (ADR-0021, CW-4b drawer-as-record retirement).
 *
 * This test greps the source files to enforce the invariant at the unit layer.
 * A failing test = a file that has reintroduced a Drawer import that should not
 * be there; fix the file, not the test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

// The Drawer is imported as `import { Drawer` or `import Drawer` or `from '@/…/Drawer'`
// We match the component name in an import statement.
const DRAWER_IMPORT_RE = /\bDrawer\b/;

// Pages that MUST NOT import Drawer
// (detail pages + list pages that now use routable record pages)
const PAGES_ROOT = resolve(__dirname, '../../');

const GUARDED_FILES = [
  // Detail pages
  'pages/CompanyDetail.tsx',
  'pages/ContactDetail.tsx',
  'pages/IncidentDetail.tsx',
  'pages/project-detail/ProjectDetail.tsx',
  'pages/ProcurementDetails.tsx',
  // List pages (used to have drawers; now use routable detail pages)
  'pages/Companies.tsx',
  'pages/Contacts.tsx',
  'pages/Incidents.tsx',
  'pages/Projects.tsx',
  'pages/Procurement.tsx',
];

describe('AC-PJ-DG-001: drawer-vs-detail invariant — no Drawer import in detail or list pages', () => {
  for (const relPath of GUARDED_FILES) {
    it(`AC-PJ-DG-001: ${relPath} does NOT import <Drawer>`, () => {
      const absPath = join(PAGES_ROOT, relPath);
      // A missing guarded file must FAIL LOUDLY, not pass vacuously — a silently-swallowed
      // ENOENT here previously let a renamed/deleted guarded file "pass" with zero assertions
      // ever executed (the invariant this test exists to enforce was never actually checked).
      // readFileSync's own throw on a missing path is exactly the loud failure we want; if this
      // guard's file inventory (GUARDED_FILES above) ever drifts from the real pages/ tree, the
      // fix is to update GUARDED_FILES to match reality — never to swallow the read error here.
      const src = readFileSync(absPath, 'utf-8');

      // Extract all import statements
      const importLines = src
        .split('\n')
        .filter((line) => line.trim().startsWith('import '));

      const drawerImports = importLines.filter((line) => DRAWER_IMPORT_RE.test(line));

      expect(drawerImports, `${relPath} must not import Drawer:\n${drawerImports.join('\n')}`).toHaveLength(0);
    });
  }
});

describe('AC-PJ-DG-001: no new Detail pages have been created with Drawer imports', () => {
  it('AC-PJ-DG-001: all *Detail.tsx files in pages/ are Drawer-free', () => {
    // Scan pages/ and pages/project-detail/ for *Detail.tsx
    const pagesDir = join(PAGES_ROOT, 'pages');

    const findDetailFiles = (dir: string): string[] => {
      const results: string[] = [];
      let entries: string[];
      try {
        entries = readdirSync(dir, { withFileTypes: true }) as unknown as string[];
      } catch {
        return results;
      }
      for (const entry of entries as unknown as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>) {
        if (entry.isDirectory()) {
          results.push(...findDetailFiles(join(dir, entry.name)));
        } else if (entry.isFile() && entry.name.endsWith('Detail.tsx')) {
          results.push(join(dir, entry.name));
        }
      }
      return results;
    };

    const detailFiles = findDetailFiles(pagesDir);
    expect(detailFiles.length).toBeGreaterThan(0); // guard: must find at least one

    const violations: string[] = [];
    for (const filePath of detailFiles) {
      const src = readFileSync(filePath, 'utf-8');
      const importLines = src.split('\n').filter((l) => l.trim().startsWith('import '));
      const drawerImports = importLines.filter((l) => DRAWER_IMPORT_RE.test(l));
      if (drawerImports.length > 0) {
        violations.push(`${filePath}: ${drawerImports.join('; ')}`);
      }
    }

    expect(violations, `These Detail pages import Drawer (invariant violation):\n${violations.join('\n')}`).toHaveLength(0);
  });
});
