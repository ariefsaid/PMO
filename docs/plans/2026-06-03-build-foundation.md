# Implementation Plan — Issue #1: De-cruft + Build Foundation

> **Date:** 2026-06-03 · **Phase:** Migration §13 Phase 0 (Green + de-cruft) + the Tailwind slice of Phase 1.
> **Spec sources:** `docs/specs/target-architecture.spec.md` §10 (UI/CSS), §11 (perf), §13 (migration);
> `docs/specs/baseline.spec.md` §9 findings F-1, F-4, F-12; `docs/adr/0004-tailwind-via-vite.md`.
> **Charter:** behavior-preserving cleanup; the planner carries the Architecture / Existing-repo /
> Performance lenses. This issue changes **no app behavior** — it makes the repo green, replaces CDN
> Tailwind with a real bundled pipeline, fixes one latent hooks-order crash, and flips CI lint to blocking.
>
> **Constraint honored:** this is a foundation/quality issue. Most tasks are **behavior-preserving
> cleanups whose gate IS the test** (typecheck / `lint:ci` / build / existing render smoke). **One** task
> (F-1) fixes a real latent bug and therefore gets a **TDD failing test first** (a render test asserting no
> hooks-order error). See "TDD vs gate-is-the-test" below.

---

## TDD vs gate-is-the-test (read first)

| Work | Class | "Test" that proves it |
|---|---|---|
| F-1 hooks reorder (`ProjectDetails`) | **Real bug → TDD** | New failing component-render test `pmo-portal/test/project-details-hooks.test.tsx` (red → green). AC-005. |
| Remove CDN/importmap/`/index.css`, delete `metadata.json` | Behavior-preserving cleanup | Build emits no `/index.css` warning + real CSS file present. AC-003. |
| Real Tailwind via Vite + token port | Config change | `npm run build` succeeds, Tailwind utility classes resolved in emitted CSS; existing render smoke still green. AC-003, AC-004. |
| Fix the 21 ESLint errors (unused/`prefer-const`) | Behavior-preserving cleanup | `npm run lint:ci` (`--max-warnings=0`) exits 0. AC-002. |
| Flip CI lint to blocking | CI config | `ci.yml` runs `npm run lint:ci` with no `continue-on-error`. AC-006. |
| Whole-issue regression guard | — | `npm run typecheck` + `npm test` green; app still renders Dashboard + Project Details routes. AC-001, AC-004, AC-005. |

> **Why the 21 lint errors are not pre-enumerated line-by-line here:** the authoritative list is whatever
> `npm run lint` prints against the current tree. ESLint output **is** the work list; each diagnostic has a
> deterministic, rule-specified mechanical fix (below). Hand-copying 21 line numbers into this plan would be
> guesswork that drifts the moment any earlier task (e.g. F-1 reorder, CSS import) shifts a line. Task 8
> therefore specifies the **exact transform per rule** and the **exact verify gate**, which is fully
> no-placeholder: there is no judgement left to the implementer, only rule-mechanical edits. F-1 is removed
> from that bucket and handled explicitly in Tasks 6–7 because it is a real bug, not cleanup.

---

## Acceptance criteria (verification-based foundation issue)

All ACs are in Given/When/Then. Each maps to tasks below.

- **AC-001 — Typecheck clean.**
  Given the repo on this branch, When `npm run typecheck` runs in `pmo-portal/`, Then it exits 0 with no errors.
- **AC-002 — Lint blocking-clean.**
  Given the repo on this branch, When `npm run lint:ci` runs in `pmo-portal/`, Then it exits 0 (zero errors, zero warnings under `--max-warnings=0`).
- **AC-003 — Bundled Tailwind, no CDN residue.**
  Given `index.html` no longer references `cdn.tailwindcss.com`, the `aistudiocdn` importmap, or `/index.css`, and `metadata.json` is deleted, When `npm run build` runs, Then it succeeds, emits a CSS asset in `dist/assets/` that contains compiled Tailwind utilities, and prints **no** `/index.css` (missing file) warning.
- **AC-004 — App still renders unchanged (smoke).**
  Given the new Tailwind pipeline and cleanup, When the existing render smoke test runs under `npm test`, Then the Executive Dashboard route and the Project Details route both render without throwing, identical in behavior to before this issue.
- **AC-005 — No hooks-order error in ProjectDetails (F-1).**
  Given a Project Details route for a valid project id, When the component renders, Then React reports **no** "rendered more/fewer hooks than during the previous render" error and the version selector initializes from the active budget version (behavior preserved).
- **AC-006 — CI lint gate is blocking.**
  Given `.github/workflows/ci.yml`, When the lint step is inspected, Then it runs `npm run lint:ci` with **no** `continue-on-error`, so a lint regression fails the build.

---

## Pre-flight (Task 0)

### Task 0 — Capture the current lint baseline (read-only; informs Task 8)
- **Action:** none to source. The implementer runs the linter once to materialize the authoritative error list before editing.
- **Verify:** `cd pmo-portal && npm run lint` — record the printed diagnostics (expected per baseline F-4: 21 errors + 3 warnings; the F-1 `react-hooks/rules-of-hooks` error at `pages/ProjectDetails.tsx:1217:55`, the rest unused imports/vars + one `prefer-const`; 2 `exhaustive-deps` + 1 `react-refresh` warnings).
- **Note:** the 2 `exhaustive-deps` + 1 `react-refresh` *warnings* must also reach zero for `--max-warnings=0` (AC-002). They are handled in Task 9. (`baseline.spec.md F-4`.)

---

## A. Tailwind pipeline (ADR-0004) — AC-003, AC-004

### Task 1 — Add Tailwind v4 devDependencies
- **File:** `pmo-portal/package.json` — in `devDependencies`, add (alphabetical placement):
  ```json
    "@tailwindcss/vite": "^4.1.0",
  ```
  and
  ```json
    "tailwindcss": "^4.1.0",
  ```
- **Then install:** `cd pmo-portal && npm install` (updates `package-lock.json`).
- **Verify:** `cd pmo-portal && node -e "require('@tailwindcss/vite'); require('tailwindcss'); console.log('ok')"` prints `ok`.
- **AC:** AC-003 (enabling).

### Task 2 — Register the Tailwind Vite plugin
- **File:** `pmo-portal/vite.config.ts`.
- **Change:** add the import after the react import (line 3):
  ```ts
  import tailwindcss from '@tailwindcss/vite';
  ```
  and change the plugins array (line 10) from `plugins: [react()],` to:
  ```ts
  plugins: [react(), tailwindcss()],
  ```
- **Verify:** `cd pmo-portal && npm run typecheck` exits 0 (config compiles; `vitest/config` `defineConfig` accepts the plugin).
- **AC:** AC-003.

### Task 3 — Create the real Tailwind CSS entry with the ported `primary` palette
- **File (new):** `pmo-portal/index.css` (package root, beside `index.tsx`; **not** under `src/` — this issue does not introduce the `src/` layout, see ADR-0007).
- **Content (exact):**
  ```css
  @import "tailwindcss";

  /* Class-based dark mode (preserves prototype's darkMode: 'class' behavior). */
  @custom-variant dark (&:where(.dark, .dark *));

  /* Ported verbatim from the prototype's inline CDN config (index.html:16) so the look is unchanged. */
  @theme {
    --color-primary-50: #eff6ff;
    --color-primary-100: #dbeafe;
    --color-primary-200: #bfdbfe;
    --color-primary-300: #93c5fd;
    --color-primary-400: #60a5fa;
    --color-primary-500: #3b82f6;
    --color-primary-600: #2563eb;
    --color-primary-700: #1d4ed8;
    --color-primary-800: #1e40af;
    --color-primary-900: #1e3a8a;
    --color-primary-950: #172554;
  }
  ```
- **Verify:** `test -f pmo-portal/index.css && grep -q '@import "tailwindcss";' pmo-portal/index.css && grep -q 'color-primary-950' pmo-portal/index.css && echo ok` prints `ok`.
- **AC:** AC-003 (palette port preserves look → AC-004).

### Task 4 — Import the CSS entry from the app root
- **File:** `pmo-portal/index.tsx`.
- **Change:** add as the first import (above `import React`, new line 2):
  ```ts
  import './index.css';
  ```
- **Verify:** `cd pmo-portal && head -5 index.tsx | grep -q "import './index.css';" && echo ok` prints `ok`.
- **AC:** AC-003, AC-004.

### Task 5 — Strip CDN Tailwind, importmap, dead `/index.css`; delete `metadata.json`
- **File:** `pmo-portal/index.html`. Replace the `<head>` so lines 9–33 (the `cdn.tailwindcss.com` script, the inline `tailwind.config` script, the `aistudiocdn` importmap, and the `<link rel="stylesheet" href="/index.css">`) are **removed**. Resulting file (exact):
  ```html

  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <link rel="icon" type="image/svg+xml" href="/vite.svg" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>PMO Portal</title>
    </head>
    <body class="bg-gray-50 dark:bg-gray-900">
      <div id="root"></div>
    <script type="module" src="/index.tsx"></script>
  </body>
  </html>
  ```
- **Delete file:** `pmo-portal/metadata.json` (AI Studio artifact; remove from disk).
- **Verify (all three):**
  - `! grep -q 'cdn.tailwindcss.com\|aistudiocdn\|index.css' pmo-portal/index.html && echo html-clean` prints `html-clean`.
  - `test ! -f pmo-portal/metadata.json && echo no-metadata` prints `no-metadata`.
  - `cd pmo-portal && npm run build 2>&1 | tee /tmp/pmo-build.log; ! grep -qi "index.css" /tmp/pmo-build.log && grep -RIlq "primary" dist/assets/*.css && echo build-clean` prints `build-clean` (build succeeds, no `/index.css` warning, compiled CSS contains the ported palette → Tailwind emitted).
- **AC:** AC-003.

---

## B. F-1 hooks-order crash — TDD (AC-005)

### Task 6 — RED: failing render test for ProjectDetails hooks order
- **File (new):** `pmo-portal/test/project-details-hooks.test.tsx`.
- **Content (exact):**
  ```tsx
  import { describe, it, expect, vi, afterEach } from 'vitest';
  import { render } from '@testing-library/react';
  import { MemoryRouter, Routes, Route } from 'react-router-dom';
  import { projects } from '../data/mockData';
  import ProjectDetails from '../pages/ProjectDetails';

  // F-1 (baseline §9): useState ran AFTER an early `return <Navigate/>`, making a hook
  // conditional. React surfaces this as a console.error: "Rendered more hooks than during
  // the previous render" / "change in the order of Hooks". This test fails (red) while the
  // hook is below the guard and passes (green) once all hooks are hoisted above it. AC-005.
  afterEach(() => vi.restoreAllMocks());

  function renderAt(projectId: string) {
    return render(
      <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectDetails />} />
          <Route path="/projects" element={<div>projects-list</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  describe('ProjectDetails hooks order (F-1)', () => {
    it('renders a valid project without a React hooks-order error', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const validId = projects[0].id;
      expect(() => renderAt(validId)).not.toThrow();
      const hooksOrderError = errorSpy.mock.calls.some(args =>
        String(args[0]).match(/hook|order of Hooks|Rendered more|Rendered fewer/i),
      );
      expect(hooksOrderError).toBe(false);
    });
  });
  ```
- **Verify (expect RED):** `cd pmo-portal && npx vitest run test/project-details-hooks.test.tsx` — must **fail** before Task 7 (hooks-order console.error present or render throws).
- **AC:** AC-005.

### Task 7 — GREEN: hoist all hooks above the `if (!project)` guard
- **File:** `pmo-portal/pages/ProjectDetails.tsx`, the `ProjectDetails` component (currently lines 1204–1217).
- **Change:** move the `selectedVersionId` `useState` **above** the early `return <Navigate/>`. Replace lines 1204–1217 with:
  ```tsx
  const ProjectDetails: React.FC = () => {
      const { projectId } = useParams<{ projectId: string }>();
      const [activeTab, setActiveTab] = useState('Overview');

      const project = projects.find(p => p.id === projectId);
      const projectVersions = budgetVersions.filter(v => v.projectId === projectId);
      const activeVersion = projectVersions.find(v => v.status === 'Active');
      const [selectedVersionId, setSelectedVersionId] = useState(activeVersion?.id || projectVersions[0]?.id);

      if (!project) {
          return <Navigate to="/projects" replace />;
      }
  ```
  Notes preserving behavior: `projectVersions` now keys off `projectId` (the URL param) instead of `project.id`; for a found project these are identical (`project.id === projectId`), and for a missing project the values are unused before the guard returns. The `useState` initializer reads `activeVersion`/`projectVersions`, both now computed above it — same initial value as before. No other lines change; the later `project`-dependent code (lines 1219+) is unchanged and still runs only past the guard.
- **Verify (expect GREEN):** `cd pmo-portal && npx vitest run test/project-details-hooks.test.tsx` passes; and `cd pmo-portal && npx eslint pages/ProjectDetails.tsx --rule '{"react-hooks/rules-of-hooks":"error"}'` reports no `rules-of-hooks` error at the former line 1217.
- **AC:** AC-005.

---

## C. Lint to zero — AC-002

### Task 8 — Remove unused imports/vars and `prefer-const` violations (rule-mechanical)
- **Files:** every file ESLint reports under `@typescript-eslint/no-unused-vars` (error) and `prefer-const` from Task 0's baseline. Per F-4 these are concentrated in the page/component files (`pages/*.tsx`, `components/*.tsx`) — e.g. unused imports in `pages/ProjectDetails.tsx` line 9 (icon imports such as `EyeIcon`/`CloudArrowUpIcon` if unreferenced after Task 7) and unused type imports line 8.
- **Exact transform per diagnostic (no judgement):**
  - `@typescript-eslint/no-unused-vars` on an **import specifier** → delete that specifier from its import list; if the list becomes empty, delete the whole import statement.
  - `@typescript-eslint/no-unused-vars` on a **local `const`/`let`/function** → delete the declaration (and its now-dead initializer) if it has no side effects; if the initializer has a side effect, keep the call but drop the binding.
  - `@typescript-eslint/no-unused-vars` on a **function parameter that cannot be removed** (positional, used by a later param) → rename it with a leading underscore (the config's `argsIgnorePattern: '^_'`, `eslint.config.js:27`).
  - `prefer-const` → change the offending `let` to `const`.
- **Do NOT** change any runtime behavior: only delete provably-unreferenced symbols and tighten `let`→`const`. If removing an import would change behavior (a side-effect-only import), keep it — there are none expected here.
- **Verify:** `cd pmo-portal && npx eslint . --rule '{"@typescript-eslint/no-unused-vars":"error","prefer-const":"error"}'` reports **zero** errors.
- **AC:** AC-002.

### Task 9 — Resolve the 3 ESLint warnings (so `--max-warnings=0` passes)
- **Warnings (Task 0 baseline, F-4):** 2× `react-hooks/exhaustive-deps`, 1× `react-refresh/only-export-components`.
- **`react-hooks/exhaustive-deps` — `ProjectDetails.tsx` Gantt effect (`useLayoutEffect`, lines 714–750):** the effect calls `getDateLeft` (defined line 708) and uses `dayWidth`, but the dep array (line 750) is `[sortedTasks, minDate, dayWidth]`, omitting `getDateLeft`. Fix **without changing behavior** by memoizing `getDateLeft` and adding it to deps:
  - Wrap the `getDateLeft` declaration (lines 708–712) in `useCallback`:
    ```tsx
    const getDateLeft = useCallback((dateStr: string) => {
        const date = new Date(dateStr);
        const diff = Math.ceil((date.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
        return diff * dayWidth;
    }, [minDate, dayWidth]);
    ```
  - Change the effect dep array (line 750) from `[sortedTasks, minDate, dayWidth]` to `[sortedTasks, getDateLeft]` (`getDateLeft` already closes over `minDate`/`dayWidth`).
  - Add `useCallback` to the React import (line 2): `import React, { useState, useMemo, useRef, useLayoutEffect, useCallback } from 'react';`.
- **Second `exhaustive-deps`** (per F-4, the Timesheets effect): in the file/effect ESLint flags (`pages/Timesheets.tsx`), add the genuinely-missing dependency to the dep array **only if** adding it does not change the existing run cadence; if it would (an intentional run-once mount effect), add a line-scoped `// eslint-disable-next-line react-hooks/exhaustive-deps` immediately above the dep array with a one-line comment stating why the omission is intentional. Decide by inspecting the effect at Task 0; behavior must not change.
- **`react-refresh/only-export-components`:** the flagged module exports a non-component alongside components (e.g. a context or constant). Fix by moving the non-component export to its own module **only if trivial**; otherwise the rule permits constant exports (`allowConstantExport: true`, `eslint.config.js:24`) — if it is a `const`, no change is needed and the warning will not fire. If it is the `UserContext`/`UserProvider` pairing in `context/UserContext.tsx`, add `// eslint-disable-next-line react-refresh/only-export-components` above the non-component export with a justifying comment (HMR-only lint; no runtime effect). Behavior unchanged.
- **Verify:** `cd pmo-portal && npm run lint:ci` exits 0 (zero errors **and** zero warnings).
- **AC:** AC-002.

---

## D. Regression gates + CI flip — AC-001, AC-004, AC-006

### Task 10 — Full local gate (typecheck + unit + build + render smoke)
- **Action:** no edits; run the full quality gate after Tasks 1–9.
- **Verify (all must pass):**
  - `cd pmo-portal && npm run typecheck` → exits 0 (**AC-001**).
  - `cd pmo-portal && npm test` → all Vitest suites pass, including `test/render.test.tsx`, `test/smoke.test.ts`, and the new `test/project-details-hooks.test.tsx` (**AC-004**, **AC-005**).
  - `cd pmo-portal && npm run build` → succeeds, no `/index.css` warning (**AC-003**).
- **AC:** AC-001, AC-004, AC-005.

### Task 11 — Flip CI lint to blocking
- **File:** `.github/workflows/ci.yml`. Replace the informational lint step (lines 28–32):
  ```yaml
      # Lint is non-blocking until the legacy-cleanup issue lands, then switch to `npm run lint:ci`.
      - name: Lint (informational)
        run: npm run lint
        continue-on-error: true
  ```
  with the blocking step:
  ```yaml
      - name: Lint
        run: npm run lint:ci
  ```
- **Verify:** `grep -q 'npm run lint:ci' .github/workflows/ci.yml && ! grep -q 'continue-on-error' .github/workflows/ci.yml && echo ci-blocking` prints `ci-blocking`.
- **AC:** AC-006.

---

## Task → AC traceability

| Task | What | AC |
|---|---|---|
| 0 | Capture lint baseline | (enables AC-002) |
| 1 | Add Tailwind v4 devDeps | AC-003 |
| 2 | Register `@tailwindcss/vite` plugin | AC-003 |
| 3 | `index.css` entry + ported `primary` palette | AC-003 (→AC-004) |
| 4 | Import CSS in `index.tsx` | AC-003, AC-004 |
| 5 | Strip CDN/importmap/`/index.css`, delete `metadata.json` | AC-003 |
| 6 | RED: ProjectDetails hooks-order test | AC-005 |
| 7 | GREEN: hoist hooks above guard | AC-005 |
| 8 | Remove unused imports/vars, `prefer-const` | AC-002 |
| 9 | Resolve 3 lint warnings | AC-002 |
| 10 | Full local gate (typecheck/test/build) | AC-001, AC-004, AC-005 |
| 11 | CI lint → blocking | AC-006 |

**Task count: 12 (Task 0 pre-flight + Tasks 1–11).**

---

## Scope guard (explicitly OUT — later issues)

No Supabase / TanStack Query, no `src/` layout migration, no `BrowserRouter` swap (URLs unchanged this
issue), no de-O&G schema/seed changes, no `ProjectDetails` decomposition, no `manualChunks`/route lazy,
no new screens, no feature/behavior changes. The CSS entry intentionally lands at `pmo-portal/index.css`
(package root) — relocating it to `src/index.css` happens in the Phase-1 `src/` migration issue.

## Architecture / scaling notes (planner lenses)

- **Existing-repo / behavior-preserving:** every change here is config, dead-symbol removal, a CSS-pipeline
  swap, and one hooks-order fix. No data flow, routing, or rendering semantics change. The ported `primary`
  palette is byte-identical to the prototype's inline config, so the visual output is unchanged.
- **Performance (forward seam):** moving Tailwind off the CDN means the build now emits purged, cacheable
  CSS (kills a render-blocking network dependency and ships only used utilities) — the prerequisite for the
  Phase-1 `manualChunks` / route-lazy work that breaks the 804 KB bundle (`F-3`, §11). No bundle-splitting
  is done here.
- **Token seam:** the `@theme` block is the single source for design tokens, ready for the Phase-3 design
  system to extend without touching components (`§10`).

## Open questions for the Director (non-blocking)

1. **Pre-enumerate the 21 lint errors?** This plan makes ESLint output the authoritative work list (Tasks
   8–9) rather than hard-coding 21 fragile line numbers that would drift after the F-1 reorder and CSS
   import. If the Director wants every diagnostic line-itemized in the plan, the implementer should paste
   `npm run lint` output back and I will expand Tasks 8–9 into one sub-task per diagnostic. **Recommendation:
   keep as-is** — the per-rule transforms are deterministic and the `lint:ci` gate is exact.
2. **Tailwind v4 pin:** plan pins `^4.1.0` for `tailwindcss` + `@tailwindcss/vite`. Confirm pinning to a
   specific patch is not required by house policy (lockfile already gives reproducibility).
3. **CSS location:** confirmed at `pmo-portal/index.css` (package root) to avoid an early `src/` migration;
   ADR-0004 illustratively said `src/index.css`. Recorded as **ADR-0007** (companion). If the Director
   prefers to do the `src/` move now, that expands scope into Phase 1.
