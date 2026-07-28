import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const packageJson = JSON.parse(
  readFileSync(new URL('../pmo-portal/package.json', import.meta.url), 'utf8'),
);

test('the ordinary e2e lane runs before the served-function smoke lane', () => {
  const e2eStep = workflow.indexOf('- name: E2E tests (Playwright / Chromium)');
  const servedFunctionStep = workflow.indexOf('- name: Serve adapter-dispatch (served-fn lane smoke)');

  assert.notEqual(e2eStep, -1, 'ordinary e2e step is missing');
  assert.notEqual(servedFunctionStep, -1, 'served-function smoke step is missing');
  assert.ok(
    e2eStep < servedFunctionStep,
    'serve-functions cleanup leaves Kong forwarding to a removed runtime; run ordinary e2e first',
  );
});

test('CI and the local promotion gate reject retry-masked flaky Playwright cases', () => {
  // Assert the CONTRACT (every browser lane rejects flakes), not a character-distance window.
  // The {0,300} form broke merely because a comment was added above the command — a false RED that
  // says nothing about whether the flag is present. Match each lane's command independently.
  assert.match(workflow, /playwright test --project=chromium --fail-on-flaky-tests/);
  assert.match(workflow, /playwright test --project=serial --workers=1 --fail-on-flaky-tests/);
  // ...and that neither lane's json report is produced with a shell redirect, which would send the
  // `list` reporter into the file too — hiding the failing test name from the CI log and corrupting
  // the JSON the skip gate parses (regression, 2026-07-25).
  // Strip comment lines first — this rule's own explanation above contains the bad form verbatim,
  // and a check that fails on documentation describing it is a check nobody keeps (3rd time today).
  const workflowCommands = workflow
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  assert.doesNotMatch(workflowCommands, /--reporter=list,json\s*>/);
  assert.match(workflow, /PLAYWRIGHT_JSON_OUTPUT_NAME=\/tmp\/pw-chromium\.json/);
  assert.match(workflow, /PLAYWRIGHT_JSON_OUTPUT_NAME=\/tmp\/pw-serial\.json/);
  assert.match(
    workflow,
    /- name: Serve adapter-dispatch \(served-fn lane smoke\)[\s\S]{0,800}playwright test served-fn-smoke --project=chromium --fail-on-flaky-tests/,
  );

  const script = readFileSync(new URL('./verify-main-pr.sh', import.meta.url), 'utf8');
  assert.equal(
    script.match(/--fail-on-flaky-tests/g)?.length,
    3,
    'parallel, serial, and served local Playwright lanes must all reject flakes',
  );
});

test('pull_request has NO paths-ignore — required checks must always be able to report', () => {
  // `main` requires `verify` + `integration`, and required contexts are not path-aware. A
  // paths-ignore on pull_request means a docs-only PR never starts the workflow, the contexts never
  // report, and the PR is unmergeable forever. Found 2026-07-25 shipping v0.8.0.
  // ⚑ Bound-check BEFORE slicing. `indexOf('jobs:')` takes the FIRST occurrence anywhere in the
  // file, so a prose comment containing "jobs:" above the trigger block inverts the bounds and
  // `slice(start > end)` yields '' — on which doesNotMatch passes vacuously. Demonstrated green
  // against a live `paths-ignore` regression during the 2026-07-28 ownership review.
  const prIdx = workflow.indexOf('\n  pull_request:');
  const jobsIdx = workflow.indexOf('\njobs:');
  assert.ok(prIdx !== -1, 'pull_request trigger not found — this gate would have scanned nothing');
  assert.ok(jobsIdx > prIdx, 'jobs: precedes pull_request — slice bounds inverted, gate is vacuous');
  const pr = workflow.slice(prIdx, jobsIdx);
  assert.doesNotMatch(
    pr,
    /paths-ignore:/,
    'pull_request must not path-ignore: required checks would never report and the PR could never merge',
  );
  // And the inverse-filter "stub workflow" fix must not come back either — two workflows publishing
  // the same check names both fire on a MIXED (docs + code) PR, letting a stub mask a real failure.
  // ⚑ Assert the INVARIANT (exactly one workflow owns these job names), not the name of the one
  // file we happened to delete. The previous form grepped ci.yml for 'ci-path-ignored' — a string
  // that lives in a SEPARATE file, so it could never fire; re-creating the stub left it green.
  const workflowDir = new URL('../.github/workflows/', import.meta.url);
  const workflowFiles = readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(workflowFiles.length > 0, 'no workflow files found — this gate would have scanned nothing');
  const owners = workflowFiles.filter((f) =>
    /^ {2}(verify|integration):/m.test(readFileSync(new URL(f, workflowDir), 'utf8')),
  );
  assert.deepEqual(
    owners,
    ['ci.yml'],
    `only ci.yml may publish the required 'verify'/'integration' checks; found: ${owners.join(', ')}`,
  );
});

test('CI and local promotion run shared-state specs after the parallel browser lane', () => {
  const script = readFileSync(new URL('./verify-main-pr.sh', import.meta.url), 'utf8');
  for (const source of [workflow, script]) {
    const parallel = source.indexOf('playwright test --project=chromium --fail-on-flaky-tests');
    const serial = source.indexOf('playwright test --project=serial --workers=1 --fail-on-flaky-tests');
    assert.ok(parallel !== -1, 'parallel Chromium lane is missing');
    assert.ok(serial > parallel, 'shared-state specs must run later in their own serial invocation');
  }
});

test('the local PR-to-main simulation runs every gate before the served-function smoke', () => {
  const script = readFileSync(new URL('./verify-main-pr.sh', import.meta.url), 'utf8');
  const verify = script.indexOf('npm run verify:locked');
  const coverage = script.indexOf('npm run test:coverage');
  const changedLines = script.indexOf('changed-lines-coverage.mjs');
  const repositoryTests = script.indexOf('scripts/parallel-infra.test.mjs');
  const denoBoot = script.indexOf('scripts/deno-boot-smoke-edge-fns.sh');
  const denoUnit = script.indexOf('scripts/deno-test-edge-fns.sh');
  const pgtap = script.indexOf('supabase test db');
  const ordinaryE2e = script.indexOf('CI=true npx playwright test --project=chromium');
  const servedFunction = script.indexOf('scripts/serve-functions.sh');

  assert.ok(verify !== -1, 'full verify gate is missing');
  assert.ok(coverage > verify, 'CI-equivalent coverage suite must run after full verify');
  assert.ok(changedLines > coverage, 'changed-lines coverage gate must consume the fresh coverage report');
  assert.ok(repositoryTests > changedLines, 'repository-level CI contract tests must run after coverage');
  assert.ok(denoBoot > repositoryTests, 'Deno boot smoke must run after repository-level tests');
  assert.ok(denoUnit > denoBoot, 'Deno unit tests must run after boot smoke');
  assert.ok(pgtap > denoUnit, 'pgTAP must run after the non-DB gates');
  assert.ok(ordinaryE2e > pgtap, 'ordinary e2e must run after pgTAP');
  assert.ok(servedFunction > ordinaryE2e, 'served-function smoke must run last');
});

test('CI and the local simulation share the same Deno boot and unit-test scripts', () => {
  const script = readFileSync(new URL('./verify-main-pr.sh', import.meta.url), 'utf8');
  for (const command of [
    'bash scripts/deno-boot-smoke-edge-fns.sh',
    'bash scripts/deno-test-edge-fns.sh',
  ]) {
    assert.ok(workflow.includes(command), `CI is missing shared command: ${command}`);
    assert.ok(script.includes(command), `local simulation is missing shared command: ${command}`);
  }
});

test('shared Deno scripts discover the complete current function and test inventories', () => {
  const boot = readFileSync(new URL('./deno-boot-smoke-edge-fns.sh', import.meta.url), 'utf8');
  const unit = readFileSync(new URL('./deno-test-edge-fns.sh', import.meta.url), 'utf8');

  assert.match(boot, /find "\$FUNCTIONS_ROOT" .*index\.ts/);
  assert.doesNotMatch(boot, /for fn in agent-chat/);
  assert.match(unit, /find "\$FUNCTIONS_ROOT" .*\*\.test\.ts/);
  assert.doesNotMatch(unit, /for fn in adapter-dispatch/);
  assert.doesNotMatch(unit, /-maxdepth 2/);
  assert.match(boot, /inventory is empty/);
  assert.match(unit, /inventory is empty/);
});

test('the full verify gate enforces edge-function test binding', () => {
  assert.match(packageJson.scripts.verify, /check:edge-test-binding/);
  assert.equal(
    packageJson.scripts['check:edge-test-binding'],
    'node ../scripts/check-edge-fn-test-binding.mjs',
  );
});

test('gate-script-only changes still trigger CI', () => {
  assert.doesNotMatch(workflow, /paths-ignore:[\s\S]{0,240}- 'scripts\/\*\*'/);
});

test('authoritative CI-mode browser runs never reuse an unrelated Vite server', () => {
  const config = readFileSync(new URL('../pmo-portal/playwright.config.ts', import.meta.url), 'utf8');
  assert.match(config, /reuseExistingServer:\s*!process\.env\.CI/);
});

test('auth setup exposes transient login failures to Playwright flake detection', () => {
  const setup = readFileSync(new URL('../pmo-portal/e2e/auth.setup.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(setup, /SIGN_IN_ATTEMPTS|SIGN_IN_BACKOFF_MS/);
});

test('the project instructions bind PRs targeting main to the local simulation', () => {
  const instructions = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
  assert.match(instructions, /PR.*main[\s\S]*scripts\/verify-main-pr\.sh/i);
});

test('post-merge cleanup is verify-first and removes worktrees before branches', () => {
  const instructions = readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8');
  const playbook = readFileSync(new URL('../docs/director-playbook.md', import.meta.url), 'utf8');
  const environments = readFileSync(new URL('../docs/environments.md', import.meta.url), 'utf8');

  for (const source of [instructions, playbook, environments]) {
    const verifyMerge = source.search(/verify[^.\n]*merge/i);
    const captureHeadOid = source.search(/headRefOid/);
    const verifyLocalTip = source.search(/git rev-parse <branch>/i);
    const verifyRemoteTip = source.search(/git ls-remote --heads origin refs\/heads\/<branch>/i);
    const removeWorktree = source.search(/git worktree remove/i);
    const deleteLocal = source.search(/git branch -d/i);
    const deleteRemote = source.search(/git push origin --delete/i);

    assert.ok(verifyMerge !== -1, 'merge verification must be explicit');
    assert.ok(captureHeadOid > verifyMerge, 'cleanup must capture the immutable PR headRefOid');
    assert.ok(verifyLocalTip > captureHeadOid, 'local branch tip must be verified against headRefOid');
    assert.ok(verifyRemoteTip > captureHeadOid, 'remote branch tip must be verified against headRefOid');
    assert.ok(
      removeWorktree > Math.max(verifyLocalTip, verifyRemoteTip),
      'worktree removal must follow exact local and remote head verification',
    );
    assert.ok(deleteLocal > removeWorktree, 'local branch deletion must follow worktree removal');
    assert.ok(deleteRemote > deleteLocal, 'remote branch deletion must be last');
    assert.doesNotMatch(source, /git worktree remove --force/);
  }
});
