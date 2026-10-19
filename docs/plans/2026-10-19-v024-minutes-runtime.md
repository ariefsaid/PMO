# v0.24 Minutes Editor Runtime Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for this bounded fresh-builder brief.
> Execute the conditional gates in order; do not dispatch another worker from this plan.

**Goal:** Reproduce and, only with causal proof, remove the unsaved-input runtime error while retaining the accepted editor contract.

**Architecture:** Keep the real BlockNote instance and the page-owned document/baseline/Save flow.
First exercise the stable state-updating parent seam; retain a browser oracle at the existing
surface journey. The only predesigned correction candidate is a stable local change adapter,
conditional on the faithful red/green proof and Root's causal decision.

**Tech Stack:** Existing React 19, TypeScript, BlockNote, Vitest/RTL and Playwright; no additions.

**Spec:** `docs/specs/v024-minutes-runtime.spec.md`; parent contract:
`docs/specs/v024-engineering-health.spec.md` FR-EH-005 / AC-EH-005.

## Global constraints

- Only possible implementation paths: `pmo-portal/src/components/meetings/MinutesEditor.tsx`,
  `pmo-portal/src/components/meetings/MinutesEditor.test.tsx`,
  `pmo-portal/e2e/AC-MTG-022-minutes-editor-surface.spec.ts`.
- Preserve all existing assertions, six surface cases, timeouts, retries, edit/role behavior and
  geometry tolerances. No console suppression, error cancellation, delay masking or fake editor.
- Exact input token is `` `https://example.test/${'x'.repeat(140)}` ``. Preserve this expression;
  the existing comment's rounded length is not a reason to change the input.
- No dependency/version/lockfile/schema/seed/global-cache/repository/API/theme-hook change.
- No browser, DB or heavy run without Root admission; no credentials or environment-file reads.
  Root supplies established protected-fixture receipts; this builder does not invent a snapshot script.
- At most two heavy local runs and two browser dispatches. Higher-priority statement/rehearsal
  work gets capacity first. No reset, Save, fixture write or independent runtime investigation.
- Product code is held from dev until v0.23 dev-to-main is actually merged. Test/CI-only work
  can be assessed separately. Red dev integration blocks unrelated merges. This plan authorizes
  no push, merge, main promotion or production action.

## Review focus

1. A state-updating consumer must be real `setBlocks`, not a callback mock that creates guessed recursion (Tasks 2–3).
2. The whole long token and prior document must survive before and after theme notification (Tasks 4–5, 10).
3. Theme updates must not rebuild the instance or reset readiness/baseline (Tasks 2, 8–9).
4. A changed external `onChange` must not become stale if the adapter is memoized (Task 9).
5. A passing layout test must still fail for an unhandled runtime error; raw errors must remain runner-visible (Tasks 4–5, 10).

## Design decisions and data flow

`MeetingDetail` obtains saved blocks, mounts one editor keyed by meeting, records normalized
ready blocks as baseline and current state, then receives current editor blocks through stable
`setBlocks`. Dirty remains its serialized document comparison. The child reads the DOM-backed
theme hook and passes its current theme to BlockNote. No data layer participates in typing.

Installed BlockNote subscribes through an effect keyed by `[callback, editor]`. The current
inline adapter changes identity on render. Memoizing that adapter can reduce subscription churn,
but that is a hypothesis until the faithful regression changes from red to green. The recorded
stack's mapped line disagrees with source and cannot choose the edit. Theme came after the
observed failures; do not reclassify them as a demonstrated theme-loop defect.

Alternatives considered: rebuilding the editor would reset unsaved state; debouncing document
reports would alter dirty/Save timing; editing BlockNote/dependencies would expand the scope.
None is admitted. If the local callback candidate fails, Root gets the actual evidence and the
source change is removed. No architectural decision is introduced, so no ADR is added.

Performance: the page currently serializes minutes to determine dirty state; subscription churn
is another possible per-keystroke cost. This task adds no benchmark claim or unrelated optimization.
No cache or cross-document editor singleton is introduced; each editor remains instance-local.
DB schema, reversible migrations, RLS and the `org_id` seam are unchanged because there is no DB work.

## Traceability

| AC | Owning layer / file | Tasks |
| --- | --- | --- |
| AC-MRT-001 | Existing surface E2E, four heading cases; six-case geometry contract retained | 4, 5, 6, 7, 10, 11 |
| AC-MRT-002 | Real-editor unit, stateful parent | 2, 3, 7, 8, 9, 11 |
| AC-EH-005 | Existing surface E2E + causal evidence; unit is supplementary | 1–12 |
| Existing AC-MTG-021/022/023/060, 300/301/302 | Existing owners unchanged | 8, 9, 10, 11 |

All tasks are bounded 2–5 minute work units; tool execution may wait for Root's resource slot.
A waiting command is not a completed verification task. Tasks 6–7 are explicit branch gates.

### Task 1 — Freeze the baseline and permitted seam (AC-EH-005)

**Read:** the spec; `MinutesEditor.tsx`, `MinutesEditor.test.tsx`, `pages/MeetingDetail.tsx`,
the surface E2E file, `docs/e2e-parallel-conventions.md`. Do not modify these in this task.

- [ ] Run from repo root: `git rev-parse HEAD` and `git status --short`.
- [ ] Record the revision in Root's supplied evidence destination and verify source has
  `onChange={setBlocks}`, stable `onEditorReady`, one-time normalized ready effect, and
  `useCreateBlockNote(..., [])`. Record six collected source cases and the token expression.
- [ ] Verify: `git diff --exit-code -- pmo-portal/src/components/meetings/MinutesEditor.tsx pmo-portal/src/components/meetings/MinutesEditor.test.tsx pmo-portal/e2e/AC-MTG-022-minutes-editor-surface.spec.ts`.
  Expected: no owned implementation delta before regression authoring; preserve unrelated work.

### Task 2 — Write the faithful stateful-parent unit regression (AC-MRT-002, AC-EH-005)

**Modify/Test:** `pmo-portal/src/components/meetings/MinutesEditor.test.tsx` only.
**Consumes:** actual `MinutesEditorProps`, `NoteBlock[]`, existing QueryClient wrapper and geometry shims.
**Produces:** real-editor `it.each(['light', 'dark'] as const)` titled
`AC-MRT-002 stable parent retains the full heading input and baseline through %s theme`.

- [ ] Import `NoteBlock` and existing `notesToText` from `@/src/lib/meetingNotes`.
  Keep current BlockNote imports and geometry shims real; do not mock the editor or emitter.
- [ ] Inside the test use a component with these exact state/callback semantics:

```tsx
let readyCount = 0;
const initialBlocks: NoteBlock[] = [para('Agenda')];
function StatefulMinutes() {
  const [blocks, setBlocks] = React.useState<NoteBlock[] | null>(null);
  const [baseline, setBaseline] = React.useState<string | null>(null);
  const onReady = React.useCallback((doc: NoteBlock[]) => {
    readyCount += 1;
    setBaseline(JSON.stringify(doc));
    setBlocks(doc);
  }, []);
  const onRequestAction = React.useCallback((_line: string) => {}, []);
  return <>
    <MinutesEditor initialBlocks={initialBlocks} editable tasksExternal={false}
      onReady={onReady} onChange={setBlocks} onRequestAction={onRequestAction} />
    <output data-testid="runtime-baseline">{baseline}</output>
    <output data-testid="runtime-document">{JSON.stringify(blocks)}</output>
    <output data-testid="runtime-dirty">{String(blocks !== null && baseline !== null && JSON.stringify(blocks) !== baseline)}</output>
  </>;
}
```

- [ ] Mount under the existing QueryClientProvider configuration. Register a `window` `error`
  listener collecting messages before render; remove it in `finally`. Do not call `preventDefault`,
  mock `console`, change Vitest unhandled-error handling or synthesize an error.
- [ ] Before typing assert readyCount is 1, dirty is `false`, and normalized baseline contains
  `Agenda`; save the baseline string. Use actual userEvent keyboard calls, matching the browser:
  click textbox, `{Control>}{End}{/Control}`, `{Enter}`, `# Page title`, `{Enter}`,
  `## Section heading`, `{Enter}`, `### Subheading`, `{Enter}`, then the exact token expression.
- [ ] Parse `runtime-document` as `NoteBlock[]`; assert `notesToText(doc)` contains `Agenda`,
  `Page title`, `Section heading`, `Subheading`, and the full token. Assert dirty `true`, same
  baseline, readyCount 1. In `act`, toggle root `dark` by the parameter and dispatch
  `themechange`; repeat those assertions and assert collected errors `[]`. Restore original
  root class in `finally`. Do not add sleeps or a timeout override.
- [ ] Verify the diff contains only this test addition/imports:
  `git diff -- pmo-portal/src/components/meetings/MinutesEditor.test.tsx`.

### Task 3 — Establish whether jsdom produces the actual RED (AC-MRT-002, AC-EH-005)

**Files:** Task 2 unit test; product source remains unchanged.

- [ ] After Root admits the test slot, run from repo root:
  `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/meetings/MinutesEditor.test.tsx -t AC-MRT-002'`.
- [ ] Capture output body and revision. A valid causal RED reproduces update depth during the
  actual input path. An import, harness or missing jsdom API failure must be repaired in the test
  without changing global shims or product source; repeat only that targeted probe if justified.
- [ ] If green, keep its genuine baseline/content proof, record **jsdom runtime reproduction
  inconclusive**, and go to Task 4. Do not manufacture recursion. If faithful RED, also go to
  Task 4: the browser owner remains required. No source edit is admitted by a unit pass alone.

### Task 4 — Add errors and full-content proof to the existing browser owner (AC-MRT-001, AC-EH-005)

**Modify/Test:** `pmo-portal/e2e/AC-MTG-022-minutes-editor-surface.spec.ts` only.
**Interfaces:** `page.on('pageerror', (error: Error) => ...)`; existing `editor` Locator;
existing `minutes-save` test id. No new fixture or helper module.

- [ ] Append ` / AC-MRT-001` to the four heading titles without deleting their AC-MTG-022 text.
  Retain the two handle titles, parameters, all six tests and all original assertions verbatim.
- [ ] In each heading case attach `page.on('pageerror', error => pageErrors.push(error.message))`
  with `const pageErrors: string[] = []` before sign-in/navigation. Do not filter any message.
- [ ] Before typing record `const originalText = (await editor.innerText()).trim()` and assert
  Save disabled. After typing assert originalText remains when nonempty, each of the three
  heading strings remains, the full literal token is contained, and Save is enabled. Repeat the
  text and Save assertions immediately after the existing theme evaluation. `toContainText`
  must receive the complete token, not a substring or regex that can match truncated input.
- [ ] At the end of each heading case, after all existing geometry assertions, add
  `expect(pageErrors, 'AC-MRT-001 unhandled page errors').toEqual([])`.
  Keep natural browser/runner error reporting intact. Do not fail early and skip geometry proof.
- [ ] Verify: `git diff --check` and `git diff -- pmo-portal/e2e/AC-MTG-022-minutes-editor-surface.spec.ts`.
  Expected: additions preserve page scroll `<= 0`, right bleed `<= 1`, left `>= -0.5`, handle
  bounds `±0.5`, 360/390 light/dark, 1280/390 handle cases and original keyboard order.

### Task 5 — Capture the unchanged-source browser RED (AC-MRT-001, AC-EH-005)

**Files:** enhanced existing surface test; source still unchanged.

- [ ] Root must admit this one six-case run and supply its protected-fixture receipt procedure.
  Existing diagnostic traces are supporting evidence, not a substitute for the new regression RED.
  Root handles any required existing auth setup; do not inspect or copy its contents.
- [ ] From repo root, run only when admitted:
  `scripts/with-db-lock.sh scripts/with-test-lock.sh scripts/e2e-local.sh AC-MTG-022-minutes-editor-surface.spec.ts --project=chromium`.
  No reset, repeat-each, trace replay, retries, timeout change or fixture mutation.
- [ ] Record all six outcomes, actual errors and content/dirty assertions separately, with
  before/after fixture receipts. Expected causal RED: unhandled update-depth error in heading
  cases; do not presume content loss. If all green, report scoped non-reproduction to Root and
  stop product work. If capacity is unavailable, leave this task pending; no source correction.

### Task 6 — Root's causal gate for the single candidate (AC-EH-005, AC-MRT-001)

**Read-only files:** real editor, parent and installed BlockNote subscription source.

- [ ] Submit a small causal card: unchanged revision; exact sequence; real regression RED;
  complete observed error; content/dirty outcome; source-map mismatch caveat; hypothesis that
  adapter identity changes subscriptions. Distinguish proven facts from the candidate.
- [ ] Root decides whether the evidence admits exactly the local candidate in Task 7. A stack
  mentioning `onChange` or a changing function identity alone is insufficient causal proof.
  The controlled before/after experiment can test sufficiency, but cannot be called a fix before green.
- [ ] Verify product diff still empty:
  `git diff --exit-code -- pmo-portal/src/components/meetings/MinutesEditor.tsx`.
  If Root declines or cause points elsewhere, stop source work and return the card. No alternative
  product change is delegated by this plan and no owner question is required.

### Task 7 — Apply only the admitted local candidate (AC-MRT-001/002, AC-EH-005)

**Modify:** `pmo-portal/src/components/meetings/MinutesEditor.tsx` only.
**Consumes:** existing `editor`, existing prop `onChange: (blocks: NoteBlock[]) => void`.
**Produces:** internal `handleChange: () => void`; no public signature change.

- [ ] Preconditions: faithful RED from Task 3 or 5, browser RED from Task 5 for its owning AC,
  and Task 6 admission. Failing regression exists before this production edit.
- [ ] After the one-time readiness effect add:

```tsx
const handleChange = useCallback(() => {
  onChange(editor.document as unknown as NoteBlock[]);
}, [editor, onChange]);
```

- [ ] Replace only inline `BlockNoteView.onChange` with `onChange={handleChange}`. Keep readiness,
  editor creation, current-document reference, theme, toolbar/menu, imperative handle and props.
- [ ] Verify: `git diff --check` and `git diff -- pmo-portal/src/components/meetings/MinutesEditor.tsx`.
  Expected: one local callback and one prop replacement. No serialization, clone, ref indirection,
  duplicate-document suppression, guard, timer or subscription implementation of our own.

### Task 8 — Check real-editor GREEN and retained contracts (AC-MRT-002, AC-EH-005)

**Tests:** existing `MinutesEditor.test.tsx` (including its locale test), `minutesEditor.css.test.ts`.

- [ ] Under Root's admitted slot run from repo root:
  `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/meetings/MinutesEditor.test.tsx src/components/meetings/minutesEditor.css.test.ts'`.
- [ ] Expected: entire real-editor suite green, no unhandled diagnostics, baseline/typing,
  read-only, slash/action items, locale and CSS contracts retained. Compare exact Task 3 regression
  output; a jsdom probe that was already green remains supplementary proof, not causal green.
- [ ] If the faithful unit RED remains red, remove the candidate source delta, retain test/evidence
  and stop for Root. Do not broaden the source patch or weaken a test.

### Task 9 — Pin consumer freshness and page ownership (AC-MRT-002, AC-EH-005)

**Modify/Test:** `MinutesEditor.test.tsx`; read-only proof: `pages/MeetingDetail.test.tsx`.
**Interface:** unchanged `MinutesEditorProps.onChange`.

- [ ] Add unit test `AC-MRT-002 a replacement consumer receives the current document without reinitializing`.
  Bind `const initialBlocks = [para('Agenda')]` once, then mount the real editor through existing
  `mount({ initialBlocks })`; click textbox, press `{Control>}{End}{/Control}`, then type `A`;
  save original onChange count. Rerender with a new `onChange` spy, same initialBlocks, same
  `onReady`/`onRequestAction`, and the same QueryClientProvider instance; type `B`. Assert new
  consumer receives current doc containing `AB`, old count stops increasing, ready remains once,
  and existing content is preserved. In `mount`, bind the existing QueryClient construction to
  `const client`, use that value in its provider, and include `client` in its return object so the
  rerender reuses it. Reuse its returned `ref` and callbacks too. This is a preservation assertion;
  a green result is not a runtime RED and does not replace Tasks 3/5.
- [ ] Run:
  `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/meetings/MinutesEditor.test.tsx pages/MeetingDetail.test.tsx'`.
  Expected: green, including existing dirty/Save, read-only/author and unsaved-navigation tests.
  This test may pass before the candidate; it protects callback freshness, not the runtime cause.

### Task 10 — Verify browser GREEN against the same sequence (AC-MRT-001, AC-EH-005)

**Test:** same enhanced six-case surface file; no further journey changes.

- [ ] After Root admission use the exact Task 5 command at corrected revision and the same
  receipt procedure. This is a controlled red/green comparison, not a new broad diagnostic run.
- [ ] Expected: all six pass, zero captured page errors, complete original+new text before and
  after theme event, Save enabled for unsaved input, every old geometry/handle oracle green,
  protected fixtures unchanged. Record actual counts; do not claim ResizeObserver is fixed.
- [ ] If runtime RED persists, remove only Task 7 candidate delta and return to Root with unchanged
  error/content evidence. No new candidate, increased timeout, assertion filter or skip is admitted.

### Task 11 — Run the scoped final gate once (AC-MRT-001/002, AC-EH-005)

**Files:** the three owned implementation/test paths only.

- [ ] Under Root's admitted test slot:
  `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx eslint --max-warnings=0 src/components/meetings/MinutesEditor.tsx src/components/meetings/MinutesEditor.test.tsx e2e/AC-MTG-022-minutes-editor-surface.spec.ts && npx vitest run --changed origin/dev'`.
- [ ] Run from repo root: `git diff --check` and `bash scripts/check-e2e-isolation.sh`.
  Expected: all output bodies green; no package/lock/schema/config delta. No local full suite or
  pgTAP invocation is needed for this source-only change; PR CI still owns full gate coverage.
- [ ] Root admits the retained unsaved-navigation journey for the changed editor dependency:
  `scripts/with-db-lock.sh scripts/with-test-lock.sh scripts/e2e-local.sh AC-MTG-300-unsaved-minutes.spec.ts --project=chromium`.
  Use the same receipt protections and never Save. Unavailable capacity leaves the gate pending.
  Do not rerun the already-green surface suite without a change/failure requiring it.

### Task 12 — Hand over causal evidence and release classification (AC-EH-005)

**Read-only:** final diff and Root's before/after gate outputs. No commit/push in this planning task.

- [ ] Run `git diff --stat` and `git diff --name-only`; require only admitted three paths in the
  implementation delta. Return revision, exact RED/GREEN commands/output, all-six preservation,
  changed-code coverage evidence (80% minimum at CI), fixture receipts and source-map caveat.
- [ ] Explicitly classify: **confirmed local correction** only after Task 10 passes; otherwise
  **inconclusive/rejected candidate**, with the next executable gate and no source fix claimed.
- [ ] Root routes spec/quality/security reviews and rendered Discover/acceptance using the existing
  portfolio. New scope or failed tests return to Root; no suppressed errors or weakened tests.
- [ ] Product correction remains APP/HOLD-DEV pending actual v0.23 dev-to-main merge; current red
  dev also blocks unrelated merges. Test-only changes are assessed separately. Required PR evidence
  remains four unit shards, verify, pgTAP, and admitted integration at lane closure through
  `scripts/ci-e2e.sh <branch>`; the branch argument is Root's actual prepared branch, never guessed.
  Push/merge/deploy require their separate authorization and are not tasks delegated here.

## Planner verification

The planner read the primary diagnostic, current source/tests, installed subscription effect,
binding charter and prior-art search. This artifact is a conditional specification and plan.
No unit/browser/DB run, source correction, implementation commit or release is claimed.
