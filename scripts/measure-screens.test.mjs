import assert from 'node:assert/strict';
import test from 'node:test';

let api = {};
try {
  api = await import('./measure-screens.mjs');
} catch {
  // The missing driver is the expected RED state while this test is introduced first.
}

const { parseScorecard, formatFindingCount, materializeRoute, markdownTable } = api;

test('parses measured rows, expands role and denial rows, and excludes redirects', () => {
  assert.equal(typeof parseScorecard, 'function');
  const markdown = `
## Section 1 — base cells
| # | route | kind | role | width | seeded id |
|---|---|---|---|---|---|
| 1 | \`/records/:recordId\` | record | Admin | 1440 | record-1 |
| 2 | \`/legacy\` | redirect | Admin | 390 | n/a |
| 3 | \`/stock/new/:kind\` | form | Admin | 1440 | kind: receive | transfer |

## Section 2 — extra role cells
| # | route | role | why it differs | proof (file:line) |
|---|---|---|---|---|
| E1 | \`/records/:recordId\` | Engineer | scoped rows | \`pages/Records.tsx:1 | pages/RecordList.tsx:2\` |

## Section 3 — denied states
| # | denied surface | who hits it | what renders | proof (file:line) |
|---|---|---|---|---|
| D1 | Create blocked | Engineer | AccessDenied | \`pages/RecordNew.tsx:1\` |
`;
  const parsed = parseScorecard(markdown);
  assert.equal(parsed.excludedRedirects, 1);
  assert.equal(parsed.cells.length, 6);
  assert.deepEqual(parsed.cells.map((cell) => cell.scorecardId), ['1', '3', 'E1-1440', 'E1-390', 'D1-1440', 'D1-390']);
  assert.equal(parsed.cells[1].seededId, 'kind: receive | transfer');
  assert.equal(parsed.cells[2].proof, 'pages/Records.tsx:1 | pages/RecordList.tsx:2');
  assert.equal(api.resolveCellPath(parsed.cells[2], parsed.cells, ''), '/records/record-1');
  assert.equal(parsed.cells[4].proof, 'pages/RecordNew.tsx:1');
  assert.equal(parsed.cells[5].route, null);
});

test('rejects a planted ragged scorecard row', () => {
  assert.equal(typeof parseScorecard, 'function');
  const malformed = `
## Section 1 — base cells
| # | route | kind | role | width | seeded id |
|---|---|---|---|---|---|
| 1 | \`/records\` | list | Admin | 1440 |
`;
  assert.throws(() => parseScorecard(malformed), /ragged.*row|row.*columns/i);
});

test('keeps a planted unknown tool count unknown instead of showing zero', () => {
  assert.equal(typeof formatFindingCount, 'function');
  assert.equal(formatFindingCount({ status: 'complete', findings: [] }), '0');
  assert.equal(formatFindingCount({ status: 'unknown' }), 'unknown');
  assert.notEqual(formatFindingCount({ status: 'unknown' }), '0');
});

test('renders stored per-tool counts and lists unmeasured seed rows', () => {
  assert.equal(typeof markdownTable, 'function');
  const output = markdownTable([
    { cellKey: '1@1440', route: '/records/record-1', role: 'Admin', width: 1440, status: 'measured', durationMs: 20, counts: { uxProof: '2', taste: '1', stageshow: '0', impeccable: '3' }, findingsFile: 'findings/1.json', captureFile: 'captures/1.png' },
    { cellKey: '2@1440', route: '/records/:recordId', role: 'Admin', width: 1440, status: 'NOT MEASURED', reason: 'no seed record for this route', recordKindNeeded: 'record', counts: { uxProof: 'unknown', taste: 'unknown', stageshow: 'unknown', impeccable: 'unknown' }, findingsFile: 'findings/2.json', captureFile: null },
  ], { cellsDigest: 'digest', cellCount: 2, excludedRedirects: 0 });
  assert.match(output, /\| measured \| 20 \| 2 \| 1 \| 0 \| 3 \|/);
  assert.match(output, /## Seed slice required/);
  assert.ok(output.includes('| 2@1440 | `/records/:recordId` | Admin | 1440 | record | no seed record for this route |'));
});

test('materializes a cell path from its route and seeded values', () => {
  assert.equal(typeof materializeRoute, 'function');
  assert.equal(materializeRoute('/records/:recordId/:tab → detail', 'record-7'), '/records/record-7/detail');
  assert.equal(materializeRoute('/records/:recordId/:tab', 'record-7'), '/records/record-7/overview');
  assert.equal(materializeRoute('*', 'not-found'), '/not-found');
  assert.throws(() => materializeRoute('/records/:recordId', 'none seeded (create one)'), (error) => error.code === 'NO_SEED_RECORD');
});
