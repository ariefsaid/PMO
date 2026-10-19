# Test hygiene (#1071)

Status: approved 2026-10-17 — owner: “Please proceed with the handoff and proceed with the rest of the queue.” Baseline: `ea9d40fc` (includes #1099).

## Job and scope

When maintaining the test portfolio after a UX wave, maintainers need dependable mocks, readable
test sections, and visible timing headroom so that a green result remains useful evidence.

This is test/tooling maintenance. Preserve application behavior, existing assertions, acceptance
coverage, isolation classes, retries, and timeouts. No product, database, dependency, or deployment
changes. In particular, do not raise a timeout, skip a case, or weaken an oracle to obtain green.

## Deciding evidence

- Issue #1071 supplies the five scope items. `scripts/prior-art.sh 1071` found that issue and #1081;
  that search is not proof that other prior art is absent.
- `pmo-portal/src/components/ui/DataTable.tsx:812–860`: the real `SearchMini` calls
  `trackSearchUsed` after a nonblank debounced search and on Enter. A replacement analytics facade
  missing that export can produce an asynchronous mock error in a test rendering this control.
- `pmo-portal/src/lib/analytics/index.ts:114`: the helper accepts surface, result count, and module.
  `src/components/ui/__tests__/SearchMini.analytics.test.tsx` already owns its tracking semantics.
- `pmo-portal/src/components/integrations/IntegrationsView.test.tsx`: 1,877 lines, 82 ordinary
  `it()` declarations, and three `it.each` declarations with 2/3/2 rows (89 expanded cases by
  source inspection; collected identities decide the retained-case comparison). At lines 1765–1766 the readiness response
  bypasses the already typed `getErpSetup` mock with `as never`.
- `pmo-portal/src/lib/repositories/types.ts:1037–1047` defines `ErpSetupReadiness` and
  `IntegrationsRepository.getErpSetup`. Its `defaults` is a record; this issue does not invent a
  stricter production contract for individual defaults keys.
- `pmo-portal/package-lock.json` locks Playwright **1.61.0**. Its
  [JSON reporter source](https://github.com/microsoft/playwright/blob/v1.61.0/packages/playwright/src/reporters/json.ts)
  serializes nested suites/specs, each test's `timeout`, `annotations`, `projectName`, and each
  result's `status`, `duration`, and `retry`. The timeout belongs to the **test**, not its result.
- `.github/workflows/ci.yml` emits `/tmp/pw-chromium.json`, `/tmp/pw-serial.json`, and
  `/tmp/pw-consent.json` through the JSON reporter output setting. `scripts/check-e2e-skips.mjs`
  consumes all three together; its self-test runs in `verify`. Preserve that gate unchanged.
- Existing local HTML report data was inspected: it contains per-result duration, but lacks
  timeout. It is a different schema and cannot establish duration/timeout ratios.
- Historical full JSON timing baseline is **unavailable**: successful integration dispatch
  [38740594844](https://github.com/ariefsaid/PMO/actions/runs/38740594844) exposes no artifacts;
  failed integration run [38994552023](https://github.com/ariefsaid/PMO/actions/runs/38994552023)
  exposes only test-result artifacts. Current workflow uploads HTML/traces on failure, not these
  JSON reports. No complete-portfolio timing pass is claimed from these artifacts.
- `pmo-portal/e2e/UIP-005-project-tab-work-fold.spec.ts` retains `test.setTimeout(120_000)`;
  #1099 split its eight UIP-005 theme/role/viewport cases. Owner-supplied local evidence is
  19–37 seconds per split case; it is not a substitute for a current full CI timing baseline.
- `AGENTS.md`, `docs/product-expectations.md`, `docs/e2e-parallel-conventions.md`,
  `docs/qa-portfolio.md`, and `scripts/ci-e2e.sh` decide verification and dispatch policy.

## Requirements (EARS)

**FR-001 — Analytics mock completeness.** When a test replaces the analytics facade, its mock
shall retain `trackSearchUsed` and every export its real rendered dependencies use, while retaining
the test's existing spies and behavior. Use a typed `importOriginal<typeof import(...)>()` spread
plus typed overrides, or a fully typed replacement where isolation requires it; do not use a cast
to conceal an incomplete shape. Sweep facade mocks throughout `pmo-portal/pages/**` and
`pmo-portal/src/**`, including factories returning a hoisted object. Do not change production
tracking or use shortened debounce delays to avoid the asynchronous path.

**FR-002 — Section split with retained proof.** When the integrations suite is reorganized, each
of its existing ordinary and parameterized cases shall remain discoverable exactly once, with its existing
suite context, assertions, role/locale states, error/retry checks, and lifecycle behavior. Put
coherent sections in the files below, with shared test-only setup. Each section shall run alone
and with its siblings without depending on file execution order. Preserve query retry settings,
cleanup, locale restoration, and deliberate mock overrides. No global config changes.

**FR-003 — Typed readiness fixture.** When the readiness mock resolves, its hoisted function and
fixture shall be checked against `IntegrationsRepository['getErpSetup']` and its awaited return
type. Remove the readiness response's `as never` casts; use an explicit type or `satisfies`.
Retain the existing Company-selection proof that the checklist changes from 1/6 to 6/6. Type
drift in a required response member shall produce a TypeScript error rather than be cast away.

**FR-004 — Timing audit.** When supplied Playwright JSON reports, the audit shall recursively
evaluate each executed result against its test's effective timeout, using milliseconds and
individual-attempt duration, never suite totals or a sum across retries. At **75%** of timeout
it shall warn; at **85%** it shall fail. Boundary comparisons are inclusive. Report relative
file/line, suite/test identity, project, attempt, duration, timeout, utilization, and headroom,
with the action “split the journey; preserve its oracles and timeout.” These thresholds are a
conservative initial policy, not a measured claim about today's entire portfolio.

**FR-005 — Explicit tighter budget.** Where a test has a `time-budget-ms` annotation with a
positive integer description below its timeout, the audit shall also enforce that stricter
duration limit. Warn at 75% of the annotated budget; fail at the budget itself. Combine these
with FR-004 using the earlier warning/failure threshold; annotations shall never relax a gate.
Annotate the eight UIP-005 split cases with **90000**, preserving their existing 120-second
timeout and all assertions. Each case must remain **strictly below 90 seconds**. The generic
85% gate alone would allow 102 seconds here and therefore does not enforce this owner target.
At 67.5 seconds the stricter-budget warning provides an earlier signal. Prefer these explicit
annotations over matching title fragments; keep the already split journeys intact.

**FR-006 — Honest input and result handling.** When input is missing, unreadable, invalid JSON,
not the expected report shape, or supplies invalid timing/budget data for an executed case, the
audit shall fail with an actionable diagnostic. No arguments or no executed results shall not
produce green. Ignore skipped results for timing while leaving skip validation to the existing
skip gate. Preserve test failures/timeouts as failures; never convert them to warnings or filter
away an unfavorable attempt. Report interruption/incomplete lane evidence honestly.

**FR-007 — Reuse CI execution and retain safe evidence.** When the existing integration lane
runs, CI shall audit its existing chromium, serial, and consent JSON reports without rerunning
Playwright. The new audit's deterministic self-test shall run in `verify`. CI shall retain a
sanitized timing-summary artifact on success and failure when reports are available, even if a
budget violation makes the job red. Retain only relative test identity, project, result status,
attempt, duration, timeout, explicit budget, and classification; exclude raw reports, stdout,
stderr, attachments, metadata, absolute paths, and response bodies. An unavailable lane must
be marked incomplete, never reported as a complete portfolio pass. Preserve human-readable CI
output and ordinary-before-served execution order. The skip and timing gates remain independent.

**Case expansion after #1106.** The eight original role/theme/viewport identities now expand to
20 UIP-005 cases: the two PM/light identities each have seven independent tab journeys, and the
other six identities remain unchanged. The original Tasks journey retains its overview, editing,
and accessibility checks. Every original goal, the 120000ms timeout, the explicit 90000ms budget,
and AC-TH-007 ownership remain in force for the expanded cases.

**FR-008 — Wave-closing proof.** When a PR closes a wave/milestone, the release checklist shall
require a completed green integration run covering the final changes before merge, recording
the run URL and tested revision in release evidence. For PRs to `dev`, dispatch only through
`scripts/ci-e2e.sh <branch>` and respect its concurrency, one-run, daily-cap, bugfix-proof, and
owner-override rules. For PRs to `main`, use the automatic integration run; do not add a manual
duplicate. A wave closure is identified in its signed brief/release evidence, not inferred from
a branch-name pattern. Reuse existing sufficient proof, and never run a full local suite to
replace CI. A blocked dispatch is a pending release gate, not permission to bypass fair-use.

## Affected paths

All paths below are relative to the repository root. Production modules above are read-only.

Analytics sweep: these **27** test files have facade mocks and no explicit `trackSearchUsed`
mention at this baseline; inspect each factory and repair incomplete replacements. Existing
complete mocks, including `pages/__tests__/SalesInvoices.assignProject.test.tsx`, are comparison
evidence, not a reason to alter their behavior.

```text
pmo-portal/pages/Contacts.analytics.test.tsx
pmo-portal/pages/ExecutiveDashboard.test.tsx
pmo-portal/pages/__tests__/Revenue.exportNumeric.test.tsx
pmo-portal/pages/__tests__/SalesInvoices.dueDate.test.tsx
pmo-portal/pages/__tests__/SalesInvoices.efaktur.test.tsx
pmo-portal/pages/__tests__/SalesInvoices.invoicePdf.test.tsx
pmo-portal/pages/__tests__/VendorQuotesTab.test.tsx
pmo-portal/pages/procurement/__tests__/ProcurementListRow.analytics.test.tsx
pmo-portal/pages/project-detail/__tests__/ProjectDetail.analytics.test.tsx
pmo-portal/src/auth/AuthProvider.test.tsx
pmo-portal/src/auth/LoginPage.test.tsx
pmo-portal/src/auth/UpdatePasswordPage.test.tsx
pmo-portal/src/auth/authFloorAnalytics.test.tsx
pmo-portal/src/components/ErrorBoundary.test.tsx
pmo-portal/src/components/import/__tests__/useImportWizard.test.tsx
pmo-portal/src/components/legal/AnalyticsOptOutToggle.test.tsx
pmo-portal/src/components/panel/FeedbackControl.analytics.test.tsx
pmo-portal/src/components/reports/BoardPackAction.test.tsx
pmo-portal/src/components/ui/__tests__/EntityFormModal.focus.test.tsx
pmo-portal/src/components/ui/__tests__/ListState.test.tsx
pmo-portal/src/components/ui/__tests__/useEntityForm.test.tsx
pmo-portal/src/hooks/useAssistantPanel.analytics.test.ts
pmo-portal/src/hooks/useComposeArtifact.analytics.test.ts
pmo-portal/src/lib/agent/runtime/AgentRuntimeProvider.prefill.test.tsx
pmo-portal/src/lib/agent/runtime/AgentRuntimeProvider.test.tsx
pmo-portal/src/lib/classifyMutationError.analytics.test.ts
pmo-portal/src/lib/import/procurementCycle/__tests__/commit.test.ts
```

Split `pmo-portal/src/components/integrations/IntegrationsView.test.tsx` into these siblings
(all names prefixed `IntegrationsView.`), plus `IntegrationsView.test-helpers.tsx` for shared
rendering/fixtures and hoisted-mock setup as supported by Vitest. Do not register hooks inside
hoisted callbacks or import one test file from another.

| New sibling suffix | Existing sections to move |
| --- | --- |
| `bindingMap.test.tsx` | Admin binding map; AC-IRUX-006 source states |
| `ownership.test.tsx` | AC-EAS-015 and locality groups; AC-IRUX-007 ownership states |
| `connections.test.tsx` | Connect/disconnect Admin, non-Admin, loading/error groups; AC-IRUX-008 recovery |
| `health.test.tsx` | Health surface subgroup, including asynchronous independent-tier checks |
| `companyPicker.test.tsx` | OD-INT-6; AC-IRUX-005 picker/refusal states |
| `identity.test.tsx` | M365 organisation affordance; org scope labels; AC-ICI identity |
| `readinessCopy.test.tsx` | AC-IRUX-010 locale/role readiness copy and catalog helpers |
| `setup.test.tsx` | ERP setup checklist; ERP domain actions; typed readiness refresh fixture |

Tooling/release paths:

- New `scripts/check-e2e-time-budget.mjs` (pure audit, CLI, and `--self-test`).
- `.github/workflows/ci.yml` (self-test, report audit, safe timing artifact).
- `scripts/ci-integration-order.test.mjs` (audit wiring/order/no duplicate execution contract).
- `pmo-portal/e2e/UIP-005-project-tab-work-fold.spec.ts` (eight budget annotations and an AC title suffix only).
- `docs/e2e-parallel-conventions.md` (budget/annotation authoring rule).
- `docs/director-playbook.md` (wave-closing evidence checkpoint).

## Acceptance and owning proofs

Each AC has one lowest-sufficient owner. Existing journey tests retain their own original ACs;
this maintenance issue does not move coverage up the pyramid or add a new cross-stack journey.

| AC | Given / When / Then | Owning layer and proof |
| --- | --- | --- |
| AC-TH-001 | Given a repaired previously incomplete page mock and the real search control, when a user enters a nonblank search and the full existing debounce elapses, then the typed search spy receives the expected surface/count/module without a missing-export error, while existing page assertions still pass. | Unit: a focused regression in `SalesInvoices.invoicePdf.test.tsx`, using controlled timers and restoring them; existing `SearchMini.analytics.test.tsx` retains semantic coverage. |
| AC-TH-002 | Given the baseline integrations suite, when its sections run individually and together after the split, then all original ordinary and parameterized cases are retained exactly once and their existing assertions pass without file-order dependence. | Unit: the eight moved Vitest files; compare pre/post collected full test identities (89 expected from source inspection) and inspect the assertion-preserving diff. |
| AC-TH-003 | Given the typed hoisted readiness mock, when Company selection refreshes setup, then the unchanged 1/6-to-6/6 goal holds; a malformed required response member is rejected by typechecking. | Unit: the moved readiness refresh test in `IntegrationsView.setup.test.tsx`, AC-tagged, with typed fixtures; required project typecheck proves the type boundary. |
| AC-TH-004 | Given nested multi-project report fixtures with durations immediately below, at, and above 75%/85%, when audited, then warnings/failures occur at the specified inclusive boundaries using each result's own duration and the test timeout. | Unit: `check-e2e-time-budget.mjs --self-test`, AC-tagged checks. Include multiple reports, repeated setup, and multiple attempts without summing durations. |
| AC-TH-005 | Given explicit budgets and invalid/empty/missing report inputs, when audited, then tighter budgets cannot relax the generic gate, exactly 90000ms fails a 90000ms budget, invalid inputs cannot pass, and skips remain the skip gate's concern. | Unit: the same audit self-test with distinct AC-tagged cases for these behaviors and nonzero CLI failures. |
| AC-TH-006 | Given the workflow and audit contract, when repository CI contract tests run, then all three existing reports feed the audit, its self-test runs in verify, safe timing evidence is retained on both outcomes, and no added browser invocation or changed lane order occurs. | Unit: `scripts/ci-integration-order.test.mjs`, plus audit self-test assertions on the emitted summary's allowlisted fields. |
| AC-TH-007 | Given the eight already split UIP-005 cases with explicit 90000ms budgets, when the existing integration invocation completes, then each measured case is below 90000ms with its unchanged 120000ms timeout and every existing oracle retained. | E2E: the eight existing UIP-005 cases and their timing-summary entries; append this AC reference without replacing their original names/IDs. |

FR-008 is an operational release checkpoint: the Director verifies the recorded green run and
tested revision before merging a wave-closing PR. Existing dispatcher self-tests support its
fair-use rules; no unit or browser test is claimed to prove a future human release decision.

## Verification and open evidence

Builder verification is the scoped final gate in `AGENTS.md`: locked typecheck and changed-importer
Vitest, lint touched files, cheap script self-tests/CI contract tests, and the touched UIP-005
journey through `scripts/e2e-local.sh` under its existing lock. No reset is needed for this scope.
Do not run the full local suite. CI decides full-suite acceptance. Reviewers reuse builder proof
and inspect the retained-case diff rather than starting another full run.

The first existing authorized integration execution after wiring supplies the missing portfolio
timing baseline. Inspect its sanitized summary before claiming that all current journeys satisfy
the new gate. Unexpected existing violations require Director inspection and an assertion-preserving
split decision; do not start an unrelated remediation wave, increase thresholds/timeouts, add
exemptions, or rerun CI merely to sample a faster machine. No product-scope decisions remain open;
the unavailable baseline is explicitly pending evidence.
