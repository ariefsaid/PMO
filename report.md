# ui-prove report

Environment: Docker started by hand, Supabase local (analytics/vector/studio/realtime/mailpit/imgproxy excluded), `db reset` before each branch, Playwright chromium, `CI=true`. Each branch merged with origin/dev on a local branch. No work branch changed.

Environment limits: mailpit excluded, so the two Mailpit specs fail on every branch. `AC-S21-005` fails with `S21_HANDLER_SERVER_EXITED_EARLY` (support/AC-S21-005-runtime.mjs:18) on every branch and on dev. The `ux-proof` "missing shrink-only target baseline" lines are noise from the sandbox seed and are omitted. Rich seed is the standard local seed.

Baseline on origin/dev (the 23 specs that failed on the links branch, rerun on dev): 20 passed. Failing on dev: `AC-S21-005`, `AC-AUTH-005`, `AC-AUTHF-005-password-reset` (env).

## Summary

| Branch | typecheck | check:guards | affected e2e (198 specs) | ux-proof vs dev |
|---|---|---|---|---|
| land/2077-links-are-links | pass | pass | **FAIL: 24 specs red, reproducible, pass on dev** | 2 findings fewer than dev; nothing new |
| fix/uat-materials | pass | pass | only the 3 dev-baseline env failures | identical to dev |
| fix/uat-admin | pass | pass | only the 3 dev-baseline env failures | identical to dev |

## 1. land/2077-links-are-links

Run 1: chromium 339 passed / 22 failed / 10 skipped / 2 did not run; serial 35 passed / 5 failed / 22 skipped.
Rerun of those 23 failing spec files on this branch, and on origin/dev, to separate real from flaky:
- On the branch: chromium 22 of 22 still red (including `AC-S21-005`); serial 3 red beyond the env ones.
- On origin/dev: all pass except `AC-S21-005`, `AC-AUTH-005`, `AC-AUTHF-005`.
So the following 24 specs fail on the branch only (they pass on dev). Not patched.

Representative error (AC-CODE-003, line 44 of the spec):
`expect(locator).toBeVisible() failed` — Locator `getByTestId('projects-table-container').getByRole('listitem').filter({ has: getByRole('button', { name: '<project>', exact: true }) })`, element(s) not found, 15s.
`AC-1011` fails the same way: `getByRole('listitem').filter({ has: getByRole('button', { name: 'Eastgate Depot Upgrade', exact: true }) })` not found.
Likely cause (inferred from these two, not confirmed for every spec): the branch turns the row-open control from a button into a link; the e2e specs were not updated (the branch diff touches no `e2e/` file), so locators on `button` + name no longer match, and later steps time out at 30s/120s/180s.

Failing specs (chromium): AC-CODE-003, AC-DEL-022, AC-EXP-070 (timeout 120s), AC-IMP-011, AC-IXD-PROJ-001, AC-LRC-003, AC-LRC-006, AC-LRC-007, AC-S29-005, AC-SHELL-002 ×4 (Budget tab, overview, /documents, /expenses; timeout 30s), AC-SIL-010 (120s), AC-SIL-014 (180s), AC-TM-018-toast-clears-phone-drawer-header (30s), JOB-E1, JOB-F17, JOB-F19, notice-never-blocks-the-control ×2 (1280×720 and 390×844).
Failing specs (serial): AC-1011, AC-LRC-013, AC-PRJ-006.
Fails on dev too (env, not branch): AC-S21-005, AC-AUTH-005, AC-AUTHF-005.

ux-proof routes: /projects /companies /contacts /incidents /meetings /procurement /stock /expenses /imprest /equipment/assets (390 and 1440).
- Findings present on both dev and branch: /contacts@390, /meetings@390 word count; /incidents@1440, /stock@1440, /expenses@1440, /imprest@1440 word counts; /procurement@390 `smallTargetCount=25`; R5 sharedEnds warnings on /projects@1440. impeccable 0 and axe 0 on every route on both.
- Only on dev (branch fixes them): /projects@1440 `layoutFingerprints=1 not in the baseline`; /projects@1440 rowCentre figure "$5,000,000" and action centres differ by 24px.
- New on the branch: none.

Rendered screenshots (local only, not committed), `docs/private/ux-shots/` in the sandbox, 40 png each (light/dark × 390/1440 per route):
- Before (origin/dev): `links-before/<route>-<width>-<theme>.png`
- After: `links-after/<route>-<width>-<theme>.png`
- Routes: projects, companies, contacts, incidents, meetings, procurement, stock, expenses, imprest, equipment-assets.

## 2. fix/uat-materials

Migrations 1100–1102 applied by `db reset`. Affected e2e: chromium 359 passed / 1 failed / 10 skipped / 2 did not run; serial 38 passed / 2 failed / 22 skipped. Failures are exactly `AC-S21-005`, `AC-AUTH-005`, `AC-AUTHF-005` (all fail on dev too, env).
ux-proof /material-requests /material-requests/new /stock: output identical to dev. Findings on both: /material-requests@1440 `layoutFingerprints=1 not in the baseline`, taste panel-void (58px blank band in "Nothing is waiting for you"), /stock@1440 word count 20 vs 19. impeccable 0, axe 0.

## 3. fix/uat-admin

Migration 1105 applied. Affected e2e: chromium 358 passed / 1 failed / 10 skipped / 2 did not run; serial 39 passed / 2 failed / 22 skipped. Failures: the same three env specs, all failing on dev too.
ux-proof /administration /incidents /equipment/expiring /equipment/assets /master-data/document-types: identical to dev. Only finding: /incidents@1440 word count 18 vs 15, on dev too. impeccable 0, axe 0.

DONE: ui-prove
