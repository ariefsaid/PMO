# Test Hygiene Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task. Executor already selected:
> Luna xhigh through the Director's safe pi wrapper. No additional owner checkpoint or dispatch.

**Goal:** Implement approved #1071 without changing product behavior or reducing existing proof.
**Architecture:** Keep analytics overrides typed and preserve unmodified facade exports. Keep Vitest
mock registration file-local, sharing ordinary fixtures/rendering only. Audit existing Playwright
JSON through one pure function and CLI; CI retains only a sanitized summary from the same runs.
**Tech stack:** TypeScript, Vitest 4.1, React Testing Library, Node built-ins, Playwright 1.61.
**Spec:** `docs/specs/test-hygiene.spec.md` (approved 2026-10-17).

## Constraints and preparation

- Work only in `/Users/ariefsaid/.codex/worktrees/test-hygiene-1071/PMO`, branch `codex/test-hygiene-1071`.
  No production modules, schema, dependencies, lockfile, skip guard, retry, or timeout changes.
- Preserve 89 collected original cases, full suite contexts and assertions. Only the readiness
  title receives the explicit AC prefix below; record that one mapping, never normalize all names.
- Every action below is a 2–5 minute step; repeat edit/run steps for the named file batches.
- No full local suite, raw CI dispatch, extra browser invocation, or additional agent review round.
  One GLM review total for the PR, one fix round, then Director inspection. No attribution trailers.
- Private evidence directory: `/Users/ariefsaid/Coding/PMO/docs/private/orchestration/runs/1071/`.
  Keep inventories, assertion-retention diffs and gate logs there; never add that directory to Git.
- [ ] Select Node >=22.22, run `node --version`, then `scripts/setup-hooks.sh` from repo root.
- [ ] Run `npm ci` inside `pmo-portal/` (dependencies are absent). Never `npm install`; confirm
  `git diff --exit-code -- pmo-portal/package-lock.json` afterward.
- [ ] Create the private evidence directory. Save original suite source there before edits.
  Collect the baseline from `pmo-portal/` under the test lock:

```bash
../scripts/with-test-lock.sh npx vitest list src/components/integrations/IntegrationsView.test.tsx --json=/Users/ariefsaid/Coding/PMO/docs/private/orchestration/runs/1071/integrations-before.json
```

Vitest collection JSON entries have `name` (full suite/test identity), `file`, `projectName` and
optional `location`. Compare sorted `[projectName ?? '', name]` pairs including multiplicity;
exclude file/line because files move. Assert exactly 89 entries; collection errors/missing output
are failures. Inspect actual collected output before comparison; do not substitute a grep count.

## Review focus

1. Delayed search must execute the real 500ms timer, not pass because the component unmounted.
2. Health tests must retain the parent connection-suite setup after moving to their own file.
3. Test outcome and attempt status differ in Playwright JSON; one bad attempt cannot hide behind a later pass.
4. Missing later-lane reports must still produce an incomplete safe summary after the first lane fails.
5. Invalid budgets, zero timeouts and malformed timing must fail closed, not become a zero-duration pass.

## Task 1 — Analytics regression and mock sweep (AC-TH-001)

**Files:** Modify the 27 analytics mock files enumerated in the spec. Regression owner:
`pmo-portal/pages/__tests__/SalesInvoices.invoicePdf.test.tsx`.
**Consumes:** real `SearchMini` in `src/components/ui/DataTable.tsx` and the real analytics facade.
**Produces:** complete runtime exports plus existing typed spies, with unchanged event assertions.

- [ ] Write the regression first. Import `act`, `fireEvent`, `cleanup` and the mocked facade namespace;
  render through existing `renderPage('Finance')`, wait for the invoice row using real timers,
  then enable fake timers only for the search interaction. Use the existing row number as query:

```tsx
it('AC-TH-001 debounced invoice search retains the analytics facade export', async () => {
  renderPage('Finance');
  await rowFor('ACC-SINV-2026-00001');
  vi.useFakeTimers();
  try {
    fireEvent.change(screen.getByRole('textbox', { name: 'Search sales invoices' }),
      { target: { value: 'ACC-SINV-2026-00001' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(analytics.trackSearchUsed).toHaveBeenCalledWith('sales-invoices-list', 1, 'salesInvoices');
  } finally { cleanup(); vi.useRealTimers(); }
});
```

- [ ] Run that file under `../scripts/with-test-lock.sh npx vitest run pages/__tests__/SalesInvoices.invoicePdf.test.tsx`;
  capture the missing-export failure. Preserve every existing PDF test.
- [ ] Replace the regression file's factory with typed partial passthrough and a typed search spy.
  Use this pattern, retaining each file's exact existing overrides:

```ts
type Analytics = typeof import('@/src/lib/analytics');
vi.mock('@/src/lib/analytics', async importOriginal => ({
  ...await importOriginal<Analytics>(),
  trackFilterApplied: vi.fn<Analytics['trackFilterApplied']>(),
  trackSearchUsed: vi.fn<Analytics['trackSearchUsed']>(),
} satisfies Analytics));
```

- [ ] Apply typed passthrough to the spec's 27 factories in batches (pages; components; auth/hooks/lib).
  Preserve hoisted spy identities, custom safe wrappers and call-history resets. For `./analytics`,
  use that module's exact import type. Do not add a global mock or call real telemetry deliberately.
- [ ] Run each batch's touched tests under the test lock using explicit file arguments; include
  `src/components/ui/__tests__/SearchMini.analytics.test.tsx` in the first batch. Capture green proof.

## Task 2 — Split sections and type readiness (AC-TH-002, AC-TH-003)

**Files:** Replace `pmo-portal/src/components/integrations/IntegrationsView.test.tsx` with eight
`IntegrationsView.<suffix>.test.tsx` siblings and `IntegrationsView.test-helpers.tsx`.
**Produces:** the same original suite/test identities, except the one explicitly mapped AC title.

| Suffix | Exact source sections at approved baseline |
| --- | --- |
| bindingMap | lines 188–239 and 1490–1565: Admin map and AC-IRUX-006 sources, including `it.each` |
| ownership | 240–350 and 1293–1333: read-only ownership/locality and AC-IRUX-007 |
| connections | 351–777 and 1335–1370: Admin/non-Admin/loading/error and disconnect recovery |
| health | 778–985: Health subgroup inside its unchanged connection-suite parent |
| companyPicker | 992–1065 and 1134–1290: OD-INT-6 and picker/refusal states |
| identity | 1068–1130 and 1571–1672: M365 affordance, org scope, connector identity |
| readinessCopy | 1404–1486: AC-IRUX-010 locale and role cases |
| setup | 1676–1877: checklist and domain actions |

Use AST/suite boundaries, not blind line slicing; line numbers are navigation aids.

- [ ] Copy baseline tests unchanged into these sections. Preserve nested describe titles. In health,
  retain the `IntegrationsView — Connect/Disconnect cards (AC-EAC-016, AC-EAC-017)` parent and its
  before/after hooks; otherwise full identities and inherited setup change.
- [ ] Keep every `vi.mock` and `vi.hoisted` declaration local to its new test file, before ordinary
  helper imports are used. Copy the existing registration block as test plumbing; never import
  a shared variable into `vi.hoisted` or put mocks in a helper imported after the SUT.
- [ ] Extract only ordinary fixtures/render helpers: `mockBinding`, `baseExternalDomainReturn`,
  `emptyProfilesReturn`, `profile`, `wrapWithRole`, `bindingMapIntegrations`, `project`, and
  `wrapWithRoleAndLocale` with its real catalogue loading. Export `installIntegrationDefaults()`
  that registers the original default profile beforeEach and cleanup/clearMocks afterEach.
  Call it once per test file; keep section-specific hooks in their original describe scopes.
  Keep date/locale restoration and `onTestFinished` calls. Helpers must not import the SUT.
- [ ] From `pmo-portal/`, run `../scripts/with-test-lock.sh npx vitest list src/components/integrations/IntegrationsView. --json=/Users/ariefsaid/Coding/PMO/docs/private/orchestration/runs/1071/integrations-after.json`.
  Compare the 89 pairs exactly before adding any AC title or additional test. Save the comparison.
- [ ] Preserve a private assertion-retention diff. Use installed TypeScript's parser/printer
  (`ts.createSourceFile`, `ts.createPrinter({removeComments:true})`) to fingerprint each original
  `it(...)` and outer `it.each(...)(...)` call by full suite/title expression. Compare 85 declaration
  bodies before/after (82 ordinary plus three tables); unchanged bodies must match. Also inspect
  `git diff --color=never -- pmo-portal/src/components/integrations/` for deleted/loosened assertions.
- [ ] Type the local setup mock using the production repository function, retaining original defaults:

```ts
import type { IntegrationsRepository } from '@/src/lib/repositories/types';
type Readiness = Awaited<ReturnType<IntegrationsRepository['getErpSetup']>>;
// Inside the local vi.hoisted object, preserving its original default response:
getErpSetup: vi.fn<IntegrationsRepository['getErpSetup']>(async () => ({
  defaults: { company: 'Example Company', default_receivable_account: null, default_activity_type: null },
  domains: [], unmappedProjects: [{ id: 'project-2', name: 'Example Delivery', code: 'SYNTH-2' }],
  budgetMappedCategories: [], unlinkedEmployeeCount: 2,
})),
const readiness = {
  defaults: { company: 'Example Company' }, domains: [], unmappedProjects: [],
  budgetMappedCategories: [], unlinkedEmployeeCount: 0,
} satisfies Readiness;
```

The callback uses the original inline default implementation, not an imported runtime factory.
Remove both response `as never` casts from the existing refresh test. Prefix its title with
`AC-TH-003 `, retaining the original text `refreshing Company defaults updates the setup checklist
after Company selection succeeds`. Save precisely this old→new full identity mapping privately.
- [ ] Verify a temporary removal of `unlinkedEmployeeCount` causes locked `npm run typecheck` to
  fail; restore the valid fixture and capture green. This is compile-boundary evidence, not a
  reason to change the production `defaults` record contract. Save the one allowed body diff.
- [ ] Run each new file alone under the test lock, then all eight together once. Recollect final
  identities; require exactly 89 originals after applying only the explicit one-case title mapping.
  Fix setup/order leaks without changing original test goals. Delete the old file only after proof.

## Task 3 — Pure timing audit, CLI and self-tests (AC-TH-004, AC-TH-005)

**Create:** `scripts/check-e2e-time-budget.mjs`. Use Node built-ins; follow the existing skip guard's
`pathToFileURL(process.argv[1] ?? '').href` main-module check, without importing/changing its policy.
**Interfaces:** Export `audit(inputs)`; each input is `{ source, report }` or `{ source, inputError }`.
Return `{ schemaVersion:1, complete, ok, measurements, issues, counts }`. Export async `main(argv)`
returning an exit code. CLI: `node scripts/check-e2e-time-budget.mjs --summary <output> <reports...>`.
`--self-test` executes the same real audit/CLI; module import has no I/O or process exit.

- [ ] Start with a small audit stub and failing self-tests using this actual JSON shape:

```js
const fixture = (duration, timeout = 1000, status = 'passed', annotations = []) => ({
  suites: [{ title: 'file', file: 'case.spec.ts', suites: [{ title: 'nested',
    specs: [{ title: 'journey', file: 'case.spec.ts', line: 1, tests: [{
      projectName: 'chromium', status: 'expected', timeout, annotations,
      results: [{ status, duration, retry: 0 }],
    }] }],
  }] }], errors: [],
});
const input = report => [{ source: 'chromium.json', report }];
assert.equal(audit(input(fixture(749))).counts.warnings, 0); // AC-TH-004
assert.equal(audit(input(fixture(750))).counts.warnings, 1);
assert.equal(audit(input(fixture(849))).ok, true);
assert.equal(audit(input(fixture(850))).ok, false);
assert.equal(audit(input(fixture(90000, 120000, 'passed',
  [{ type: 'time-budget-ms', description: '90000' }]))).ok, false); // AC-TH-005
```

- [ ] Implement recursive suite traversal, counting each test result separately. Test `status`
  values are outcomes (`expected`, `unexpected`, `flaky`, `skipped`); result `status` values are
  attempts (`passed`, `failed`, `timedOut`, `interrupted`, `skipped`). Reject unknown values;
  every failed/timedOut/interrupted attempt fails regardless of test outcome or later passes.
- [ ] Add/run failing tests, then implement: 75% warning, 85% failure, inclusive boundaries;
  explicit positive-integer budget below timeout adds warn-at-75%-budget/fail-at-budget using
  the earlier limits. Reject duplicate budget annotations (even equal), malformed descriptions,
  timeout<=0/unlimited/nonfinite, negative/nonfinite duration and invalid attempt index. Preserve
  fractional finite durations; never sum retries. Skip results have no timing, no new allowlist.
- [ ] Add fail-closed cases: no inputs, nonexistent/unreadable file, invalid JSON, HTML-report
  schema, missing suites/specs/tests/results, zero executed cases, top-level report errors,
  unexpected/flaky outcome, empty result list, malformed annotations, and missing later lanes.
  Validate file identity is relative and reject absolute/traversal paths. Diagnose with safe
  issue codes, never raw parse exceptions, source report bodies or error messages.
- [ ] Build the summary by explicit projection only: relative file/line and suite/title, project,
  attempt, result status, duration, timeout, explicit budget, utilization/headroom/classification.
  Counts include executed/skipped/warnings/failures; issues use safe codes and report basenames.
  Mark missing/invalid input or interrupted execution `complete:false`; retain good measurements
  from other inputs. `ok` requires complete valid input, at least one execution, and no failures.
- [ ] CLI reads each requested report independently, audits all available inputs, writes summary
  before returning failure, and prints split/preserve-oracles/retain-timeout guidance. No summary
  output on an unwritable path may return success. Exit 0 pass/warnings, 1 audit/input failure,
  2 invalid CLI usage. Set `process.exitCode`, not an early `process.exit` before summary writes.
- [ ] Self-test the real CLI in a temporary directory via `spawnSync(process.execPath, args)`;
  cover paths with spaces, missing second/third report, malformed JSON, no args, invalid flags,
  unwritable output, and a failed attempt followed by a pass. Inject sentinels into stdout,
  stderr, attachments, metadata and errors; require none survive in summary. Remove temp files.
  Run `node scripts/check-e2e-time-budget.mjs --self-test` after every test/implementation pair.

## Task 4 — CI, annotations and release docs (AC-TH-006, AC-TH-007; FR-008)

**Modify:** `.github/workflows/ci.yml`, `scripts/ci-integration-order.test.mjs`,
`pmo-portal/e2e/UIP-005-project-tab-work-fold.spec.ts`, `docs/e2e-parallel-conventions.md`,
`docs/director-playbook.md`. No new workflow or change to `scripts/check-e2e-skips.mjs`.

- [ ] Add failing AC-TH-006 contract tests: verify self-test in `verify`; exactly one unchanged
  ordinary chromium/serial/consent command; audit uses all three existing report paths; audit
  runs after ordinary E2E and before served smoke even when E2E/skip audit fails; summary upload
  runs on success/failure and contains no raw-report path. Bound step slices before asserting.
- [ ] Give existing E2E step `id: ordinary_e2e`. Add the self-test to the existing verify script
  block. Add timing audit after the unchanged skip-audit step, with `if: ${{ always() && !cancelled()
  && (steps.ordinary_e2e.outcome == 'success' || steps.ordinary_e2e.outcome == 'failure') }}`:
  `node scripts/check-e2e-time-budget.mjs --summary /tmp/pw-time-budget-summary.json /tmp/pw-chromium.json /tmp/pw-serial.json /tmp/pw-consent.json`.
  Keep existing E2E failure exit behavior; unavailable later reports become incomplete evidence.
- [ ] Add `upload-artifact` using the workflow's existing pinned version, the same condition,
  name `e2e-time-budget-summary`, path `/tmp/pw-time-budget-summary.json`, retention 7 days and
  `if-no-files-found: error`. Do not upload raw JSON or broaden existing diagnostic artifacts.
- [ ] Add `{ annotation: { type: 'time-budget-ms', description: '90000' } }` as the registration
  details argument only on the UIP-005 nested-loop `test(...)` declaration (eight expansions).
  Append ` [AC-TH-007]` to its existing title for canonical proof traceability; retain the entire
  original title text, all assertions and `test.setTimeout(120_000)`.
- [ ] Document budget boundaries/annotations in E2E conventions. In the playbook release checklist,
  require a green final-revision integration run URL before wave-closing merge; use existing
  `ci-e2e.sh` fair-use dispatch for dev, automatic integration for main, no duplicate full run.
  This is an actual Director evidence checkpoint, not a fictional unit proof of human behavior.
- [ ] Run `node --test scripts/ci-integration-order.test.mjs` and the audit self-test. For the local
  touched E2E proof run `scripts/e2e-local.sh UIP-005-project-tab-work-fold --project=chromium` once;
  no reset, no full lane. If budget-guard CLI needs local input, use an ephemeral JSON reporter
  file from this same invocation, generate the sanitized summary, then remove the raw report.

## Scoped final gate and handoff

- [ ] From `pmo-portal/`, run `../scripts/with-test-lock.sh npm run typecheck` and
  `../scripts/with-test-lock.sh npx vitest run --changed origin/dev`. This changed-importer gate is
  required even after focused tests; it is not permission to run the full local suite.
- [ ] From `pmo-portal/`, lint all existing changed/new TS/TSX files with this exact command;
  the scripts are outside the app ESLint boundary, so syntax-check both `.mjs` files with Node.

```bash
python3 - <<'PY'
import pathlib, subprocess
raw = subprocess.check_output(['git', 'ls-files', '-m', '-o', '--exclude-standard', '-z', '--', '*.ts', '*.tsx'])
files = sorted({p for p in raw.decode().split('\0') if p and pathlib.Path(p).is_file()})
assert files, 'No changed TypeScript files found'
raise SystemExit(subprocess.call(['npx', 'eslint', '--max-warnings=0', *files]))
PY
node --check ../scripts/check-e2e-time-budget.mjs
node --check ../scripts/ci-integration-order.test.mjs
```

  From repo root run `bash scripts/check-e2e-isolation.sh`, `git diff --check`, and both cheap script tests.
- [ ] Save commands, output bodies, exit codes, 89-case identity comparison/one-title mapping,
  assertion-body fingerprints and approved readiness-only diff privately. Confirm lockfile and
  production modules unchanged. Report AC-TH-001…007 individually; FR-008 is release evidence.
- [ ] Hand off the green scoped diff to the Director for the authorized single GLM review/fix cycle.
  Do not dispatch reviewers or push. CI's full gate and one permitted wave-closing integration
  run decide acceptance. If it exposes other overbudget journeys, stop and report exact summary
  evidence; no unrelated remediation, threshold/timeout increases, exemptions or speculative reruns.
