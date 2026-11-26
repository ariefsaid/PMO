# Lists, create and print — partial report

## Purpose and structure

- Work orders: a project manager finds and opens an order; on the old phone screen, summary figures obscured the first row. Structure: header → summary → filters → order register → scoped project panels.
  Sketch: `[Work orders | New] [Summary ▸] [Filters] [Order rows]` on phone; desktop puts exception counts ahead of separate money figures.
- New project: a project manager enters a project and saves it; the phone baseline obscured the footer behind navigation. Structure: identity and customer → manager and references → stage and classification → dates → actions.
  Sketch: `[New project] [Fields …] [Cancel | Create] [Navigation]`.
- Purchase order print: a buyer prints the supplier order and collector authority. Structure: document identity and supplier → collector → items and total → signatures. Its prominence has not been judged in a render.
  Sketch: `[Order / supplier] [Collector] [Items / total] [Signatures]`.
- Delivery note print: a storekeeper prints items and destination for delivery and receipt signatures. Structure: identity and destination → items and quantities → signatures. Its prominence has not been judged in a render.
  Sketch: `[Note / destination] [Items / quantity] [Dispatch | Delivery | Receipt]`.
- Safety summary: a project manager finds monthly safety exceptions and opens records. Skipped after the integration branch acquired the site-and-field owner's recomposition.
- Your tasks: an assignee finds and updates assigned work. Skipped: the home-and-lists owner recomposed this screen in this round.
- Approvals: an approver finds and clears waiting decisions. Skipped: the home-and-lists owner recomposed this screen in this round.
- Transfer print: a storekeeper prints a stock move for signatures. Skipped: the stock owner recomposed it in commit `773f3c920`.

## Changes and limits

- Work orders: separate exception counts from money; place the summary behind a disclosure on phones so rows appear sooner. All figures and filter actions remain present. The full row → drawer → full-page flow and desktop table overflow were not recomposed.
- New project: use the existing shared form footer in the page branch so its offset accounts for phone navigation. The two edit-dialog callers remain on the modal branch. This is not a whole-form recomposition and has no after render.
- Purchase order and delivery note: localize the document number label and fallback signature titles; format delivery-note quantities in the active number locale. Configured signature blocks are preserved. These are source-only fixes, not complete print recompositions.
- The safety changes initially made here were reverted after the other owner's work appeared on integration; their version is retained.
- No schema, RPC, repository or permission changes. No test or journey steps were changed.

## Measured edges

Screenshot pixel sampling of the work-order list's left painted frame, in px (header and project-name areas masked):

| Viewport | Before x | After x |
| --- | ---: | ---: |
| 1440 | 248 | 248 |
| 1024 | 248 | 248 |
| 390 | 16 | 16 |

These samples do not establish text baselines, figure right edges, equal gaps, or all-state alignment; those measurements remain outstanding. Print and project footer measurements are not available.

## Captures

`ux-shots/lists-create-print/workorder-{before,after}-{en,id}-{1440,1024,390}.png` — populated list, project-manager role, summary closed on phone. The shell header and project values are masked to avoid publishing names. The sample work order was created through the Admin form using a seeded project and a long order value. The local database reset later removed it. Captures use system Chromium, not the requested pinned browser. They do not cover 1920, expanded summary, menus, errors, loading, empty states, long rupiah, or print views. `ux-shots/lists-create-print/project-before-{1440,1024,390}.png` are English only; no project after capture exists.

## Skill lines applied

- Restructure: “Freeze the feature floor before any edit; simplification cannot silently remove a figure, capability or safeguard.” Figures and actions were kept; a full floor reconciliation remains open.
- Taste app screens: “the product's real data, a screen that answers its one question first” guided the phone list-first decision. The complete taste inspector was not run.
- Impeccable craft floor: “Plus real content, working controls, responsive composition, keyboard focus.” Shared controls were retained; the critique engine did not complete a proof of these screens.
- UI UX Pro Max: “Min size 44×44px” guided the disclosure target. A complete touch audit remains open. Screen rules took precedence where guidance differed.

## Checks and journeys

- Initial lean stack and local reset: passed before integration; system Chromium substituted because `/opt/pw-browsers` lacked the required revision and the download endpoint returned 403.
- `AC-WOD-008`: 11 passed including setup before the final integration merge; not a post-merge result.
- Safety affected set: 15 passed including setup before the safety changes were withdrawn; not proof of the final owned changes.
- Print page unit tests: 13 passed. Project form/new-project targeted unit tests: 25 passed.
- ESLint on four changed source files: passed. Node 22 `npm run typecheck`: passed after the final source change.
- `npm run check:guards`: failed on the merged integration branch's i18n completeness issues in the task toolbar and approvals, before completing the full suite.
- The related run for the work-order source before the final project edit: 35 files passed, 3 failed; 466 tests passed, 5 failed in administration, project-detail and command-palette tests. The final all-source related run failed: 78 files and 834 tests passed; 2 files and 4 tests failed in project-detail and command-palette tests.
- Affected selector on the earlier work-order-only diff chose 189 specs, including the work-order dashboard and creation journeys. Required post-merge journeys were not run: two resets stalled in schema initialization, leaving an unseeded database.
- `ux-proof` did not complete: the initial safety invocation lacked the critique engine; that screen was later skipped. Final owned routes were not proved after the reset failures.

## Owner to confirm

- Work-order exception counts move ahead of financial figures; on phone the summary is initially closed. No before/after crop of the open disclosure is available.
- New-project actions move above phone navigation via the shared footer. The intended result has not been rendered after the change.
- Print fallback labels now follow the active locale; configured signature text is unchanged. Printed paper and custom configurations remain to be checked.

## Needs a data change

None identified. The incomplete work has not been established to require one.

## Not completed

- Whole-screen recomposition and drawer flow for work orders; desktop table overflow, all role/state captures and long-rupiah validation.
- Whole-screen new-project composition, after captures and role journeys.
- Purchase-order and delivery-note compositions, one-page black-and-white paper proof, role journeys and before/after captures.
- Final rendered proof, complete related test suite, affected journeys and all required gates. This branch is **not READY**.
