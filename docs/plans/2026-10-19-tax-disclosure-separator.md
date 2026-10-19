# Tax Disclosure Separator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`. Root dispatches one fresh native Luna xhigh worker with this complete bounded brief. No child delegation or standalone chat; preserve others' work.

**Goal:** Remove the collapsed tax disclosure's trailing dot while preserving all S39/#1169 behavior and money oracles.

**Architecture:** Move the existing post-trigger separator into the same hidden span as the rate/base facts. Keep the component interface, state, formatting, classes and all callers unchanged.

**Tech Stack:** React 19, TypeScript, Vitest/RTL and existing i18next; Node 22.22+; no new dependencies.

**Spec:** `docs/specs/tax-disclosure-separator.spec.md` (complete #1157 contract, FR-V24P-014 / AC-V24P-014).

## Global constraints

- Deciding source baseline: `origin/dev` `c599d87d849f37c3db6c22f71efa8bb0db2199f9`; re-read the actual component/tests in the assigned build checkout before editing. Do not use the older planning checkout as code truth.
- Own only `pmo-portal/src/components/ui/TaxBasisLabel.tsx` and `pmo-portal/src/components/ui/__tests__/TaxBasisLabel.test.tsx`.
- Retain every existing assertion, test title, timeout and fixture contract. Do not loosen snapshots or add them as substitutes.
- Preserve source currency, amounts, stored treatment, exact authored nominal rate/DPP, unknown-versus-zero, ordinary inline default, basis-only mode and unknown-treatment absence.
- Preserve the pre-trigger separator and the complete trigger class string, especially `touch-target -my-2`, `min-h-8` and `text-primary-text`. No project-header height/color regression.
- Preserve keyboard, Escape/focus, parent-card activation prevention, invoice evidence separation, explicit invoice approval and all money assertions.
- No new copy/locales, queue cases/admissions, calculations, authority/policy, API/schema, scripts/CI, dependencies or lockfiles. No reset, DB access or browser execution in the build worker; Root admits rendered verification separately.
- Use the approved Node 22 PATH below for every command. Typecheck/Vitest use `PMO_TEST_LOCK_SLOTS=2` and the test wrapper, with `--maxWorkers=2` for Vitest. Root schedules at most two heavy local runs and gives statement/RIS work priority.
- v024B is BUILD/REVIEW/CI GREEN ON BRANCH ONLY. HOLD dev merge until Root verifies the actual v023 dev-to-main PR merged by the owner; this condition grants no main authorization. The current red dev gate independently holds unrelated code merges.
- Worker returns evidence and a two-file patch; Root owns normal commit/publication and gate admission. No worker commit, push, PR, merge, deploy, credential reads or installation.

## Review Focus

1. Collapsed `textContent` includes hidden descendants: the new oracle must remove hidden descendants from a cloned test node before comparing visible text; never assert raw wrapper text as visible output.
2. Inclusive/exclusive rows may differ: assert both, keeping their original exact nominal rates and fractions.
3. Unknown facts and a known zero rate differ: assert `rate not recorded` / `DPP not recorded` separately from `0% · DPP 1/1`.
4. Collapse after expansion can regress separately from first paint: assert click-close, reopen and Escape-close with focus restoration.
5. Shared callers have richer goals: run their complete existing suites, including card non-activation, contract prerequisites, currency and explicit invoice approval, without editing them.

## File responsibilities and design

| File | Responsibility |
|---|---|
| `pmo-portal/src/components/ui/TaxBasisLabel.tsx` | Existing treatment/facts/trigger; relocate only the post-trigger separator at baseline lines 95–97. |
| `pmo-portal/src/components/ui/__tests__/TaxBasisLabel.test.tsx` | Add the canonical AC-V24P-014 visible punctuation regression while retaining all existing coverage. |

No interface change: `TaxBasisLabel: React.FC<TaxBasisLabelProps>`. No new component, production helper, wrapper, CSS token or state. Existing `detailsId`, `triggerId`, `hidden`, ARIA and `onKeyDown` behavior remain identical. At baseline, pre-trigger punctuation is line 81, protected classes line 89, and the relocated punctuation lines 95–97. `DESIGN.md` tax-disclosure rule governs phone/desktop, light/dark and English/Indonesian; the inline component retains natural wrapping without introducing a breakpoint.

## Command setup

Run command blocks from the assigned build worktree's repository root in the same shell; this PATH export pins npm/npx child processes as well as the parent. The approved installed runtime is v22.23.2. Do not install or search for another runtime.

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
node --version
```

Expected: `v22.23.2`. Keep raw command bodies, status and source hashes in the private run evidence Root assigns. A test failure is a stop-and-diagnose result, never permission to weaken an existing goal.

### Task 1: Add the canonical visible-text regression (AC-V24P-014, 2–5 minutes)

**Modify/Test:** `pmo-portal/src/components/ui/__tests__/TaxBasisLabel.test.tsx` only.
**Consumes:** current `TaxBasisLabelProps`, `render`, `screen`, `within`, `userEvent` already imported.
**Produces:** `it.each` cases whose title begins `AC-V24P-014:`; all existing tests remain unchanged.

- [ ] Add a test-local visible-text helper: deep-clone the label as `HTMLElement`, remove all cloned descendants matching `[hidden]`, then normalize whitespace in the clone's `textContent` and trim it. It must not remove punctuation text nodes outside the hidden span, inspect React internals, alter the rendered DOM or rely on jsdom `innerText`.
- [ ] Add table cases with these exact prop/output pairs:

| Case | Props beyond `detailsMode="disclosure"` | Basis | Detail text |
|---|---|---|---|
| exclusive | `treatment="exclusive" taxRate={12} taxBaseNumerator={11} taxBaseDenominator={12}` | `excl. PPN` | `12% · DPP 11/12` |
| inclusive | `treatment="inclusive" taxRate={5} taxBaseNumerator={1} taxBaseDenominator={2}` | `incl. PPN` | `5% · DPP 1/2` |
| unknown | `treatment="exclusive" taxRate={null} taxBaseUnknown` | `excl. PPN` | `rate not recorded · DPP not recorded` |
| zero | `treatment="exclusive" taxRate={0} taxBaseNumerator={1} taxBaseDenominator={1}` | `excl. PPN` | `0% · DPP 1/1` |

- [ ] Per case, resolve the button and panel through the real `aria-controls`; assert initial panel hidden and visible label exactly `${basis} · Show tax details`. Click to expand: panel visible, `aria-expanded=true`, visible label exactly `${basis} · Hide tax details · ${facts}`. Click to close and repeat the initial exact visible-label assertion. Reopen, press Escape, assert hidden panel, `aria-expanded=false`, exact collapsed text and trigger focus. Keep the control/panel IDs stable throughout.
- [ ] Run only the new cases under the lock:

```bash
PMO_TEST_LOCK_SLOTS=2 scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/ui/__tests__/TaxBasisLabel.test.tsx -t AC-V24P-014 --maxWorkers=2'
```

Expected RED: the initial visible label ends with an extra `·`. Do not change production source until this behavior failure is captured. Fixture, import or helper errors do not count as the required RED.

### Task 2: Move the separator and prove GREEN (AC-V24P-014, 2–5 minutes)

**Modify:** `pmo-portal/src/components/ui/TaxBasisLabel.tsx` only.
**Test:** `pmo-portal/src/components/ui/__tests__/TaxBasisLabel.test.tsx`.
**Consumes:** Task 1's failing visible-text cases and the existing hidden details span.
**Produces:** unchanged `TaxBasisLabel` interface with the post-trigger separator inside that span.

- [ ] Remove only the `{' · '}` immediately after `</button>` and place it at the beginning of `<span id={detailsId} aria-labelledby={triggerId} hidden={!detailsExpanded}>`, immediately before `{rateLabel}`. Preserve the separator before the button, separator between rate/base, every class and all event/ARIA logic byte-for-byte.
- [ ] Run the complete shared component suite:

```bash
PMO_TEST_LOCK_SLOTS=2 scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/ui/__tests__/TaxBasisLabel.test.tsx --maxWorkers=2'
```

Expected GREEN: all old and new cases pass. Inspect the two-file diff: no formatting sweep, production helper, caller change or removed old oracle.

### Task 3: Preserve caller goals and run the local final gate (AC-V24P-014 regression, 2–5 minutes of actions; wait for commands)

**Read-only suites:** `pmo-portal/pages/project-detail/__tests__/ProjectDetailHeader.test.tsx`, `pmo-portal/components/ProjectCard.test.tsx`, `pmo-portal/pages/approvals/SalesInvoiceApprovalSection.test.tsx`.
**Consumes:** unchanged callers importing the shared component.
**Produces:** raw Node22 caller/type/lint/changed-import/coverage evidence; no additional source edits.

- [ ] Run all existing caller tests, with focused component coverage in the same run:

```bash
PMO_TEST_LOCK_SLOTS=2 scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/ui/__tests__/TaxBasisLabel.test.tsx pages/project-detail/__tests__/ProjectDetailHeader.test.tsx components/ProjectCard.test.tsx pages/approvals/SalesInvoiceApprovalSection.test.tsx --maxWorkers=2 --coverage --coverage.include=src/components/ui/TaxBasisLabel.tsx --coverage.reporter=text --coverage.reporter=json'
PMO_TEST_LOCK_SLOTS=2 scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck'
(cd pmo-portal && npx eslint --max-warnings=0 src/components/ui/TaxBasisLabel.tsx src/components/ui/__tests__/TaxBasisLabel.test.tsx)
PMO_TEST_LOCK_SLOTS=2 scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run --changed origin/dev --maxWorkers=2'
```

Expected: every selected test PASS, zero type errors and zero lint warnings/errors. Record actual totals and command bodies, not just process exit codes. Do not run the full local suite, reset the DB or dispatch browsers. No e2e source is touched; Root owns affected-route runtime admission.
- [ ] Score the uncommitted patch using the existing changed-lines gate's exported scorer. Its CLI compares committed HEAD; before Root commits, use this exact working-tree adapter from repository root so the future patch is actually measured:

```bash
node --input-type=module <<'NODE'
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { collectChangedFromDiff, computeChangedLinesCoverage } from './scripts/changed-lines-coverage.mjs';
const coverage = JSON.parse(readFileSync('pmo-portal/coverage/coverage-final.json', 'utf8'));
const diff = execFileSync('git', ['diff', '--unified=0', 'origin/dev', '--', 'pmo-portal/'], { encoding: 'utf8' });
const result = computeChangedLinesCoverage({ changedLinesByFile: collectChangedFromDiff(diff), coverage, min: 80, root: process.cwd() });
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
NODE
```

Expected: at least 80% changed executable-line coverage. Report numerator/denominator honestly; a zero executable denominator is not proof that a behavior was exercised. The required AC RED/GREEN and coverage report remain mandatory. Root runs `node scripts/changed-lines-coverage.mjs --base origin/dev --coverage pmo-portal/coverage/coverage-final.json --min 80` after its normal commit and before publication.

### Task 4: Freeze the bounded patch and hand off review/runtime gates (AC-V24P-014, 2–5 minutes)

**Read:** the complete two-file diff and retained caller tests.
**Produces:** private completion record with exact two-file source hashes, RED/GREEN logs, caller/changed-import/type/lint/coverage bodies and honest remaining gates; no public or source changes.

- [ ] Confirm no caller suite, fixture, old test/assertion, timeout, class string, currency/money logic or approval path changed. Include the retained AC-S39-001/002/003/004, AC-DPP-002, AC-UNB-001, AC-NAR-002 and AC-1048-02 goals in the evidence index.
- [ ] Return to Root for one consolidated spec/quality/security review retaining the rendered design axis, one bounded repair round if required and Root verification. Any newly demonstrated issue outside the two files goes back to Root; no scope expansion or second job for this worker.
- [ ] Root schedules the portfolio rendered Discover and affected-route sweep on the exact candidate after explicit admission: project cards, project overview and reachable native invoice approvals; collapsed/open/Escape states; English/Indonesian, light/dark, phone 390px and desktop 1440px. Preserve amount/source currency, exact facts, no card/invoice activation, explicit approval, the `text-primary-text` contrast and #1169 compact header/control geometry. Use existing rich fixtures without reset or business writes. Every finding graduates to a test, matrix cell and design/decision note through separately assigned ownership; re-render until clean. Do not claim a DOM unit test substitutes for the rendered result.
- [ ] Root admits applicable touched-journey verification and logs any browser integration through `scripts/ci-e2e.sh` under current cadence/cap rules; no browser command is authorized by this plan alone. Require all four unit shards, pgTAP and verify GREEN on the actual branch head. A green branch does not lift either dev merge hold. Main/prod actions remain unauthorised.
- [ ] Preserve issue #1157's future ERP-origin queue observation in the disposition. The existing ERP preview test remains intact; no claim of an admitted ERP queue regression. Report exactly what is proved and what is pending.

## Traceability and self-review

| Requirement | Task / owning proof |
|---|---|
| FR-V24P-014, FR-TDS-001 | Tasks 1–2; canonical AC-V24P-014 RTL cases |
| FR-TDS-002, FR-TDS-003 | Tasks 2–3; retained component and full caller suites |
| NFR-TDS-001 | Tasks 2–4; unchanged classes + existing assertions + admitted rendered geometry |
| NFR-TDS-002/003 | Tasks 3–4; two-file diff, locked gates and changed-line coverage |
| NFR-TDS-004 | Task 4; Root verifies actual release/dev gate artifacts before any merge |

All five review-focus inputs have explicit test steps above. No schema/API/architecture decision or new owner interview is needed. This plan is not a passing test, rendered acceptance, CI result, merge permission or execution claim.
