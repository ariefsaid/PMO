#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'pmo-portal');
const AUTH_SETUP = path.join(APP, 'e2e', 'auth.setup.ts');
const SIGN_IN = path.join(ROOT, '.claude', 'skill-overrides', 'restructure', 'scripts', 'signed-in-state.mjs');
const STATE_DIR = path.join(ROOT, '.taste-skill', 'auth');
const DEFAULT_RESULTS = path.join(os.homedir(), 'Coding', 'PMO', 'docs', 'private', 'ux-1110', 'all-screens', 'results');
const DEFAULT_BASE = 'http://localhost:5288';
const DEFAULT_WIDTHS = [1440, 390];
const NOT_FOUND_ID = '00000000-0000-0000-0000-000000000000';
const HEIGHT_BY_WIDTH = { 1440: 900, 1280: 800, 1024: 768, 768: 1024, 390: 844, 375: 812 };

class MissingSeedError extends Error {
  constructor(route, parameter) {
    super(`route ${route} needs a seeded value for :${parameter}`);
    this.name = 'MissingSeedError';
    this.code = 'NO_SEED_RECORD';
    this.route = route;
    this.parameter = parameter;
  }
}

const usage = `usage: node scripts/measure-screens.mjs --cells <private-scorecard.md> [--out <private-results-dir>] [--base <52xx-url>] [--from <1-based-cell>] [--limit 1..10] [--impeccable <script>]
       node scripts/measure-screens.mjs --self-test [--impeccable <script>]

Each invocation is one browser batch of at most 10 cells. Re-run with the next --from value after the lock pair releases.
The loaded page runs ux-proof metrics, taste app checks, and stageshow layout-core in-page; impeccable detect attaches to that same page over CDP.`;

function cleanCell(value) {
  return String(value ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim();
}

function splitMarkdownRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) throw new Error('not a pipe table row');
  const content = trimmed.slice(1, -1);
  const cells = [];
  let value = '';
  let codeDelimiter = 0;
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (character === '`') {
      let runLength = 1;
      while (content[index + runLength] === '`') runLength++;
      if (!codeDelimiter) codeDelimiter = runLength;
      else if (runLength === codeDelimiter) codeDelimiter = 0;
      value += '`'.repeat(runLength);
      index += runLength - 1;
      continue;
    }
    if (character === '|' && !codeDelimiter && content[index - 1] !== '\\') {
      cells.push(cleanCell(value));
      value = '';
      continue;
    }
    value += character;
  }
  cells.push(cleanCell(value));
  return cells;
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')));
}

function columnIndex(headers, name) {
  const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const target = normalize(name);
  const exact = headers.findIndex((header) => normalize(header) === target);
  return exact >= 0 ? exact : headers.findIndex((header) => normalize(header).startsWith(`${target} `));
}

function getColumn(row, headers, name) {
  const index = columnIndex(headers, name);
  return index < 0 ? '' : row[index] ?? '';
}

function cellId(value, section, width) {
  const id = cleanCell(value);
  return section === 'base' ? id : `${id}-${width}`;
}

function parseRole(value) {
  const role = cleanCell(value);
  if (/anonymous/i.test(role)) return 'anonymous';
  if (/any signed-in role/i.test(role)) return 'any signed-in role';
  const roles = ['Executive', 'Admin', 'Finance', 'Project Manager', 'Engineer'];
  return roles.find((candidate) => role.toLowerCase().includes(candidate.toLowerCase())) ?? role;
}

function parseDeniedRole(value) {
  const source = cleanCell(value);
  const roles = ['Executive', 'Admin', 'Finance', 'Project Manager', 'Engineer'];
  const found = roles
    .map((role) => ({ role, index: source.toLowerCase().indexOf(role.toLowerCase()) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index);
  return found[0]?.role ?? 'Admin';
}

export function parseScorecard(markdown) {
  const cells = [];
  let section = null;
  let headers = null;
  let excludedRedirects = 0;
  let rowCount = 0;

  for (const [index, line] of String(markdown).split(/\r?\n/).entries()) {
    const heading = line.match(/^#{1,6}\s+Section\s+(\d+)\b/i);
    if (heading) {
      section = Number(heading[1]);
      headers = null;
      continue;
    }
    if (![1, 2, 3].includes(section)) continue;
    if (!line.trim() || !line.trim().startsWith('|')) {
      headers = null;
      continue;
    }

    let row = splitMarkdownRow(line);
    if (isSeparatorRow(row)) continue;
    if (!headers) {
      headers = row.map((value) => value.toLowerCase().replace(/\*\*/g, '').trim());
      continue;
    }

    const sourceLine = index + 1;
    if (row.length !== headers.length) {
      const seedIndex = columnIndex(headers, 'seeded id');
      const pipeListInSeed = seedIndex === headers.length - 1 && row.length > headers.length && /^kind(?: tabs)?:\s*/i.test(row[seedIndex] ?? '');
      if (pipeListInSeed) row = [...row.slice(0, seedIndex), row.slice(seedIndex).join(' | ')];
      if (row.length !== headers.length) {
        throw new Error(`ragged scorecard row at line ${sourceLine}: header has ${headers.length} columns, row has ${row.length}`);
      }
    }

    const rowId = getColumn(row, headers, '#');
    if (!rowId) throw new Error(`scorecard row at line ${sourceLine} has no cell identifier`);
    rowCount++;

    if (section === 1) {
      const kind = getColumn(row, headers, 'kind');
      if (kind.toLowerCase() === 'redirect') {
        excludedRedirects++;
        continue;
      }
      const width = Number(getColumn(row, headers, 'width'));
      const route = getColumn(row, headers, 'route');
      if (!route || !Number.isInteger(width)) throw new Error(`scorecard base row ${rowId} at line ${sourceLine} needs a route and integer width`);
      cells.push({
        scorecardId: cellId(rowId, 'base'),
        sourceId: rowId,
        section: 'base',
        route,
        kind,
        role: parseRole(getColumn(row, headers, 'role')),
        roleSource: getColumn(row, headers, 'role'),
        width,
        seededId: getColumn(row, headers, 'seeded id'),
        sourceLine,
      });
      continue;
    }

    if (section === 2) {
      const route = getColumn(row, headers, 'route');
      if (!route) throw new Error(`scorecard extra-role row ${rowId} at line ${sourceLine} has no route`);
      for (const width of DEFAULT_WIDTHS) {
        cells.push({
          scorecardId: cellId(rowId, 'extra', width),
          sourceId: rowId,
          section: 'extra-role',
          route,
          kind: '',
          role: parseRole(getColumn(row, headers, 'role')),
          roleSource: getColumn(row, headers, 'role'),
          width,
          seededId: '',
          why: getColumn(row, headers, 'why it differs'),
          proof: getColumn(row, headers, 'proof'),
          sourceLine,
        });
      }
      continue;
    }

    if (section === 3) {
      for (const width of DEFAULT_WIDTHS) {
        cells.push({
          scorecardId: cellId(rowId, 'denied', width),
          sourceId: rowId,
          section: 'denied',
          route: null,
          kind: 'denied',
          role: parseDeniedRole(getColumn(row, headers, 'who hits it')),
          roleSource: getColumn(row, headers, 'who hits it'),
          width,
          seededId: '',
          surface: getColumn(row, headers, 'denied surface'),
          whatRenders: getColumn(row, headers, 'what renders'),
          proof: getColumn(row, headers, 'proof'),
          sourceLine,
        });
      }
    }
  }

  if (!rowCount || !cells.length) throw new Error('no measurable scorecard cells found in Sections 1–3');
  return { cells, excludedRedirects };
}

function routeTemplate(routeText) {
  return cleanCell(routeText).split(/\s*→\s*/)[0].trim();
}

function routedTab(routeText) {
  return cleanCell(routeText).match(/\s*→\s*([a-z0-9_-]+)\s*$/i)?.[1] ?? null;
}

function firstKind(seedText) {
  return cleanCell(seedText).match(/\bkind(?: tabs)?:\s*([^|·,)]+)/i)?.[1]?.trim() ?? null;
}

function firstSeedToken(seedText) {
  const seed = cleanCell(seedText);
  const uuid = seed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  if (uuid) return uuid;
  if (/^(?:n\/a|none seeded|no id|unknown)\b/i.test(seed)) return null;
  return firstKind(seed) ?? (seed ? seed.split(/[;,\s]+/)[0] : null);
}

export function materializeRoute(routeText, seededId = '') {
  let route = routeTemplate(routeText);
  if (!route || route === '*') {
    const fallback = cleanCell(seededId).replace(/^\/+/, '').split(/[\s,;]+/)[0];
    if (!fallback || /^(?:n\/a|none|unknown)$/i.test(fallback)) throw new MissingSeedError('*', 'not-found path');
    return `/${fallback}`;
  }

  const tab = routedTab(routeText);
  const seedToken = firstSeedToken(seededId);
  const params = [...route.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g)].map((match) => match[1]);
  for (const param of params) {
    let value;
    if (param === 'tab') value = tab ?? 'overview';
    else if (param === 'kind') value = firstKind(seededId);
    else if (param === 'section') value = 'unknown';
    else value = seedToken;
    if (!value && /not[ -]?found/i.test(seededId)) value = NOT_FOUND_ID;
    if (!value) throw new MissingSeedError(routeTemplate(routeText), param);
    route = route.replace(`:${param}`, encodeURIComponent(value));
  }
  return route;
}

function appRouteEntries(appSource) {
  const moduleAliases = [];
  const importPattern = /const\s+([A-Za-z_$][\w$]*)\s*=\s*lazyWithPreload\(\(\)\s*=>\s*import\(['"]([^'"]+)['"]\)/g;
  for (const match of appSource.matchAll(importPattern)) {
    moduleAliases.push({ alias: match[1], modulePath: match[2].replace(/^\.\//, '') });
  }
  const start = appSource.indexOf('export const appRouteConfig');
  const routeArray = start < 0 ? '' : appSource.slice(start, appSource.indexOf('\n];', start));
  if (!routeArray) throw new Error('could not read appRouteConfig from pmo-portal/App.tsx');

  const entries = [];
  const routePattern = /^[ \t]*\{[ \t]*path:[ \t]*(['"])(.*?)\1,[ \t]*([\s\S]*?)(?=^[ \t]*\{[ \t]*path:|^[ \t]*\];)/gm;
  for (const match of routeArray.matchAll(routePattern)) {
    const pathPattern = match[2];
    const body = match[3];
    const modules = moduleAliases.filter(({ alias }) => new RegExp(`\\b${alias.replace(/[$]/g, '\\$')}\\b`).test(body));
    entries.push({ path: pathPattern, modules });
  }
  return entries;
}

function proofModules(proof) {
  const paths = [];
  const pattern = /((?:pages|src\/auth)\/[A-Za-z0-9_./-]+)\.(?:tsx?|jsx?)/g;
  for (const match of String(proof ?? '').matchAll(pattern)) {
    const modulePath = match[1].replace(/^pages\//, 'pages/');
    if (!paths.includes(modulePath)) paths.push(modulePath);
  }
  return paths;
}

function resolveDeniedRoute(cell, routes) {
  const description = `${cell.surface ?? ''} ${cell.whatRenders ?? ''}`.toLowerCase();
  const evidencePaths = proofModules(cell.proof);
  let candidates = [];
  for (const evidencePath of evidencePaths) {
    const moduleSuffix = evidencePath.replace(/\.tsx?$/, '');
    candidates = routes.filter((entry) => entry.modules.some(({ modulePath }) => modulePath.endsWith(moduleSuffix)));
    if (candidates.length) break;
  }
  if (!candidates.length) throw new Error(`cannot map denied row ${cell.scorecardId} to an app route from its proof field`);

  const explicitPath = [...description.matchAll(/\/(?:[a-z0-9_-]+|:[a-z][a-z0-9_]*)+(?:\/(?:[a-z0-9_-]+|:[a-z][a-z0-9_]*))*/g)]
    .map((match) => match[0]);
  const exact = candidates.find((entry) => explicitPath.some((candidate) => candidate.toLowerCase() === entry.path.toLowerCase()));
  if (exact) return exact.path;
  if (/exchange[ -]rates/.test(description)) {
    const match = candidates.find((entry) => entry.path.includes('exchange-rates'));
    if (match) return match.path;
  }
  if (/\busage\b/.test(description)) {
    const match = candidates.find((entry) => entry.path.endsWith('/usage'));
    if (match) return match.path;
  }
  if (/\bedit\b/.test(description)) {
    const match = candidates.find((entry) => entry.path.endsWith('/edit'));
    if (match) return match.path;
  }
  if (/\bcreate\b/.test(description)) {
    const match = candidates.find((entry) => entry.path.endsWith('/new'));
    if (match) return match.path;
  }
  return candidates[0].path;
}

export function resolveCellPath(cell, allCells, appSource) {
  if (cell.route) {
    const template = routeTemplate(cell.route);
    const baseCell = allCells.find((candidate) => candidate.section === 'base' && routeTemplate(candidate.route) === template);
    const seed = cell.seededId || baseCell?.seededId || '';
    return materializeRoute(cell.route, seed);
  }
  const route = resolveDeniedRoute(cell, appRouteEntries(appSource));
  const template = route;
  const baseCell = allCells.find((candidate) => candidate.section === 'base' && routeTemplate(candidate.route) === template);
  let seed = baseCell?.seededId ?? '';
  const description = `${cell.surface ?? ''} ${cell.whatRenders ?? ''}`;
  if (/not[ -]?found/i.test(description)) seed = `not found ${NOT_FOUND_ID}`;
  if (/:kind\b/.test(route) && /financial/i.test(description)) {
    const values = cleanCell(seed).match(/kind(?: tabs)?:\s*(.*)$/i)?.[1]?.split(/[|·,]/).map((value) => value.trim()).filter(Boolean) ?? [];
    seed = `kind: ${values.find((value) => /account|tax/i.test(value)) ?? ''}`;
  }
  return materializeRoute(route, seed);
}

export function formatFindingCount(toolResult) {
  if (!toolResult || toolResult.status !== 'complete') return 'unknown';
  if (Number.isInteger(toolResult.count)) return String(toolResult.count);
  if (!Array.isArray(toolResult.findings)) return 'unknown';
  return String(toolResult.findings.length);
}

function countDetectorFindings(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return 0;
  if (Array.isArray(value.findings)) return value.findings.length;
  if (Array.isArray(value.results)) return value.results.reduce((sum, item) => sum + countDetectorFindings(item), 0);
  return Object.entries(value).reduce((sum, [key, item]) => sum + (key === 'advisories' ? 0 : countDetectorFindings(item)), 0);
}

function hasDetectorFindingShape(value) {
  if (Array.isArray(value)) return true;
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value.findings) || Array.isArray(value.results)) return true;
  return Object.entries(value).some(([key, item]) => key !== 'advisories' && hasDetectorFindingShape(item));
}

function resolveDetector(explicitPath) {
  const candidates = [
    explicitPath ? path.resolve(explicitPath) : null,
    path.join(ROOT, '.claude', 'skills', 'impeccable', 'scripts', 'impeccable'),
  ].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  const found = spawnSync('which', ['impeccable'], { encoding: 'utf8' });
  const fromPath = found.status === 0 ? found.stdout.trim() : '';
  return fromPath && existsSync(fromPath) ? fromPath : null;
}

function parseArgs(argv) {
  const options = { cells: null, out: DEFAULT_RESULTS, base: DEFAULT_BASE, from: 1, limit: 10, impeccable: null, selfTest: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--self-test') { options.selfTest = true; continue; }
    if (!['--cells', '--out', '--base', '--from', '--limit', '--impeccable'].includes(arg) || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error(`unexpected argument ${arg}; use --help`);
    }
    const value = argv[++index];
    if (arg === '--cells') options.cells = value;
    else if (arg === '--out') options.out = path.resolve(value);
    else if (arg === '--base') options.base = value.replace(/\/$/, '');
    else if (arg === '--impeccable') options.impeccable = value;
    else if (arg === '--from') options.from = Number(value);
    else if (arg === '--limit') options.limit = Number(value);
  }
  if (options.help) return options;
  if (!options.selfTest && !options.cells) throw new Error('--cells is required outside --self-test');
  if (!Number.isInteger(options.from) || options.from < 1) throw new Error('--from must be a positive 1-based cell number');
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10) throw new Error('--limit must be an integer from 1 through 10');
  const base = new URL(options.base);
  if (!/^https?:$/.test(base.protocol) || !/^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(base.hostname) || !/^52\d\d$/.test(base.port)) {
    throw new Error('--base must use a local host and a 52xx port');
  }
  return options;
}

async function waitForMachineLoad() {
  const load = os.loadavg()[0];
  if (!Number.isFinite(load)) return;
  if (load > 30) console.error(`machine load ${load.toFixed(1)} is over 30; waiting before browser work`);
  while (os.loadavg()[0] > 30) await delay(5000);
}

function requirePlaywright() {
  const requireApp = createRequire(path.join(APP, 'package.json'));
  try { return requireApp('@playwright/test').chromium; }
  catch { throw new Error('Playwright is not installed in pmo-portal; install the worktree dependencies before measuring'); }
}

async function allocateDebugPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function launchBrowser(chromium, debugPort) {
  return chromium.launch({ headless: true, args: [`--remote-debugging-port=${debugPort}`] });
}

async function loadToolModules() {
  const tasteRoot = path.join(ROOT, '.claude', 'skills', 'taste', 'scripts', 'lib');
  const layoutCore = path.join(ROOT, '.claude', 'skills', 'stageshow', 'scripts', 'layout-core.mjs');
  const metrics = path.join(ROOT, 'scripts', 'ux-proof-metrics.mjs');
  const tasteFiles = [
    path.join(tasteRoot, 'probe.mjs'),
    path.join(tasteRoot, 'rules.mjs'),
    layoutCore,
    metrics,
  ];
  const missing = tasteFiles.filter((file) => !existsSync(file));
  if (missing.length) throw new Error(`measurement sources are missing: ${missing.map((file) => path.relative(ROOT, file)).join(', ')}; install the repo skills before running`);
  const [probeModule, rulesModule, layoutModule, metricsModule] = await Promise.all([
    import(pathToFileURL(path.join(tasteRoot, 'probe.mjs'))),
    import(pathToFileURL(path.join(tasteRoot, 'rules.mjs'))),
    import(pathToFileURL(layoutCore)),
    import(pathToFileURL(metrics)),
  ]);
  return {
    probe: probeModule.probe,
    frame: probeModule.frame,
    tasteLayout: probeModule.layout,
    tasteApp: probeModule.app,
    colourShare: probeModule.colourShare,
    judge: rulesModule.judge,
    judgeLayout: rulesModule.judgeLayout,
    judgeApp: rulesModule.judgeApp,
    appSkip: rulesModule.APP_SKIP,
    auditLayout: layoutModule.auditLayout,
    layoutResult: layoutModule.layoutResult,
    chartSelector: metricsModule.CHART_SELECTOR,
    measureText: metricsModule.measureText,
    violations: metricsModule.violations,
  };
}

function resolveCellRole(cell) {
  return cell.section === 'denied' ? cell.role : parseRole(cell.role);
}

function recordKindNeeded(cell, route) {
  const parameter = String(route ?? '').match(/:([A-Za-z][A-Za-z0-9]*?Id)\b/)?.[1];
  if (!parameter) return cell.kind || 'record';
  return parameter.replace(/Id$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function roleAlias(role) {
  const aliases = {
    Executive: ['exec'],
    Admin: ['admin'],
    Finance: ['finance'],
    'Project Manager': ['pm'],
    Engineer: ['engineer'],
  };
  return aliases[role] ?? null;
}

function emailForRole(role, authSource) {
  if (role === 'anonymous') return null;
  const aliases = roleAlias(role) ?? (role === 'any signed-in role' ? ['admin'] : null);
  if (!aliases) throw new Error(`no seeded sign-in mapping is defined for role ${role}`);
  const emails = [...authSource.matchAll(/['"]([a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,})['"]/gi)].map((match) => match[1]);
  const email = emails.find((candidate) => aliases.includes(candidate.split('@')[0].toLowerCase()));
  if (!email) throw new Error(`no seeded sign-in matching role ${role} is listed in pmo-portal/e2e/auth.setup.ts`);
  return email;
}

function roleStatePath(email) {
  return path.join(STATE_DIR, `${email}.json`);
}

function ensureRoleState(role, email, base) {
  if (!email) return null;
  const statePath = roleStatePath(email);
  if (existsSync(statePath)) return statePath;
  const result = spawnSync(process.execPath, [SIGN_IN, '--base', base, '--email', email, '--out', statePath, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 45000,
    stdio: 'ignore',
  });
  if (result.error || result.status !== 0 || !existsSync(statePath)) {
    throw new Error(`could not create a saved sign-in state for role ${role}; run the restructure signed-in-state helper once against this base URL`);
  }
  return statePath;
}

function readBudget() {
  const budgetPath = path.join(ROOT, 'docs', 'ux', 'word-budget.json');
  if (!existsSync(budgetPath)) throw new Error('docs/ux/word-budget.json is missing; ux-proof measures need the shipped baseline file');
  return JSON.parse(readFileSync(budgetPath, 'utf8'));
}

function toolResult(findings, detail = {}) {
  return { status: 'complete', findings, ...detail };
}

function unknownResult(error) {
  return { status: 'unknown', findings: null, error: String(error?.message ?? error) };
}

async function measureUxProof(page, cell, route, login, budget, tools) {
  try {
    const metrics = await page.evaluate(tools.measureText, tools.chartSelector);
    const key = `${route}@${cell.width}@${login}`;
    const targetBaseline = budget.targets?.[key];
    const findings = tools.violations(metrics, budget[key], `${route} @${cell.width}`, budget.charts?.[key], targetBaseline);
    // A missing shrink-only baseline is a gap in the budget file, not something wrong with the screen:
    // it travels as a note so the finding count stays the screen's own violations (the slow path's 0/0).
    const notes = targetBaseline === undefined
      ? [`${route} @${cell.width}: missing shrink-only target baseline; run the measured seed after fixes.`]
      : [];
    return { ...toolResult(findings, { metrics, baseline: budget[key] ?? null, chartBaseline: budget.charts?.[key] ?? null, targetBaseline: targetBaseline ?? null }), notes };
  } catch (error) { return unknownResult(error); }
}

const WALK_MAX_SCREENS = 40;

// The scroll walk: taste's own inspector checks every screen it photographs, because some defects only
// exist at a scroll position or as a frame-to-frame state (two texts drawn over each other while a
// heading swaps, a caption covered every time it is in view). The one-pass driver judges a single
// snapshot, so it reuses the skill's in-page frame check (probe.mjs `frame`) at each screen and applies
// the same aggregation the inspector does (inspect.mjs "what only shows up while scrolling").
async function walkFrameChecks(page, tools, width, pageHeight, metrics) {
  const height = HEIGHT_BY_WIDTH[width] ?? Math.round(width * 0.625);
  const check = () => page.evaluate(tools.frame, { film: false }).catch(() => null);
  const where = () => page.evaluate(() => ({
    y: Math.round(scrollY || document.scrollingElement.scrollTop || 0),
    max: Math.round(document.scrollingElement.scrollHeight - innerHeight),
  })).catch(() => null);
  const controls = metrics?.page?.pauseControl
    ? await page.evaluate((id) => !!document.querySelector(id), metrics.page.pauseControl).catch(() => false)
    : false;
  const total = Math.max(1, Math.ceil((Number(pageHeight) || height) / height));
  const stride = Math.max(1, Math.ceil(total / WALK_MAX_SCREENS));
  const frames = [await check()];
  let lastY = 0;
  for (let i = 1; i <= WALK_MAX_SCREENS + 8; i++) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), i * stride * height).catch(() => {});
    await delay(650);
    let pos = await where();
    if (pos && pos.y <= lastY + 2 && pos.y < pos.max - 2) {
      await page.mouse.wheel(0, Math.round(height / 2)).catch(() => {});
      await delay(1000);
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), i * stride * height).catch(() => {});
      await delay(650);
      pos = await where();
    }
    if (!pos || pos.y <= lastY + 2) break;
    lastY = pos.y;
    frames.push(await check());
    if (pos.y >= pos.max - 2) break;
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })).catch(() => {});
  await delay(350);
  return { frames: frames.filter(Boolean), pauseControl: controls, stride };
}

export function walkFrameFindings(walk, width, height) {
  const frames = Array.isArray(walk) ? walk : walk.frames;
  const pauseControl = Array.isArray(walk) ? false : !!walk.pauseControl;
  const stride = Array.isArray(walk) ? 1 : (walk.stride || 1);
  const findings = [];
  const screenOf = (frame, index) => (frame && frame.y != null ? Math.round(frame.y / height) + 1 : index * stride + 1);
  const collect = (key) => [...new Map(frames.filter(Boolean).flatMap((frame, index) => (frame[key] || []).map((item) => [item.text, { ...item, screen: screenOf(frame, index) }]))).values()];
  const coveredText = collect('covered');
  if (coveredText.length) findings.push({ level: 'FAIL', id: 'covered-text', width, message: 'Large text lies under another element at some scroll position: ' + coveredText.slice(0, 4).map((c) => `"${c.text}" (screen ${c.screen}, ${Math.round(c.share * 100)}% hidden)`).join('; ') });
  const clippedText = collect('clipped');
  if (clippedText.length) findings.push({ level: 'FAIL', id: 'clipped-text', width, message: 'Large text is cut off along its top by the box that holds it: ' + clippedText.slice(0, 3).map((c) => `"${c.text}" (screen ${c.screen})`).join('; ') });
  const overPictures = collect('pinnedOver');
  if (overPictures.length) findings.push({ level: 'WARN', id: 'pinned-over-picture', width, message: 'Pinned large text slides across pictures while the page scrolls: ' + overPictures.slice(0, 3).map((c) => `"${c.text}" (screen ${c.screen}, ${Math.round(c.share * 100)}% over a picture)`).join('; ') });
  const overText = [...new Map(frames.filter(Boolean).flatMap((frame) => (frame.overText || []).map((o) => [`${o.a}|${o.b}`, { ...o, y: frame.y }]))).values()];
  if (overText.length) findings.push({ level: 'FAIL', id: 'text-over-text', width, message: 'Two texts are drawn on top of each other while the page scrolls: ' + overText.slice(0, 3).map((o) => `"${o.a}" over "${o.b}" (at ${o.y}px)`).join('; ') });
  const sightings = new Map();
  for (const frame of frames.filter(Boolean)) for (const [text, ok] of frame.seen || []) {
    const s = sightings.get(text) || { n: 0, ok: 0, at: [] };
    s.n++; s.ok += ok; if (s.at.length < 6) s.at.push(frame.y); sightings.set(text, s);
  }
  const unread = [...sightings.entries()].filter(([, s]) => s.n >= 2 && !s.ok).map(([text, s]) => ({ text, n: s.n, at: s.at }));
  if (unread.length) findings.push({ level: 'FAIL', id: 'never-readable', width, message: `${unread.length} block(s) of text are covered at every scroll position they were seen at: ` + unread.slice(0, 4).map((u) => `"${u.text.slice(0, 44)}" (${u.n} frames)`).join('; ') });
  const playing = [...new Set(frames.filter(Boolean).flatMap((frame) => frame.playing || []))];
  if (playing.length && !pauseControl) findings.push({ level: 'WARN', id: 'no-pause', width, message: `${playing.length} video loop(s) play with no control to pause them: ${playing.slice(0, 3).join(', ')}` });
  const onMedia = new Map();
  for (const frame of frames.filter(Boolean)) for (const item of frame.onMedia || []) {
    const set = onMedia.get(item.media) || new Set();
    for (const text of item.texts) set.add(text);
    onMedia.set(item.media, set);
  }
  const captioned = [...onMedia.entries()].map(([media, set]) => ({ media, texts: [...set], words: [...set].join(' ').split(/\s+/).filter(Boolean).length })).filter((item) => item.texts.length >= 2 || item.words > 12);
  if (captioned.length) findings.push({ level: 'WARN', id: 'caption-on-media', width, message: 'Small text is set on ' + captioned.length + ' large picture(s): ' + captioned.slice(0, 3).map((item) => `${item.media} under ${item.texts.slice(0, 3).map((text) => `"${text.slice(0, 32)}"`).join(', ')}`).join('; ') });
  const straddled = collect('straddle');
  if (straddled.length) findings.push({ level: 'WARN', id: 'text-straddles-edge', width, message: 'A picture edge runs through a paragraph, so part of it sits on the picture and part on the ground: ' + straddled.slice(0, 3).map((s) => `"${s.text}" (screen ${s.screen}, ${Math.round(s.share * 100)}% on the picture)`).join('; ') });
  if (width >= 1100) {
    const runs = new Map();
    frames.filter(Boolean).forEach((frame, index) => {
      for (const text of frame.big || []) {
        const r = runs.get(text) || { start: index, last: index - 1, best: 0 };
        if (r.last === index - 1) r.last = index; else { r.start = index; r.last = index; }
        r.best = Math.max(r.best, r.last - r.start + 1); runs.set(text, r);
      }
    });
    const longPins = [...runs.entries()].filter(([, r]) => r.best >= 3);
    if (longPins.length) findings.push({ level: 'WARN', id: 'long-pin', width, message: `The same large text stays on screen for ${Math.max(...longPins.map(([, r]) => r.best))} screens in a row: ` + longPins.slice(0, 2).map(([text]) => `"${text}"`).join('; ') });
  }
  return findings;
}

async function measureTaste(page, width, screenshotBuffer, tools) {
  try {
    const metrics = await page.evaluate(tools.probe);
    const layoutMetrics = await page.evaluate(tools.tasteLayout);
    const appMetrics = await page.evaluate(tools.tasteApp);
    if (tools.colourShare && screenshotBuffer) {
      const screenshotData = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;
      appMetrics.colourShare = await page.evaluate(tools.colourShare, screenshotData);
    }
    const devServer = await page.evaluate(() => {
      const scripts = [...document.scripts].map((script) => script.src || '').join(' ');
      if (/@vite\/client|webpack-dev-server|\/_next\/static\/development\/|react-refresh|webpack-hmr/.test(scripts)) return true;
      try { return !!(window.__NEXT_DATA__ && window.__NEXT_DATA__.buildId === 'development'); } catch { return false; }
    });
    const findings = [
      ...tools.judge(metrics, { width }),
      ...tools.judgeLayout(layoutMetrics, { width }),
      ...tools.judgeApp(appMetrics, metrics, { width }),
    ].filter((finding) => !tools.appSkip.has(finding.id) && finding.id !== 'no-title' && finding.id !== 'small-title');
    if (devServer) findings.push({ level: 'WARN', id: 'dev-server', width, message: 'This page is served by a development server.' });
    const walk = await walkFrameChecks(page, tools, width, metrics?.page?.height, metrics);
    findings.push(...walkFrameFindings(walk, width, HEIGHT_BY_WIDTH[width] ?? Math.round(width * 0.625)));
    return toolResult(findings, { metrics, layout: layoutMetrics, app: appMetrics, walkFrames: walk.frames.length });
  } catch (error) { return unknownResult(error); }
}

async function measureStageshow(page, tools) {
  try {
    const auditSource = tools.auditLayout.toString();
    const scope = await page.evaluate((source) => {
      const audit = Function(`return (${source})`)();
      return { selector: 'body', ...audit(document.body) };
    }, auditSource);
    const result = tools.layoutResult([scope]);
    const findings = scope.findings;
    return { status: result.status === 'inconclusive' ? 'unknown' : 'complete', findings: result.status === 'inconclusive' ? null : findings, result };
  } catch (error) { return unknownResult(error); }
}

// impeccable detect exits 0 = scan completed with no primary findings, 1 = at least one requested target
// could not be scanned, 2 = scan completed with primary findings. Reading only 0 and 1 wrote every cell
// that HAS a finding as "unknown" (the detector's own exit code IS the completed-with-findings signal).
const DETECTOR_COMPLETE_EXITS = new Set([0, 2]);

export function detectorOutcome(status, stdout, stderr) {
  let report;
  try { report = JSON.parse(stdout); }
  catch { return unknownResult(new Error('detector returned invalid JSON: ' + String(stderr || stdout || '(empty output)').slice(0, 200))); }
  if (!DETECTOR_COMPLETE_EXITS.has(status)) {
    const reason = status === 1 ? 'detector could not scan a requested target' : `detector exited ${status}`;
    return unknownResult(new Error(stderr || reason));
  }
  if (!hasDetectorFindingShape(report)) return unknownResult(new Error(stderr || 'detector returned no finding list'));
  return toolResult([], { count: countDetectorFindings(report), exitCode: status, report });
}

function runImpeccable(detector, port, target) {
  if (!detector) return { status: 'unknown', findings: null, error: 'impeccable detector script not found; pass --impeccable <script>' };
  const result = spawnSync(detector, ['detect', '--cdp', String(port), '--target', target, '--json', '--no-advisory'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15000,
  });
  if (result.error) return unknownResult(result.error);
  return detectorOutcome(result.status, result.stdout, result.stderr);
}

function assertCleanTool(name, result) {
  if (result.status !== 'complete' || !Array.isArray(result.findings) || result.findings.length > 0) {
    const detail = Array.isArray(result.findings) ? result.findings.map((finding) => finding.id ?? finding.message ?? String(finding)).join(', ') : result.error ?? result.status;
    throw new Error(`self-test clean fixture failed ${name}: ${detail}`);
  }
}

function createFixtureHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; color: #202124; background: #fff; font: 16px/1.5 system-ui, sans-serif; }
    main { width: 100%; margin: 0; padding: 24px; }
    h1 { margin: 0 0 12px; font-size: 24px; line-height: 1.25; font-weight: 600; }
    h2 { margin: 0 0 8px; font-size: 18px; line-height: 1.4; font-weight: 600; }
    p { margin: 0 0 16px; }
    section { margin: 0 0 16px; padding: 16px; border: 1px solid #ececec; background: #fff; }
    button { width: 100%; height: 44px; padding: 0 16px; border: 1px solid #d6d6d6; background: #fff; color: inherit; font: inherit; }
  </style></head><body><main><h1>Overview</h1><p>Records remain visible to the people who need them.</p><section><h2>Current status</h2><p>All work is moving within its planned dates.</p></section><button type="button">Open records</button></main></body></html>`;
}

function createOverlapFixtureHtml() {
  // Planted text-over-text: two headings drawn on the same line, which the snapshot rules cannot see
  // and the scroll walk must catch (a swap or a travelling caption that shares the line's pixels).
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; color: #202124; background: #fff; font: 16px/1.5 system-ui, sans-serif; }
    main { padding: 24px; }
    h1 { margin: 0 0 12px; font-size: 24px; }
    .stage { position: relative; height: 200px; }
    .layer { position: absolute; left: 16px; top: 16px; font-size: 24px; line-height: 1.25; color: #202124; }
  </style></head><body><main><h1>Overview</h1><div class="stage"><div class="layer">Alpha heading drawn on the line</div><div class="layer">Bravo heading drawn on the line</div></div></main></body></html>`;
}

async function selfTest() {
  const markdown = `
## Section 1 — base cells
| # | route | kind | role | width | seeded id |
|---|---|---|---|---|---|
| 1 | \`/fixture\` | list | Admin | 1440 | n/a |
`;
  const parsed = parseScorecard(markdown);
  if (parsed.cells.length !== 1 || parsed.cells[0].route !== '/fixture') throw new Error('self-test fixture cell did not parse');
  let raggedRejected = false;
  try { parseScorecard(markdown.replace('| 1 | `/fixture` | list | Admin | 1440 | n/a |', '| 1 | `/fixture` | list | Admin | 1440 |')); }
  catch (error) { raggedRejected = /ragged/i.test(error.message); }
  if (!raggedRejected) throw new Error('self-test did not reject a planted ragged scorecard row');
  const unknown = formatFindingCount({ status: 'unknown' });
  if (unknown !== 'unknown' || unknown === '0') throw new Error('self-test rendered an unknown tool count as zero');

  await waitForMachineLoad();
  const chromium = requirePlaywright();
  const tools = await loadToolModules();
  const port = await allocateDebugPort();
  const browser = await launchBrowser(chromium, port);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.setContent(createFixtureHtml(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.fonts.ready);
    const screenshot = await page.screenshot({ type: 'png' });
    const budget = {};
    const ux = await measureUxProof(page, { width: 1440 }, '/fixture', 'fixture-role', budget, tools);
    // A clean local fixture has no persisted budget key; exercise the shipped metrics and rules with its measured values as the fixture baselines.
    const fixtureMetrics = ux.metrics;
    if (!fixtureMetrics) throw new Error(`self-test ux-proof measurement is unknown: ${ux.error}`);
    ux.findings = tools.violations(fixtureMetrics, fixtureMetrics.wordCount, 'fixture @1440', fixtureMetrics.chartCount, fixtureMetrics.smallTargetCount);
    const taste = await measureTaste(page, 390, screenshot, tools);
    const stageshow = await measureStageshow(page, tools);
    const detectorFixture = toolResult([]);
    assertCleanTool('ux-proof', ux);
    assertCleanTool('taste', taste);
    assertCleanTool('stageshow layout-core', stageshow);
    assertCleanTool('impeccable count reducer', detectorFixture);
    if (formatFindingCount({ status: 'unknown', count: 0 }) !== 'unknown') throw new Error('self-test unknown detector count was coerced to zero');
    // A planted overlap must be caught by the scroll walk: a check that cannot see the defect the slow
    // path found is not a check. Same page, two headings on one line.
    await page.setContent(createOverlapFixtureHtml(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.fonts.ready);
    const overlap = await measureTaste(page, 390, await page.screenshot({ type: 'png' }), tools);
    const overlapIds = (overlap.findings ?? []).map((finding) => finding.id);
    if (overlap.status !== 'complete' || !overlapIds.includes('text-over-text')) {
      throw new Error(`self-test did not catch planted overlapping text (${overlapIds.join(', ') || overlap.error})`);
    }
    console.log('measure-screens self-test passed: clean fixture page; planted text-over-text caught; planted unknown stayed unknown; planted ragged row rejected');
  } finally {
    await page.close();
    await browser.close();
  }
}

function safeName(value) {
  return String(value).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'cell';
}

function stableKey(cell) {
  return `${cell.scorecardId}@${cell.width}`;
}

export function markdownTable(results, metadata) {
  const count = (result, tool) => result.tools ? formatFindingCount(result.tools[tool]) : result.counts?.[tool] ?? 'unknown';
  const lines = [
    '# Screen measurements',
    '',
    `Scorecard SHA-256: \`${metadata.cellsDigest}\``,
    `Cells in scorecard: ${metadata.cellCount}; redirect rows excluded: ${metadata.excludedRedirects}.`,
    '',
    '| Cell | Route | Role | Width | Status | ms | ux-proof | taste | stageshow | impeccable | findings file | capture | Reason |',
    '|---|---|---|---:|---|---:|---:|---:|---:|---:|---|---|---|',
  ];
  for (const result of results) {
    lines.push(`| ${result.cellKey} | \`${result.route}\` | ${result.role} | ${result.width} | ${result.status ?? 'measured'} | ${result.durationMs ?? '—'} | ${count(result, 'uxProof')} | ${count(result, 'taste')} | ${count(result, 'stageshow')} | ${count(result, 'impeccable')} | \`${result.findingsFile}\` | ${result.captureFile ? `\`${result.captureFile}\`` : '—'} | ${result.reason ?? '—'} |`);
  }
  const seedRows = results.filter((result) => result.status === 'NOT MEASURED');
  if (seedRows.length) {
    lines.push('', '## Seed slice required', '', '| Cell | Route | Role | Width | Record kind needed | Reason |', '|---|---|---|---:|---|---|');
    for (const result of seedRows) lines.push(`| ${result.cellKey} | \`${result.route}\` | ${result.role} | ${result.width} | ${result.recordKindNeeded} | ${result.reason} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function atomicWrite(file, contents) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, contents);
  renameSync(temporary, file);
}

function readExistingResults(resultsPath, digest) {
  if (!existsSync(resultsPath)) return [];
  const existing = JSON.parse(readFileSync(resultsPath, 'utf8'));
  if (existing.cellsDigest !== digest) throw new Error('the output directory contains results for a different scorecard; choose a fresh private output directory');
  return Array.isArray(existing.results) ? existing.results : [];
}

function makeSummaryRow(result) {
  return {
    cellKey: stableKey(result.cell),
    scorecardId: result.cell.scorecardId,
    section: result.cell.section,
    route: result.route,
    role: result.role,
    width: result.cell.width,
    landedOn: result.landedOn,
    status: result.status,
    reason: result.reason ?? null,
    recordKindNeeded: result.recordKindNeeded ?? null,
    durationMs: result.durationMs,
    counts: {
      uxProof: formatFindingCount(result.tools.uxProof),
      taste: formatFindingCount(result.tools.taste),
      stageshow: formatFindingCount(result.tools.stageshow),
      impeccable: formatFindingCount(result.tools.impeccable),
    },
    findingsFile: result.findingsFile,
    captureFile: result.captureFile,
  };
}

function makeUnmeasuredSeedRow(cell, route, role, outputDir) {
  const slug = safeName(`${cell.scorecardId}-${cell.width}`);
  const findingsRelative = path.join('findings', `${slug}.json`);
  const findingsPath = path.join(outputDir, findingsRelative);
  const reason = 'no seed record for this route';
  const recordKind = recordKindNeeded(cell, route);
  const unknown = unknownResult(new Error(reason));
  const tools = { uxProof: unknown, taste: unknown, stageshow: unknown, impeccable: unknown };
  atomicWrite(findingsPath, `${JSON.stringify({ cell, route, role, status: 'NOT MEASURED', reason, recordKindNeeded: recordKind, tools }, null, 2)}\n`);
  return {
    cellKey: stableKey(cell),
    scorecardId: cell.scorecardId,
    section: cell.section,
    route,
    role,
    width: cell.width,
    status: 'NOT MEASURED',
    reason,
    recordKindNeeded: recordKind,
    durationMs: null,
    counts: { uxProof: 'unknown', taste: 'unknown', stageshow: 'unknown', impeccable: 'unknown' },
    findingsFile: findingsRelative,
    captureFile: null,
  };
}

async function runDetectorAndChecks(browser, cell, route, role, statePath, budget, tools, detector, debugPort, outputDir, baseUrl) {
  const slug = safeName(`${cell.scorecardId}-${cell.width}`);
  const captureRelative = path.join('captures', `${slug}.png`);
  const findingsRelative = path.join('findings', `${slug}.json`);
  const capturePath = path.join(outputDir, captureRelative);
  const findingsPath = path.join(outputDir, findingsRelative);
  mkdirSync(path.dirname(capturePath), { recursive: true });
  const started = performance.now();
  const url = new URL(route, `${baseUrl}/`).toString();
  let context;
  let cellPage;
  let pageErrors = [];
  let result;
  try {
    context = await browser.newContext({
      viewport: { width: cell.width, height: HEIGHT_BY_WIDTH[cell.width] ?? Math.round(cell.width * 0.625) },
      colorScheme: 'light',
      ...(statePath ? { storageState: statePath } : {}),
    });
    cellPage = await context.newPage();
    cellPage.on('pageerror', (error) => pageErrors.push(error.message));
    await cellPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 18000 });
    await cellPage.locator('body').waitFor({ state: 'visible', timeout: 5000 });
    await cellPage.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
    await cellPage.evaluate(() => document.fonts.ready);

    const landedOn = new URL(cellPage.url()).pathname + new URL(cellPage.url()).search;
    const loginLanding = role !== 'anonymous' && /^\/(?:login|signin|sign-in)(?:[/?#]|$)/i.test(landedOn);
    const screenshot = await cellPage.screenshot({ path: capturePath, type: 'png' });
    const requestPath = new URL(url).pathname;
    const expectedRoute = requestPath === '/' ? '/' : requestPath;
    const actualRoute = new URL(cellPage.url()).pathname;

    let toolResults;
    const routeMismatch = actualRoute !== expectedRoute;
    if (loginLanding || routeMismatch) {
      const reason = loginLanding ? `signed-in state landed on ${landedOn}` : `route landed on ${actualRoute}, expected ${expectedRoute}`;
      const unknown = unknownResult(new Error(reason));
      toolResults = { uxProof: unknown, taste: unknown, stageshow: unknown, impeccable: unknown };
    } else {
      const login = statePath ? path.basename(statePath, '.json') : 'anonymous';
      // Sequential: taste's scroll walk moves the page, so the two snapshot measurements must finish
      // before it starts (they used to share one Promise.all, which the walk would have raced).
      const uxProof = await measureUxProof(cellPage, cell, actualRoute, login, budget, tools);
      const stageshow = await measureStageshow(cellPage, tools);
      const taste = await measureTaste(cellPage, cell.width, screenshot, tools);
      const impeccable = runImpeccable(detector, debugPort, cellPage.url());
      toolResults = { uxProof, taste, stageshow, impeccable };
    }
    result = {
      cell,
      cellKey: stableKey(cell),
      route: actualRoute,
      role,
      landedOn,
      status: loginLanding ? 'incomplete-auth' : routeMismatch ? 'incomplete-route' : 'measured',
      durationMs: Math.round(performance.now() - started),
      pageErrors,
      tools: toolResults,
      captureFile: captureRelative,
      findingsFile: findingsRelative,
    };
  } catch (error) {
    result = {
      cell,
      cellKey: stableKey(cell),
      route,
      role,
      landedOn: null,
      status: 'incomplete-load',
      durationMs: Math.round(performance.now() - started),
      error: String(error.message ?? error),
      tools: { uxProof: unknownResult(error), taste: unknownResult(error), stageshow: unknownResult(error), impeccable: unknownResult(error) },
      captureFile: captureRelative,
      findingsFile: findingsRelative,
    };
    if (cellPage) await cellPage.screenshot({ path: capturePath, type: 'png' }).catch(() => {});
  } finally {
    if (context) await context.close().catch(() => {});
  }
  atomicWrite(findingsPath, `${JSON.stringify({ cell: result.cell, route: result.route, role, tools: result.tools, pageErrors: result.pageErrors ?? [], error: result.error ?? null }, null, 2)}\n`);
  return result;
}

async function runCells(options) {
  await waitForMachineLoad();
  const cellFile = path.resolve(options.cells);
  if (!existsSync(cellFile)) throw new Error(`no scorecard at ${cellFile}`);
  const scorecard = readFileSync(cellFile, 'utf8');
  const cellsDigest = createHash('sha256').update(scorecard).digest('hex');
  const parsed = parseScorecard(scorecard);
  const startIndex = options.from - 1;
  const selected = parsed.cells.slice(startIndex, startIndex + options.limit);
  if (!selected.length) throw new Error(`no cells at --from ${options.from}; scorecard has ${parsed.cells.length} measurable cells`);
  if (selected.length > 10) throw new Error('a browser batch cannot exceed 10 cells');

  const appSource = readFileSync(path.join(ROOT, 'pmo-portal', 'App.tsx'), 'utf8');
  const plans = parsed.cells.map((cell) => {
    const role = resolveCellRole(cell);
    try { return { cell, route: resolveCellPath(cell, parsed.cells, appSource), role, status: 'ready' }; }
    catch (error) {
      if (error.code !== 'NO_SEED_RECORD') throw error;
      return {
        cell,
        route: error.route ?? routeTemplate(cell.route),
        role,
        status: 'NOT MEASURED',
        reason: 'no seed record for this route',
        recordKindNeeded: recordKindNeeded(cell, error.route ?? cell.route),
      };
    }
  });
  const selectedPlans = plans.slice(startIndex, startIndex + options.limit);
  const resolved = selectedPlans.filter((item) => item.status === 'ready');
  const seedRows = plans.filter((item) => item.status === 'NOT MEASURED').map((item) => makeUnmeasuredSeedRow(item.cell, item.route, item.role, options.out));
  const started = Date.now();
  const authSource = readFileSync(AUTH_SETUP, 'utf8');
  const states = new Map();
  for (const item of resolved) {
    const email = emailForRole(item.role, authSource);
    if (!email || states.has(item.role)) continue;
    states.set(item.role, ensureRoleState(item.role, email, options.base));
  }

  const currentResults = [];
  if (resolved.length) {
    const detector = resolveDetector(options.impeccable);
    const tools = await loadToolModules();
    const budget = readBudget();
    const chromium = requirePlaywright();
    const debugPort = await allocateDebugPort();
    const browser = await launchBrowser(chromium, debugPort);
    try {
      for (const item of resolved) {
        const statePath = states.get(item.role) ?? null;
        const result = await runDetectorAndChecks(browser, item.cell, item.route, item.role, statePath, budget, tools, detector, debugPort, options.out, options.base);
        currentResults.push(result);
        console.log(`${result.cellKey} | ${item.route} | ${item.role} | ${item.cell.width} | ${result.durationMs}ms | ux ${formatFindingCount(result.tools.uxProof)} | taste ${formatFindingCount(result.tools.taste)} | layout ${formatFindingCount(result.tools.stageshow)} | impeccable ${formatFindingCount(result.tools.impeccable)}`);
      }
    } finally {
      await browser.close();
    }
  }

  const resultsPath = path.join(options.out, 'results.json');
  const allResults = readExistingResults(resultsPath, cellsDigest);
  const byKey = new Map(allResults.map((result) => [result.cellKey, result]));
  for (const result of seedRows) byKey.set(result.cellKey, result);
  for (const result of currentResults) byKey.set(result.cellKey, makeSummaryRow(result));
  const merged = [...byKey.values()].sort((a, b) => parsed.cells.findIndex((cell) => stableKey(cell) === a.cellKey) - parsed.cells.findIndex((cell) => stableKey(cell) === b.cellKey));
  const metadata = { cellsDigest, cellFile, cellCount: parsed.cells.length, excludedRedirects: parsed.excludedRedirects, at: new Date().toISOString(), batch: { from: options.from, limit: options.limit, elapsedMs: Date.now() - started } };
  atomicWrite(resultsPath, `${JSON.stringify({ ...metadata, results: merged }, null, 2)}\n`);
  atomicWrite(path.join(options.out, 'results.md'), markdownTable(merged, metadata));

  const firstTen = merged.filter((result) => result.status !== 'NOT MEASURED' && Number.isFinite(result.durationMs) && parsed.cells.findIndex((cell) => stableKey(cell) === result.cellKey) < 10).sort((a, b) => parsed.cells.findIndex((cell) => stableKey(cell) === a.cellKey) - parsed.cells.findIndex((cell) => stableKey(cell) === b.cellKey));
  if (firstTen.length) console.log(`first ${firstTen.length} measured scorecard cell time ms: ${firstTen.map((result) => `${result.cellKey}=${result.durationMs}`).join(', ')}`);
  const allSeedRows = merged.filter((result) => result.status === 'NOT MEASURED');
  if (allSeedRows.length) {
    console.log(`NOT MEASURED seed slice (${allSeedRows.length}): route | role | width | record kind needed`);
    for (const result of allSeedRows) console.log(`${result.route} | ${result.role} | ${result.width} | ${result.recordKindNeeded}`);
  }
  console.log(`results: ${resultsPath}`);
  console.log(`captures: ${path.join(options.out, 'captures')}`);
  console.log(`elapsed batch ms: ${metadata.batch.elapsedMs}`);
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(`measure-screens: ${error.message}\n${usage}`); process.exitCode = 2; return; }
  if (options.help) { console.log(usage); return; }
  try {
    if (options.selfTest) await selfTest();
    else await runCells(options);
  } catch (error) {
    console.error(`measure-screens: ${error.message}`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
