#!/usr/bin/env node
// Changed-lines coverage gate (charter Part C: "≥80% line coverage on changed code
// to merge"). Diff-aware so it never trips on legacy under-covered files: it only
// scores the executable lines a PR actually adds/modifies.
//
// Logic (computeChangedLinesCoverage + diff/path helpers) is pure and unit-tested
// in scripts/changed-lines-coverage.test.mjs. IO (git, fs) lives in the CLI block.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POSIX = path.posix;

// --- pure logic ---------------------------------------------------------------

/**
 * Repo-relative POSIX path for an absolute coverage key.
 * @param {string} absPath absolute path from the istanbul report
 * @param {string} root repo root absolute path
 */
export const normalizeCoveragePath = (absPath, root) =>
  POSIX.join(...path.relative(root, absPath).split(path.sep));

/**
 * True for files that are not production source we score — mirrors the spirit of
 * the vitest coverage `exclude` (tests, e2e, configs, decls, the test/ dir).
 * @param {string} relPath repo-relative POSIX path
 */
export const isExcludedSource = (relPath) => {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(relPath)) return true;
  if (/\.d\.ts$/.test(relPath)) return true;
  if (/(^|\/)\w[\w.-]*\.config\.[cm]?[jt]sx?$/.test(relPath)) return true;
  if (/(^|\/)e2e\//.test(relPath)) return true;
  if (/(^|\/)test\//.test(relPath)) return true;
  return false;
};

/**
 * Parse `git diff --unified=0` output into the new-side (added/modified) line
 * numbers per file. Only `+++ b/<path>` headers and `@@ -x,y +a,b @@` hunks matter
 * at zero context.
 * @param {string} diff raw unified diff text
 * @returns {Map<string, Set<number>>}
 */
export const parseDiffForChangedLines = (diff) => {
  const byFile = new Map();
  let current = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      // "+++ b/pmo-portal/src/a.ts" or "+++ /dev/null" for deletions
      const target = line.slice(4).trim();
      if (target === '/dev/null') {
        current = null;
      } else {
        current = target.replace(/^b\//, '');
      }
      continue;
    }
    if (line.startsWith('@@')) {
      // @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (!match || !current) continue;
      const start = Number(match[1]);
      const count = match[2] === undefined ? 1 : Number(match[2]);
      if (count <= 0) continue; // pure deletion — no new-side lines
      let set = byFile.get(current);
      if (!set) {
        set = new Set();
        byFile.set(current, set);
      }
      for (let i = 0; i < count; i += 1) set.add(start + i);
    }
  }
  return byFile;
};

/**
 * Score changed lines against an istanbul coverage report.
 *
 * @param {object} args
 * @param {Map<string, Set<number>>} args.changedLinesByFile repo-relative path -> new-side line numbers
 * @param {Record<string, {statementMap: object, s: object}>} args.coverage parsed coverage-final.json (keyed by absolute path)
 * @param {number} args.min threshold percentage
 * @returns {{ total: number, covered: number, pct: number, ok: boolean, perFile: Array<{file:string,total:number,covered:number,pct:number}> }}
 */
export const computeChangedLinesCoverage = ({ changedLinesByFile, coverage, min }) => {
  // Index coverage by repo-relative path so it matches the diff paths. The report
  // is keyed by absolute path; the longest matching suffix wins.
  const byRelPath = new Map();
  for (const [absPath, entry] of Object.entries(coverage)) {
    const norm = POSIX.join(...String(entry?.path ?? absPath).split(/[\\/]/));
    byRelPath.set(norm, entry);
  }

  const findEntry = (relPath) => {
    // exact suffix match against any coverage key
    for (const [key, entry] of byRelPath.entries()) {
      if (key === relPath || key.endsWith(`/${relPath}`)) return entry;
    }
    return null;
  };

  let total = 0;
  let covered = 0;
  const perFile = [];

  for (const [relPath, lines] of changedLinesByFile.entries()) {
    const entry = findEntry(relPath);
    if (!entry || !entry.statementMap) continue;

    let fileTotal = 0;
    let fileCovered = 0;
    for (const line of lines) {
      let executable = false;
      let lineCovered = false;
      for (const [id, stmt] of Object.entries(entry.statementMap)) {
        const startLine = stmt?.start?.line;
        const endLine = stmt?.end?.line ?? startLine;
        if (startLine == null) continue;
        if (line >= startLine && line <= endLine) {
          executable = true;
          if ((entry.s?.[id] ?? 0) > 0) {
            lineCovered = true;
            break;
          }
        }
      }
      if (!executable) continue;
      fileTotal += 1;
      if (lineCovered) fileCovered += 1;
    }

    if (fileTotal > 0) {
      perFile.push({
        file: relPath,
        total: fileTotal,
        covered: fileCovered,
        pct: round(fileCovered / fileTotal * 100),
      });
    }
    total += fileTotal;
    covered += fileCovered;
  }

  const pct = total === 0 ? 100 : round(covered / total * 100);
  return { total, covered, pct, ok: pct >= min, perFile: perFile.sort((a, b) => a.file.localeCompare(b.file)) };
};

const round = (n) => Math.round(n * 10) / 10;

// --- CLI ----------------------------------------------------------------------

const parseArgs = (argv) => {
  const options = {
    base: 'origin/main',
    coverage: 'pmo-portal/coverage/coverage-final.json',
    min: 80,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') options.base = argv[++i];
    else if (arg === '--coverage') options.coverage = argv[++i];
    else if (arg === '--min') options.min = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
};

const printHelp = () => {
  console.log(`Usage: node scripts/changed-lines-coverage.mjs [--base <ref>] [--coverage <path>] [--min <n>]

Fails (exit 1) when added/modified executable lines fall below --min% coverage.
  --base      git ref to diff against (default origin/main)
  --coverage  istanbul coverage-final.json (default pmo-portal/coverage/coverage-final.json)
  --min       threshold percent (default 80)
`);
};

const collectChangedLines = (base, root) => {
  const diff = execFileSync(
    'git',
    [
      'diff',
      '--unified=0',
      `${base}...HEAD`,
      '--',
      'pmo-portal/**/*.ts',
      'pmo-portal/**/*.tsx',
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = parseDiffForChangedLines(diff);
  const filtered = new Map();
  for (const [file, lines] of parsed.entries()) {
    if (isExcludedSource(file)) continue;
    filtered.set(file, lines);
  }
  return filtered;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      process.exit(0);
    }

    const root = process.cwd();
    const coveragePath = path.resolve(root, options.coverage);
    if (!fs.existsSync(coveragePath)) {
      console.error(
        `changed-lines coverage: coverage file not found at ${options.coverage}.\n` +
          'Run `npm run test:coverage` in pmo-portal/ first.',
      );
      process.exit(2);
    }
    const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
    const changedLinesByFile = collectChangedLines(options.base, root);

    const result = computeChangedLinesCoverage({ changedLinesByFile, coverage, min: options.min });

    if (result.total === 0) {
      console.log('changed-lines coverage: no executable changed lines — pass');
      process.exit(0);
    }

    for (const f of result.perFile) {
      const flag = f.pct >= options.min ? 'ok' : 'LOW';
      console.log(`  [${flag}] ${f.file}: ${f.covered}/${f.total} = ${f.pct}%`);
    }
    console.log(
      `changed-lines coverage: ${result.covered}/${result.total} = ${result.pct}% ` +
        `(min ${options.min}%) — ${result.ok ? 'PASS' : 'FAIL'}`,
    );
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
