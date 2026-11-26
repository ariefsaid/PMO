# Meetings and views — partial

The meeting action-item section has been changed and pushed; the screen as a whole is not ready without rendered review. The work branch was merged with the integration branch before the final checks. The notes below are source-based purposes, not rendered judgements. Whether each purpose is the most obvious thing on screen is **unverified**.

## Purpose and structure

- Meetings list: find and open a meeting. `[title + create] → [search / project / archive] → [meeting rows]`. Obviousness unverified.
- New meeting: record a meeting and its minutes. `[details] → [minutes] → [attendees] → [save]`. Obviousness unverified.
- Meeting page: record minutes and follow actions. `[meeting facts] → [minutes] → [action items] → [attendees] → [sharing]`. Obviousness unverified.
- Calendar: see dated tasks and phases by day and open the work. `[month controls] → [calendar] → [dated item]`. Obviousness unverified.
- Activity controls: edit an activity or load more of its timeline. `[activity fields / save]` and `[show more]` inside their existing callers. Obviousness unverified.
- Saved views list: find and reopen or manage a saved view. `[title + create] → [view rows / actions]`. Obviousness unverified.
- View builder: define and save a reusable view. `[view details] → [panels] → [preview] → [save]`. Obviousness unverified.
- Rendered view: inspect the saved view's current data. `[view title] → [configured panels]`. Obviousness unverified.

Meeting action items now use a table with aligned action, status, owner and due-date columns. The task link, status, owner, due date and unassigned message remain in the same section; the table scrolls within its frame on narrow screens. This is source-reviewed only and needs rendered review. The test that expected an inline owner label now checks the owner heading and value.

## Evidence and checks

| Item | Result |
| --- | --- |
| Branch and identity | Work branch created from the requested integration branch; identity configured before any commit. Integration branch fetched and fast-forwarded before push. |
| Dependency install | `npm ci` completed before the final integration check. No lockfile change. |
| Skill vendoring | Earlier vendoring failed on a missing upstream directory. Restructure was read locally; impeccable and taste were recovered separately in the earlier attempt, but their repository skill files are absent. |
| Local stack | The original start failed on the read-only home. Containerized retries exhausted Docker VFS storage. After the authorized prune, the lean retry failed with Docker Hub's unauthenticated pull rate limit. The database was not initialized. |
| Reset, seed, journeys | Not run: no initialized stack. No sample records created. |
| Before / after captures and measured edges | Not available: no authenticated seeded render. Measurements and screenshot paths are unavailable. |
| ESLint | Passed on the two touched files. |
| Typecheck | Passed. |
| Meeting detail tests | Passed: 55 tests, Node 22. The old inline-owner assertion was updated for the table heading and value. |
| Related tests | Failed: 251 passed, 3 failed in shell command-palette integration, reporting a missing impersonation provider. |
| Guards | Failed at i18n completeness; the introduced missing status key was fixed by reusing an existing translation. A rerun still reported unrelated missing and orphaned keys. Later guards did not run. |
| UX proof and journeys | Not run: the seeded stack and authenticated captures were unavailable. |
| Impeccable critique and taste inspector | Not run on a rendered result. |

## Skill lines used in the investigation

- Restructure: “Freeze the feature floor before any edit; simplification cannot silently remove a figure, capability or safeguard.” The action-item fields and other meeting-page sections were recorded before any edit.
- Taste app screens: “Tables become lists of two-line rows below about 640px” with fields moved, never dropped. This is a candidate constraint for a future phone composition; no composition was built.
- Impeccable: “Verify by looking at the rendered result at the sizes it ships at.” No redesign is claimed without that render.
- UI/UX Pro Max: “Tables can overflow on mobile” and “Use horizontal scroll or card layout.” The repository's screen rules remain authoritative for the eventual phone design.

## Owner to confirm

The action-item fields moved from a wrapping list into table columns. Confirm the table and its horizontal scrolling at phone width after a seeded render; before/after crops are unavailable.

## Needs a data change

None established. No data contract was changed or assessed as sufficient through a running journey.

## Not reached

Whole-screen review of meeting detail and all other assigned screens, feature-floor reconciliation, role and language captures, visual iterations, journeys, UX proof and measured before/after edges remain outstanding. A working local stack with sufficient Docker storage is needed before resuming. The requested independent critique also awaits permission to use sub-agents.
