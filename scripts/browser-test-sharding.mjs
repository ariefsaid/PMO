import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PROJECTS = new Set(['setup', 'chromium', 'serial', 'consent']);
const MODES = new Set(['ordinary', 'served']);
const KNOWN_RESULT_STATUSES = new Set(['passed', 'skipped', 'failed', 'timedOut', 'interrupted', 'not_run']);
const UNIT_RESULT_MODES = new Set(['run', 'only', 'skip', 'todo']);
const UNIT_SHARD_COUNT = 4;
const UNIT_REPORT_NAMES = Array.from({ length: UNIT_SHARD_COUNT }, (_, index) => `unit-shard-${index + 1}-of-${UNIT_SHARD_COUNT}.json`);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REVISION = /^[a-f0-9]{40,64}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

function compareCodepoint(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class ContractError extends Error {
  constructor(issues) {
    super('Browser sharding input does not satisfy its contract.');
    this.name = 'ContractError';
    this.issues = normalizeIssues(issues);
  }
}

function normalizeIssues(issues) {
  const seen = new Set();
  return issues
    .filter((issue) => issue && typeof issue.code === 'string')
    .map((issue) => ({ code: issue.code, ...(SAFE_ID.test(issue.invocationId ?? '') ? { invocationId: issue.invocationId } : {}) }))
    .filter((issue) => {
      const key = JSON.stringify(issue);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => compareCodepoint(left.code, right.code) || compareCodepoint(left.invocationId ?? '', right.invocationId ?? ''));
}

function issue(code, invocationId) {
  return { code, ...(SAFE_ID.test(invocationId ?? '') ? { invocationId } : {}) };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || CONTROL_CHARACTERS.test(value)) return null;
  const slashPath = value.replaceAll('\\', '/');
  if (slashPath.startsWith('/') || /^[a-zA-Z]:\//.test(slashPath) || slashPath.startsWith('//')) return null;
  const parts = slashPath.split('/');
  if (parts.some((part) => part === '..')) return null;
  const normalized = path.posix.normalize(slashPath).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..') return null;
  return normalized;
}

function validText(value, allowEmpty = false) {
  return typeof value === 'string' && (allowEmpty || value.length > 0) && !CONTROL_CHARACTERS.test(value);
}

function validInvocation(value) {
  return typeof value === 'string' && SAFE_ID.test(value);
}

export function canonicalTestIdentity({ mode, project, file, titlePath, repeatIndex }) {
  return JSON.stringify([mode, project, file, titlePath, repeatIndex]);
}

function stablePlaywrightConfig(config, selectedConfig) {
  const rootDir = typeof config.rootDir === 'string' && path.isAbsolute(config.rootDir) ? config.rootDir : null;
  const sourcePath = (value) => {
    if (typeof value !== 'string' || CONTROL_CHARACTERS.test(value)) return null;
    const relative = rootDir && path.isAbsolute(value) ? path.relative(rootDir, value) : value;
    if (relative === '') return '.';
    return normalizeRelativePath(relative);
  };
  const plainValue = (value) => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
    if (Array.isArray(value)) return value.map(plainValue);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
        const safeValue = plainValue(value[key]);
        return safeValue === undefined ? [] : [[key, safeValue]];
      }));
    }
    return undefined;
  };
  const emulationKeys = [
    'browserName', 'channel', 'deviceName', 'hasTouch', 'isMobile', 'javaScriptEnabled',
    'locale', 'timezoneId', 'colorScheme', 'reducedMotion', 'forcedColors', 'viewport', 'screen',
  ];
  const emulationMetadata = (metadata) => {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const emulation = metadata.emulation;
    if (!emulation || typeof emulation !== 'object' || Array.isArray(emulation)) return null;
    return Object.fromEntries(Object.keys(emulation).sort().flatMap((key) => {
      if (!emulationKeys.includes(key)) return [];
      const value = plainValue(emulation[key]);
      return value === undefined ? [] : [[key, value]];
    }));
  };
  const projects = config.projects.map((project) => {
    const use = {};
    for (const key of emulationKeys) {
      if (project.use && Object.hasOwn(project.use, key)) use[key] = plainValue(project.use[key]);
    }
    const normalized = {
      name: project.name,
      ...(project.testDir !== undefined ? { testDir: sourcePath(project.testDir) } : {}),
      ...(Array.isArray(project.testMatch) ? { testMatch: project.testMatch.map(plainValue) } : {}),
      ...(Array.isArray(project.testIgnore) ? { testIgnore: project.testIgnore.map(plainValue) } : {}),
      ...(project.retries !== undefined ? { retries: project.retries } : {}),
      ...(project.timeout !== undefined ? { timeout: project.timeout } : {}),
      ...(project.repeatEach !== undefined ? { repeatEach: project.repeatEach } : {}),
      ...(project.fullyParallel !== undefined ? { fullyParallel: project.fullyParallel } : {}),
      ...(Array.isArray(project.dependencies) ? { dependencies: [...project.dependencies].sort() } : {}),
      use: Object.hasOwn(project, 'use')
        ? { availability: 'available', values: use }
        : { availability: 'unavailable' },
      metadata: {
        availability: Object.hasOwn(project, 'metadata') ? 'available' : 'unavailable',
        emulation: emulationMetadata(project.metadata),
      },
    };
    return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== undefined));
  }).sort((left, right) => compareCodepoint(left.name, right.name));
  return Object.fromEntries(Object.entries({
    version: config.version,
    retries: config.retries,
    timeout: config.timeout,
    fullyParallel: config.fullyParallel,
    workers: config.workers,
    selectedConfig: selectedConfig
      ? { availability: 'available', sha256: selectedConfig.sha256, lockedPlaywrightVersion: selectedConfig.lockedPlaywrightVersion }
      : { availability: 'unavailable' },
    projects,
  }).filter(([, value]) => value !== undefined));
}

function normalizeNativeShard(shard) {
  if (shard === undefined || shard === null) return null;
  if (!shard || typeof shard !== 'object' || Array.isArray(shard)) return undefined;
  const { current, total } = shard;
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(total) || total < 1 || current < 1 || current > total) return undefined;
  return { index: current, total };
}

function reportTestEntries(report, repeatEachByProject) {
  const found = [];
  const failures = [];
  if (!Array.isArray(report.suites)) return { found, failures: [issue('INVALID_PLAYWRIGHT_REPORT')] };

  function visit(suite, context) {
    if (!suite || typeof suite !== 'object' || Array.isArray(suite)) {
      failures.push(issue('INVALID_PLAYWRIGHT_REPORT'));
      return;
    }
    let project = suite.projectName ?? context.project;
    const suiteTitle = suite.title;
    if (!project && typeof suiteTitle === 'string' && PROJECTS.has(suiteTitle)) project = suiteTitle;
    if (project && !PROJECTS.has(project)) failures.push(issue('UNKNOWN_PROJECT'));

    let file = context.file;
    if (suite.file !== undefined) {
      const normalized = normalizeRelativePath(suite.file);
      if (!normalized) failures.push(issue('INVALID_PATH'));
      else file = normalized;
    }

    let titles = context.titles;
    const isProjectTitle = !context.project && typeof suiteTitle === 'string' && PROJECTS.has(suiteTitle);
    const fileTitle = typeof suiteTitle === 'string' && file && (suiteTitle === file || suiteTitle === path.posix.basename(file));
    if (validText(suiteTitle) && !isProjectTitle && !fileTitle) titles = [...titles, suiteTitle];

    if (suite.specs !== undefined && !Array.isArray(suite.specs)) failures.push(issue('INVALID_PLAYWRIGHT_REPORT'));
    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
          failures.push(issue('INVALID_PLAYWRIGHT_REPORT'));
          continue;
        }
        const specFileValue = spec.file ?? file;
        const specFile = normalizeRelativePath(specFileValue);
        if (!specFile) {
          failures.push(issue('INVALID_PATH'));
          continue;
        }
        const specTitles = Array.isArray(spec.titlePath) ? spec.titlePath : [...titles, spec.title];
        if (!Array.isArray(specTitles) || specTitles.length === 0 || specTitles.some((title) => !validText(title))) {
          failures.push(issue('INVALID_TITLE_PATH'));
          continue;
        }
        if (!Array.isArray(spec.tests) || spec.tests.length === 0) {
          failures.push(issue('INVALID_PLAYWRIGHT_REPORT'));
          continue;
        }
        for (const reportTest of spec.tests) {
          if (!reportTest || typeof reportTest !== 'object' || Array.isArray(reportTest)) {
            failures.push(issue('INVALID_PLAYWRIGHT_REPORT'));
            continue;
          }
          const testProject = reportTest.projectName ?? spec.projectName ?? project;
          if (typeof testProject !== 'string' || !PROJECTS.has(testProject)) {
            failures.push(issue('UNKNOWN_PROJECT'));
            continue;
          }
          const explicitRepeatIndex = reportTest.repeatEachIndex ?? spec.repeatEachIndex;
          const repeatEach = repeatEachByProject.get(testProject) ?? 1;
          if (explicitRepeatIndex === undefined && repeatEach > 1) {
            failures.push(issue('MISSING_REPEAT_INDEX'));
            continue;
          }
          const repeatEachIndex = explicitRepeatIndex ?? 0;
          if (!Number.isSafeInteger(repeatEachIndex) || repeatEachIndex < 0) {
            failures.push(issue('INVALID_REPEAT_INDEX'));
            continue;
          }
          found.push({ project: testProject, file: specFile, titlePath: [...specTitles], repeatIndex: repeatEachIndex });
        }
      }
    }
    if (Array.isArray(suite.suites)) {
      for (const child of suite.suites) visit(child, { project, file, titles });
    } else if (suite.suites !== undefined) {
      failures.push(issue('INVALID_PLAYWRIGHT_REPORT'));
    }
  }

  for (const suite of report.suites) visit(suite, { project: undefined, file: undefined, titles: [] });
  return { found, failures };
}

export function normalizePlaywrightList({ report, mode, revision, invocation, selectedConfig }) {
  let parsedReport = report;
  if (typeof parsedReport === 'string') {
    try {
      parsedReport = JSON.parse(parsedReport);
    } catch {
      throw new ContractError([issue('MALFORMED_JSON')]);
    }
  }
  if (!parsedReport || typeof parsedReport !== 'object' || Array.isArray(parsedReport)) {
    throw new ContractError([issue('INVALID_PLAYWRIGHT_REPORT')]);
  }
  if (!MODES.has(mode)) throw new ContractError([issue('INVALID_MODE')]);
  if (typeof revision !== 'string' || !REVISION.test(revision)) throw new ContractError([issue('INVALID_REVISION')]);
  if (!validInvocation(invocation)) throw new ContractError([issue('INVALID_INVOCATION')]);
  if (!parsedReport.config || typeof parsedReport.config !== 'object' || Array.isArray(parsedReport.config) || !Array.isArray(parsedReport.config.projects)) {
    throw new ContractError([issue('INVALID_PLAYWRIGHT_REPORT')]);
  }
  const repeatEachByProject = new Map();
  const configIssues = [];
  for (const project of parsedReport.config.projects) {
    if (!project || typeof project !== 'object' || Array.isArray(project) || !validText(project.name)) {
      configIssues.push(issue('INVALID_PLAYWRIGHT_REPORT'));
      continue;
    }
    if (!PROJECTS.has(project.name)) configIssues.push(issue('UNKNOWN_PROJECT'));
    if (project.repeatEach !== undefined && (!Number.isSafeInteger(project.repeatEach) || project.repeatEach < 1)) configIssues.push(issue('INVALID_REPEAT_CONFIG'));
    repeatEachByProject.set(project.name, project.repeatEach ?? 1);
  }
  const { found, failures } = reportTestEntries(parsedReport, repeatEachByProject);
  failures.push(...configIssues);
  for (const entry of found) {
    if (!repeatEachByProject.has(entry.project)) failures.push(issue('PROJECT_NOT_CONFIGURED', invocation));
  }
  if (Array.isArray(parsedReport.errors) && parsedReport.errors.length > 0) failures.push(issue('COLLECTION_FAILED'));
  if (selectedConfig !== undefined && (!selectedConfig || typeof selectedConfig !== 'object' || Array.isArray(selectedConfig)
    || !SHA256.test(selectedConfig.sha256 ?? '') || !validText(selectedConfig.lockedPlaywrightVersion))) {
    failures.push(issue('INVALID_SELECTED_CONFIG_PROVENANCE'));
  }
  if (selectedConfig?.lockedPlaywrightVersion && parsedReport.config.version !== selectedConfig.lockedPlaywrightVersion) {
    failures.push(issue('LOCKED_PLAYWRIGHT_VERSION_MISMATCH'));
  }
  const configProvenance = stablePlaywrightConfig(parsedReport.config, selectedConfig);
  if (configProvenance.retries !== undefined && (!Number.isSafeInteger(configProvenance.retries) || configProvenance.retries < 0)) failures.push(issue('INVALID_RETRY_CONFIG'));
  if (configProvenance.timeout !== undefined && (!Number.isFinite(configProvenance.timeout) || configProvenance.timeout < 0)) failures.push(issue('INVALID_TIMEOUT_CONFIG'));
  if (typeof configProvenance.fullyParallel !== 'boolean') failures.push(issue('INVALID_PARALLEL_CONFIG'));
  if (configProvenance.projects.some((project) =>
    project.testDir === null
    || (project.testMatch && project.testMatch.some((entry) => entry === null))
    || (project.retries !== undefined && (!Number.isSafeInteger(project.retries) || project.retries < 0))
    || (project.timeout !== undefined && (!Number.isFinite(project.timeout) || project.timeout < 0)))) {
    failures.push(issue('INVALID_SOURCE_CONFIG'));
  }
  const nativeShard = normalizeNativeShard(parsedReport.config.shard);
  if (nativeShard === undefined) failures.push(issue('INVALID_NATIVE_SHARD'));
  const invocationMetadata = {
    nativeShard,
    argvDigest: Array.isArray(parsedReport.config.argv) ? sha256(canonicalJson(parsedReport.config.argv)) : null,
    outputDigest: sha256(canonicalJson({
      outputDir: parsedReport.config.outputDir ?? null,
      reporter: parsedReport.config.reporter ?? null,
    })),
  };
  const configDigest = sha256(canonicalJson(configProvenance));
  const tests = found.map((entry) => ({
    ...entry,
    file: normalizeRelativePath(entry.file),
  }));
  if (tests.some((entry) => !entry.file)) failures.push(issue('INVALID_PATH'));
  if (tests.length === 0) failures.push(issue('EMPTY_INVENTORY'));
  const identities = new Set();
  for (const entry of tests) {
    const key = canonicalTestIdentity({ mode, ...entry });
    if (identities.has(key)) failures.push(issue('DUPLICATE_TEST_IDENTITY', invocation));
    identities.add(key);
  }
  if (failures.length > 0) throw new ContractError(failures);
  tests.sort((left, right) => compareCodepoint(canonicalTestIdentity({ mode, ...left }), canonicalTestIdentity({ mode, ...right })));
  return { schemaVersion: 1, revision, configDigest, configProvenance, invocationMetadata, mode, invocation, tests };
}

function safeUnitRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || CONTROL_CHARACTERS.test(value)) return null;
  const slashPath = value.split(String.fromCharCode(92)).join('/');
  if (slashPath.startsWith('/') || /^[a-zA-Z]:/.test(slashPath) || slashPath.startsWith('//')) return null;
  const parts = slashPath.split('/');
  if (parts.some((part, index) => part === '..' && (index !== 0 || parts.filter((segment) => segment === '..').length > 1))) return null;
  const normalized = path.posix.normalize(slashPath);
  if (!normalized || normalized === '.' || normalized.startsWith('../..')) return null;
  return normalized;
}
function unitShard(value, { allowNull = false } = {}) {
  if (allowNull && value === null) return true;
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Number.isSafeInteger(value.index) && Number.isSafeInteger(value.total)
    && value.total === UNIT_SHARD_COUNT && value.index >= 1 && value.index <= UNIT_SHARD_COUNT);
}

function unitIdentity(entry) {
  return JSON.stringify([entry.project, entry.file, entry.fullTitle, entry.repeatIndex ?? 0]);
}

function validateUnitInventory(inventory, expectedRevision) {
  const issues = [];
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)
    || inventory.schemaVersion !== 1 || inventory.runner !== 'vitest'
    || !REVISION.test(inventory.revision ?? '') || !validInvocation(inventory.invocation)
    || !Array.isArray(inventory.tests) || !unitShard(inventory.shard, { allowNull: true })) {
    return [issue('INVALID_UNIT_INVENTORY')];
  }
  if (expectedRevision && inventory.revision !== expectedRevision) issues.push(issue('REVISION_MISMATCH', inventory.invocation));
  if (inventory.tests.length === 0) issues.push(issue('EMPTY_UNIT_INVENTORY', inventory.invocation));
  const identities = new Set();
  for (const entry of inventory.tests) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !validText(entry.project) || !safeUnitRelativePath(entry.file)
      || !validText(entry.fullTitle) || !Number.isSafeInteger(entry.repeatIndex) || entry.repeatIndex < 0) {
      issues.push(issue('INVALID_UNIT_TEST_ENTRY', inventory.invocation));
      continue;
    }
    const key = unitIdentity(entry);
    if (identities.has(key)) issues.push(issue('AMBIGUOUS_TEST_MAPPING', inventory.invocation));
    identities.add(key);
  }
  return normalizeIssues(issues);
}

export function normalizeVitestList({ report, root, revision, invocation, shard } = {}) {
  let parsedReport = report;
  if (typeof parsedReport === 'string') {
    try {
      parsedReport = JSON.parse(parsedReport);
    } catch {
      throw new ContractError([issue('MALFORMED_JSON')]);
    }
  }
  if (!Array.isArray(parsedReport)) throw new ContractError([issue('INVALID_VITEST_LIST')]);
  if (typeof root !== 'string' || !path.isAbsolute(root) || CONTROL_CHARACTERS.test(root)) throw new ContractError([issue('INVALID_ROOT')]);
  if (typeof revision !== 'string' || !REVISION.test(revision)) throw new ContractError([issue('INVALID_REVISION')]);
  if (!validInvocation(invocation)) throw new ContractError([issue('INVALID_INVOCATION')]);
  if (!(shard === null || unitShard(shard))) throw new ContractError([issue('INVALID_SHARD')]);

  const rootPath = path.resolve(root);
  const repositoryBoundary = path.dirname(rootPath);
  const tests = [];
  const failures = [];
  for (const entry of parsedReport) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !validText(entry.name) || !validText(entry.projectName)
      || typeof entry.file !== 'string' || !path.isAbsolute(entry.file)) {
      failures.push(issue('INVALID_VITEST_LIST_ENTRY', invocation));
      continue;
    }
    const absoluteFile = path.resolve(entry.file);
    const relativeFile = path.relative(rootPath, absoluteFile).replaceAll('\\', '/');
    const allowedOutsideRoot = relativeFile.startsWith('../')
      && !path.relative(repositoryBoundary, absoluteFile).startsWith('../')
      && path.relative(repositoryBoundary, absoluteFile) !== '..';
    const normalizedFile = safeUnitRelativePath(relativeFile);
    if (!normalizedFile || (normalizedFile.startsWith('../') && !allowedOutsideRoot)) {
      failures.push(issue('INVALID_PATH', invocation));
      continue;
    }
    tests.push({
      project: entry.projectName,
      file: normalizedFile,
      fullTitle: entry.name,
      repeatIndex: 0,
    });
  }
  if (tests.length === 0) failures.push(issue('EMPTY_UNIT_INVENTORY', invocation));
  const identities = new Set();
  for (const entry of tests) {
    const key = unitIdentity(entry);
    if (identities.has(key)) failures.push(issue('AMBIGUOUS_TEST_MAPPING', invocation));
    identities.add(key);
  }
  if (failures.length > 0) throw new ContractError(failures);
  tests.sort((left, right) => compareCodepoint(unitIdentity(left), unitIdentity(right)));
  return { schemaVersion: 1, runner: 'vitest', revision, invocation, shard, tests };
}

export async function readUnitShardReports(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new ContractError([issue('UNIT_REPORT_DIRECTORY_UNREADABLE')]);
  }
  const names = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const issues = [];
  for (const name of UNIT_REPORT_NAMES) {
    if (!names.has(name)) issues.push(issue('MISSING_UNIT_SHARD_REPORT'));
  }
  if (entries.some((entry) => entry.name.startsWith('unit-shard-') && entry.name.endsWith('.json') && !UNIT_REPORT_NAMES.includes(entry.name))) {
    issues.push(issue('UNEXPECTED_UNIT_SHARD_REPORT'));
  }
  if (issues.length > 0) throw new ContractError(issues);
  const reports = [];
  for (const name of UNIT_REPORT_NAMES) {
    try {
      reports.push(JSON.parse(await readFile(path.join(directory, name), 'utf8')));
    } catch {
      throw new ContractError([issue('MALFORMED_UNIT_SHARD_REPORT')]);
    }
  }
  return reports;
}

export function validateUnitShardEvidence({ full, shards, reports } = {}) {
  const issues = [];
  issues.push(...validateUnitInventory(full));
  if (!full || !Array.isArray(full.tests)) return { ok: false, issues: normalizeIssues(issues) };
  const revision = full.revision;
  const fullKeys = new Set(full.tests.map(unitIdentity));
  if (!Array.isArray(shards) || shards.length !== UNIT_SHARD_COUNT) issues.push(issue('EXPECTED_UNIT_SHARD_COUNT'));
  const shardByIndex = new Map();
  const assigned = new Map();
  for (const shard of Array.isArray(shards) ? shards : []) {
    issues.push(...validateUnitInventory(shard, revision));
    if (!shard || !unitShard(shard.shard)) continue;
    if (shardByIndex.has(shard.shard.index)) issues.push(issue('DUPLICATE_UNIT_SHARD'));
    shardByIndex.set(shard.shard.index, shard);
    if (shard.tests?.length === 0) issues.push(issue('EMPTY_UNIT_SHARD', shard.invocation));
    for (const entry of shard.tests ?? []) {
      const key = unitIdentity(entry);
      if (!fullKeys.has(key)) issues.push(issue('EXTRA_UNIT_TEST', shard.invocation));
      if (assigned.has(key)) issues.push(issue('DUPLICATE_UNIT_ASSIGNMENT'));
      assigned.set(key, shard.shard.index);
    }
  }
  for (const key of fullKeys) {
    if (!assigned.has(key)) issues.push(issue('MISSING_UNIT_TEST'));
  }
  for (const key of assigned.keys()) {
    if (!fullKeys.has(key)) issues.push(issue('EXTRA_UNIT_TEST'));
  }

  const reportList = Array.isArray(reports) ? reports : [];
  if (reportList.length !== UNIT_SHARD_COUNT) issues.push(issue('MISSING_UNIT_SHARD_REPORT'));
  const reportByIndex = new Map();
  for (const report of reportList) {
    if (!report || typeof report !== 'object' || Array.isArray(report) || report.schemaVersion !== 1
      || !unitShard(report.shard) || !Array.isArray(report.tests)) {
      issues.push(issue('INVALID_UNIT_SHARD_REPORT'));
      continue;
    }
    const index = report.shard.index;
    if (reportByIndex.has(index)) issues.push(issue('DUPLICATE_UNIT_SHARD_REPORT'));
    reportByIndex.set(index, report);
    if (report.collectionOutcome !== 'complete') issues.push(issue('UNIT_COLLECTION_INCOMPLETE'));
    if (report.runOutcome !== 'passed') issues.push(issue('UNIT_SHARD_NOT_SUCCESS'));
  }
  for (let index = 1; index <= UNIT_SHARD_COUNT; index += 1) {
    const shard = shardByIndex.get(index);
    const report = reportByIndex.get(index);
    if (!shard || !report) {
      issues.push(issue('MISSING_UNIT_SHARD_REPORT'));
      continue;
    }
    if (report.shard.total !== shard.shard.total) issues.push(issue('UNIT_SHARD_REPORT_MISMATCH', report.invocation));
    const expected = new Set(shard.tests.map(unitIdentity));
    const actualActive = new Map();
    const allReported = new Set();
    for (const entry of report.tests) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || !validText(entry.project) || !safeUnitRelativePath(entry.file)
        || !validText(entry.fullTitle) || !Array.isArray(entry.titlePath)
        || entry.titlePath.length === 0 || entry.titlePath.some((title) => !validText(title))
        || !UNIT_RESULT_MODES.has(entry.mode) || !KNOWN_RESULT_STATUSES.has(entry.status)
        || !Number.isSafeInteger(entry.repeatIndex) || entry.repeatIndex < 0) {
        issues.push(issue('INVALID_UNIT_RESULT', report.invocation));
        continue;
      }
      const key = unitIdentity(entry);
      if (allReported.has(key)) issues.push(issue('DUPLICATE_UNIT_RESULT', report.invocation));
      allReported.add(key);
      if (entry.mode === 'skip' || entry.mode === 'todo') {
        if (entry.status !== 'skipped') issues.push(issue('INVALID_DECLARED_SKIP_RESULT', report.invocation));
        continue;
      }
      if (actualActive.has(key)) issues.push(issue('DUPLICATE_UNIT_RESULT', report.invocation));
      actualActive.set(key, entry);
      if (!expected.has(key)) issues.push(issue('EXTRA_UNIT_RESULT', report.invocation));
      if (entry.status === 'failed') issues.push(issue('FAILED_UNIT_RESULT', report.invocation));
      if (entry.status === 'not_run' || entry.status === 'interrupted' || entry.status === 'timedOut') issues.push(issue('UNEXECUTED_UNIT_RESULT', report.invocation));
    }
    for (const key of expected) {
      if (!actualActive.has(key)) issues.push(issue('MISSING_UNIT_RESULT', report.invocation));
    }
  }
  return { ok: normalizeIssues(issues).length === 0, issues: normalizeIssues(issues) };
}

export function inventoryDigest(inventory) {
  return sha256(canonicalJson(inventory));
}

function validateInventory(inventory, expected = {}) {
  const issues = [];
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) return [issue('INVALID_INVENTORY')];
  const invocationId = validInvocation(inventory.invocation) ? inventory.invocation : undefined;
  if (inventory.schemaVersion !== 1 || !REVISION.test(inventory.revision ?? '') || !SHA256.test(inventory.configDigest ?? '') || !MODES.has(inventory.mode) || !validInvocation(inventory.invocation) || !Array.isArray(inventory.tests)) {
    issues.push(issue('INVALID_INVENTORY', invocationId));
  }
  if (expected.revision && inventory.revision !== expected.revision) issues.push(issue('REVISION_MISMATCH', invocationId));
  if (expected.configDigest && inventory.configDigest !== expected.configDigest) issues.push(issue('CONFIG_DIGEST_MISMATCH', invocationId));
  if (expected.mode && inventory.mode !== expected.mode) issues.push(issue('MODE_MISMATCH', invocationId));
  if (Array.isArray(inventory.tests)) {
    for (const entry of inventory.tests) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        issues.push(issue('INVALID_TEST_ENTRY', invocationId));
        continue;
      }
      if (typeof entry.project !== 'string' || !PROJECTS.has(entry.project)) issues.push(issue('UNKNOWN_PROJECT', invocationId));
      const normalizedPath = normalizeRelativePath(entry.file);
      if (!normalizedPath || normalizedPath !== entry.file) issues.push(issue('INVALID_PATH', invocationId));
      if (!Array.isArray(entry.titlePath) || entry.titlePath.length === 0 || entry.titlePath.some((title) => !validText(title))) issues.push(issue('INVALID_TITLE_PATH', invocationId));
      if (!Number.isSafeInteger(entry.repeatIndex) || entry.repeatIndex < 0) issues.push(issue('INVALID_REPEAT_INDEX', invocationId));
    }
  }
  return normalizeIssues(issues);
}

function identitiesFor(inventory, mode = inventory?.mode) {
  return Array.isArray(inventory?.tests)
    ? inventory.tests.map((entry) => canonicalTestIdentity({ mode, ...entry }))
    : [];
}

function pushIf(issues, code, condition, invocationId) {
  if (condition) issues.push(issue(code, invocationId));
}

export function validatePartition({ full, selected, tail, served } = {}) {
  const issues = [];
  const fullIssues = validateInventory(full, { mode: 'ordinary' });
  issues.push(...fullIssues);
  if (!full || !Array.isArray(full.tests)) return { ok: false, issues: normalizeIssues(issues) };

  const fullRevision = full.revision;
  const fullConfig = full.configDigest;
  const selectedShards = Array.isArray(selected) ? selected : [];
  if (selectedShards.length !== 2) issues.push(issue('EXPECTED_SHARD_COUNT'));
  for (const shard of selectedShards) {
    issues.push(...validateInventory(shard, { revision: fullRevision, configDigest: fullConfig, mode: 'ordinary' }));
  }
  if (selectedShards.length < 2) {
    for (let index = selectedShards.length; index < 2; index += 1) issues.push(issue('EMPTY_SHARD'));
  }

  const fullIdentities = new Map();
  const fullSetup = new Map();
  let fullChromiumCount = 0;
  for (const entry of full.tests) {
    if (!entry || typeof entry !== 'object') continue;
    const id = canonicalTestIdentity({ mode: 'ordinary', ...entry });
    fullIdentities.set(id, (fullIdentities.get(id) ?? 0) + 1);
    if (entry.project === 'chromium') fullChromiumCount += 1;
    if (entry.project === 'setup') fullSetup.set(id, (fullSetup.get(id) ?? 0) + 1);
    if (!['chromium', 'setup'].includes(entry.project)) issues.push(issue('UNEXPECTED_PROJECT', full.invocation));
  }
  if ([...fullIdentities.values()].some((count) => count > 1)) issues.push(issue('DUPLICATE_FULL_IDENTITY', full.invocation));
  pushIf(issues, 'EMPTY_FULL_INVENTORY', fullChromiumCount === 0, full.invocation);
  pushIf(issues, 'EMPTY_SETUP_INVENTORY', fullSetup.size === 0, full.invocation);

  const selectedChromium = new Map();
  const selectedSetupByShard = [];
  for (let shardIndex = 0; shardIndex < selectedShards.length; shardIndex += 1) {
    const shard = selectedShards[shardIndex];
    if (!shard || !Array.isArray(shard.tests)) {
      selectedSetupByShard.push(new Map());
      continue;
    }
    const setupCounts = new Map();
    let chromiumCount = 0;
    for (const entry of shard.tests) {
      if (!entry || typeof entry !== 'object') continue;
      const id = canonicalTestIdentity({ mode: 'ordinary', ...entry });
      if (entry.project === 'chromium') {
        chromiumCount += 1;
        selectedChromium.set(id, (selectedChromium.get(id) ?? 0) + 1);
      } else if (entry.project === 'setup') {
        setupCounts.set(id, (setupCounts.get(id) ?? 0) + 1);
      } else if (PROJECTS.has(entry.project)) {
        issues.push(issue('UNEXPECTED_PROJECT', shard.invocation));
      }
    }
    selectedSetupByShard.push(setupCounts);
    pushIf(issues, 'EMPTY_SHARD', chromiumCount === 0, shard.invocation);
  }
  if ([...selectedChromium.values()].some((count) => count > 1)) issues.push(issue('DUPLICATE_SELECTED_IDENTITY'));
  for (const id of fullIdentities.keys()) {
    const entry = full.tests.find((candidate) => canonicalTestIdentity({ mode: 'ordinary', ...candidate }) === id);
    if (entry?.project === 'chromium' && !selectedChromium.has(id)) issues.push(issue('MISSING_TEST'));
  }
  for (const id of selectedChromium.keys()) {
    if (!fullIdentities.has(id)) issues.push(issue('EXTRA_TEST'));
  }
  for (const setupCounts of selectedSetupByShard) {
    const ids = new Set([...setupCounts.keys(), ...fullSetup.keys()]);
    if ([...ids].some((id) => (setupCounts.get(id) ?? 0) !== (fullSetup.get(id) ?? 0))) {
      issues.push(issue('SETUP_MULTIPLICITY_MISMATCH'));
      break;
    }
  }

  const expectedTail = [['serial', 'serial'], ['consent', 'consent']];
  for (const [key, project] of expectedTail) {
    const lane = tail?.[key];
    if (!lane) {
      issues.push(issue('MISSING_TAIL_LANE'));
      continue;
    }
    issues.push(...validateInventory(lane, { revision: fullRevision, configDigest: fullConfig, mode: 'ordinary' }));
    const projectEntries = Array.isArray(lane.tests) ? lane.tests.filter((entry) => entry?.project === project) : [];
    if (!Array.isArray(lane.tests) || projectEntries.length === 0) issues.push(issue('EMPTY_TAIL_LANE', lane.invocation));
    const laneSetup = new Map();
    if (Array.isArray(lane.tests)) {
      for (const entry of lane.tests) {
        if (entry?.project === 'setup') {
          const id = canonicalTestIdentity({ mode: 'ordinary', ...entry });
          laneSetup.set(id, (laneSetup.get(id) ?? 0) + 1);
        } else if (entry?.project !== project) {
          issues.push(issue('UNEXPECTED_PROJECT', lane.invocation));
        }
      }
    }
    const setupIds = new Set([...fullSetup.keys(), ...laneSetup.keys()]);
    if ([...setupIds].some((id) => (laneSetup.get(id) ?? 0) !== (fullSetup.get(id) ?? 0))) issues.push(issue('SETUP_MULTIPLICITY_MISMATCH', lane.invocation));
    const ids = identitiesFor(lane, 'ordinary');
    if (new Set(ids).size !== ids.length) issues.push(issue('DUPLICATE_TAIL_IDENTITY', lane.invocation));
  }

  if (!served) {
    issues.push(issue('MISSING_SERVED_INVENTORY'));
  } else {
    issues.push(...validateInventory(served, { revision: fullRevision, configDigest: fullConfig, mode: 'served' }));
    const servedChromium = Array.isArray(served.tests) ? served.tests.filter((entry) => entry?.project === 'chromium') : [];
    if (servedChromium.length === 0) issues.push(issue('EMPTY_SERVED_INVENTORY', served.invocation));
    const servedSetup = new Map();
    if (Array.isArray(served.tests)) {
      for (const entry of served.tests) {
        if (entry?.project === 'setup') {
          const id = canonicalTestIdentity({ mode: 'ordinary', ...entry });
          servedSetup.set(id, (servedSetup.get(id) ?? 0) + 1);
        } else if (entry?.project !== 'chromium') {
          issues.push(issue('UNEXPECTED_PROJECT', served.invocation));
        }
      }
    }
    const servedSetupIds = new Set([...fullSetup.keys(), ...servedSetup.keys()]);
    if ([...servedSetupIds].some((id) => (servedSetup.get(id) ?? 0) !== (fullSetup.get(id) ?? 0))) issues.push(issue('SETUP_MULTIPLICITY_MISMATCH', served.invocation));
    const ids = identitiesFor(served, 'served');
    if (new Set(ids).size !== ids.length) issues.push(issue('DUPLICATE_SERVED_IDENTITY', served.invocation));
  }

  const normalized = normalizeIssues(issues);
  return { ok: normalized.length === 0, issues: normalized };
}

function validateManifest(manifest, { requirePartition = false } = {}) {
  const issues = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return [issue('INVALID_PLAN')];
  if (manifest.schemaVersion !== 1 || typeof manifest.revision !== 'string' || !REVISION.test(manifest.revision) || !validInvocation(manifest.runId) || !Number.isSafeInteger(manifest.attempt) || manifest.attempt < 1 || !Array.isArray(manifest.expectedJobs) || !Array.isArray(manifest.invocations)) {
    issues.push(issue('INVALID_PLAN'));
  }
  const jobs = new Set();
  for (const jobId of manifest.expectedJobs ?? []) {
    if (!validInvocation(jobId)) issues.push(issue('INVALID_JOB_ID'));
    else if (jobs.has(jobId)) issues.push(issue('DUPLICATE_JOB'));
    else jobs.add(jobId);
  }
  const invocationIds = new Set();
  for (const invocation of manifest.invocations ?? []) {
    if (!invocation || typeof invocation !== 'object' || Array.isArray(invocation) || !validInvocation(invocation.id) || !validInvocation(invocation.jobId) || !validInvocation(invocation.lane) || !MODES.has(invocation.mode) || !invocation.inventory) {
      issues.push(issue('INVALID_INVOCATION'));
      continue;
    }
    if (invocationIds.has(invocation.id)) issues.push(issue('DUPLICATE_INVOCATION'));
    invocationIds.add(invocation.id);
    if (!jobs.has(invocation.jobId)) issues.push(issue('UNEXPECTED_JOB_REFERENCE', invocation.id));
    issues.push(...validateInventory(invocation.inventory, { revision: manifest.revision, mode: invocation.mode }));
    if (invocation.inventory.invocation !== invocation.id) issues.push(issue('INVOCATION_MISMATCH', invocation.id));
    if (invocation.inventoryDigest !== undefined && invocation.inventoryDigest !== inventoryDigest(invocation.inventory)) issues.push(issue('INVENTORY_DIGEST_MISMATCH', invocation.id));
    if (invocation.shard !== null && (!invocation.shard || !Number.isSafeInteger(invocation.shard.index) || !Number.isSafeInteger(invocation.shard.total) || invocation.shard.total < 1 || invocation.shard.index < 1 || invocation.shard.index > invocation.shard.total)) {
      issues.push(issue('INVALID_SHARD', invocation.id));
    }
  }
  if (manifest.invocations?.length === 0) issues.push(issue('EMPTY_PLAN'));
  if (requirePartition) {
    if (!manifest.partition || typeof manifest.partition !== 'object') {
      issues.push(issue('MISSING_PARTITION_PROOF'));
    } else {
      const proof = validatePartition(manifest.partition);
      issues.push(...proof.issues);
      const partition = manifest.partition;
      const expected = [
        ...(Array.isArray(partition.selected) ? partition.selected.map((inventory, index) => ({ inventory, lane: 'chromium', mode: 'ordinary', shard: { index: index + 1, total: 2 } })) : []),
        ...(partition.tail?.serial ? [{ inventory: partition.tail.serial, lane: 'serial', mode: 'ordinary', shard: null }] : []),
        ...(partition.tail?.consent ? [{ inventory: partition.tail.consent, lane: 'consent', mode: 'ordinary', shard: null }] : []),
        ...(partition.served ? [{ inventory: partition.served, lane: 'served', mode: 'served', shard: null }] : []),
      ];
      const expectedIds = new Set();
      for (const expectedInvocation of expected) {
        const id = expectedInvocation.inventory?.invocation;
        if (!validInvocation(id)) {
          issues.push(issue('INVALID_INVOCATION'));
          continue;
        }
        expectedIds.add(id);
        const actual = (manifest.invocations ?? []).find((entry) => entry?.id === id);
        if (!actual || !actual.inventory || actual.lane !== expectedInvocation.lane || actual.mode !== expectedInvocation.mode || inventoryDigest(actual.inventory) !== inventoryDigest(expectedInvocation.inventory) || canonicalJson(actual.shard ?? null) !== canonicalJson(expectedInvocation.shard)) {
          issues.push(issue('PARTITION_INVOCATION_MISMATCH', id));
        }
      }
      for (const invocation of manifest.invocations ?? []) {
        if (validInvocation(invocation?.id) && !expectedIds.has(invocation.id)) issues.push(issue('PARTITION_INVOCATION_EXTRA', invocation.id));
      }
    }
  }
  return normalizeIssues(issues);
}

export function createPlan(manifest) {
  const issues = validateManifest(manifest, { requirePartition: true });
  if (issues.length > 0) throw new ContractError(issues);
  return {
    schemaVersion: 1,
    revision: manifest.revision,
    runId: manifest.runId,
    attempt: manifest.attempt,
    expectedJobs: [...manifest.expectedJobs],
    partition: manifest.partition,
    invocations: manifest.invocations.map((entry) => ({
      id: entry.id,
      lane: entry.lane,
      jobId: entry.jobId,
      mode: entry.mode,
      shard: entry.shard ? { index: entry.shard.index, total: entry.shard.total } : null,
      inventoryDigest: inventoryDigest(entry.inventory),
      inventory: entry.inventory,
    })),
  };
}

function isSafeOutcome(value) {
  return ['success', 'failure', 'skipped', 'cancelled', 'timeout', 'unknown'].includes(value);
}

function jobEntries(jobs) {
  if (jobs?._loadError) return { entries: [], malformed: true };
  if (Array.isArray(jobs)) return { entries: jobs, malformed: false };
  if (jobs && typeof jobs === 'object' && Array.isArray(jobs.jobs)) return { entries: jobs.jobs, malformed: false };
  return { entries: [], malformed: false };
}

function expectedResultIdentity(invocation, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  if (typeof result.project !== 'string' || typeof result.file !== 'string' || !Array.isArray(result.titlePath) || !Number.isSafeInteger(result.repeatIndex)) return null;
  const normalizedPath = normalizeRelativePath(result.file);
  if (!normalizedPath || normalizedPath !== result.file || result.titlePath.length === 0 || result.titlePath.some((title) => !validText(title))) return null;
  return canonicalTestIdentity({ mode: invocation.mode, project: result.project, file: result.file, titlePath: result.titlePath, repeatIndex: result.repeatIndex });
}

export function validateResults({ plan, artifacts, jobs } = {}) {
  const issues = [];
  const safePlan = plan && typeof plan === 'object' && !Array.isArray(plan) ? plan : null;
  if (!safePlan || safePlan.schemaVersion !== 1 || !REVISION.test(safePlan.revision ?? '') || !validInvocation(safePlan.runId) || !Number.isSafeInteger(safePlan.attempt) || !Array.isArray(safePlan.expectedJobs) || !Array.isArray(safePlan.invocations)) {
    issues.push(issue('INVALID_PLAN'));
    const normalized = normalizeIssues(issues);
    return { ok: false, complete: false, issues: normalized, counts: emptyCounts(), outcomes: [] };
  }
  const planIssues = validateManifest(safePlan, { requirePartition: true });
  if (planIssues.length > 0) issues.push(...planIssues);
  const expectedById = new Map(safePlan.invocations.map((entry) => [entry.id, entry]));
  const { entries: actualJobs, malformed: malformedJobs } = jobEntries(jobs);
  if (malformedJobs) issues.push(issue('MALFORMED_JSON'));
  const jobsById = new Map();
  const jobOutcomeById = new Map();
  for (const job of actualJobs) {
    if (!job || typeof job !== 'object' || !validInvocation(job.id) || !isSafeOutcome(job.outcome)) {
      issues.push(issue('INVALID_JOB'));
      continue;
    }
    jobsById.set(job.id, (jobsById.get(job.id) ?? 0) + 1);
    jobOutcomeById.set(job.id, job.outcome);
    if (!safePlan.expectedJobs.includes(job.id)) issues.push(issue('UNEXPECTED_JOB', job.id));
    if (job.outcome !== 'success') issues.push(issue('JOB_NOT_SUCCESS', job.id));
  }
  for (const jobId of safePlan.expectedJobs) {
    if (!jobsById.has(jobId)) issues.push(issue('MISSING_JOB', jobId));
    else if (jobsById.get(jobId) > 1) issues.push(issue('DUPLICATE_JOB', jobId));
  }

  const actualArtifacts = Array.isArray(artifacts) ? artifacts : [];
  if (!Array.isArray(artifacts)) issues.push(issue('INVALID_ARTIFACT_SET'));
  const artifactCounts = new Map();
  let expectedCases = 0;
  let reportedCases = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let unexecuted = 0;
  const outcomes = [];
  for (const invocation of safePlan.invocations) {
    if (Array.isArray(invocation.inventory?.tests)) expectedCases += invocation.inventory.tests.length;
  }
  for (const artifact of actualArtifacts) {
    if (artifact?._loadError) {
      const invocationId = validInvocation(artifact.invocationId) ? artifact.invocationId : undefined;
      issues.push(issue('MALFORMED_JSON', invocationId));
      if (invocationId) artifactCounts.set(invocationId, (artifactCounts.get(invocationId) ?? 0) + 1);
      outcomes.push({ invocationId: invocationId ?? 'unknown', jobId: 'unknown', jobOutcome: 'unknown', processOutcome: 'unknown', collectionOutcome: 'incomplete' });
      continue;
    }
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact) || !validInvocation(artifact.invocationId)) {
      issues.push(issue('INVALID_ARTIFACT'));
      outcomes.push({ invocationId: 'unknown', jobId: 'unknown', jobOutcome: 'unknown', processOutcome: 'unknown', collectionOutcome: 'incomplete' });
      continue;
    }
    const invocationId = artifact.invocationId;
    artifactCounts.set(invocationId, (artifactCounts.get(invocationId) ?? 0) + 1);
    if (artifact._sourceInvocationId !== undefined) {
      if (!validInvocation(artifact._sourceInvocationId)) issues.push(issue('INVALID_ARTIFACT_FILENAME', invocationId));
      else if (artifact._sourceInvocationId !== invocationId) issues.push(issue('ARTIFACT_FILENAME_MISMATCH', invocationId));
    }
    const expected = expectedById.get(invocationId);
    if (!expected) {
      issues.push(issue('UNEXPECTED_ARTIFACT', invocationId));
      const unexpectedJobId = validInvocation(artifact.jobId) ? artifact.jobId : 'unknown';
      outcomes.push({ invocationId, jobId: unexpectedJobId, jobOutcome: isSafeOutcome(jobOutcomeById.get(unexpectedJobId)) ? jobOutcomeById.get(unexpectedJobId) : 'unknown', processOutcome: isSafeOutcome(artifact.processOutcome) ? artifact.processOutcome : 'unknown', collectionOutcome: artifact.collectionOutcome === 'complete' ? 'complete' : 'incomplete' });
      continue;
    }
    const outcome = isSafeOutcome(artifact.processOutcome) ? artifact.processOutcome : 'unknown';
    const collectionOutcome = artifact.collectionOutcome === 'complete' ? 'complete' : 'incomplete';
    const artifactJobId = validInvocation(artifact.jobId) ? artifact.jobId : 'unknown';
    outcomes.push({ invocationId, jobId: artifactJobId, jobOutcome: isSafeOutcome(jobOutcomeById.get(artifactJobId)) ? jobOutcomeById.get(artifactJobId) : 'unknown', processOutcome: outcome, collectionOutcome });
    if (artifact.schemaVersion !== 1 || !validInvocation(artifact.jobId) || !REVISION.test(artifact.revision ?? '') || !validInvocation(artifact.runId) || !Number.isSafeInteger(artifact.attempt) || !SHA256.test(artifact.inventoryDigest ?? '') || !isSafeOutcome(artifact.processOutcome) || !Array.isArray(artifact.results)) {
      issues.push(issue('INVALID_ARTIFACT', invocationId));
      continue;
    }
    if (artifact.revision !== safePlan.revision) issues.push(issue('STALE_REVISION', invocationId));
    if (artifact.runId !== safePlan.runId) issues.push(issue('STALE_RUN_ID', invocationId));
    if (artifact.attempt !== safePlan.attempt) issues.push(issue('STALE_RUN_ATTEMPT', invocationId));
    if (artifact.inventoryDigest !== expected.inventoryDigest) issues.push(issue('INVENTORY_DIGEST_MISMATCH', invocationId));
    if (artifact.jobId !== expected.jobId) issues.push(issue('JOB_MISMATCH', invocationId));
    if (artifact.processOutcome !== 'success') issues.push(issue('ARTIFACT_PROCESS_NOT_SUCCESS', invocationId));
    if (collectionOutcome !== 'complete') issues.push(issue('COLLECTION_INCOMPLETE', invocationId));

    const expectedIdentities = new Set(identitiesFor(expected.inventory, expected.mode));
    const resultCounts = new Map();
    for (const result of artifact.results) {
      reportedCases += 1;
      const identity = expectedResultIdentity(expected, result);
      if (!identity) {
        issues.push(issue('INVALID_RESULT_IDENTITY', invocationId));
      } else {
        resultCounts.set(identity, (resultCounts.get(identity) ?? 0) + 1);
        if (!expectedIdentities.has(identity)) issues.push(issue('EXTRA_RESULT', invocationId));
      }
      const status = result?.status;
      if (status === 'passed') passed += 1;
      else if (status === 'skipped') skipped += 1;
      else if (status === 'not_run' || status === 'interrupted') {
        unexecuted += 1;
        issues.push(issue('UNEXECUTED_RESULT', invocationId));
      } else if (status === 'failed' || status === 'timedOut') {
        failed += 1;
        issues.push(issue('FAILED_RESULT', invocationId));
      } else if (!KNOWN_RESULT_STATUSES.has(status)) {
        failed += 1;
        issues.push(issue('UNKNOWN_RESULT_STATUS', invocationId));
      }
    }
    for (const [identity, count] of resultCounts) {
      if (count > 1) issues.push(issue('DUPLICATE_RESULT', invocationId));
      if (!expectedIdentities.has(identity)) continue;
    }
    for (const identity of expectedIdentities) {
      if (!resultCounts.has(identity)) issues.push(issue('MISSING_RESULT', invocationId));
    }
  }
  for (const invocationId of expectedById.keys()) {
    if (!artifactCounts.has(invocationId)) issues.push(issue('MISSING_ARTIFACT', invocationId));
    else if (artifactCounts.get(invocationId) > 1) issues.push(issue('DUPLICATE_ARTIFACT', invocationId));
    if (!outcomes.some((entry) => entry.invocationId === invocationId)) {
      const expected = expectedById.get(invocationId);
      outcomes.push({ invocationId, jobId: expected.jobId, jobOutcome: isSafeOutcome(jobOutcomeById.get(expected.jobId)) ? jobOutcomeById.get(expected.jobId) : 'unknown', processOutcome: 'unknown', collectionOutcome: 'incomplete' });
    }
  }

  const normalized = normalizeIssues(issues);
  const counts = {
    expectedJobs: safePlan.expectedJobs.length,
    reportedJobs: actualJobs.length,
    expectedArtifacts: safePlan.invocations.length,
    reportedArtifacts: actualArtifacts.length,
    expectedCases,
    reportedCases,
    passed,
    failed,
    skipped,
    unexecuted,
  };
  const complete = normalized.length === 0;
  return { ok: complete, complete, issues: normalized, counts, outcomes: outcomes.sort((left, right) => compareCodepoint(left.invocationId, right.invocationId)) };
}

function emptyCounts() {
  return { expectedJobs: 0, reportedJobs: 0, expectedArtifacts: 0, reportedArtifacts: 0, expectedCases: 0, reportedCases: 0, passed: 0, failed: 0, skipped: 0, unexecuted: 0 };
}

export function projectSafeSummary({ plan, result } = {}) {
  const safeRevision = typeof plan?.revision === 'string' && REVISION.test(plan.revision) ? plan.revision : 'unknown';
  const counts = result?.counts && typeof result.counts === 'object' ? result.counts : emptyCounts();
  const numericCounts = Object.fromEntries(Object.entries(emptyCounts()).map(([key]) => [key, Number.isSafeInteger(counts[key]) && counts[key] >= 0 ? counts[key] : 0]));
  const outcomes = Array.isArray(result?.outcomes) ? result.outcomes.map((entry) => ({
    invocationId: validInvocation(entry?.invocationId) ? entry.invocationId : 'unknown',
    jobId: validInvocation(entry?.jobId) ? entry.jobId : 'unknown',
    jobOutcome: isSafeOutcome(entry?.jobOutcome) ? entry.jobOutcome : 'unknown',
    processOutcome: isSafeOutcome(entry?.processOutcome) ? entry.processOutcome : 'unknown',
    collectionOutcome: entry?.collectionOutcome === 'complete' ? 'complete' : 'incomplete',
  })) : [];
  return {
    schemaVersion: 1,
    revision: safeRevision,
    lane: 'aggregate',
    shard: null,
    counts: numericCounts,
    complete: result?.complete === true,
    outcomes,
    issueCodes: normalizeIssues(result?.issues ?? []).map((entry) => entry.code),
  };
}

function parseArguments(args) {
  const [command, ...rest] = args;
  const expected = command === 'plan' ? ['--input', '--output'] : command === 'check' ? ['--plan', '--results', '--jobs', '--summary'] : null;
  if (!expected || rest.length !== expected.length * 2) return null;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    if (!expected.includes(rest[index]) || options[rest[index]] || typeof rest[index + 1] !== 'string' || rest[index + 1].length === 0) return null;
    options[rest[index]] = rest[index + 1];
  }
  if (expected.some((flag) => !options[flag])) return null;
  return { command, options };
}

async function readJsonFile(filePath) {
  try {
    const text = await readFile(filePath, 'utf8');
    try {
      return { value: JSON.parse(text), error: null };
    } catch {
      return { value: null, error: 'MALFORMED_JSON' };
    }
  } catch {
    return { value: null, error: 'MALFORMED_JSON' };
  }
}

function printSafeDiagnostic(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function runPlan(options) {
  const input = await readJsonFile(options['--input']);
  if (input.error) {
    printSafeDiagnostic({ schemaVersion: 1, complete: false, issueCodes: [input.error] });
    return 1;
  }
  let plan;
  try {
    plan = createPlan(input.value);
  } catch (error) {
    const issueCodes = error instanceof ContractError ? error.issues.map((entry) => entry.code) : ['INVALID_PLAN'];
    printSafeDiagnostic({ schemaVersion: 1, complete: false, issueCodes: [...new Set(issueCodes)].sort() });
    return 1;
  }
  try {
    await writeFile(options['--output'], `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  } catch {
    printSafeDiagnostic({ schemaVersion: 1, complete: false, issueCodes: ['PLAN_WRITE_FAILED'] });
    return 2;
  }
  printSafeDiagnostic({ schemaVersion: 1, revision: plan.revision, complete: true, issueCodes: [] });
  return 0;
}

async function readArtifactDirectory(directory) {
  let names;
  try {
    names = await readdir(directory, { withFileTypes: true });
  } catch {
    return { artifacts: [], issues: [issue('RESULTS_DIR_UNREADABLE')] };
  }
  const artifacts = [];
  const issues = [];
  for (const entry of names.filter((item) => item.name.endsWith('.json')).sort((a, b) => compareCodepoint(a.name, b.name))) {
    const invocationId = entry.name.slice(0, -5);
    if (!validInvocation(invocationId)) {
      issues.push(issue('INVALID_ARTIFACT_FILENAME'));
      continue;
    }
    if (!entry.isFile()) {
      artifacts.push({ _loadError: true, invocationId });
      continue;
    }
    const loaded = await readJsonFile(path.join(directory, entry.name));
    if (loaded.error) artifacts.push({ _loadError: true, invocationId });
    else if (loaded.value && typeof loaded.value === 'object' && !Array.isArray(loaded.value)) {
      artifacts.push({ ...loaded.value, _sourceInvocationId: invocationId });
    } else {
      artifacts.push(loaded.value);
    }
  }
  return { artifacts, issues };
}

async function runCheck(options) {
  const [loadedPlan, loadedJobs, loadedArtifacts] = await Promise.all([
    readJsonFile(options['--plan']),
    readJsonFile(options['--jobs']),
    readArtifactDirectory(options['--results']),
  ]);
  const jobs = loadedJobs.error ? { _loadError: true } : loadedJobs.value;
  let result = validateResults({ plan: loadedPlan.value, artifacts: loadedArtifacts.artifacts, jobs });
  const additionalIssues = [];
  if (loadedPlan.error) additionalIssues.push(issue('MALFORMED_JSON'));
  if (loadedJobs.error) additionalIssues.push(issue('MALFORMED_JSON'));
  additionalIssues.push(...loadedArtifacts.issues);
  if (additionalIssues.length > 0) {
    const issues = normalizeIssues([...result.issues, ...additionalIssues]);
    result = { ...result, ok: false, complete: false, issues };
  }
  let summary = projectSafeSummary({ plan: loadedPlan.value, result });
  try {
    await writeFile(options['--summary'], `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  } catch {
    result = { ...result, ok: false, complete: false, issues: normalizeIssues([...result.issues, issue('SUMMARY_WRITE_FAILED')]) };
    summary = projectSafeSummary({ plan: loadedPlan.value, result });
    printSafeDiagnostic(summary);
    return 2;
  }
  printSafeDiagnostic(summary);
  return result.ok ? 0 : 1;
}

async function main(args = process.argv.slice(2)) {
  const parsed = parseArguments(args);
  if (!parsed) {
    printSafeDiagnostic({ schemaVersion: 1, complete: false, issueCodes: ['INVALID_USAGE'] });
    return 2;
  }
  return parsed.command === 'plan' ? runPlan(parsed.options) : runCheck(parsed.options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((status) => { process.exitCode = status; }).catch(() => {
    printSafeDiagnostic({ schemaVersion: 1, complete: false, issueCodes: ['INTERNAL_ERROR'] });
    process.exitCode = 1;
  });
}
