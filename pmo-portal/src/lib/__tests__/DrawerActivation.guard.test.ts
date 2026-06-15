/**
 * AC-G3D-GUARD-2: No primary list's onActivate opens a <Drawer>.
 *
 * CW-4 decision: drawers-as-record-pages are RETIRED. Every primary entity's
 * list row navigates to a dedicated route (e.g. /projects/:id, /companies/:id,
 * /contacts/:id, /incidents/:id) — NOT to a Drawer.
 *
 * This guard scans the source of the primary page files for the pattern of
 * an `onActivate` prop wiring into a `<Drawer` open state. It is a source-
 * code text scan — the BDD complement of the E2E navigation tests.
 *
 * Pages in scope (primary lists with an onActivate / row-click affordance):
 *   - pages/Projects.tsx       → /projects/:id  (detail page)
 *   - pages/Companies.tsx      → /companies/:id (detail page)
 *   - pages/Contacts.tsx       → /contacts/:id  (detail page)
 *   - pages/Incidents.tsx      → /incidents/:id (detail page)
 *
 * Out-of-scope (sub-lists within record pages, e.g. procurement board): these
 * are allowed to open contextual side panels; the guard is for PRIMARY lists only.
 *
 * Implementation note: We use Node's `fs` module to read the source at build time
 * so this guard runs in the same Vitest environment without needing a browser.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '../../../../');

function readPage(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/**
 * A primary list "opens a Drawer from onActivate" if both:
 *   (a) it has a pattern like `onActivate` or `onOpen` setting a state that is
 *       then passed to a `<Drawer` `open={…}` prop on the **same page**; AND
 *   (b) that `<Drawer` is NOT a sub-panel inside a record-detail tab (i.e. not
 *       gated behind a route param on the same page).
 *
 * The heuristic used here: check that there is NO `<Drawer` tag in the primary
 * list page at all, OR that any Drawer present is NOT wired to the row-activation
 * state (i.e., the `open` prop does not reference the activation state variable).
 *
 * For simplicity, and because CW-4 made the routing clean, we assert:
 *   "the file does NOT contain both `<Drawer` AND `onActivate` with a
 *    setSelected/setOpen state that feeds into `open={selected`."
 *
 * The canonical positive check: the page uses `useNavigate` (or `<Link`) for
 * row clicks — not a Drawer open state.
 */
function usesNavigateForRowActivation(src: string): boolean {
  return src.includes('useNavigate') || src.includes('navigate(');
}

function hasDrawerWiredToRowActivation(src: string): boolean {
  // Pattern: a Drawer whose `open` prop is set by the same state variable
  // that is set by the row-activation handler (setSelected, setOpen, etc.)
  // Heuristic: look for `<Drawer` AND `open={selected` or `open={drawerOpen`
  // within the same file.
  const hasDrawer = /<Drawer[\s\n]/.test(src);
  if (!hasDrawer) return false;
  // Check if any Drawer's open prop references a row-activation state
  const activationOpenPatterns = [
    /open=\{selected/,
    /open=\{drawerOpen/,
    /open=\{isDrawerOpen/,
    /open=\{showDrawer/,
  ];
  return activationOpenPatterns.some((p) => p.test(src));
}

describe('AC-G3D-GUARD-2: primary lists use navigation, not Drawer, for row activation', () => {
  it('Projects.tsx uses useNavigate for row activation (not a Drawer open state)', () => {
    const src = readPage('pmo-portal/pages/Projects.tsx');
    expect(usesNavigateForRowActivation(src)).toBe(true);
    expect(hasDrawerWiredToRowActivation(src)).toBe(false);
  });

  it('Companies.tsx uses useNavigate for row activation (not a Drawer open state)', () => {
    const src = readPage('pmo-portal/pages/Companies.tsx');
    expect(usesNavigateForRowActivation(src)).toBe(true);
    expect(hasDrawerWiredToRowActivation(src)).toBe(false);
  });

  it('Contacts.tsx uses useNavigate for row activation (not a Drawer open state)', () => {
    const src = readPage('pmo-portal/pages/Contacts.tsx');
    expect(usesNavigateForRowActivation(src)).toBe(true);
    expect(hasDrawerWiredToRowActivation(src)).toBe(false);
  });

  it('Incidents.tsx uses useNavigate for row activation (not a Drawer open state)', () => {
    const src = readPage('pmo-portal/pages/Incidents.tsx');
    expect(usesNavigateForRowActivation(src)).toBe(true);
    expect(hasDrawerWiredToRowActivation(src)).toBe(false);
  });
});
