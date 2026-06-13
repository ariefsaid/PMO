import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeChangedLinesCoverage,
  parseDiffForChangedLines,
  normalizeCoveragePath,
  isExcludedSource,
} from './changed-lines-coverage.mjs';

// A small istanbul-shaped coverage fixture. Keys are absolute paths; each file
// has a statementMap (id -> {start:{line}, end:{line}}) and s (id -> hits).
const makeCoverage = (entries) => {
  const out = {};
  for (const [abs, statements] of Object.entries(entries)) {
    const statementMap = {};
    const s = {};
    statements.forEach((stmt, i) => {
      statementMap[String(i)] = {
        start: { line: stmt.start },
        end: { line: stmt.end ?? stmt.start },
      };
      s[String(i)] = stmt.hits;
    });
    out[abs] = { path: abs, statementMap, s };
  }
  return out;
};

test('AC: a changed line on a hit statement counts as covered', () => {
  const coverage = makeCoverage({
    '/repo/pmo-portal/src/a.ts': [{ start: 10, end: 10, hits: 3 }],
  });
  const changedLinesByFile = new Map([
    ['pmo-portal/src/a.ts', new Set([10])],
  ]);
  const result = computeChangedLinesCoverage({ changedLinesByFile, coverage, min: 80 });
  assert.equal(result.total, 1);
  assert.equal(result.covered, 1);
  assert.equal(result.pct, 100);
  assert.equal(result.ok, true);
});

test('AC: a changed line on a 0-hit statement counts as uncovered', () => {
  const coverage = makeCoverage({
    '/repo/pmo-portal/src/a.ts': [{ start: 10, end: 10, hits: 0 }],
  });
  const changedLinesByFile = new Map([
    ['pmo-portal/src/a.ts', new Set([10])],
  ]);
  const result = computeChangedLinesCoverage({ changedLinesByFile, coverage, min: 80 });
  assert.equal(result.total, 1);
  assert.equal(result.covered, 0);
  assert.equal(result.pct, 0);
  assert.equal(result.ok, false);
});

test('AC: a changed line covered by ANY statement with hits is covered', () => {
  // Two overlapping statements on the same line: one 0-hit, one hit.
  const coverage = makeCoverage({
    '/repo/pmo-portal/src/a.ts': [
      { start: 5, end: 20, hits: 0 },
      { start: 10, end: 10, hits: 4 },
    ],
  });
  const changedLinesByFile = new Map([
    ['pmo-portal/src/a.ts', new Set([10])],
  ]);
  const result = computeChangedLinesCoverage({ changedLinesByFile, coverage, min: 80 });
  assert.equal(result.covered, 1);
  assert.equal(result.total, 1);
});

test('AC: a changed comment/blank line (no covering statement) is not counted', () => {
  const coverage = makeCoverage({
    '/repo/pmo-portal/src/a.ts': [{ start: 10, end: 10, hits: 1 }],
  });
  // line 99 has no statement covering it -> not executable -> not counted
  const changedLinesByFile = new Map([
    ['pmo-portal/src/a.ts', new Set([99])],
  ]);
  const result = computeChangedLinesCoverage({ changedLinesByFile, coverage, min: 80 });
  assert.equal(result.total, 0);
  assert.equal(result.pct, 100);
  assert.equal(result.ok, true);
});

test('AC: total === 0 (no executable changed lines) yields pct 100 and ok', () => {
  const coverage = makeCoverage({});
  const changedLinesByFile = new Map();
  const result = computeChangedLinesCoverage({ changedLinesByFile, coverage, min: 80 });
  assert.equal(result.total, 0);
  assert.equal(result.covered, 0);
  assert.equal(result.pct, 100);
  assert.equal(result.ok, true);
});

test('AC: a file in the diff but absent from coverage (all:true 0-hit shape) counts its lines as uncovered', () => {
  // Under `all: true`, a never-imported new file is present in coverage with all
  // statements at 0 hits — so its changed executable lines are uncovered.
  const coverage = makeCoverage({
    '/repo/pmo-portal/src/new.ts': [
      { start: 1, end: 1, hits: 0 },
      { start: 2, end: 2, hits: 0 },
    ],
  });
  const changedLinesByFile = new Map([
    ['pmo-portal/src/new.ts', new Set([1, 2])],
  ]);
  const result = computeChangedLinesCoverage({ changedLinesByFile, coverage, min: 80 });
  assert.equal(result.total, 2);
  assert.equal(result.covered, 0);
  assert.equal(result.ok, false);
});

test('AC: a changed file entirely absent from the coverage object contributes nothing', () => {
  // Defensive: if a file is not in coverage at all, its lines cannot be classified
  // as executable, so they are not counted (no false failure).
  const coverage = makeCoverage({
    '/repo/pmo-portal/src/a.ts': [{ start: 1, end: 1, hits: 2 }],
  });
  const changedLinesByFile = new Map([
    ['pmo-portal/src/ghost.ts', new Set([1, 2, 3])],
  ]);
  const result = computeChangedLinesCoverage({ changedLinesByFile, coverage, min: 80 });
  assert.equal(result.total, 0);
  assert.equal(result.ok, true);
});

test('AC: exactly 80% passes the boundary', () => {
  // 8 covered of 10 changed -> 80% -> ok
  const statements = [];
  for (let i = 1; i <= 10; i += 1) statements.push({ start: i, end: i, hits: i <= 8 ? 1 : 0 });
  const coverage = makeCoverage({ '/repo/pmo-portal/src/a.ts': statements });
  const changedLinesByFile = new Map([
    ['pmo-portal/src/a.ts', new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])],
  ]);
  const result = computeChangedLinesCoverage({ changedLinesByFile, coverage, min: 80 });
  assert.equal(result.total, 10);
  assert.equal(result.covered, 8);
  assert.equal(result.pct, 80);
  assert.equal(result.ok, true);
});

test('AC: 79.9% fails the boundary', () => {
  // 799 covered of 1000 -> 79.9% -> fail
  const statements = [];
  for (let i = 1; i <= 1000; i += 1) statements.push({ start: i, end: i, hits: i <= 799 ? 1 : 0 });
  const coverage = makeCoverage({ '/repo/pmo-portal/src/a.ts': statements });
  const lines = new Set();
  for (let i = 1; i <= 1000; i += 1) lines.add(i);
  const changedLinesByFile = new Map([['pmo-portal/src/a.ts', lines]]);
  const result = computeChangedLinesCoverage({ changedLinesByFile, coverage, min: 80 });
  assert.equal(result.total, 1000);
  assert.equal(result.covered, 799);
  assert.equal(result.pct, 79.9);
  assert.equal(result.ok, false);
});

test('perFile breakdown is reported per changed file', () => {
  const coverage = makeCoverage({
    '/repo/pmo-portal/src/a.ts': [{ start: 1, end: 1, hits: 1 }],
    '/repo/pmo-portal/src/b.ts': [{ start: 1, end: 1, hits: 0 }],
  });
  const changedLinesByFile = new Map([
    ['pmo-portal/src/a.ts', new Set([1])],
    ['pmo-portal/src/b.ts', new Set([1])],
  ]);
  const result = computeChangedLinesCoverage({ changedLinesByFile, coverage, min: 80 });
  assert.equal(result.perFile.length, 2);
  const a = result.perFile.find((f) => f.file === 'pmo-portal/src/a.ts');
  const b = result.perFile.find((f) => f.file === 'pmo-portal/src/b.ts');
  assert.deepEqual({ total: a.total, covered: a.covered }, { total: 1, covered: 1 });
  assert.deepEqual({ total: b.total, covered: b.covered }, { total: 1, covered: 0 });
});

// --- diff parsing helper ---

test('parseDiffForChangedLines extracts new-side lines from @@ hunks', () => {
  const diff = [
    'diff --git a/pmo-portal/src/a.ts b/pmo-portal/src/a.ts',
    'index 000..111 100644',
    '--- a/pmo-portal/src/a.ts',
    '+++ b/pmo-portal/src/a.ts',
    '@@ -10,0 +11,2 @@',
    '+const x = 1;',
    '+const y = 2;',
    '@@ -20,1 +23,1 @@',
    '+const z = 3;',
  ].join('\n');
  const map = parseDiffForChangedLines(diff);
  assert.deepEqual([...map.get('pmo-portal/src/a.ts')].sort((a, b) => a - b), [11, 12, 23]);
});

test('parseDiffForChangedLines handles single-line hunk (no comma)', () => {
  const diff = [
    '+++ b/pmo-portal/src/a.ts',
    '@@ -5 +7 @@',
    '+changed',
  ].join('\n');
  const map = parseDiffForChangedLines(diff);
  assert.deepEqual([...map.get('pmo-portal/src/a.ts')], [7]);
});

test('parseDiffForChangedLines ignores a deleted file (+++ /dev/null)', () => {
  const diff = [
    '+++ /dev/null',
    '@@ -1,3 +0,0 @@',
    '+++ b/pmo-portal/src/a.ts',
    '@@ -0,0 +1,1 @@',
    '+const x = 1;',
  ].join('\n');
  const map = parseDiffForChangedLines(diff);
  // The /dev/null header sets current=null so its hunk is dropped; the real file
  // that follows is still captured.
  assert.equal(map.has('/dev/null'), false);
  assert.deepEqual([...map.get('pmo-portal/src/a.ts')], [1]);
});

test('parseDiffForChangedLines skips pure-deletion hunks (new count 0)', () => {
  const diff = [
    '+++ b/pmo-portal/src/a.ts',
    '@@ -5,2 +4,0 @@',
  ].join('\n');
  const map = parseDiffForChangedLines(diff);
  assert.equal(map.has('pmo-portal/src/a.ts'), false);
});

// --- path/exclude helpers ---

test('normalizeCoveragePath makes an absolute coverage path repo-relative', () => {
  assert.equal(
    normalizeCoveragePath('/repo/pmo-portal/src/a.ts', '/repo'),
    'pmo-portal/src/a.ts',
  );
});

test('isExcludedSource excludes tests, e2e, configs, d.ts, test dirs', () => {
  assert.equal(isExcludedSource('pmo-portal/src/a.test.ts'), true);
  assert.equal(isExcludedSource('pmo-portal/src/a.spec.tsx'), true);
  assert.equal(isExcludedSource('pmo-portal/e2e/foo.spec.ts'), true);
  assert.equal(isExcludedSource('pmo-portal/src/types.d.ts'), true);
  assert.equal(isExcludedSource('pmo-portal/vite.config.ts'), true);
  assert.equal(isExcludedSource('pmo-portal/test/setup.ts'), true);
  assert.equal(isExcludedSource('pmo-portal/src/a.ts'), false);
  assert.equal(isExcludedSource('pmo-portal/pages/Companies.tsx'), false);
});
