# CRM screen-owner report — incomplete

## Purpose and structure (source inspection only)

- Companies: find a customer or supplier and open the record. Sketch: title/actions → search and filters → company rows → record. Obviousness unverified.
- Company record: check the organisation and find who to call, or check a supplier before ordering. Sketch: header → company facts → supplier details → related records → activity → contacts. Primary contact is in the facts; the contact list follows several sections. Obviousness unverified.
- Contacts: find a person and their company and open the record. Sketch: title/actions → search and filters → contact rows → record. Obviousness unverified.
- Contact record: find contact details and follow the relationship. Sketch: header → contact details → activity. Obviousness unverified.
- Sales pipeline: identify deals needing attention and open one. Sketch: attention and funnel on desktop → filters and deal list/board; phone list → disclosed figures. Obviousness unverified.
- Deal record: assess and advance a deal. Sketch: project record → deal band with figures and actions → project details. Obviousness unverified.

These are provisional descriptions, not a settled feature floor or an assessment of the rendered hierarchy.

## Changes and evidence

Company record: moved the contacts list above related records and activity, after supplier risk, so people can find who to call sooner. Contact rows now have a 44px minimum touch target. The same facts, controls, permissions and data calls remain. No sample records were created. No screenshots or measured edges exist; before and after measurements are unavailable.

## Skills

- Restructure: read the repository override. Applied its instruction to “Freeze the feature floor before any edit”; the source-level change preserves the existing contacts block and its controls; the rendered feature floor remains unverified.
- Impeccable, taste and ui-ux-pro-max: not loaded. `scripts/vendor-skills.sh` stopped at `cp: cannot stat .../gstack/cso`; its later vendoring steps did not run. No lines are claimed as applied.

## Journeys and gates

- `npm ci`: passed, with engine and install-script warnings. The lockfile was not changed.
- Supabase lean start: failed twice: CLI attempted to create `/home/agent/.supabase`, a read-only location. The environment policy prevents changing HOME. Database reset, dev server, role walks, captures, journeys and UX proof were not run.
- Integration branch merged and pushed. Typecheck and ESLint on both changed files passed.
- Guards failed on integration catalogue errors: missing `filters` and `back`, and orphaned `approvals.bulk.select` and `m365Documents.procurement.intro`.
- Related tests with Node 22: 21 files passed, one failed; 271 passed, three command-palette tests failed because their render lacked an ImpersonationProvider. The initial Node 24 run failed the repository version guard.
- Affected-journey discovery was interrupted after it did not finish; no journeys ran. This is not READY.

## Owner to confirm

Contacts moved above related records and activity; this choice needs rendered review. No before/after crops are available.

## Needs a data change

Not assessed. No data changes were made.

## Not reached

Rendered baseline, complete preservation inventory, design and implementation of all six screens, mobile and Bahasa verification, captures, measured edges, three review rounds, journeys, gates and final integration merge. Resolve the local Supabase CLI home-directory constraint and resume from the pushed work branch. Taste and impeccable are absent; the user directed that vendoring not be run again.
