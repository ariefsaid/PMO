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

test('no Playwright retries anywhere: a failure runs once (with a trace) and a flake cannot be retried green', () => {
  // The CONTRACT is "no retry can mask a flake". With retries 0 there is nothing for
  // --fail-on-flaky-tests to catch, so the lanes no longer pass it; a retry re-introduced at the
  // config, CLI, or spec level must go red here instead.
  const config = readFileSync(new URL('../pmo-portal/playwright.config.ts', import.meta.url), 'utf8');
  assert.match(config, /^\s*retries: 0,/m, 'playwright.config.ts must set retries: 0 for every environment');
  assert.match(config, /trace: 'retain-on-failure'/, "failures must keep a trace ('on-first-retry' never fires without retries)");
  const script = readFileSync(new URL('./verify-main-pr.sh', import.meta.url), 'utf8');
  for (const source of [workflow, script]) assert.doesNotMatch(source, /--retries/);
  const e2eDir = new URL('../pmo-portal/e2e/', import.meta.url);
  const specs = readdirSync(e2eDir, { recursive: true }).filter((f) => /\.ts$/.test(f));
  assert.ok(specs.length > 0, 'no e2e sources found — this gate would have scanned nothing');
  for (const f of specs) {
    const code = readFileSync(new URL(f, e2eDir), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    assert.doesNotMatch(code, /\bretries:\s*[1-9]/, `${f} re-introduces a retry`);
  }
  assert.match(workflow, /playwright test --project=chromium/);
  assert.match(workflow, /playwright test --project=serial --workers=1/);
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
    /- name: Serve adapter-dispatch \(served-fn lane smoke\)[\s\S]{0,800}playwright test served-fn-smoke --project=chromium/,
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
    const parallel = source.indexOf('playwright test --project=chromium');
    const serial = source.indexOf('playwright test --project=serial --workers=1');
    assert.ok(parallel !== -1, 'parallel Chromium lane is missing');
    assert.ok(serial > parallel, 'shared-state specs must run later in their own serial invocation');
  }
});

test('the local PR-to-main simulation runs every gate before the served-function smoke', () => {
  const script = readFileSync(new URL('./verify-main-pr.sh', import.meta.url), 'utf8');
  const verify = script.indexOf('npm run check:guards');
  const coverage = script.indexOf('npm run test:coverage');
  const changedLines = script.indexOf('changed-lines-coverage.mjs');
  const repositoryTests = script.indexOf('scripts/parallel-infra.test.mjs');
  const denoBoot = script.indexOf('scripts/deno-boot-smoke-edge-fns.sh');
  const denoUnit = script.indexOf('scripts/deno-test-edge-fns.sh');
  const pgtap = script.indexOf('supabase test db');
  const ordinaryE2e = script.indexOf('CI=true npx playwright test --project=chromium');
  const servedFunction = script.indexOf('scripts/serve-functions.sh');

  assert.ok(verify !== -1, 'repo guards are missing');
  assert.ok(coverage > verify, 'CI-equivalent coverage suite must run after the guards');
  // The unit suite runs ONCE: coverage IS the suite (a plain `npm test`/`verify` would repeat it).
  assert.doesNotMatch(script, /npm run verify|npm (run )?test(\s|$)/m, 'the unit suite must run only once (under coverage)');
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

test('AC-RDR-006: CI wires the redirect-target guard and its self-test', () => {
  assert.equal(packageJson.scripts['check:redirect-targets'], 'node ../scripts/check-redirect-targets.mjs');
  // The guard itself runs via check:guards (asserted to run in CI below); the self-test directly.
  assert.match(packageJson.scripts['check:guards'], /npm run check:redirect-targets(\s|$)/);
  const verifyJob = workflow.slice(workflow.indexOf('  verify:'), workflow.indexOf('  integration:'));
  assert.match(verifyJob, /node scripts\/check-redirect-targets\.mjs --self-test/);
  assert.match(verifyJob, /run: npm run check:guards/);
});

test('every repo guard runs in CI: check:guards holds every check:* and CI verify runs it early', () => {
  // Six guards ran only in `npm run verify` (never in CI) until 2026-09-30 — once the local promote
  // gate became reproduction-only they ran nowhere. One list, run by both, cannot drift.
  const { scripts } = packageJson;
  const defined = Object.keys(scripts).filter((n) => n.startsWith('check:') && n !== 'check:guards');
  assert.ok(defined.length > 0, 'no check:* scripts found — this gate would have scanned nothing');
  const inGuards = [...scripts['check:guards'].matchAll(/npm run (check:[\w-]+)/g)].map((m) => m[1]);
  assert.deepEqual([...inGuards].sort(), [...defined].sort(), 'check:guards must run every check:* script');
  assert.match(scripts.verify, /^npm run check:guards && /, 'verify must start with check:guards');
  assert.deepEqual(scripts.verify.match(/\bcheck:[\w-]+/g), ['check:guards'], 'verify must reach guards only via check:guards');

  const verifyJob = workflow
    .slice(workflow.indexOf('\n  verify:'), workflow.indexOf('\n  pgtap:'))
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  const at = (s) => verifyJob.indexOf(s);
  assert.ok(at('run: npm ci') !== -1, 'verify job has no npm ci step — slice is wrong');
  assert.ok(at('run: npm run check:guards') > at('run: npm ci'), 'CI must run check:guards after npm ci');
  assert.ok(at('run: npm run check:guards') < at('run: npm run typecheck'), 'guards must run before typecheck');
  // Cheap failures first: typecheck and lint before the (slow) unit + coverage suite.
  assert.ok(at('run: npm run typecheck') < at('run: npm run test:coverage'), 'typecheck must precede unit tests');
  assert.ok(
    at('run: npm run lint:ci') !== -1 && at('run: npm run lint:ci') < at('run: npm run test:coverage'),
    'lint must precede unit tests',
  );
});

test('a dispatched e2e run skips verify and pgTAP; the PR-to-main integration gate keeps pgTAP', () => {
  const verifyJob = workflow.slice(workflow.indexOf('\n  verify:'), workflow.indexOf('\n  pgtap:'));
  assert.match(verifyJob, /\n    if: github\.event_name != 'workflow_dispatch'\n/);
  const integration = workflow.slice(workflow.indexOf('\n  integration:'));
  assert.match(
    integration,
    /if: github\.event_name != 'workflow_dispatch' \|\| inputs\.run_pgtap\n\s+run: supabase test db/,
    'pgTAP in integration must be skipped ONLY on a dispatch (never on the PR-to-main gate)',
  );
  const dispatcher = readFileSync(new URL('./ci-e2e.sh', import.meta.url), 'utf8');
  assert.match(dispatcher, /--ref "\$branch" -f run_pgtap="\$pgtap"/);
});

test('the full verify gate enforces edge-function test binding', () => {
  assert.match(packageJson.scripts['check:guards'], /check:edge-test-binding/);
  assert.equal(
    packageJson.scripts['check:edge-test-binding'],
    'node ../scripts/check-edge-fn-test-binding.mjs',
  );
});

test('gate-script-only changes still trigger CI', () => {
  assert.doesNotMatch(workflow, /paths-ignore:[\s\S]{0,240}- 'scripts\/\*\*'/);
});

test('authoritative browser runs own their Vite servers', () => {
  const config = readFileSync(new URL('../pmo-portal/playwright.config.ts', import.meta.url), 'utf8');
  assert.equal((config.match(/reuseExistingServer:\s*false/g) ?? []).length, 2);
});

test('auth setup exposes transient login failures to Playwright flake detection', () => {
  const setup = readFileSync(new URL('../pmo-portal/e2e/auth.setup.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(setup, /SIGN_IN_ATTEMPTS|SIGN_IN_BACKOFF_MS/);
});

test('the project instructions name CI as the PR-to-main gate and verify-main-pr.sh as its local reproduction', () => {
  const instructions = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
  assert.match(instructions, /PRs to `main` gate on CI's `verify` \+ `integration`/);
  assert.match(instructions, /scripts\/verify-main-pr\.sh[\s\S]*reproduces CI's PR-to-`main` run/);
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
