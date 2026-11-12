import assert from 'node:assert/strict';
import test from 'node:test';

let api = {};
try {
  api = await import('./measure-screens.mjs');
} catch {
  // The missing driver is the expected RED state while this test is introduced first.
}

const { parseScorecard, formatFindingCount, materializeRoute, markdownTable, detectorOutcome, walkFrameFindings, cellListSignature, checkExistingResults } = api;

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

// impeccable detect: exit 0 = completed, no primary findings; 1 = a requested target could not be
// scanned; 2 = completed WITH primary findings. The driver used to accept only 0 and 1, so every cell
// that had a detector finding was written as "unknown" and its count was never reported.
test('reads detector exit 2 as completed with its findings counted', () => {
  assert.equal(typeof detectorOutcome, 'function');
  const finding = (antipattern) => ({ antipattern, name: antipattern, severity: 'warning' });
  const clean = detectorOutcome(0, '[]', '');
  assert.equal(clean.status, 'complete');
  assert.equal(clean.count, 0);
  assert.equal(clean.exitCode, 0);
  const withFindings = detectorOutcome(2, JSON.stringify([finding('cramped-padding'), finding('overused-font')]), '');
  assert.equal(withFindings.status, 'complete');
  assert.equal(withFindings.count, 2);
  assert.equal(withFindings.exitCode, 2);
  const unscanned = detectorOutcome(1, '[]', '');
  assert.equal(unscanned.status, 'unknown');
  assert.match(unscanned.error, /could not scan/);
  const crashed = detectorOutcome(3, '', 'detector crashed: no display');
  assert.equal(crashed.status, 'unknown');
  assert.match(crashed.error, /detector crashed/);
  const garbage = detectorOutcome(0, 'not json', '');
  assert.equal(garbage.status, 'unknown');
  assert.match(garbage.error, /invalid JSON/);
});

const cleanFrame = (y = 0) => ({
  y,
  covered: [],
  clipped: [],
  pinnedOver: [],
  overText: [],
  seen: [['a block of readable words', 1]],
  playing: [],
  onMedia: [],
  straddle: [],
  big: [],
  filled: 0.6,
});

test('the scroll walk reports nothing on a clean page', () => {
  assert.equal(typeof walkFrameFindings, 'function');
  assert.deepEqual(walkFrameFindings([cleanFrame(0), cleanFrame(900)], 390, 844), []);
});

test('the scroll walk catches two texts drawn over each other', () => {
  assert.equal(typeof walkFrameFindings, 'function');
  const findings = walkFrameFindings([{ ...cleanFrame(), overText: [{ a: 'Alpha heading', b: 'Bravo heading', size: 24 }] }], 390, 844);
  assert.deepEqual(findings.map((finding) => finding.id), ['text-over-text']);
  assert.equal(findings[0].level, 'FAIL');
});

test('the scroll walk catches large text under another element at a scroll position', () => {
  assert.equal(typeof walkFrameFindings, 'function');
  const findings = walkFrameFindings([{ ...cleanFrame(1800), covered: [{ text: 'A large statement', share: 0.62 }] }], 1440, 900);
  assert.deepEqual(findings.map((finding) => finding.id), ['covered-text']);
  assert.match(findings[0].message, /screen 3/);
});

test('the scroll walk catches text covered in every frame it is seen in', () => {
  assert.equal(typeof walkFrameFindings, 'function');
  const unread = [0, 900].map((y) => ({ ...cleanFrame(y), seen: [['a caption nobody can read', 0]] }));
  assert.deepEqual(walkFrameFindings(unread, 390, 844).map((finding) => finding.id), ['never-readable']);
  const readableLater = [0, 900].map((y, index) => ({ ...cleanFrame(y), seen: [['a caption that gets its turn', index === 0 ? 0 : 1]] }));
  assert.deepEqual(walkFrameFindings(readableLater, 390, 844), []);
});

// The results file is keyed on the measured CELL LIST, not on the scorecard bytes: the scorecard is a
// working document (a Verdict column is rewritten while a run is in flight) and a reworded column must
// not refuse a merge. A cell that appeared, disappeared or changed its key still refuses.
const twoCellTable = `
## Section 1 — base cells
| # | route | kind | role | width | seeded id |
|---|---|---|---|---|---|
| 1 | \`/records\` | list | Admin | 1440 | n/a |
| 2 | \`/records\` | list | Admin | 390 | n/a |
`;

test('a reworded scorecard column (Verdict added) still merges the existing results', () => {
  assert.equal(typeof checkExistingResults, 'function');
  const before = parseScorecard(twoCellTable);
  const reworded = parseScorecard(twoCellTable.replace('| # | route | kind | role | width | seeded id |', '| # | route | kind | role | width | seeded id | verdict |').replace('|---|---|---|---|---|---|', '|---|---|---|---|---|---|---|').replace('| 1 | `/records` | list | Admin | 1440 | n/a |', '| 1 | `/records` | list | Admin | 1440 | n/a | REPAIR |').replace('| 2 | `/records` | list | Admin | 390 | n/a |', '| 2 | `/records` | list | Admin | 390 | n/a | not judged yet |'));
  const existing = { cellsDigest: 'sha-of-the-old-file', cellCount: 2, results: [{ cellKey: '1@1440' }, { cellKey: '2@390' }] };
  assert.equal(cellListSignature(before.cells), cellListSignature(reworded.cells));
  assert.deepEqual(checkExistingResults(existing, reworded.cells).map((row) => row.cellKey), ['1@1440', '2@390']);
});

test('existing results holding a cell that is not in the scorecard are refused', () => {
  assert.equal(typeof checkExistingResults, 'function');
  const cells = parseScorecard(twoCellTable).cells;
  assert.throws(() => checkExistingResults({ cellCount: 2, results: [{ cellKey: '9@1440' }] }, cells), /not in this scorecard/);
});

test('existing results for a different cell count are refused', () => {
  assert.equal(typeof checkExistingResults, 'function');
  const cells = parseScorecard(twoCellTable).cells;
  assert.throws(() => checkExistingResults({ cellCount: 3, results: [] }, cells), /holds results for 3 cells/);
});
