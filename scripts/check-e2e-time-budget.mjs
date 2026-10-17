import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TEST_STATUSES = new Set(['expected', 'unexpected', 'flaky', 'skipped']);
const ATTEMPT_STATUSES = new Set(['passed', 'failed', 'timedOut', 'interrupted', 'skipped']);
const ACTION = 'split the journey; preserve its oracles and timeout';
const SELF_TEST_LABEL = 'AC-TH timing-audit self-test';
const ABSOLUTE_PATH_IN_IDENTITY = /(?:^|[\s("'`])\/|(?:^|[\s("'`])[A-Za-z]:[\\/]|(?:^|[\s("'`])\\\\/;

function reportBasename(source) {
  if (typeof source !== 'string' || source.length === 0) return 'report';
  const basename = path.posix.basename(source.replaceAll('\\', '/'));
  return basename.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240) || 'report';
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeIdentity(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 2000
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !ABSOLUTE_PATH_IN_IDENTITY.test(value);
}

function relativeFile(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1000 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')) return null;
  const segments = normalized.split('/');
  if (segments.some(segment => segment === '..')) return null;
  const clean = path.posix.normalize(normalized);
  if (!clean || clean === '.' || clean === '..' || clean.startsWith('../')) return null;
  return clean;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function parseBudget(annotations, timeoutMs) {
  if (!Array.isArray(annotations)) return { ok: false, code: 'invalid-annotations', budgetMs: null };
  let budgetAnnotation;
  for (const annotation of annotations) {
    if (!isRecord(annotation) || typeof annotation.type !== 'string') {
      return { ok: false, code: 'invalid-annotations', budgetMs: null };
    }
    if (annotation.type !== 'time-budget-ms') continue;
    if (budgetAnnotation) return { ok: false, code: 'duplicate-time-budget', budgetMs: null };
    budgetAnnotation = annotation;
  }
  if (!budgetAnnotation) return { ok: true, budgetMs: null };
  const description = budgetAnnotation.description;
  if (typeof description !== 'string' || !/^[1-9]\d*$/.test(description)) {
    return { ok: false, code: 'invalid-time-budget', budgetMs: null };
  }
  const budgetMs = Number(description);
  if (!positiveInteger(budgetMs) || budgetMs >= timeoutMs) {
    return { ok: false, code: 'invalid-time-budget', budgetMs: null };
  }
  return { ok: true, budgetMs };
}

/** Audit already-collected Playwright JSON reports; no browser or filesystem I/O occurs here. */
export function audit(inputs) {
  const measurements = [];
  const issues = [];
  const counts = { executed: 0, skipped: 0, warnings: 0, failures: 0 };
  let complete = true;

  function issue(source, code, { incomplete = true } = {}) {
    issues.push({ source: reportBasename(source), code });
    counts.failures += 1;
    if (incomplete) complete = false;
  }

  if (!Array.isArray(inputs) || inputs.length === 0) {
    issue('input', 'no-inputs');
    issue('input', 'no-executed-results');
    return { schemaVersion: 1, complete: false, ok: false, measurements, issues, counts };
  }

  for (const input of inputs) {
    const source = isRecord(input) ? input.source : undefined;
    if (!isRecord(input) || typeof source !== 'string' || source.length === 0) {
      issue('report', 'invalid-input');
      continue;
    }
    if (Object.hasOwn(input, 'inputError')) {
      const allowedCodes = new Set(['missing-report', 'read-error', 'invalid-json']);
      const code = allowedCodes.has(input.inputError) ? input.inputError : 'input-error';
      issue(source, code);
      continue;
    }
    const report = input.report;
    if (!isRecord(report) || !Array.isArray(report.suites) || !Array.isArray(report.errors)) {
      issue(source, 'invalid-report-shape');
      continue;
    }
    if (report.errors.length > 0) issue(source, 'report-errors');

    function visitSuite(suite, ancestorTitles, inheritedFile) {
      if (!isRecord(suite) || !safeIdentity(suite.title)) {
        issue(source, 'invalid-suite');
        return;
      }
      const suiteFile = typeof suite.file === 'string' ? suite.file : inheritedFile;
      const titles = [...ancestorTitles, suite.title];
      if (!Array.isArray(suite.suites)) issue(source, 'missing-suites');
      if (!Array.isArray(suite.specs)) issue(source, 'missing-specs');

      if (Array.isArray(suite.specs)) {
        for (const spec of suite.specs) visitSpec(spec, titles, suiteFile);
      }
      if (Array.isArray(suite.suites)) {
        for (const child of suite.suites) visitSuite(child, titles, suiteFile);
      }
    }

    function visitSpec(spec, suiteTitles, inheritedFile) {
      if (!isRecord(spec)) {
        issue(source, 'invalid-spec');
        return;
      }
      if (!Array.isArray(spec.tests)) {
        issue(source, 'missing-tests');
        return;
      }
      for (const test of spec.tests) visitTest(test, spec, suiteTitles, inheritedFile);
    }

    function visitTest(test, spec, suiteTitles, inheritedFile) {
      if (!isRecord(test)) {
        issue(source, 'invalid-test');
        return;
      }
      const testStatus = test.status;
      if (typeof testStatus !== 'string' || !TEST_STATUSES.has(testStatus)) {
        issue(source, 'invalid-test-status');
      }
      if (!Array.isArray(test.results)) {
        issue(source, 'missing-results');
        return;
      }
      if (test.results.length === 0) {
        issue(source, 'empty-results');
        return;
      }

      const attempts = [];
      for (const result of test.results) {
        if (!isRecord(result) || typeof result.status !== 'string' || !ATTEMPT_STATUSES.has(result.status)) {
          issue(source, 'invalid-result-status');
          continue;
        }
        if (result.status === 'skipped') {
          counts.skipped += 1;
          continue;
        }
        counts.executed += 1;
        attempts.push(result);
      }
      if (attempts.length === 0) return;

      const projectName = test.projectName;
      if (!safeIdentity(projectName)) issue(source, 'invalid-project');
      const testTitle = spec.title;
      if (!safeIdentity(testTitle) || suiteTitles.some(title => !safeIdentity(title))) issue(source, 'invalid-identity');
      const file = relativeFile(spec.file ?? inheritedFile);
      if (!file) issue(source, 'invalid-file');
      const line = spec.line;
      if (!positiveInteger(line)) issue(source, 'invalid-line');
      const timeoutMs = test.timeout;
      const timeoutValid = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0;
      if (!timeoutValid) issue(source, 'invalid-timeout');
      const budget = timeoutValid ? parseBudget(test.annotations, timeoutMs) : { ok: false, code: 'invalid-timeout', budgetMs: null };
      if (!budget.ok && timeoutValid) issue(source, budget.code);
      const outcomeFails = testStatus === 'unexpected' || testStatus === 'flaky';
      let hasBadAttempt = false;

      for (const result of attempts) {
        const durationMs = result.duration;
        const durationValid = typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0;
        if (!durationValid) issue(source, 'invalid-duration');
        const retry = result.retry;
        const attemptValid = Number.isSafeInteger(retry) && retry >= 0;
        if (!attemptValid) issue(source, 'invalid-attempt');

        const attemptFails = result.status === 'failed' || result.status === 'timedOut' || result.status === 'interrupted';
        if (attemptFails) {
          hasBadAttempt = true;
          issue(source, result.status === 'failed' ? 'attempt-failed' : result.status === 'timedOut' ? 'attempt-timed-out' : 'attempt-interrupted', {
            incomplete: result.status === 'interrupted',
          });
        }
        if (!durationValid || !attemptValid || !file || !positiveInteger(line) || !safeIdentity(projectName)
          || !safeIdentity(testTitle) || suiteTitles.some(title => !safeIdentity(title)) || !timeoutValid) continue;

        const effectiveLimit = budget.ok && budget.budgetMs !== null ? Math.min(timeoutMs, budget.budgetMs) : timeoutMs;
        const warningAt = budget.ok && budget.budgetMs !== null
          ? Math.min(timeoutMs * 0.75, budget.budgetMs * 0.75)
          : timeoutMs * 0.75;
        const failureAt = budget.ok && budget.budgetMs !== null
          ? Math.min(timeoutMs * 0.85, budget.budgetMs)
          : timeoutMs * 0.85;
        let classification = 'pass';
        if (attemptFails || outcomeFails || !budget.ok || durationMs >= failureAt) classification = 'failure';
        else if (durationMs >= warningAt) classification = 'warning';

        if (classification === 'warning') counts.warnings += 1;
        if (classification === 'failure' && !attemptFails && !outcomeFails && budget.ok && durationMs >= failureAt) {
          issue(source, 'time-budget-exceeded', { incomplete: false });
        }
        measurements.push({
          file,
          line,
          suite: suiteTitles.join(' > '),
          test: testTitle,
          project: projectName,
          attempt: retry + 1,
          status: result.status,
          durationMs,
          timeoutMs,
          budgetMs: budget.ok ? budget.budgetMs : null,
          utilization: durationMs / effectiveLimit,
          headroomMs: failureAt - durationMs,
          classification,
        });
      }

      if (outcomeFails && !hasBadAttempt) {
        issue(source, testStatus === 'flaky' ? 'test-outcome-flaky' : 'test-outcome-unexpected', { incomplete: false });
      }
    }

    for (const suite of report.suites) visitSuite(suite, [], undefined);
  }

  if (counts.executed === 0) issue('input', 'no-executed-results');
  const ok = complete && counts.executed > 0 && counts.failures === 0;
  return { schemaVersion: 1, complete, ok, measurements, issues, counts };
}

function artifactSummary(result) {
  return {
    schemaVersion: 1,
    complete: result.complete,
    ok: result.ok,
    counts: {
      executed: result.counts.executed,
      skipped: result.counts.skipped,
      warnings: result.counts.warnings,
      failures: result.counts.failures,
    },
    measurements: result.measurements.map(measurement => ({
      file: measurement.file,
      line: measurement.line,
      suite: measurement.suite,
      test: measurement.test,
      project: measurement.project,
      status: measurement.status,
      attempt: measurement.attempt,
      durationMs: measurement.durationMs,
      timeoutMs: measurement.timeoutMs,
      budgetMs: measurement.budgetMs,
      classification: measurement.classification,
    })),
    issues: result.issues.map(({ source, code }) => ({ source, code })),
  };
}

function printHumanSummary(result) {
  for (const measurement of result.measurements) {
    if (measurement.classification === 'pass') continue;
    const level = measurement.classification === 'warning' ? 'WARN' : 'FAIL';
    const utilization = `${(measurement.utilization * 100).toFixed(1)}%`;
    const budget = measurement.budgetMs === null ? '' : ` budget=${measurement.budgetMs}ms`;
    console.log(`${level} ${measurement.file}:${measurement.line} | ${measurement.suite} > ${measurement.test} | project=${measurement.project} attempt=${measurement.attempt} status=${measurement.status} duration=${measurement.durationMs}ms timeout=${measurement.timeoutMs}ms${budget} utilization=${utilization} headroom=${measurement.headroomMs}ms; action: ${ACTION}.`);
  }
  for (const entry of result.issues) console.error(`ERROR report=${entry.source} code=${entry.code}`);
  console.log(`Timing audit: complete=${result.complete} executed=${result.counts.executed} skipped=${result.counts.skipped} warnings=${result.counts.warnings} failures=${result.counts.failures}`);
}

function usage() {
  console.error('usage: node scripts/check-e2e-time-budget.mjs --summary <output> <chromium.json> [serial.json ...]');
  console.error('       node scripts/check-e2e-time-budget.mjs --self-test');
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--self-test') {
    runSelfTest();
    return 0;
  }
  if (!Array.isArray(argv) || argv.length === 0 || argv.some(arg => typeof arg !== 'string')) {
    usage();
    return 2;
  }

  let summaryPath;
  const reports = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--summary') {
      if (summaryPath !== undefined || index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
        usage();
        return 2;
      }
      summaryPath = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('-')) {
      usage();
      return 2;
    } else {
      reports.push(arg);
    }
  }
  if (!summaryPath || reports.length === 0) {
    usage();
    return 2;
  }

  const inputs = [];
  for (const reportPath of reports) {
    let contents;
    try {
      contents = readFileSync(reportPath, 'utf8');
    } catch (error) {
      const code = isRecord(error) && error.code === 'ENOENT' ? 'missing-report' : 'read-error';
      inputs.push({ source: reportPath, inputError: code });
      continue;
    }
    try {
      inputs.push({ source: reportPath, report: JSON.parse(contents) });
    } catch {
      inputs.push({ source: reportPath, inputError: 'invalid-json' });
    }
  }

  const result = audit(inputs);
  try {
    writeFileSync(summaryPath, `${JSON.stringify(artifactSummary(result), null, 2)}\n`, { mode: 0o600 });
  } catch {
    console.error('ERROR code=summary-write-failed');
    return 1;
  }
  printHumanSummary(result);
  return result.ok ? 0 : 1;
}

function check(condition, label) {
  assert.ok(condition, `${SELF_TEST_LABEL}: ${label}`);
}

function fixture(duration, timeout = 1000, resultStatus = 'passed', annotations = []) {
  return {
    suites: [{
      title: 'case.spec.ts',
      file: 'e2e/case.spec.ts',
      suites: [{
        title: 'nested suite',
        file: 'e2e/case.spec.ts',
        suites: [],
        specs: [{
          title: 'journey',
          file: 'e2e/case.spec.ts',
          line: 7,
          tests: [{
            projectName: 'chromium',
            status: resultStatus === 'skipped' ? 'skipped' : 'expected',
            timeout,
            annotations,
            results: [{ status: resultStatus, duration, retry: 0 }],
          }],
        }],
      }],
      specs: [],
    }],
    errors: [],
  };
}

function oneInput(report, source = 'chromium.json') {
  return [{ source, report }];
}

function runSelfTest() {
  // AC-TH-004: inclusive generic warning/failure boundaries use each attempt, not suite totals.
  check(audit(oneInput(fixture(749))).counts.warnings === 0, '749ms remains below warning');
  check(audit(oneInput(fixture(750))).counts.warnings === 1, '75% warning boundary is inclusive');
  check(audit(oneInput(fixture(849))).ok, '849ms remains below failure');
  check(!audit(oneInput(fixture(850))).ok, '85% failure boundary is inclusive');
  const fractional = audit(oneInput(fixture(749.5)));
  check(fractional.ok && fractional.measurements[0].durationMs === 749.5, 'finite fractional duration is retained');

  // AC-TH-005: the explicit budget is stricter, warns at 75%, and fails at the exact limit.
  const budget = [{ type: 'time-budget-ms', description: '90000' }];
  check(audit(oneInput(fixture(67500, 120000, 'passed', budget))).counts.warnings === 1, 'budget warning starts at 67.5 seconds');
  const budgetBoundary = audit(oneInput(fixture(90000, 120000, 'passed', budget)));
  check(!budgetBoundary.ok && budgetBoundary.measurements[0].classification === 'failure', 'exact budget boundary fails');
  check(audit(oneInput(fixture(89999.5, 120000, 'passed', budget))).ok, 'fraction immediately below budget passes');
  const duplicateBudget = audit(oneInput(fixture(100, 120000, 'passed', [...budget, ...budget])));
  check(!duplicateBudget.ok && duplicateBudget.issues.some(entry => entry.code === 'duplicate-time-budget'), 'duplicate budgets fail even when equal');
  for (const description of ['', '0', '-1', '1.5', '90000ms', 90000]) {
    const malformed = audit(oneInput(fixture(100, 120000, 'passed', [{ type: 'time-budget-ms', description }])));
    check(!malformed.ok && malformed.issues.some(entry => entry.code === 'invalid-time-budget'), `malformed budget rejected: ${String(description)}`);
  }
  check(!audit(oneInput(fixture(100, 100, 'passed', [{ type: 'time-budget-ms', description: '100' }]))).ok, 'budget equal to timeout is invalid');
  check(!audit(oneInput(fixture(90000, 120000, 'passed', budget))).ok, 'annotation never relaxes generic gate');

  // Attempts are independent: a slow-looking sum across retries must not trigger a warning.
  const retries = fixture(500);
  const retryTest = retries.suites[0].suites[0].specs[0].tests[0];
  retryTest.results = [
    { status: 'passed', duration: 500, retry: 0 },
    { status: 'passed', duration: 500, retry: 1 },
  ];
  const retryAudit = audit(oneInput(retries));
  check(retryAudit.ok && retryAudit.counts.executed === 2 && retryAudit.counts.warnings === 0, 'retry durations are not summed');
  check(retryAudit.measurements.map(m => m.attempt).join(',') === '1,2', 'attempt numbers preserve retry indexes');
  const chromiumProject = fixture(700);
  const serialProject = fixture(700);
  serialProject.suites[0].suites[0].specs[0].tests[0].projectName = 'serial';
  const repeatedProjects = audit([
    { source: 'chromium.json', report: chromiumProject },
    { source: 'serial.json', report: serialProject },
  ]);
  check(repeatedProjects.ok && repeatedProjects.counts.executed === 2 && repeatedProjects.counts.warnings === 0,
    'repeated setup in separate reports keeps per-project attempt durations independent');
  check(repeatedProjects.measurements.map(m => m.project).join(',') === 'chromium,serial', 'multiple report projects remain distinct');
  check(retryAudit.measurements[0].file === 'e2e/case.spec.ts'
    && retryAudit.measurements[0].line === 7
    && retryAudit.measurements[0].suite === 'case.spec.ts > nested suite'
    && retryAudit.measurements[0].test === 'journey'
    && retryAudit.measurements[0].project === 'chromium', 'recursive report identity is projected relative to the repository');

  const failedThenPassed = fixture(40);
  const flakyTest = failedThenPassed.suites[0].suites[0].specs[0].tests[0];
  flakyTest.status = 'flaky';
  flakyTest.results = [
    { status: 'failed', duration: 40, retry: 0 },
    { status: 'passed', duration: 50, retry: 1 },
  ];
  const flakyAudit = audit(oneInput(failedThenPassed));
  check(!flakyAudit.ok && flakyAudit.counts.executed === 2, 'failed attempt cannot hide behind later pass');
  check(flakyAudit.measurements.length === 2 && flakyAudit.measurements[0].classification === 'failure', 'both flaky attempts remain visible');

  const unexpected = fixture(20);
  unexpected.suites[0].suites[0].specs[0].tests[0].status = 'unexpected';
  check(!audit(oneInput(unexpected)).ok, 'unexpected test outcome fails even with a passed attempt');
  for (const status of ['timedOut', 'interrupted']) {
    const result = audit(oneInput(fixture(100, 1000, status)));
    check(!result.ok && result.measurements[0].classification === 'failure', `${status} attempt fails`);
    if (status === 'interrupted') check(!result.complete, 'interrupted lane is incomplete');
  }
  const mixedSkip = fixture(20);
  mixedSkip.suites[0].suites[0].specs[0].tests[0].results.unshift({ status: 'skipped', duration: 0, retry: 0 });
  const mixedSkipAudit = audit(oneInput(mixedSkip));
  check(mixedSkipAudit.ok && mixedSkipAudit.counts.skipped === 1 && mixedSkipAudit.counts.executed === 1, 'skipped attempts have no timing measurement');
  const onlySkip = audit(oneInput(fixture(0, 1000, 'skipped')));
  check(!onlySkip.ok && !onlySkip.complete && onlySkip.counts.skipped === 1, 'skip-only report cannot pass timing audit');

  // Invalid input and malformed executed-case timing fail closed with safe codes.
  check(!audit([]).ok && !audit([]).complete, 'no inputs fail closed');
  check(!audit([{ source: `${path.sep}private${path.sep}chromium.json`, inputError: 'missing-report' }]).ok, 'missing report fails');
  check(!audit(oneInput('<html>not a json report</html>')).ok, 'HTML report shape fails');
  check(!audit(oneInput({ errors: [], suites: [] })).ok, 'empty report fails for no executed results');
  const badRoot = fixture(20);
  delete badRoot.suites;
  check(!audit(oneInput(badRoot)).ok, 'missing suites fails');
  const badSuite = fixture(20);
  delete badSuite.suites[0].specs;
  check(!audit(oneInput(badSuite)).ok, 'missing suite specs fails');
  const badSpec = fixture(20);
  delete badSpec.suites[0].suites[0].specs[0].tests;
  check(!audit(oneInput(badSpec)).ok, 'missing tests fails');
  const badResults = fixture(20);
  delete badResults.suites[0].suites[0].specs[0].tests[0].results;
  check(!audit(oneInput(badResults)).ok, 'missing results fails');
  const emptyResults = fixture(20);
  emptyResults.suites[0].suites[0].specs[0].tests[0].results = [];
  check(!audit(oneInput(emptyResults)).ok, 'empty results fails');
  const reportErrors = fixture(20);
  reportErrors.errors = [{ message: 'PRIVATE_ERROR_SENTINEL' }];
  const reportErrorAudit = audit(oneInput(reportErrors));
  check(!reportErrorAudit.complete && !JSON.stringify(artifactSummary(reportErrorAudit)).includes('PRIVATE_ERROR_SENTINEL'), 'report errors mark incomplete without retaining bodies');

  for (const timeout of [0, -1, Infinity, NaN, null]) {
    const invalid = audit(oneInput(fixture(20, timeout)));
    check(!invalid.ok && invalid.issues.some(entry => entry.code === 'invalid-timeout'), `invalid timeout rejected: ${String(timeout)}`);
  }
  for (const duration of [-1, Infinity, NaN]) {
    const invalid = audit(oneInput(fixture(duration)));
    check(!invalid.ok && invalid.issues.some(entry => entry.code === 'invalid-duration'), `invalid duration rejected: ${String(duration)}`);
  }
  for (const retry of [-1, 0.5, Infinity]) {
    const badRetry = fixture(20);
    badRetry.suites[0].suites[0].specs[0].tests[0].results[0].retry = retry;
    const invalid = audit(oneInput(badRetry));
    check(!invalid.ok && invalid.issues.some(entry => entry.code === 'invalid-attempt'), `invalid attempt index rejected: ${String(retry)}`);
  }
  for (const status of ['unknown', 'interrupted']) {
    const invalid = fixture(20);
    invalid.suites[0].suites[0].specs[0].tests[0].status = status;
    check(!audit(oneInput(invalid)).ok, `unknown test status rejected: ${status}`);
  }
  const unknownAttempt = fixture(20);
  unknownAttempt.suites[0].suites[0].specs[0].tests[0].results[0].status = 'unknown';
  check(!audit(oneInput(unknownAttempt)).ok, 'unknown attempt status rejected');
  const badAnnotations = fixture(20);
  badAnnotations.suites[0].suites[0].specs[0].tests[0].annotations = null;
  check(!audit(oneInput(badAnnotations)).ok, 'missing annotations on executed case rejected');
  const absoluteFile = `${path.sep}private${path.sep}case.spec.ts`;
  for (const file of [absoluteFile, '../case.spec.ts', 'e2e/../../case.spec.ts', 'C:\\cases\\x.spec.ts']) {
    const invalid = fixture(20);
    invalid.suites[0].suites[0].specs[0].file = file;
    check(!audit(oneInput(invalid)).ok && audit(oneInput(invalid)).issues.some(entry => entry.code === 'invalid-file'), `unsafe file identity rejected: ${file}`);
  }
  for (const title of ['Journey at /private/path', String.raw`Journey at C:\\private\\case`, String.raw`Journey at \\server\share`]) {
    const invalidIdentity = fixture(20);
    invalidIdentity.suites[0].suites[0].specs[0].title = title;
    const result = audit(oneInput(invalidIdentity));
    check(!result.ok && result.issues.some(entry => entry.code === 'invalid-identity'), 'absolute identity path is rejected');
  }
  const invalidLine = fixture(20);
  invalidLine.suites[0].suites[0].specs[0].line = 0;
  check(!audit(oneInput(invalidLine)).ok, 'invalid line rejected');
  const missingLane = audit([
    { source: 'chromium.json', report: fixture(20) },
    { source: '/reports/serial.json', inputError: 'missing-report' },
  ]);
  check(!missingLane.complete && missingLane.measurements.length === 1 && missingLane.issues.some(entry => entry.source === 'serial.json'), 'partial lane evidence retains valid measurements safely');

  // CLI tests exercise real file reads, JSON parsing, summaries, argument errors and exit codes.
  const tempDirectory = mkdtempSync(path.join(tmpdir(), 'pmo e2e timing self test '));
  try {
    const script = fileURLToPath(import.meta.url);
    const validPath = path.join(tempDirectory, 'chromium report.json');
    const missingPath = path.join(tempDirectory, 'serial report.json');
    const missingThirdPath = path.join(tempDirectory, 'consent report.json');
    const malformedPath = path.join(tempDirectory, 'malformed report.json');
    const summaryPath = path.join(tempDirectory, 'safe timing summary.json');
    const cliSentinel = 'PRIVATE_SUMMARY_SENTINEL';
    const cliReport = fixture(100);
    cliReport.metadata = { sensitive: cliSentinel };
    cliReport.stdout = cliSentinel;
    cliReport.stderr = cliSentinel;
    cliReport.errors = [{ message: cliSentinel }];
    cliReport.suites[0].suites[0].specs[0].tests[0].metadata = cliSentinel;
    cliReport.suites[0].suites[0].specs[0].tests[0].results[0].attachments = [{ body: cliSentinel }];
    writeFileSync(validPath, JSON.stringify(cliReport));
    writeFileSync(malformedPath, '<html>invalid report</html>');
    const partial = spawnSync(process.execPath, [script, '--summary', summaryPath, validPath, missingPath, missingThirdPath], { encoding: 'utf8' });
    check(partial.status === 1, 'partial-report CLI exits nonzero');
    check(readFileSync(summaryPath, 'utf8').length > 0, 'partial-report CLI writes a summary before failing');
    const summaryText = readFileSync(summaryPath, 'utf8');
    const safeSummary = JSON.parse(summaryText);
    check(!safeSummary.complete && safeSummary.measurements.length === 1, 'partial summary marks incomplete and retains valid case');
    check(!summaryText.includes(tempDirectory) && !summaryText.includes(cliSentinel), 'summary excludes absolute paths and sentinels');
    check(!partial.stdout.includes(tempDirectory) && !partial.stderr.includes(tempDirectory), 'CLI output excludes absolute paths');
    check(!partial.stdout.includes(cliSentinel) && !partial.stderr.includes(cliSentinel), 'CLI output excludes raw report content');
    const measurementKeys = Object.keys(safeSummary.measurements[0]).sort().join(',');
    check(measurementKeys === 'attempt,budgetMs,classification,durationMs,file,line,project,status,suite,test,timeoutMs', 'artifact measurement is allowlist-projected');
    check(safeSummary.issues.every(entry => Object.keys(entry).sort().join(',') === 'code,source'), 'artifact issues retain only safe basename and code');
    check(safeSummary.issues.some(entry => entry.source === 'serial report.json' && entry.code === 'missing-report')
      && safeSummary.issues.some(entry => entry.source === 'consent report.json' && entry.code === 'missing-report'), 'missing second and third lanes are both recorded');

    writeFileSync(malformedPath, '<html>invalid report</html>');
    const malformedSummaryPath = path.join(tempDirectory, 'malformed summary.json');
    const malformedRun = spawnSync(process.execPath, [script, '--summary', malformedSummaryPath, validPath, malformedPath], { encoding: 'utf8' });
    const malformedSummary = JSON.parse(readFileSync(malformedSummaryPath, 'utf8'));
    check(malformedRun.status === 1 && malformedSummary.issues.some(entry => entry.code === 'invalid-json'), 'malformed JSON gets an actionable safe code');

    const readErrorSummaryPath = path.join(tempDirectory, 'read error summary.json');
    const readErrorRun = spawnSync(process.execPath, [script, '--summary', readErrorSummaryPath, validPath, tempDirectory], { encoding: 'utf8' });
    const readErrorSummary = JSON.parse(readFileSync(readErrorSummaryPath, 'utf8'));
    check(readErrorRun.status === 1 && readErrorSummary.issues.some(entry => entry.code === 'read-error'), 'unreadable report is distinct from missing report');

    const retryPath = path.join(tempDirectory, 'failed then passed.json');
    const retrySummaryPath = path.join(tempDirectory, 'retry summary.json');
    const retryReport = fixture(40);
    const retryCase = retryReport.suites[0].suites[0].specs[0].tests[0];
    retryCase.status = 'flaky';
    retryCase.results = [{ status: 'failed', duration: 40, retry: 0 }, { status: 'passed', duration: 50, retry: 1 }];
    writeFileSync(retryPath, JSON.stringify(retryReport));
    const retryCli = spawnSync(process.execPath, [script, '--summary', retrySummaryPath, retryPath], { encoding: 'utf8' });
    const retrySummary = JSON.parse(readFileSync(retrySummaryPath, 'utf8'));
    check(retryCli.status === 1 && retrySummary.measurements.length === 2, 'CLI preserves failed attempt before later pass');

    const noArgs = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    const badFlag = spawnSync(process.execPath, [script, '--summary', summaryPath, '--unknown', validPath], { encoding: 'utf8' });
    const missingReports = spawnSync(process.execPath, [script, '--summary', summaryPath], { encoding: 'utf8' });
    check(noArgs.status === 2 && badFlag.status === 2 && missingReports.status === 2, 'CLI usage errors have exit code 2');
    const unwritable = spawnSync(process.execPath, [script, '--summary', path.join(tempDirectory, 'missing dir', 'summary.json'), validPath], { encoding: 'utf8' });
    check(unwritable.status === 1 && unwritable.stderr.includes('summary-write-failed'), 'unwritable summary fails without a success result');
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }, error => {
    if (process.argv.includes('--self-test')) console.error(`self-test failed: ${error instanceof Error ? error.message : 'unknown failure'}`);
    process.exitCode = 1;
  });
}
