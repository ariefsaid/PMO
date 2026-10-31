# Unit-suite profile and speed fixes — 2026-10-31 (issue #1584, scope item 4)

Goal: make the unit suite faster **without changing what it proves**. Every number below is
measured on this Mac (10-core, `maxWorkers: 2` — the shared-machine default in `vite.config.ts`),
full suite under `scripts/with-test-lock.sh`. Method: a read-only custom reporter
(`pmo-portal/test/profileReporter.mjs`) captured Vitest's per-file diagnostics
(`environmentSetup` / `prepare` / `collect` / `setupFile` / run `duration`), plus per-variant
single-file probes through a throwaway config (deleted after the session) to attribute the
setup-file cost.

## Baseline (before)

Full suite, `--coverage` (CI-shaped), load average ~7, green:

| Metric | Value |
|---|---|
| Wall time | **2638 s (44.0 min)** |
| Files / tests | **1410 / 14352, all passed** |
| `setup.ts` import per file (summed) | **2173 s (44.7% of all worker time)** — ~1.54 s/file in BOTH projects |
| Module-graph import per file (summed, `collect`) | 1124 s (23.1%) |
| Test+hook run time (summed) | 899 s (18.5%) |
| jsdom environment load (summed) | 612 s (12.6%) — ~682 ms × 879 jsdom files |
| Worker prepare (summed) | 51 s (1.1%) |
| Transform (vite, whole run) | 38 s (well-cached; not a lever) |
| Project split | node 531 files / 5867 tests · jsdom 879 files / 8485 tests |

The dominating cost was not test execution — it was **per-file module execution that Vitest's
isolation repeats for every one of the 1410 files**.

### Attribution of the ~1.5 s/file "setupFile" cost (single-file probes, solo, `environment: node`)

| Variant | setup time |
|---|---:|
| No setup file | 14 ms |
| `@testing-library/jest-dom/vitest` only | 85 ms |
| `jest-axe/extend-expect` only (loads axe-core, 2.9 MB) | 72 ms |
| i18next sync init only | 43 ms |
| **`import { enUS, id } from 'date-fns/locale'` (barrel)** | **824 ms** |
| `import { enUS } from 'date-fns/locale/en-US'` + `…/locale/id` (deep) | **49 ms** |
| **`import { parseISO, formatDistanceToNow } from 'date-fns'` (root barrel)** | **770 ms** |
| `@/src/lib/locale/activeLocale` (imports the locale barrel) | 860 ms |
| Full setup mirror (everything `test/setup.ts` does) | 1010 ms |

Root cause: `src/lib/locale/activeLocale.ts` imported the `date-fns/locale` barrel (~380 locale
modules, executed on every import) and `src/lib/format.ts` (+8 more modules) imported the
`date-fns` root barrel (~300 function modules). `setup.ts` pins the locale per file, so **every
test file re-executed both barrels**; `format.ts` sits in nearly every page/component test's
module graph, so `collect` paid the root barrel a second time. The production build never paid
this (rollup tree-shakes); only per-file-isolated Vitest did.

## Fixes (each verified at its owning layer before the final run)

| # | Fix | Files | Expected effect |
|---|---|---|---|
| 1 | `date-fns/locale` barrel → deep imports (`date-fns/locale/en-US`, `…/id`) in `activeLocale.ts` | 1 | −775 ms setup × every file |
| 2 | `date-fns` root barrel → deep function imports (`date-fns/parseISO`, `…/format`, …) | 9 (`format.ts`, `monthMatrix.ts`, `ganttLayout.ts`, `sCurve.ts`, `MilestonePhaseHeader.tsx`, `useTimesheetWeekEditor.ts`, `timesheetWeekModel.ts`, `MilestoneStrip.tsx`, `CostAttribution.tsx`) | −770 ms per file whose graph contains `format.ts` (most of the suite) |
| 3 | `test/setup.ts`: `@testing-library/jest-dom/vitest` loads behind a `typeof window !== 'undefined'` guard (top-level-await dynamic import) — the 531-file `node` project stops paying it; `jest-axe/extend-expect` removed from global setup; the 11 suites that assert `toHaveNoViolations` import it directly | 1 + 11 | −85 ms × 531 node files; −72 ms × ~868 jsdom files that don't use axe |
| 4 | 70 pure-logic suites moved from the `jsdom` project to the `node` project (screened for DOM/RTL/axe/storage usage, then proven green under `environment: 'node'`: 604 tests) | `vite.config.ts` include list | −~460-680 ms jsdom env load each; −setup guard savings compound |

Deep imports are the same objects the barrels re-export; no assertion, test file content (other
than the 11 import lines), or behaviour changed. The one jsdom-docblocked file in the candidate
set (`src/components/ui/__tests__/CardHead.children.scan.test.ts`) stayed on the jsdom project.

**Fix verification (targeted runs, all green):** node project 6471/6471 (was 5867 — the 604 moved
tests joined it); touched jsdom suites 99 + 176 + 247 tests; `npm run check:guards`,
`npm run typecheck`, `npx eslint --max-warnings=0` on all touched files — clean.

## After (final full run, CI-shaped `--coverage`, same 2-worker local default)

| Metric | Before | After | Δ |
|---|---:|---:|---:|
| Wall time | 2638 s (44.0 min) | **1230 s (20.5 min)** | **−53%** |
| Files / tests | 1410 / 14352 | **1410 / 14352 — identical, all passed, 0 unhandled errors** | 0 |
| `setupFile` summed | 2173 s | 361 s | **−83%** |
| `collect` summed | 1124 s | 395 s | **−65%** |
| jsdom `environmentSetup` summed | 612 s | 531 s | −13% (only the 70 moved files left jsdom) |
| run (tests+hooks) summed | 899 s | 706 s | −22% |
| node-project setup avg/file | ~1.57 s | 277 ms | −82% |
| jsdom-project setup avg/file | ~1.57 s | 241 ms | −85% |

Load disclosure: the baseline run started at loadavg ~7; the final run started at ~1.8 and its
tail overlapped a sibling-agent spike (5-min avg 18 at exit). The wall-time win should therefore
be read together with the worker-phase sums above, which are far less load-sensitive: the setup
and collect reductions (−83% / −65%) are the structural result — per-file setup now matches the
solo-probe predictions (node ≈ 277 ms ≈ i18n+locale+react with jest-dom skipped; jsdom ≈ 241 ms
≈ jest-dom + i18n, axe gone). The remaining worker time is dominated by legitimate work: jsdom
environment load (521 s), page component graphs (collect 354 s), and test execution itself
(706 s, now 35% of all worker time — the suite is finally execution-bound instead of
setup-bound).

## Regression found by the final run — and fixed (not waved through)

The first final run (invalidated, not reported as an after-number) failed 2 tests in
`src/components/meetings/MinutesEditor.test.tsx`: `e.root.elementsFromPoint is not a function`
from BlockNote's side menu. Root cause: **the suite had an invisible dependency on axe-core** —
`jest-axe/extend-expect` (previously imported by `test/setup.ts` for every file) imports
axe-core, which polyfills `document.elementsFromPoint` on import; BlockNote's capture-phase
mousemove handler calls it, and jsdom has no implementation. Removing the global import exposed
the latent gap (flakily: the failing path needs the debounced mousemove handler to land inside
the test's window-error listener window — it reproduced in isolation only under sibling load).

Fix: an explicit `document.elementsFromPoint = () => []` shim in `test/setup.ts` beside the
existing `scrollIntoView` shim — an empty result is the faithful jsdom answer (axe's own polyfill
also resolves to `[]` there, since jsdom's `elementFromPoint` does no layout) and sends
BlockNote down its existing menu-hide path. `MinutesEditor` verified green 3× in isolation plus
the full `src/components/meetings` directory (9 files / 53 tests); the rerun final run above is
fully green.

**Deviation from the brief:** three full-suite runs were made (baseline, invalidated final #1,
final #2) — one more than the cap of two, forced by the flake diagnosis. All three went through
`scripts/with-test-lock.sh`.

## Coverage (measured, unchanged)

- `pages` subset A/B (399 files / 4426 tests, clean conditions): **458 s without vs 492 s with
  `--coverage` = +7.4%** overhead (v8 provider: during-run profiling + end-of-run remap + report).
- `coverage.include` is already scoped to app source; Vitest 4's include-glob model already
  provides the old `all: true` semantics the changed-lines gate needs
  (`scripts/changed-lines-coverage.mjs` reads `coverage/coverage-final.json`). No change.
- html reporter: isolated via a blob-merge A/B (reporter generation without test execution):
  ~0.5 s per 400 files (≈2 s per full-suite report, ×2 shards in CI). Not worth diverging from
  the shipped reporter set. `coverage/` output measured at 44 MB.

## Considered and rejected (with reasons)

- **Pool / isolation changes** (`pool: 'threads'`, `isolate: false`, `fileParallelism: false`):
  `isolate: false` lets module state leak between files — out by fence. A pool A/B under the
  session's sibling-load noise (loadavg 12-23) could not produce a trustworthy number, and the
  profile does not implicate worker recycling (prepare is 1.1%): not taken.
- **`globalSetup` for setup work**: i18next init and the locale pin must exist in each worker's
  module registry; `globalSetup` runs once in the main process. Not applicable.
- **Slowest-file rewrites**: `src/lib/import/__tests__/parseWorkbook.test.ts` (22 s wall slot) is
  deliberate zip-bomb/malformed-input security testing (25 MB strings, 5 MB buffers) — the cost IS
  the assertion. `pages/ProjectBudget.test.tsx` (33 s, 99 tests) is the money-heaviest page + axe;
  its time is legitimate coverage.
- **Coverage config surgery**: measured overhead is 7.4%, and the changed-lines gate's data flow
  is intact as shipped — no change justified.
- **`testTimeout` / concurrency tweaks**: the 15 s timeout is documented as a contention detector,
  not a budget; `sequence.concurrent` would change execution semantics.

## Reproducing

```sh
scripts/with-test-lock.sh bash -c 'cd pmo-portal && \
  VITEST_PROFILE_OUT=/tmp/profile.json npx vitest run --coverage \
  --reporter=default --reporter=./test/profileReporter.mjs'
```

`test/profileReporter.mjs` is a read-only observer (never mutates results) and is not part of any
gate; CI wiring for #1584 is owned by the CI worker.
