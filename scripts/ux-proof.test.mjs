import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { violations, layoutReport } from './ux-proof-metrics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts/ux-proof.mjs');

test('rendered proof self-test checks its thresholds without an app', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--self-test'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /self-test.*pass/i);
});

test('rendered proof fails when a route renders fewer chart svgs than its baseline', () => {
  const failures = violations({ chartCount: 1, smallTextSamples: {} }, undefined, '/finance @1440', 2);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /chartCount=1.*baseline 2/);
  assert.match(failures[0], /svg\.recharts-surface/);
  assert.deepEqual(violations({ chartCount: 2, smallTextSamples: {} }, undefined, '/finance @1440', 2), []);
});

/** The shipped measureText over a static fixture — the same function the gate runs in the page. */
function measureFixture(html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ux-proof-'));
  const file = path.join(dir, 'fixture.html');
  try {
    fs.writeFileSync(file, html);
    const result = spawnSync(process.execPath, [SCRIPT, '--measure-html', file], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function wordCount(body) {
  return measureFixture(`<main style="font-size:16px">${body}</main>`).wordCount;
}

const tableRow = (i) => `<tr><td>Row ${i} detail here</td></tr>`;
const cardRow = (i) => `<button class="row"><div class="title">Row ${i}</div><div class="meta">detail here</div></button>`;
// The shared DataTable's phone branch marks each record card, so one card is data even alone.
const recordCard = (i) => `<li data-record-row=""><div class="title">Row ${i}</div><div class="meta">detail here</div></li>`;
const cardList = (count, extraChrome = '') => `<h1>Receivables</h1>${extraChrome}<ul role="list">${Array.from({ length: count }, (_, i) => recordCard(i + 1)).join('')}</ul>`;

test('wordCount counts chrome only: twenty extra table rows do not change it', () => {
  const head = '<h1>Expenses</h1><table><thead><tr><th>Title</th></tr></thead><tbody>';
  const one = wordCount(`${head}${tableRow(1)}</tbody></table>`);
  const twentyOne = wordCount(`${head}${Array.from({ length: 21 }, (_, i) => tableRow(i + 1)).join('')}</tbody></table>`);
  assert.equal(twentyOne, one, 'table-body rows are record data, not chrome');
  assert.equal(one, 2, 'the heading and the header cell still count');
});

test('wordCount counts chrome only: twenty extra card rows do not change it', () => {
  const one = wordCount(`<h1>Approvals</h1><div class="queue">${cardRow(1)}</div>`);
  const twentyOne = wordCount(`<h1>Approvals</h1><div class="queue">${Array.from({ length: 21 }, (_, i) => cardRow(i + 1)).join('')}</div>`);
  assert.equal(twentyOne, one, 'identically-shaped repeated rows are record data, not chrome');
});

test('wordCount still counts the first row of a list', () => {
  assert.equal(wordCount('<h1>Expenses</h1><ul><li>First row three words</li><li>Second row three words</li></ul>'), 5);
});

test('wordCount counts chrome only: marked record cards are data even when one is the whole list', () => {
  const one = wordCount(cardList(1));
  const two = wordCount(cardList(2));
  const twenty = wordCount(cardList(20));
  assert.equal(one, 1, 'a single record card is data, not chrome — only the heading counts');
  assert.equal(two, one, 'two record cards keep the same count as one');
  assert.equal(twenty, one, 'twenty record cards keep the same count as two');
});

test('wordCount still rises when the chrome around marked record cards changes', () => {
  const base = cardList(20);
  assert.equal(wordCount(cardList(20, '<h2>Extra heading</h2>')), wordCount(base) + 2);
  assert.equal(wordCount(cardList(20, '<p>one two three</p>')), wordCount(base) + 3);
});

test('wordCount rises when an extra heading is added', () => {
  const base = '<h1>Expenses</h1><p>one two</p>';
  assert.equal(wordCount(`${base}<h2>Extra heading</h2>`), wordCount(base) + 2);
});

test('phone proof records input text below 16px and fails it', () => {
  const metrics = measureFixture('<main><span style="font-size:16px">Form title</span><input type="text" style="font-size:15px"></main>');
  assert.equal(metrics.smallInputCount, 1);
  assert.ok(violations(metrics, undefined, '/form @390').some((failure) => failure.includes('smallInputCount=1')));
});

test('phone proof fails when the document is wider than the viewport', () => {
  const metrics = measureFixture('<main style="min-width:500px"><span>Wide content</span></main>');
  assert.equal(metrics.horizontalOverflow, true);
  assert.ok(violations(metrics, undefined, '/wide @390').some((failure) => failure.includes('horizontalOverflow')));
});

test('phone proof counts short action targets and uses a shrink-only baseline', () => {
  const metrics = measureFixture('<main><button style="height:43px;font-size:16px">Action</button></main>');
  assert.equal(metrics.smallTargetCount, 1);
  assert.ok(violations(metrics, undefined, '/actions @390', undefined, 0).some((failure) => failure.includes('smallTargetCount=1')));
  assert.deepEqual(violations({ ...metrics, smallTargetCount: 0 }, undefined, '/actions @390', undefined, 1), []);
});

test('phone proof flags visible text under 14px while preserving the existing character threshold', () => {
  const metrics = measureFixture('<main><span style="font-size:13px">small readable copy that should be measured</span></main>');
  assert.ok(metrics.pctCharsUnder14 > 15);
  assert.ok(violations(metrics, undefined, '/copy @390').some((failure) => failure.includes('pctCharsUnder14')));
});

test('#1862 ux-proof.sh does not fail the local port probe for a remote host', () => {
  const result = spawnSync('bash', [path.join(ROOT, 'scripts/ux-proof.sh'), '/x'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, SHOT_BASE: 'https://remote.invalid:8443', UX_PROOF_PORT: '' },
  });
  assert.doesNotMatch(result.stderr, /nothing is listening/);
});

test('#1862 ux-proof.sh still fails fast when a local base has no listener', () => {
  const result = spawnSync('bash', [path.join(ROOT, 'scripts/ux-proof.sh'), '/x'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, SHOT_BASE: 'http://localhost:1', UX_PROOF_PORT: '' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /nothing is listening/);
});

test('#1862 ux-proof.sh treats a bracketed IPv6 loopback base as local and fails fast', () => {
  const result = spawnSync('bash', [path.join(ROOT, 'scripts/ux-proof.sh'), '/x'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, SHOT_BASE: 'http://[::1]:1', UX_PROOF_PORT: '' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /nothing is listening/);
});

test('#1862 ux-proof.sh does not treat a host merely containing a local name as local', () => {
  const result = spawnSync('bash', [path.join(ROOT, 'scripts/ux-proof.sh'), '/x'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, SHOT_BASE: 'https://localhost.example.invalid:8443', UX_PROOF_PORT: '' },
  });
  assert.doesNotMatch(result.stderr, /nothing is listening/);
});


const emptyLayout = { leftEdges: [], gaps: [], columnsLevel: [], rowCentre: [], loneSection: [] };

test('layout failures name the route, state, width, elements and numbers', () => {
  const layout = {
    ...emptyLayout,
    leftEdges: [{ surface: 'div.panel "Summary"', surfacePath: 'main>div.panel', limit: 1, edges: { 273: ['h2 "Summary"'], 265: ['p "Body"'] }, strays: [{ path: 'main>div.panel>p', offset: -8 }] }],
    gaps: [
      { kind: 'gap', gap: 81, above: 'p "Intro"', below: 'div "Timeline"', aboveSel: 'main>p', belowSel: 'main>div' },
      { kind: 'heading', gap: 40, above: 'h2 "Lines"', below: 'p "None"', aboveSel: 'main>h2', belowSel: 'main>p' },
      { kind: 'scale', gap: 40, above: 'div "A"', below: 'div "B"', aboveSel: 'main>div.a', belowSel: 'main>div.b' },
    ],
    columnsLevel: [{ row: 'div.grid', column: 'div.panel "Health"', rowSel: 'main>div.grid', columnSel: 'main>div.grid>div.panel', ends: 397, tallest: 826, diff: 429 }],
    rowCentre: [{ row: 'li "Claim"', rowSel: 'main>li', figure: '$421', action: 'button "Pay"', dy: 14 }],
  };
  const { failures } = layoutReport(layout, '/expenses/1 @1440', 'reads-failing');
  assert.equal(failures.length, 6);
  for (const failure of failures) assert.match(failure, /^\/expenses\/1 @1440 \[reads-failing\]: /);
  assert.match(failures[0], /2 left edges \(max 1\).*x=265: p "Body"/);
  assert.match(failures[1], /81px of white space/);
  assert.match(failures[2], /40px below it \(want 12-16px\)/);
  assert.match(failures[3], /40px between sections or panels \(want 16, 24, 32px\)/);
  assert.match(failures[4], /429px above.*y=397.*y=826/);
  assert.match(failures[5], /\$421.*14px/);
});

test('a lone label/value section is a warning with the value, never a failure', () => {
  const layout = { ...emptyLayout, loneSection: [{ heading: 'Owner', label: 'Name', value: 'Ada' }] };
  const { failures, warnings } = layoutReport(layout, '/x @390');
  assert.equal(failures.length, 0);
  assert.match(warnings[0], /Owner.*Name = Ada/);
});

const gap = (above, below) => ({ kind: 'gap', gap: 60, above: `p "${above}"`, below: `p "${below}"`, aboveSel: `main>${above}`, belowSel: `main>${below}` });

test('the layout baseline is a fingerprint list: a new fingerprint fails even when the count is unchanged', () => {
  const metrics = { layout: { ...emptyLayout, gaps: [gap('a', 'b'), gap('c', 'd')] }, smallTextSamples: {} };
  const known = layoutReport(metrics.layout, '/x @1440').fingerprints;
  assert.equal(known.length, 2);
  assert.equal(violations(metrics, undefined, '/x @1440', undefined, undefined, known).length, 0);
  // one fixed, one new: the same count of two, and still red
  const swapped = known.slice(0, 1).concat('gaps-gap|main>x|main>y');
  assert.ok(violations(metrics, undefined, '/x @1440', undefined, undefined, swapped).some((failure) => /layoutFingerprints=1/.test(failure)));
  assert.ok(violations(metrics, undefined, '/x @1440').some((failure) => /layoutFingerprints=2/.test(failure)));
});

test('repeats of one element class count once, so the seed can grow without a red screen', () => {
  const one = { ...emptyLayout, rowCentre: [{ row: 'li "A"', rowSel: 'main>li.claim', figure: '$1', action: 'button', dy: 9 }] };
  const many = { ...emptyLayout, rowCentre: Array.from({ length: 10 }, (_, i) => ({ row: `li "Row ${i}"`, rowSel: 'main>li.claim', figure: `$${i}`, action: 'button', dy: 9 })) };
  assert.deepEqual(layoutReport(many, '/x @1440').fingerprints, layoutReport(one, '/x @1440').fingerprints);
});

test('an ignore marker that covers a panel or most of main fails, and is reported', () => {
  const covered = layoutReport({ ...emptyLayout, ignored: { count: 1, share: 0.1, coversPanel: true } }, '/x @1440');
  assert.ok(covered.failures.some((failure) => /ignoreMarker.*covers a panel/.test(failure)));
  const wide = layoutReport({ ...emptyLayout, ignored: { count: 2, share: 0.45, coversPanel: false } }, '/x @1440');
  assert.ok(wide.failures.some((failure) => /45% of main/.test(failure)));
  const small = layoutReport({ ...emptyLayout, ignored: { count: 1, share: 0.02, coversPanel: false } }, '/x @1440');
  assert.equal(small.failures.length, 0);
  assert.match(small.warnings[0], /1 element\(s\) marked data-layout-ignore cover 2%/);
});

// ---------------------------------------------------------------------------------------------
// False-positive classes of the layout rules: each fixture is a screen shape the review found flagged
// although nothing was off. `clean` fixtures must report nothing; `control` fixtures keep a real defect.
// ---------------------------------------------------------------------------------------------
function layoutFixture(html, width = 1440) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ux-proof-layout-'));
  const file = path.join(dir, 'fixture.html');
  try {
    fs.writeFileSync(file, `<!doctype html><style>.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}body{margin:0;font:16px/24px sans-serif}p{margin:0}</style>${html}`);
    const result = spawnSync(process.execPath, [SCRIPT, '--layout-html', file, String(width)], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).failures;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const lpanel = (body) => `<div style="border:1px solid #ccc;border-radius:8px;padding:24px;margin-bottom:24px">${body}</div>`;
const h2 = '<h2 style="margin:0 0 12px;font-size:18px">Title</h2>';

test('class aria-hidden figure: a KPI tile whose big figure is aria-hidden still has that figure as painted content', () => {
  const tile = (label, fig, top) => `<div style="margin-top:${top}px"><span>${label}</span><b aria-hidden="true" style="font-size:32px;line-height:40px;display:block;margin-top:8px">${fig}</b><span class="sr-only">${fig}</span></div>`;
  assert.deepEqual(layoutFixture(`<main style="padding:24px">${tile('Budget', '$6.9M', 0)}${tile('Spent', '$7.2M', 24)}<p style="margin-top:24px">Tail</p></main>`), []);
});

test('class wrapped text: a paragraph wrapped over four lines is measured to its last line, not its first', () => {
  const long = 'Long wrapped description that goes on and on across several lines of a narrow column so it wraps. '.repeat(2);
  assert.deepEqual(layoutFixture(`<main style="padding:24px"><div style="width:220px"><p>${long}</p></div><p style="margin-top:24px">Next block</p><p style="margin-top:24px">Tail</p></main>`), []);
});

test('control: a real 80px hole under wrapped text is still reported', () => {
  const long = 'Long wrapped description that goes on and on across several lines of a narrow column so it wraps. '.repeat(2);
  const failures = layoutFixture(`<main style="padding:24px"><div style="width:220px"><p>${long}</p></div><p style="margin-top:80px">Next block</p><p>Tail</p></main>`);
  assert.ok(failures.some((f) => /white space/.test(f)), failures.join('; '));
});

test('class leading mark: a colour swatch before a legend label is not the legend\'s left edge', () => {
  const key = (name) => `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:#07f;display:inline-block"></span>${name}</span>`;
  assert.deepEqual(layoutFixture(`<main style="padding:24px">${lpanel(`${h2}<div style="display:flex;gap:16px">${key('Delivery')}${key('Budget used')}</div>`)}<p>Tail</p></main>`), []);
});

test('class leading mark: a checkbox before a row label is not the row\'s left edge', () => {
  assert.deepEqual(layoutFixture(`<main style="padding:24px">${lpanel(`${h2}<label style="display:flex;align-items:center;gap:8px"><input type="checkbox" style="margin:0">Select all</label><p>Body</p>`)}<p>Tail</p></main>`), []);
});

test('class leading mark: an avatar with initials before a name is not the row\'s left edge', () => {
  assert.deepEqual(layoutFixture(`<main style="padding:24px">${lpanel(`${h2}<div style="display:flex;align-items:center;gap:8px"><span style="width:32px;height:32px;border-radius:50%;background:#ddd;display:inline-flex;align-items:center;justify-content:center;font-size:12px">AB</span>Ada Byron</div><p>Body</p>`).replace(h2, '')}<p>Tail</p></main>`), []);
});

test('control: a body line indented 16px beside a swatch row is still a stray edge', () => {
  const failures = layoutFixture(`<main style="padding:24px">${lpanel(`${h2}<div style="display:flex;gap:8px"><span style="width:10px;height:10px;background:#07f;display:inline-block"></span>Key</div><p style="margin-left:16px">Indented</p>`)}<p>Tail</p></main>`);
  assert.ok(failures.some((f) => /left edges/.test(f)), failures.join('; '));
});

test('class search field: the padding inside a bordered search field is not a left edge', () => {
  const field = '<label style="display:flex;align-items:center;gap:8px;border:1px solid #ccc;border-radius:8px;padding:0 11px;height:44px"><svg width="16" height="16"><circle cx="8" cy="8" r="6"/></svg><input aria-label="Search" style="border:0;outline:0;flex:1"></label>';
  assert.deepEqual(layoutFixture(`<main style="padding:24px">${lpanel(`<p>Body</p><div style="margin-top:12px">${field}</div>`)}<p>Tail</p></main>`), []);
});

test('class link tab: a tab link with its own padding sits at its box, not its text', () => {
  const tabs = '<nav style="display:flex;gap:8px;margin-top:16px"><a href="#a" style="padding:8px 12px;border-bottom:2px solid #07f">On hand</a><a href="#b" style="padding:8px 12px">Moves</a></nav>';
  assert.deepEqual(layoutFixture(`<main style="padding:24px"><h1 style="margin:0">Ledger</h1>${tabs}${lpanel('<p>Body</p>')}<p>Tail</p></main>`), []);
});

test('class centred control: centred text and a right-aligned control are not left edges', () => {
  const body = `<h1 style="margin:0">Ledger</h1>${lpanel('<p>Body</p>')}<div style="display:flex;justify-content:flex-end;margin-bottom:24px"><button>Table</button></div><p style="text-align:center;margin-bottom:24px">36 entries, end of the ledger</p>`;
  assert.deepEqual(layoutFixture(`<main style="padding:24px">${body}<p>Tail</p></main>`), []);
});

test('class intervening block: a field is measured to the block directly above it, even one that overlaps only partly', () => {
  const field = (name, w) => `<div style="display:flex;flex-direction:column;gap:8px;width:${w}px"><span>${name}</span><select style="height:44px"><option>${name} value</option></select></div>`;
  const row = `<div style="display:flex;flex-wrap:wrap;gap:12px;width:400px;align-items:flex-end">${field('Item', 334)}${field('Warehouse', 251)}${field('From', 180)}${field('To', 164)}</div>`;
  assert.deepEqual(layoutFixture(`<main style="padding:24px">${row}<p style="margin-top:24px">Tail</p></main>`), []);
});

test('class stretched KPI tiles: tiles of one KPI grid stretched to a common height are not checked for level ends', () => {
  const tile = (extra) => `<div style="background:#fff;padding:16px"><span>Label</span><b style="font-size:28px;display:block">1,200</b>${extra}</div>`;
  const kpis = `<section aria-label="KPIs" style="display:grid;grid-template-columns:1fr 1fr;gap:1px;border:1px solid #ccc;border-radius:8px;overflow:hidden;background:#ccc">${tile('<span style="display:block;margin-top:40px">Sub line one</span>')}${tile('')}</section>`;
  assert.deepEqual(layoutFixture(`<main style="padding:24px">${kpis}<p style="margin-top:24px">Below</p></main>`), []);
});

test('control: two bordered columns that end 60px apart are still reported', () => {
  const failures = layoutFixture('<main style="padding:24px"><div style="display:flex;gap:24px"><div style="width:400px;height:300px;border:1px solid #ccc;box-sizing:border-box"><p>Short</p></div><div style="width:400px;height:300px;border:1px solid #ccc;box-sizing:border-box"><p>Short</p><p style="margin-top:220px">Tall</p></div></div><p>Below</p></main>');
  assert.ok(failures.some((f) => /columnsLevel/.test(f)), failures.join('; '));
});

test('control: a visually hidden select-all checkbox is not a leading mark, and the visible rows keep one edge', () => {
  const list = '<ul style="list-style:none;margin:0;padding:0"><li><label class="sr-only"><input type="checkbox">Select all rows</label></li><li>First row</li><li>Second row</li></ul>';
  assert.deepEqual(layoutFixture(`<main style="padding:24px">${lpanel(`<p>Body</p><div style="margin-top:12px">${list}</div>`)}<p>Tail</p></main>`), []);
});
