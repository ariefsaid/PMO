# v0.24 minutes editor runtime (#1108)

Status: bounded correction handoff, 2026-10-19; reproduction and causal approval remain gates.
Implements the follow-up to `v024-engineering-health.spec.md` FR-EH-005 / AC-EH-005 and its plan D1.
This document neither confirms a root cause nor claims a correction.

## Job and observed boundary

When a meeting author types minutes, they need the complete in-memory document to remain usable
through ordinary editing and a theme update, without unhandled runtime errors.

The admitted unchanged six-case surface run passed every existing heading, overflow and handle
assertion. It also recorded eight `Maximum update depth exceeded` page errors: two in each of
the four heading cases at 360/390px, light/dark. All occurred during the last keyboard input,
before the subsequent theme event. The two handle-only cases recorded none. That run recorded
no ResizeObserver diagnostic. No text-retention, frozen-editor or save-failure oracle existed in
that run, so no such impact is established. No minutes were saved.

The captured call chain reaches React state dispatch through the editor change emitter. Its
mapped line disagrees with the checked source; use the actual callback, not that line number,
to investigate. An inline callback and a subscription effect keyed by callback identity are
source observations, not proof of recursion or of a sufficient fix.

## Deciding artifacts and existing architecture

- `pmo-portal/src/components/meetings/MinutesEditor.tsx`: real BlockNote instance, one-time
  normalized `onReady`, current-document `onChange`, theme and editability props.
- `pmo-portal/pages/MeetingDetail.tsx`: stable `setBlocks` passed as `onChange`; stable
  `onEditorReady` sets serialized baseline and current blocks; dirty compares their serialized
  documents. The page owns Save and permissions. `key={meeting.id}` owns document replacement.
- `pmo-portal/src/components/meetings/MinutesEditor.test.tsx`: real editor with existing jsdom
  zero-geometry shims; its current non-stateful `onChange` spy does not reproduce the page seam.
- `pmo-portal/e2e/AC-MTG-022-minutes-editor-surface.spec.ts`: six existing cross-stack cases,
  read-only browser-context isolation and unsaved edits. No new database fixture is needed.
- `pmo-portal/pages/MeetingDetail.test.tsx` and
  `pmo-portal/e2e/AC-MTG-300-unsaved-minutes.spec.ts`: existing Save/baseline and unsaved-navigation
  contracts; preserve them.
- Existing installed BlockNote `pmo-portal/node_modules/@blocknote/react/src/hooks/useEditorChange.ts`
  subscribes in an effect with `[callback, editor]`
  and returns editor cleanup. This source observation supports testing callback identity as one
  candidate; it does not establish cause.

## Requirements (EARS)

**FR-MRT-001 — faithful reproduction.** When investigating the input error, the worker shall
first mount the real `MinutesEditor` under a stateful parent with stable `setBlocks` and stable
`onReady`, capture unhandled window errors without cancellation, and enter the existing exact
heading/long-token sequence. Before any correction, the regression shall demonstrably fail
against unchanged shipped source. A harness, import or missing DOM API failure is not that proof.

**FR-MRT-002 — browser fallback.** Where jsdom does not reproduce the observed error, the worker
shall report that probe as inconclusive for runtime causality and retain the real-browser
`pageerror` oracle in the existing six-case surface file. Browser execution requires Root's
resource admission. No fabricated callback emitter, observer recursion or replacement editor
shall be used to manufacture a red regression.

**FR-MRT-003 — complete editing.** When the existing heading sequence and subsequent theme event
complete, the editor shall retain the original document text and every newly typed heading and
the complete token `https://example.test/` followed by 140 `x` characters, and report dirty state
without an unhandled page error. The sequence shall also retain those texts immediately before
the theme event. These assertions add proof; they do not assert prior text loss.

**FR-MRT-004 — retained editor contract.** While a correction is evaluated, the editor shall
retain heading sizes 24/20/18px, all right/left overflow and handle bounds, content editing,
read-only behavior, action-item behavior, saved document initialization, one normalized
`onReady` per instance, no mount edit, existing dirty/Save ownership, locale initialization and
theme propagation. Existing roles and accepted tests remain unchanged.

**FR-MRT-005 — smallest proven correction.** Where a red regression and a controlled candidate
establish a causal correction, the worker shall change only `MinutesEditor.tsx` and its matching
unit test plus the existing surface test. If stabilizing the change adapter is demonstrated to
be sufficient, use a callback dependent on `[editor, onChange]` that passes the current
`editor.document` unchanged. If that candidate is insufficient or evidence points elsewhere,
the worker shall stop source work and return the evidence to Root for a new bounded decision.

**NFR-MRT-001 — unchanged infrastructure.** The work shall add no dependency, BlockNote version,
lockfile, schema/migration, repository, API, cache, global state, permission or theme-hook change.
The current repository/RLS/`org_id` seams remain untouched. No ADR is warranted for a local
callback adapter; a broader architectural decision is outside this brief.

**NFR-MRT-002 — honest oracles.** The work shall preserve six surface cases, existing test
timeouts, retries, isolation classes and every assertion/tolerance. Console filtering,
swallowing errors, exception cancellation, debounce/delay masking, skips and relaxed assertions
are forbidden. Raw errors remain observable to the runner.

**NFR-MRT-003 — resource and release boundary.** Root shall admit browser/heavy runs around
the higher-priority work, with at most two heavy local runs and two browser dispatches. Use
existing locks/wrappers; no reset, seed change, Save or protected-fixture write is permitted.
A confirmed product correction is v0.24 application work and shall remain held from dev until
the v0.23 dev-to-main promotion PR has actually merged. The engineering-health issue label does
not exempt product code. Test/CI-only work may be eligible earlier; unrelated merges remain
blocked while dev's integration gate is red. No main/production release is authorized here.

## Acceptance and owning proof

| AC | Given / When / Then | One owning proof |
| --- | --- | --- |
| AC-MRT-001 | Given the existing isolated unsaved browser document, when the four existing heading cases type the exact H1/H2/H3/token sequence and then dispatch their existing theme event, then the original text, three new headings and whole token survive both checkpoints, Save is enabled after input, no page error occurs, and all six existing surface cases retain their original geometry/handle assertions. | E2E: existing `AC-MTG-022-minutes-editor-surface.spec.ts`; retain original titles and add `AC-MRT-001` to the four heading titles. |
| AC-MRT-002 | Given the real editor under a stable state-updating parent, when it mounts and runs the same heading/token sequence followed by the light/dark theme event, then `onReady` reports one normalized baseline, mounting is pristine, input updates current blocks and makes them dirty, the baseline is unchanged, all typed content survives, and no unhandled window error occurs. | Unit: `MinutesEditor.test.tsx`, `AC-MRT-002` in the new test title. A passing jsdom test alone does not prove correction of the browser error. |
| AC-EH-005 (retained) | Given an isolated unsaved document, when diagnosis/correction is assessed, then actual diagnostics and impact are recorded, every original surface assertion survives, and any confirmed correction has a faithful regression that was red against shipped code. | Existing surface E2E plus the Root-reviewed before/after causal evidence; the unit probe supplements this owner. |

Existing AC-MTG-021/022/023/060 and AC-MTG-300/301/302 keep their original owners and goals.
The new unit proof does not own browser layout or ResizeObserver behavior.

## Completion boundary

Root decides whether the causal card authorizes the single callback candidate. A green jsdom
probe and unavailable browser capacity produce an honest pending reproduction gate, with no
source correction. A candidate that does not clear the faithful red is rejected, not expanded.
No owner question or new product semantics are needed within these boundaries.
