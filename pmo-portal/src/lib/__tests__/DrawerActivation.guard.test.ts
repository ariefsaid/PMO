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

/**
 * Known limits of this heuristic (source-text scan, not an AST/type-aware check):
 *   1. It only matches `open={<identifier>` — a Drawer opened via a more complex expression
 *      (`open={!!selected}`, `open={state.drawerOpen}`, a ternary, etc.) is NOT detected.
 *   2. It cannot tell whether the matched state variable is actually SET by a row-activation
 *      handler (onActivate/onRowClick/onClick on a row) vs. some unrelated same-named state —
 *      a same-file false-positive risk in a page with an unrelated `drawerOpen`-named variable
 *      used for a non-row-activation Drawer (e.g. a "create new" modal-drawer).
 *   3. It is scoped to the 4 named primary-list pages below; it does not scan the whole
 *      pages/ tree, so a NEW primary list added without a corresponding `it(...)` here is
 *      silently uncovered (the BDD complement doesn't self-discover new pages).
 * Given these limits, this guard is a fast regression net for the 4 known pages, NOT a proof
 * that no page anywhere opens a Drawer from row activation — the Playwright/e2e navigation
 * tests (AC-G3D-GUARD-2's cross-stack proof) are the authoritative check.
 */
function hasDrawerWiredToRowActivation(src: string): boolean {
  const hasDrawer = /<Drawer[\s\n]/.test(src);
  if (!hasDrawer) return false;
  // Broadened from a fixed 4-name allowlist (selected/drawerOpen/isDrawerOpen/showDrawer) to ANY
  // `open={<identifier>}`-shaped prop whose identifier name plausibly denotes drawer/selection/
  // panel state — catches renamed or newly-introduced state variables (e.g. `activeRecord`,
  // `panelOpen`, `openRow`) that the old hardcoded list would silently miss, while still
  // excluding unrelated boolean props (e.g. `open={true}`, `open={isPending}` for an unrelated
  // loading-state Drawer) via the name-shape filter below.
  const openPropMatches = [...src.matchAll(/open=\{\s*([A-Za-z_$][\w$]*)/g)];
  if (openPropMatches.length === 0) return false;
  const activationNameShape = /selected|drawer|panel|active(?:record|row)?|openrow|isopen/i;
  return openPropMatches.some(([, ident]) => activationNameShape.test(ident));
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

describe('hasDrawerWiredToRowActivation — broadened state-name detection', () => {
  it('detects a Drawer wired via a RENAMED state variable the old fixed 4-name list would miss (e.g. `activeRecord`, `panelOpen`)', () => {
    const violatingSrc = `
      function List() {
        const [activeRecord, setActiveRecord] = useState(null);
        return (
          <>
            <Row onActivate={(row) => setActiveRecord(row)} />
            <Drawer open={activeRecord} onClose={() => setActiveRecord(null)} />
          </>
        );
      }
    `;
    expect(hasDrawerWiredToRowActivation(violatingSrc)).toBe(true);

    const violatingSrc2 = `
      <Drawer open={panelOpen} onClose={closePanel} />
    `;
    expect(hasDrawerWiredToRowActivation(violatingSrc2)).toBe(true);
  });

  it('does NOT flag a Drawer whose open prop is an unrelated boolean (name-shape filter avoids over-matching)', () => {
    const benignSrc = `
      <Drawer open={isPending} onClose={reset} />
    `;
    expect(hasDrawerWiredToRowActivation(benignSrc)).toBe(false);
  });

  it('does NOT flag a file with no <Drawer> tag at all, regardless of open= props elsewhere', () => {
    const noDrawerSrc = `
      <Modal open={selected} onClose={close} />
    `;
    expect(hasDrawerWiredToRowActivation(noDrawerSrc)).toBe(false);
  });
});
