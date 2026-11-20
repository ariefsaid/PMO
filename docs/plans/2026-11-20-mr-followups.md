# Plan: material request follow-ups (#2571)

Spec: `docs/specs/material-requests.spec.md` (FR-MRQ-020, FR-MRQ-021; AC-MRQ-020, AC-MRQ-021). No migrations.

## Tasks
1. Test first (red): `pages/MaterialRequestNew.test.tsx` pins the default needed-by across the UTC/organisation-day boundary with a faked clock (23:30 UTC, UTC+7 and UTC-8) and the saved draft payload. `pages/MaterialRequestSettings.test.tsx` checks an Engineer does not see the cut-off control and an Admin does.
2. `pages/MaterialRequestNew.tsx`: read the organisation time zone with `useOrgFxContext`, take today from `useOrgToday(zone)`, default needed-by to `addDays(today, 1)` and set the date field's minimum to that today. No new time-zone conversion code.
3. `pages/MaterialRequestSettings.tsx`: wrap the whole cut-off section in `<CanWrite entity="approvalChain" action="manage">`. That rule is Admin only, the same as the `mrq_set_cutoff` database function, so the front end is not looser than the database.
4. No new strings: English and Bahasa Indonesia keys are unchanged.

## Verify
`npm run check:guards`, `npm run typecheck`, eslint on the touched files, `npx vitest related --run` on the touched sources. The database and browser suites are unchanged by this work.
