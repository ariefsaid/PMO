# Purpose and structure — preliminary, source inspection only

- Executive dashboard: an executive identifies business and project risks and what needs a decision. Obviousness not yet judged in a render. Sketch: delivery and decisions → business position → projects.
- Management pack: an executive reads and exports the month's management figures. Obviousness not yet judged. Sketch: period and actions → figures and project rows → monthly totals.
- Financial statements: finance reads the selected financial statement for a period. Obviousness not yet judged. Sketch: statement and period → statement rows → details and export.
- Journals: finance finds and checks a journal. Obviousness not yet judged. Sketch: search and actions → journal rows → record.
- Incoming payments: finance finds a receipt and checks its invoice applications. Obviousness not yet judged. Sketch: search and actions → payments → receipt drawer and invoice links.
- ERP purchases: purchasing finds unmatched ERP purchases. Obviousness not yet judged. Sketch: redirect → procurement orphan workspace.
- Budget projection: a project controller compares approved budget and projected spending. Obviousness not yet judged. Sketch: period → category comparison → records and notes.
- Project budget: a project controller compares budget, commitments and actual spending and manages versions. Obviousness not yet judged. Sketch: decision notices → position → category comparison → versions.

All purpose and structure lines are provisional; no screen was rendered, so whether its purpose is the most obvious thing is unknown.

## Changes and evidence

The management pack now places the project table ahead of charts at every width and ahead of summary figures on phones. Its figures, filters, exports and row actions remain present. Incoming payment cards show received and total amounts on separate lines for long currency values. No shared component, data call, permission, test or journey was changed. No sample records or screenshots were created. The rendered feature floor and visual proof remain outstanding.

| Measured edge | Before | After |
| --- | --- | --- |
| Page and panel left edges, figure right edges, row baselines and gaps | Not measured | Not measured |

Screenshot paths: none. Required English and Bahasa captures, widths and states remain outstanding.

## Skill lines considered

- Restructure: “Freeze the feature floor before any edit; simplification cannot silently remove a figure, capability or safeguard.” Existing figures and actions were retained in the two source changes; the rendered floor is outstanding.
- Taste, app screens: “Tables are rules and alignment. No zebra striping, no header bands, numbers right-aligned.” The management pack table was prioritized in source; it was not inspected in a render.
- Impeccable: “Verify by looking at the rendered result at the sizes it ships at.” The context launcher failed because its cache location was not writable; no rendered critique was possible.
- UI/UX Pro Max: “Min size 44×44px” for touch and interaction. No touch targets were verified.

The skill-vendoring script stopped at a missing upstream directory before installing the UI skills; the relevant source guidance was read separately. The changes follow the screen rules and the available restructure guidance; the absent skills were not applied in this continuation.

## Journeys and gates

- Integration branch fetched and merged: already up to date.
- `npm ci`: passed after using a writable npm cache. The lockfile was not changed.
- `npm run check:guards`: failed after the latest integration merge at the English i18n gate: two missing and two orphaned catalogue entries in other screens. The prior baseline passed before that merge.
- `npm run typecheck`: passed after the integration merge.
- ESLint on the two changed files: passed.
- Affected-journey discovery: completed; journeys could not run without the stack.
- Journeys, UX proof and role-based walks: not run; the local stack did not start.
- Related tests: Node 24 attempt failed before tests because Node 22 is required; Node 22 retry: 37 files passed, one shell integration file failed three tests because its render lacked an impersonation provider (513 passed, 3 failed).
- Stack: after the requested Docker cleanup, two lean-start attempts reached database initialization but Docker Hub rate-limited the required image. The database reset and required local journey were not run. `/opt/pw-browsers` is absent; system Chromium is available.

## Owner to confirm

The management pack charts moved below the project table at desktop widths, and its summary figures moved below the table on phones. Payment-card figures were split over lines. These choices and the provisional purposes need confirmation against live screens.

## Needs a data change

None identified; data sufficiency was not assessed in a running app.

## Not reached

Six screens have not been changed; both changed screens still need a full rendered review. Complete feature floors, before/after captures and measurements, three render-and-fix rounds, role and language walks, journeys, UX proof and READY remain outstanding. A usable local stack is needed to continue.
