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

No screen, shared component, data call, permission, test, or journey was changed. No sample records were created. No screenshots were captured. The work branch contains the integration baseline only. The screen-owner brief requires looking before touching and a rendered feature floor; those steps could not be completed.

| Measured edge | Before | After |
| --- | --- | --- |
| Page and panel left edges, figure right edges, row baselines and gaps | Not measured | Not measured |

Screenshot paths: none. Required English and Bahasa captures, widths and states remain outstanding.

## Skill lines considered

- Restructure: “Freeze the feature floor before any edit; simplification cannot silently remove a figure, capability or safeguard.” Source inventory began, but the render and complete floor are outstanding; no edit was made.
- Taste, app screens: “Tables are rules and alignment. No zebra striping, no header bands, numbers right-aligned.” No rendered table was inspected or changed.
- Impeccable: “Verify by looking at the rendered result at the sizes it ships at.” The context launcher failed because its cache location was not writable; no rendered critique was possible.
- UI/UX Pro Max: “Min size 44×44px” for touch and interaction. No touch targets were verified.

The skill-vendoring script stopped at a missing upstream directory before installing the UI skills; the relevant source guidance was read separately. No skill-driven design changes are claimed.

## Journeys and gates

- Integration branch fetched and merged: already up to date.
- `npm ci`: passed after using a writable npm cache. The lockfile was not changed.
- `npm run check:guards`: passed after fetching the missing `origin/dev` reference. Its first run stopped at the layout-baseline check for that missing reference.
- `npm run typecheck`: passed.
- ESLint, related tests, affected journeys, UX proof and role-based walks: not run; no source files changed and the local stack did not start.
- Stack: the requested CLI initially failed trying to write its configuration into the read-only home directory. A containerized retry pulled service images, but the rootless Docker `vfs` driver expanded the PostgreSQL layers until available disk fell to about 12 GB; the pull was stopped to protect the workspace. The database reset and the required local journey were not run. `/opt/pw-browsers` is absent.

## Owner to confirm

No moves, renames, merges or removals were made. The preliminary purposes and sketches need confirmation against the live screens.

## Needs a data change

None identified; data sufficiency was not assessed in a running app.

## Not reached

All eight screen reviews and implementations, the complete feature floors, before/after captures and measurements, three render-and-fix rounds, role and language walks, journey and UX proof, and READY. A viable local stack with sufficient Docker storage and the requested Playwright browsers is needed to continue.
