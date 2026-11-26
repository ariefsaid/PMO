# Administration screens — blocked

Status: **not READY**. Three source-only layout changes are pushed; none has been rendered or accepted. The other eleven screens remain to be recomposed.

## Purpose and structure inventory

Source-based starting points only; the most obvious thing and final structure remain unverified for every screen.

| Screen | Intended purpose | Sketch to verify |
| --- | --- | --- |
| Administration home | Find organisation administration settings. | Navigation → setting |
| Credits | See credit balance and, where permitted, grant credits. | Balance → grant |
| Usage | Review recorded usage. | Usage → detail |
| Exchange rates | Review and maintain exchange rates. | Rates → add or replace |
| Features | Manage plan and feature switches within permissions. | Scope → switches and limits |
| Role names | Set names used for roles. | Role → current name → save |
| Terminology | Set organisation terms in both languages. | Term → current names → save |
| Document categories | Maintain document categories. | Categories → edit or archive |
| Master data | Find and manage directories. | Directory → records and actions |
| Integrations | Manage personal integrations. | Integration → connection action |
| Your plan | Review the plan, limits and included features. | Plan → limits → features |
| Material request settings | Set approval and request rules. | Chain → request settings |
| Purchase types | Maintain purchase types and rental eligibility. | Types → edit, add or retire |
| Equipment plan settings | Set the monthly plan and its categories. | Plan switch → categories |

## Changes and measurements

- Purchase types: aligned the two names, rental flag and existing row actions on wide screens; fields stack on phones. Purpose: maintain purchase types. Structure: type → names and rental flag → save or retire/restore.
- Usage: split input and output tokens into named numeric columns and applied numeric and money column roles. Purpose: review recorded usage. Structure: month and action → counts → cost and margin.
- Material requests: aligned the existing approval-step fields in a responsive grid. Purpose: set request and approval rules. Structure: step → role and check → order and save actions.
- All three retain existing data calls, controls and permissions. The requested whole-screen one-save composition remains unverified and unfinished.

No captures or measurements were obtained; there are no screenshot paths. Every scoped screen, state, language, role and viewport remains to be reviewed.

| Measurement | Before | After |
| --- | --- | --- |
| Edges, baselines and gaps | Not measured | Not measured |

## Skills and rules

- Restructure: “Freeze the feature floor before any edit”; the floor could not be reconciled against a running app.
- Impeccable: “Verify by looking at the rendered result at the sizes it ships at”; no rendered result was available. The context launcher failed on its read-only default cache, so project context was read directly.
- Taste: “Placed space reads as calm; leftover space reads as unfinished.” No visual assessment was possible. Screen rules take precedence where taste differs.
- UI UX Pro Max: unavailable locally in this continuation; no composition or inspector result to claim.
- The vendor script was not rerun. The project restructure override is available; impeccable and taste skill files were absent locally in this continuation, so the screen brief and rules were used.

## Journeys and gates

- Prerequisite settings branch and latest integration branch merged; work branch pushed. No pull request opened.
- `npm ci`: passed in the earlier setup with a temporary cache; lockfile unchanged.
- Lean stack: started after a temporary proxy bypass. Required `db reset` failed twice with container setup exit 125 as Docker exhausted disk; the retry followed the requested prune. The reset left no trustworthy seeded state. No seeded journey, UX proof or captures ran.
- System Chromium was selected for a fallback; the journey could not be run against the failed reset. No sample records were created.
- Typecheck: passed on the final work tree under Node 22.
- ESLint: passed for the three changed screens and two changed tests.
- Direct tests: purchase type and usage tests 17/17 passed; material-request settings tests 10/10 passed.
- Related tests for purchase type and usage: 238 passed, 14 failed across administration-shell and command-palette suites. Related tests for material-request settings: 209 passed, three command-palette tests failed.
- Guards: failed on unrelated missing and orphaned translation keys in the merged integration tree. Affected-journey discovery returned more than the 40-spec local cap; none ran.
- The provider-cost test expected an em dash while the existing screen reports unavailable pricing. It now asserts that message and still asserts that unknown is never displayed as zero. No journey step changed.

## Owner to confirm

Confirm the source-only changes after rendered review, including the separate input/output token headers and the new row arrangements. The prerequisite merge includes changes made by the other owner; this report does not assess them.

## Needs a data change

Not assessed across the screens. No repository, RPC or schema changes were made by this work.

## Not reached

Eleven screens were not recomposed. The three touched screens still need full-screen composition and feature-floor reconciliation. All before and after captures, three render rounds, measured comparisons, journeys and UX proof remain outstanding. Resume with enough Docker daemon storage for a successful reset, then capture the seeded before states and review each screen at all requested sizes and languages.
