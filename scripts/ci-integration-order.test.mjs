import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const packageJson = JSON.parse(
  readFileSync(new URL('../pmo-portal/package.json', import.meta.url), 'utf8'),
);

test('repository script tests run after npm ci installs their dependencies', () => {
  const install = workflow.indexOf('run: npm ci', workflow.indexOf('\n  checks:'));
  const tests = workflow.indexOf('- name: Repository script tests (non-DB)');

  assert.notEqual(install, -1, 'checks must install npm dependencies');
  assert.notEqual(tests, -1, 'checks must run repository script tests');
  assert.ok(tests > install, 'repository script tests that spawn checked-in CLIs must run after npm ci');
});

test('every scripts/*.test.mjs file is assigned to a CI test step', () => {
  const scriptTests = readdirSync(new URL('../scripts/', import.meta.url))
    .filter((file) => file.endsWith('.test.mjs'));
  const databaseTests = [
    'financial-statements-publication-race.test.mjs',
    'financial-statements-rollback.test.mjs',
    'financial-statements-nightly-intent-race.test.mjs',
  ];
  const nonDatabase = workflow.match(/find scripts[^\n]+/);
  assert.ok(nonDatabase, 'CI must discover non-database script tests by glob');
  for (const file of scriptTests) {
    if (databaseTests.includes(file)) {
      assert.ok(workflow.includes(`scripts/${file}`), `${file} must run after Supabase starts`);
      assert.match(nonDatabase[0], new RegExp(`! -name '${file}'`), `${file} must not be run before Supabase starts`);
    }
  }
  const provesCoverage = (text) => {
    assert.match(text, /find scripts -maxdepth 1 -name '\*\.test\.mjs'/);
    for (const file of databaseTests) assert.ok(text.includes(`scripts/${file}`), `${file} is missing from CI`);
  };
  provesCoverage(workflow);
  assert.throws(() => provesCoverage(workflow.replace(/scripts\/financial-statements-rollback\.test\.mjs/g, '')),
    /financial-statements-rollback\.test\.mjs is missing from CI/);
  // The release path must run the two-session interleaving proof too, not only the PR-to-dev job:
  // a harness that only runs before a dev merge would never gate a promote to main.
  const integrationJob = workflow.slice(workflow.indexOf('\n  integration-lanes:'));
  const integrationReset = integrationJob.indexOf('supabase db reset');
  const integrationRace = integrationJob.indexOf('scripts/financial-statements-nightly-intent-race.test.mjs');
  assert.ok(integrationRace !== -1, 'integration (PR-to-main release gate) must run the owning nightly-intent race proof');
  assert.ok(integrationReset !== -1 && integrationRace > integrationReset,
    'the race proof needs the released schema: it must run after the reset');
  const checksJob = workflow.slice(workflow.indexOf('\n  checks:'), workflow.indexOf('\n  deno:'));
  assert.doesNotMatch(checksJob, /node --test[^\n]*scripts\/[^ \n]+\.test\.mjs/,
    'script tests must run only through the repository-test glob, not hand-picked duplicates');

});

test('AC-BSH-003 release lanes run beside three balanced Chromium shards and a required aggregate closes the gate', () => {
  const browser = workflow.slice(workflow.indexOf('  browser-chromium:'), workflow.indexOf('  integration-lanes:'));
  const integrationLanes = workflow.slice(workflow.indexOf('\n  integration-lanes:'), workflow.indexOf('\n  integration:'));
  const integrationGate = workflow.slice(workflow.indexOf('\n  integration:'));
  assert.match(browser, /shard: \[1, 2, 3\]/);
  assert.match(browser, /max-parallel: 3/);
  assert.match(browser, /fail-fast: false/);
  assert.match(browser, /--shard=\$\{\{ matrix\.shard \}\}\/\$\{\{ strategy\.job-total \}\}/);
  assert.match(integrationLanes, /needs: \[scope\]/);
  assert.doesNotMatch(integrationLanes, /needs:.*browser-chromium/);
  for (const step of ['serial_e2e', 'consent_e2e', 'serve_adapter_dispatch']) {
    assert.ok(integrationLanes.includes(`${step}: \${{ steps.${step}.outcome }}`));
    assert.match(integrationLanes, new RegExp(`id: ${step}[\\s\\S]*?continue-on-error: true`));
  }
  assert.match(integrationGate, /needs: \[browser-chromium, integration-lanes\]/);
  assert.match(workflow, /name: browser-chromium-\$\{\{ matrix\.shard \}\}/);
  assert.match(workflow, /browser-shard-\$\{\{ matrix\.shard \}\}\.json/);
  assert.match(workflow, /GITHUB_RUN_ID[\s\S]*GITHUB_RUN_ATTEMPT[\s\S]*GITHUB_SHA/);
  assert.match(integrationGate, /Verify Chromium shard provenance and completeness[\s\S]*processOutcome !== 'success'/);
  assert.match(integrationGate, /E2E skip audit[\s\S]*if: \$\{\{ always\(\) && !cancelled\(\) \}\}/);
  assert.match(integrationGate, /E2E timing budget audit[\s\S]*if: \$\{\{ always\(\) && !cancelled\(\) \}\}/);
  assert.match(integrationGate, /Required integration result requires all browser evidence and audits[\s\S]*needs\.browser-chromium\.result/);
  const gateStart = integrationGate.indexOf('- name: Required integration result requires all browser evidence and audits');
  const nextGateStep = integrationGate.indexOf('\n      - name:', gateStart + 1);
  const gateEnd = nextGateStep === -1 ? integrationGate.length : nextGateStep;
  assert.ok(gateStart !== -1 && gateEnd > gateStart, 'required integration gate bounds are invalid');
  const gate = integrationGate.slice(gateStart, gateEnd);
  for (const expression of [
    'needs.browser-chromium.result',
    'needs.integration-lanes.result',
    'needs.integration-lanes.outputs.serial_e2e',
    'needs.integration-lanes.outputs.consent_e2e',
    'needs.integration-lanes.outputs.serve_adapter_dispatch',
    'steps.chromium_artifact_1.outcome',
    'steps.chromium_artifact_2.outcome',
    'steps.chromium_artifact_3.outcome',
    'steps.integration_reports.outcome',
  ]) assert.ok(gate.includes(expression), `required integration gate must inspect ${expression}`);
  for (const step of ['chromium_inventory', 'chromium_evidence', 'e2e_skip_audit', 'e2e_timing_audit']) {
    assert.ok(gate.includes(`steps.${step}.outcome`), `gate must require ${step} to succeed`);
    assert.ok(gate.includes(`test "\${{ steps.${step}.outcome }}" = success`), `gate must fail closed when ${step} is red`);
  }
  assert.match(browser, /denoland\/setup-deno@[a-f0-9]+[\s\S]*deno-version: ['\"]2\.7\.11['\"]/);
  const diagnosticsStart = browser.indexOf('- name: Upload Chromium shard Playwright diagnostics');
  const diagnosticsEnd = browser.indexOf('  integration-lanes:', diagnosticsStart);
  const diagnostics = browser.slice(diagnosticsStart, diagnosticsEnd);
  assert.ok(diagnostics.includes('if: ${{ failure() }}'));
  assert.ok(diagnostics.includes('pmo-portal/playwright-report/'));
  assert.ok(diagnostics.includes('/tmp/pmo-portal-test-results/'));
  assert.ok(diagnostics.includes('name: browser-chromium-playwright-${{ matrix.shard }}'));
});

test('AC-BSH-001 inventory guard self-test rejects incomplete shard coverage', () => {
  const result = spawnSync(process.execPath, ['scripts/check-browser-shard-inventory.mjs', '--self-test'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /self-test OK/);
  assert.match(workflow, /node scripts\/check-browser-shard-inventory\.mjs --self-test/);
});

test('served-function smoke and consent run before the serial e2e lane', () => {
  const e2eStep = workflow.indexOf('- name: E2E tests (Playwright / serial)');
  const servedFunctionStep = workflow.indexOf('- name: Serve adapter-dispatch (served-fn lane smoke)');
  const restoreStep = workflow.indexOf('- name: Restore ordinary local stack after served smoke');
  const consentStep = workflow.indexOf('- name: E2E tests (Playwright / consent)');

  assert.notEqual(e2eStep, -1, 'serial e2e step is missing');
  assert.notEqual(servedFunctionStep, -1, 'served-function smoke step is missing');
  assert.notEqual(restoreStep, -1, 'ordinary stack must be restored after served smoke');
  assert.notEqual(consentStep, -1, 'consent e2e step is missing');
  assert.ok(servedFunctionStep < restoreStep && restoreStep < consentStep, 'restore the stack between served smoke and later e2e lanes');
  assert.ok(consentStep < e2eStep, 'consent lane should fail early, before serial e2e');
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
  assert.match(workflow, /PLAYWRIGHT_JSON_OUTPUT_NAME=\/tmp\/pw-chromium-\$\{\{ matrix\.shard \}\}\.json/);
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

test('the local PR-to-main simulation matches CI lane order after pgTAP', () => {
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
  const restoreStack = script.indexOf('supabase start -x studio,realtime,vector', servedFunction);
  const consentE2e = script.indexOf('CI=true npx playwright test --project=consent');
  const serialE2e = script.indexOf('CI=true npx playwright test --project=serial --workers=1');

  assert.ok(verify !== -1, 'repo guards are missing');
  assert.ok(coverage > verify, 'CI-equivalent coverage suite must run after the guards');
  // The unit suite runs ONCE: coverage IS the suite (a plain `npm test`/`verify` would repeat it).
  assert.doesNotMatch(script, /npm run verify|npm (run )?test(\s|$)/m, 'the unit suite must run only once (under coverage)');
  assert.ok(changedLines > coverage, 'changed-lines coverage gate must consume the fresh coverage report');
  assert.ok(repositoryTests > changedLines, 'repository-level CI contract tests must run after coverage');
  assert.ok(denoBoot > repositoryTests, 'Deno boot smoke must run after repository-level tests');
  assert.ok(denoUnit > denoBoot, 'Deno unit tests must run after boot smoke');
  assert.ok(pgtap > denoUnit, 'pgTAP must run after the non-DB gates');
  assert.ok(ordinaryE2e > pgtap, 'Chromium e2e must run after pgTAP');
  assert.ok(servedFunction > ordinaryE2e, 'served-function smoke must run after Chromium');
  assert.ok(restoreStack > servedFunction, 'restart Supabase after the served function smoke');
  assert.ok(consentE2e > restoreStack, 'consent lane must run after stack restoration');
  assert.ok(serialE2e > consentE2e, 'serial lane must run after consent');
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
  const checksJob = workflow.slice(workflow.indexOf('\n  checks:'), workflow.indexOf('\n  deno:'));
  assert.match(checksJob, /node scripts\/check-redirect-targets\.mjs --self-test/);
  assert.match(checksJob, /run: npm run check:guards/);
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

  const checksJob = workflow
    .slice(workflow.indexOf('\n  checks:'), workflow.indexOf('\n  deno:'))
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  const at = (s) => checksJob.indexOf(s);
  assert.ok(at('run: npm ci') !== -1, 'checks job has no npm ci step — slice is wrong');
  assert.ok(at('run: npm ci') < at('CI integration-order test'), 'repository tests that spawn Playwright/Vitest must run after npm ci');
  assert.ok(at('run: npm run check:guards') > at('run: npm ci'), 'CI must run check:guards after npm ci');
  assert.ok(at('run: npm run check:guards') < at('run: npm run typecheck'), 'guards must run before typecheck');

  // #2161: the static half of the old `verify` must NOT wait for the shards — it needs `scope`
  // only, so it overlaps `unit`. Re-adding `unit` to its `needs` silently restores the ~32-min
  // serial run this issue removed, so it is asserted, not merely commented.
  assert.match(checksJob, /\n    needs: \[scope\]\n/, 'checks must need scope only (runs in parallel with unit)');

  // The test-report half: the shard blobs merge here, before the changed-lines gate, and it needs
  // only `unit` so it lands while `checks` is still running.
  const coverageJob = workflow
    .slice(workflow.indexOf('\n  coverage:'), workflow.indexOf('\n  verify:'))
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  assert.match(coverageJob, /\n    needs: \[scope, unit\]\n/, 'coverage must merge the unit shards');
  const merge = coverageJob.indexOf('run: npx vitest run --merge-reports --coverage');
  assert.ok(merge !== -1, 'coverage job must merge the shard reports');
  assert.ok(merge < coverageJob.indexOf('Changed-lines coverage gate'), 'shard coverage must merge before the gate');
  assert.match(coverageJob, /node scripts\/changed-lines-coverage\.mjs/, 'the ≥80% changed-lines gate lives in coverage');

  // The required context is the aggregate: it must fail (not skip) when a shard fails, and it must
  // depend on every verify-stage job — otherwise a red unit test could merge behind a green `verify`.
  const verifyJob = workflow
    .slice(workflow.indexOf('\n  verify:'), workflow.indexOf('\n  pgtap:'))
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  assert.match(verifyJob, /\n    needs: \[scope, checks, deno, unit, coverage\]\n/, 'verify must need every verify-stage job');
  for (const dependency of ['scope', 'checks', 'unit', 'coverage']) {
    assert.ok(
      verifyJob.includes(`test "\${{ needs.${dependency}.result }}" = success`),
      `verify must fail when ${dependency} did not succeed`,
    );
  }
  // The deno lane is conditional (scope.deno), so its assertion is conditional too — under exactly
  // the condition that scheduled it, so a skipped-but-required lane can never pass silently.
  assert.match(
    verifyJob,
    /- name: Edge-function lane passed \(when it ran\)\n        if: needs\.scope\.outputs\.deno == 'true'\n        run: test "\$\{\{ needs\.deno\.result \}\}" = success/,
    'verify must fail when the deno lane failed, and skip the assertion only when the lane was not scheduled',
  );
  assert.match(
    verifyJob,
    /\n    if: \$\{\{ !cancelled\(\) && github\.event_name != 'workflow_dispatch' \}\}\n/,
    'verify must run (and fail) when a shard failed — a skipped required check passes',
  );

  const unitJob = workflow.slice(workflow.indexOf('\n  unit:'), workflow.indexOf('\n  checks:'));
  assert.match(unitJob, /fromJSON\(needs\.scope\.outputs\.unit_matrix\)/, 'unit matrix comes from the scope job');
  assert.match(
    workflow,
    /"include":\[\{"shard":1,"mode":"full"\},\{"shard":2,"mode":"full"\},\{"shard":3,"mode":"full"\},\{"shard":4,"mode":"full"\}\]/,
    'full mode must run four shards (#2161)',
  );
  assert.match(
    workflow,
    /"include":\[\{"shard":1,"mode":"affected"\}\]/,
    'affected mode (PR to dev) stays one runner (#1584)',
  );
  assert.match(
    unitJob,
    /--coverage --shard=\$\{\{ matrix\.shard \}\}\/\$\{\{ strategy\.job-total \}\} .*--reporter=blob/,
    'each shard must record coverage and derive the shard count from the matrix',
  );
  assert.match(unitJob, /vitest run --coverage --reporter=default --reporter=blob "\$\{files\[@\]\}"/, 'affected mode must record coverage too');
  assert.match(unitJob, /timeout-minutes: 40/, 'unit job must have a timeout (#1528)');
});

test('AC-CI-002/003/004: scope narrows only a PR to dev; dev pushes run everything', () => {
  // Everything but a PR to dev is forced to full — in the workflow, not in the script.
  assert.match(workflow, /if \[ "\$EVENT" = pull_request \] && \[ "\$BASE_REF" = dev \]; then/);
  assert.match(workflow, /"unit":"full","pgtap":true,"deno":true/);
  assert.match(workflow, /\n    branches: \[main, dev\]\n/, 'push CI covers dev');
  const pgtap = workflow.slice(workflow.indexOf('\n  pgtap:'), workflow.indexOf('\n  browser-chromium:'));
  assert.match(pgtap, /needs\.scope\.outputs\.pgtap == 'true'/);
  assert.match(pgtap, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/dev'/, 'pgTAP is part of the full run on push to dev');
  const checksJob = workflow.slice(workflow.indexOf('\n  checks:'), workflow.indexOf('\n  deno:'));
  assert.match(checksJob, /node scripts\/ci-test-scope\.mjs --self-test/);

  // #2161: the edge-function lane is its own job, scheduled ONLY when the diff can affect it
  // (#1584). The gate moved from each step's `if:` to the job's, so the whole lane — and its runner
  // — is skipped rather than started and idled; `verify` re-asserts the result under the same
  // condition.
  const denoJob = workflow.slice(workflow.indexOf('\n  deno:'), workflow.indexOf('\n  coverage:'));
  assert.match(
    denoJob,
    /\n    if: \$\{\{ !cancelled\(\) && github\.event_name != 'workflow_dispatch' && needs\.scope\.outputs\.deno == 'true' \}\}\n/,
    'the deno job must be gated on scope.deno',
  );
  for (const step of ['denoland/setup-deno', 'bash scripts/deno-typecheck-edge-fns.sh', 'bash scripts/deno-boot-smoke-edge-fns.sh', 'bash scripts/deno-test-edge-fns.sh']) {
    assert.ok(denoJob.includes(step), `${step} must live in the deno lane`);
  }
  assert.doesNotMatch(checksJob, /scripts\/deno-/, 'the Deno steps must not drift back into checks (that re-serialises ~9 min)');
});

test('a dispatched e2e run skips verify and pgTAP; the PR-to-main integration gate keeps pgTAP', () => {
  const verifyJob = workflow.slice(workflow.indexOf('\n  verify:'), workflow.indexOf('\n  pgtap:'));
  assert.match(verifyJob, /\n    if: \$\{\{ !cancelled\(\) && github\.event_name != 'workflow_dispatch' \}\}\n/);
  const unitJob = workflow.slice(workflow.indexOf('\n  unit:'), workflow.indexOf('\n  checks:'));
  assert.match(unitJob, /\n    if: github\.event_name != 'workflow_dispatch'\n/);
  const integration = workflow.slice(workflow.indexOf('\n  integration-lanes:'), workflow.indexOf('\n  integration:'));
  assert.match(
    integration,
    /if: github\.event_name != 'workflow_dispatch' \|\| inputs\.run_pgtap\n\s+run: supabase test db/,
    'pgTAP in integration must be skipped ONLY on a dispatch (never on the PR-to-main gate)',
  );
  const dispatcher = readFileSync(new URL('./ci-e2e.sh', import.meta.url), 'utf8');
  assert.match(
    dispatcher,
    /coordinator=\(node "\$SCRIPT_DIR\/lib\/ci-dispatch-reservations\.mjs" coordinate/,
    'the locked wrapper must delegate dispatch to the reservation coordinator',
  );
  assert.match(dispatcher, /exec "\$\{coordinator\[@\]\}"/, 'the wrapper must execute the coordinator argv');

  // The argument owner moved from this Bash wrapper into the coordinator. Keep the literal
  // branch and PR-dependent pgTAP contract bound to that owner; the coordinator process test
  // exercises the actual argv for both PR states and for a shell-significant branch value.
  const coordinator = readFileSync(new URL('./lib/ci-dispatch-reservations.mjs', import.meta.url), 'utf8');
  assert.match(
    coordinator,
    /function dispatchArgs\(repo, workflow, branch, pr\) \{\s*const runPgtap = pr === null \? 'true' : 'false';\s*return \['workflow', 'run', workflow, '-R', repo, '--ref', branch, '-f', `run_pgtap=\$\{runPgtap\}`\];\s*\}/,
    'the coordinator must pass branch as one argv value and preserve run_pgtap for absent/present PRs',
  );
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

test('#1968 CI browser e2e serves a production build; the dev server stays local', () => {
  const config = readFileSync(new URL('../pmo-portal/playwright.config.ts', import.meta.url), 'utf8');
  // The mode switch: E2E_SERVER=dev|build, CI defaults to the production build, local keeps dev.
  assert.match(config, /E2E_SERVER/, 'the e2e server mode must be switchable via E2E_SERVER');
  assert.match(
    config,
    /process\.env\.CI\s*\?\s*'build'\s*:\s*'dev'/,
    'CI must default to the production build; local runs keep the dev server (E2E_SERVER=dev|build)',
  );
  // Build mode must serve a REAL production bundle: vite build, then vite preview on the same ports.
  assert.match(config, /vite build/, 'build mode must run vite build');
  assert.match(config, /vite preview/, 'build mode must serve the bundle with vite preview');
  // The dev-server command stays available for local runs (E2E_SERVER=dev).
  assert.match(config, /'npm run dev/, 'local runs must keep the dev server');
  // The two lanes build to SEPARATE output dirs: Playwright starts both webServers concurrently,
  // and two concurrent vite builds cannot share one dist/.
  assert.match(
    config,
    /dist-consent/,
    'the analytics (:3100) lane must build to its own outDir — it cannot share dist/ with the :3000 lane',
  );
  // Polarity: CI must never pin the dev server — the whole point of #1968 is serving the build there.
  assert.doesNotMatch(workflow, /E2E_SERVER:\s*['"]?dev/);
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

test('AC-TH-006 timing audit reuses every JSON lane after both release jobs and retains only the safe summary', () => {
  const checksStart = workflow.indexOf('\n  checks:');
  const coverageStart = workflow.indexOf('\n  coverage:');
  assert.ok(checksStart !== -1 && coverageStart > checksStart, 'checks job bounds are invalid');
  const checksJob = workflow.slice(checksStart, coverageStart);
  assert.match(checksJob, /node scripts\/check-e2e-time-budget\.mjs --self-test/);

  const ordinaryStart = workflow.indexOf('- name: E2E tests (Playwright / serial)');
  const consentStart = workflow.indexOf('- name: E2E tests (Playwright / consent)');
  const skipStart = workflow.indexOf('- name: E2E skip audit — every skip is explained');
  const auditStart = workflow.indexOf('- name: E2E timing budget audit');
  const uploadStart = workflow.indexOf('- name: Upload E2E timing summary');
  const servedStart = workflow.indexOf('- name: Serve adapter-dispatch (served-fn lane smoke)');
  for (const [label, at] of [['ordinary E2E', ordinaryStart], ['consent E2E', consentStart], ['skip audit', skipStart], ['timing audit', auditStart], ['timing summary upload', uploadStart], ['served smoke', servedStart]]) {
    assert.notEqual(at, -1, `${label} step is missing`);
  }
  const nextStep = at => workflow.indexOf('\n      - name:', at + 1);
  const ordinaryEnd = nextStep(ordinaryStart);
  const skipEnd = nextStep(skipStart);
  const auditEnd = nextStep(auditStart);
  const uploadEnd = nextStep(uploadStart);
  assert.ok(ordinaryEnd > ordinaryStart && skipEnd > skipStart && auditEnd > auditStart && uploadEnd > uploadStart, 'step bounds are invalid');
  const ordinary = workflow.slice(ordinaryStart, ordinaryEnd);
  const skip = workflow.slice(skipStart, skipEnd);
  const auditStep = workflow.slice(auditStart, auditEnd);
  const uploadStep = workflow.slice(uploadStart, uploadEnd);
  const servedSmoke = workflow.slice(servedStart);

  assert.match(ordinary, /id: serial_e2e/);
  assert.match(ordinary, /--project=serial --workers=1/);
  assert.match(ordinary, /continue-on-error: true/);
  assert.equal((ordinary.match(/npx playwright test/g) ?? []).length, 1, 'serial remains a single-worker invocation; Chromium runs only in the matrix');
  assert.equal(workflow.split('PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/pw-consent.json npx playwright test --project=consent --reporter=list,json').length - 1, 1, 'consent remains exactly once');
  assert.match(workflow, /E2E tests \(Playwright \/ consent\)[\s\S]*if: \$\{\{ always\(\) && !cancelled\(\) \}\}[\s\S]*continue-on-error: true/);
  assert.ok(servedStart < consentStart && consentStart < ordinaryStart, 'served smoke and consent must precede serial');
  assert.match(skip, /node scripts\/check-e2e-skips\.mjs \/tmp\/browser-shards\/1\/pw-chromium-1\.json \/tmp\/browser-shards\/2\/pw-chromium-2\.json \/tmp\/browser-shards\/3\/pw-chromium-3\.json \/tmp\/integration-reports\/pw-serial\.json \/tmp\/integration-reports\/pw-consent\.json/);
  assert.ok(skipStart > ordinaryStart && auditStart > skipStart, 'aggregate audits must follow the browser, consent, and serial reports');

  const condition = /if: \$\{\{\s*always\(\)\s*&&\s*!cancelled\(\)\s*\}\}/;
  assert.match(auditStep, condition, 'audit must still run after a failed or missing browser shard');
  assert.match(auditStep, /node scripts\/check-e2e-time-budget\.mjs --summary \/tmp\/pw-time-budget-summary\.json \/tmp\/browser-shards\/1\/pw-chromium-1\.json \/tmp\/browser-shards\/2\/pw-chromium-2\.json \/tmp\/browser-shards\/3\/pw-chromium-3\.json \/tmp\/integration-reports\/pw-serial\.json \/tmp\/integration-reports\/pw-consent\.json/);
  assert.doesNotMatch(auditStep, /npx playwright test/);
  assert.match(uploadStep, condition, 'summary upload must run when the audit or a browser lane failed');
  assert.match(uploadStep, /uses: actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(uploadStep, /name: e2e-time-budget-summary/);
  assert.match(uploadStep, /path: \/tmp\/pw-time-budget-summary\.json/);
  assert.match(uploadStep, /retention-days: 7/);
  assert.match(uploadStep, /if-no-files-found: error/);
  assert.doesNotMatch(uploadStep, /pw-(chromium|serial|consent)\.json/);
  assert.ok(uploadEnd > auditStart, 'summary must be retained after the aggregate timing audit');
  assert.match(servedSmoke, /playwright test served-fn-smoke --project=chromium/);
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
