#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import { CHART_SELECTOR, LAYOUT_NUMBERS, RULE_NUMBERS, measureText, measureLayout, layoutReport, measureRules, rulesReport, tabFrameFindings, violations } from './ux-proof-metrics.mjs';
import { blockDataReads, loadReusedChecks, measureSettledLayout, pageLanguage, settlePage } from './ux-proof-measure.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'pmo-portal');
const require = createRequire(path.join(APP, 'package.json'));
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
async function launchBrowser() {
  const systemChrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((candidate) => fs.existsSync(candidate));
  return chromium.launch({ headless: true, ...(systemChrome ? { executablePath: systemChrome } : {}) });
}
async function selfTest() {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    const cases = [
      { html: '<main><span style="font-size:11px">tiny text</span></main>', baseline: 2, expected: 'minFontPx' },
      { html: '<main><span style="font-size:13px">small text</span><span style="font-size:16px">normal text</span></main>', baseline: 4, expected: 'pctCharsUnder14' },
      { html: '<main style="font-size:16px">one two three four five six</main>', baseline: 5, expected: 'wordCount' },
      { html: '<main style="font-size:16px">one two three four five</main>', baseline: 5, expected: null },
    ];
    for (const fixture of cases) {
      await page.setContent(fixture.html);
      const result = violations(await page.evaluate(measureText, CHART_SELECTOR), fixture.baseline, 'fixture @390');
      if (fixture.expected ? !result.some((failure) => failure.includes(fixture.expected)) : result.length) throw new Error(`Self-test failed: expected ${fixture.expected || 'pass'}, got ${result.join('; ')}`);
    }
    await page.setContent('<main><span>page words</span><span class="sr-only">accessible duplicate</span><svg class="recharts-surface" width="10" height="10"><text>chart labels</text></svg></main>');
    const chartMetrics = await page.evaluate(measureText, CHART_SELECTOR);
    if (chartMetrics.wordCount !== 2 || chartMetrics.chartCount !== 1) throw new Error(`Self-test failed: chart labels should count as a chart, not page copy (${JSON.stringify(chartMetrics)})`);
    // The phone card branch marks each record; a menu of 2 records and one of 20 must read the
    // same, and a single record card must not leak into chrome either.
    const recordCard = (index) => `<li data-record-row=""><span>Record ${index} detail here</span></li>`;
    const recordList = (count, chrome = '') => `<main style="font-size:16px"><h1>Receivables</h1>${chrome}<ul role="list">${Array.from({ length: count }, (_, index) => recordCard(index + 1)).join('')}</ul></main>`;
    await page.setContent(recordList(2));
    const twoCards = await page.evaluate(measureText, CHART_SELECTOR);
    await page.setContent(recordList(20));
    const twentyCards = await page.evaluate(measureText, CHART_SELECTOR);
    await page.setContent(recordList(1));
    const oneCard = await page.evaluate(measureText, CHART_SELECTOR);
    await page.setContent(recordList(20, '<h2>Extra heading</h2>'));
    const moreChrome = await page.evaluate(measureText, CHART_SELECTOR);
    if (oneCard.wordCount !== twoCards.wordCount || twentyCards.wordCount !== twoCards.wordCount) throw new Error(`Self-test failed: record cards moved the word count (${oneCard.wordCount}/${twoCards.wordCount}/${twentyCards.wordCount})`);
    if (moreChrome.wordCount !== twoCards.wordCount + 2) throw new Error(`Self-test failed: chrome next to record cards must still count (${twoCards.wordCount} -> ${moreChrome.wordCount})`);
    await page.setContent('<main><span>visible copy</span><input style="font-size:15px"><button style="height:43px">Action</button></main>');
    const controlMetrics = await page.evaluate(measureText, CHART_SELECTOR);
    const controlFailures = violations(controlMetrics, undefined, 'fixture @390', undefined, 0);
    if (controlMetrics.smallInputCount !== 1 || !controlFailures.some((failure) => failure.includes('smallInputCount=1')) || !controlFailures.some((failure) => failure.includes('smallTargetCount=1'))) {
      throw new Error(`Self-test failed: phone inputs and action targets should be measured (${JSON.stringify({ controlMetrics, controlFailures })})`);
    }
    await page.setContent('<main style="min-width:500px"><span>wide copy</span></main>');
    const overflowMetrics = await page.evaluate(measureText, CHART_SELECTOR);
    if (!overflowMetrics.horizontalOverflow || !violations(overflowMetrics, undefined, 'fixture @390').some((failure) => failure.includes('horizontalOverflow'))) {
      throw new Error(`Self-test failed: document overflow should fail (${JSON.stringify(overflowMetrics)})`);
    }
    // Layout checks: each fixture is a small page; `expected` is the check that must fail ('' = clean).
    await page.setViewportSize({ width: 1440, height: 900 });
    const panel = (body, extra = '') => `<div style="border:1px solid #ccc;border-radius:8px;padding:24px;margin-bottom:24px;${extra}">${body}</div>`;
    const layoutCases = [
      { name: 'one left edge per surface', expected: '', html: `<main style="padding:24px">${panel('<h2 style="margin:0 0 12px">Title</h2><p>Body</p><p>More</p>')}</main>` },
      { name: 'stray left edge in a panel', expected: 'leftEdges', html: `<main style="padding:24px">${panel('<h2 style="margin:0 0 12px">Title</h2><p style="margin-left:16px">Indented</p>')}</main>` },
      { name: 'three edges in the page column', expected: 'leftEdges', html: '<main style="padding:24px"><h1>Page</h1><p style="margin-left:24px">A</p><p style="margin-left:48px">B</p></main>' },
      { name: 'ignored indent', expected: '', html: `<main style="padding:24px">${panel('<h2 style="margin:0 0 12px">Title</h2><p data-layout-ignore style="margin-left:16px">Indented</p>')}</main>` },
      { name: 'structural second column does not count', expected: '', html: `<main style="padding:24px">${panel('<div style="display:flex;justify-content:space-between"><h2 style="margin:0 0 12px">Title</h2><button>Act</button></div>')}</main>` },
      { name: 'gap of 80px with content below', expected: 'gaps', html: '<main style="padding:24px"><p>One</p><p style="margin-top:80px">Two</p><p>Three</p></main>' },
      { name: 'gap of 80px at the end of the page is exempt', expected: '', html: '<main style="padding:24px"><p>One</p><p style="margin-top:80px">Two</p></main>' },
      { name: 'scale gap', expected: '', html: '<main style="padding:24px"><p>One</p><p style="margin-top:32px">Two</p><p style="margin-top:16px">Three</p></main>' },
      { name: 'stacked padding 24 + 32 + 40 leaves a hole', expected: 'gaps', html: `<main style="padding:24px"><p>Intro</p><div style="padding-top:40px"><div style="margin-top:32px">${panel('<h2 style="margin:0 0 12px">Card</h2><p style="margin:0">Body</p>')}</div></div><p>Tail</p></main>` },
      { name: 'panels 40px apart are off the scale', expected: 'between sections or panels', html: `<main style="padding:24px">${panel('<h2 style="margin:0 0 12px">One</h2><p style="margin:0">A</p>', 'margin-bottom:40px')}${panel('<h2 style="margin:0 0 12px">Two</h2><p style="margin:0">B</p>')}<p>Tail</p></main>` },
      { name: 'panels 24px apart sit on the scale', expected: '', html: `<main style="padding:24px">${panel('<h2 style="margin:0 0 12px">One</h2><p style="margin:0">A</p>')}${panel('<h2 style="margin:0 0 12px">Two</h2><p style="margin:0">B</p>')}<p>Tail</p></main>` },
      { name: 'inner gaps of 4px and 8px in one group are not judged', expected: '', html: '<main style="padding:24px"><div><span style="display:block">Label</span><span style="display:block;margin-top:4px">Value</span><span style="display:block;margin-top:8px">Note</span></div><p style="margin-top:24px">Tail</p></main>' },
      { name: 'heading 14px above its content', expected: '', html: '<main style="padding:24px"><h2 style="margin:0">Section</h2><p style="margin:14px 0 0">Body</p><p>Tail</p></main>' },
      { name: 'heading 20px above its content', expected: 'heading content', html: '<main style="padding:24px"><h2 style="margin:0">Section</h2><p style="margin:20px 0 0">Body</p><p>Tail</p></main>' },
      { name: 'KPI row inset is its own surface', expected: '', html: `<main style="padding:24px"><section aria-label="KPIs" style="display:grid;grid-template-columns:1fr 1fr;gap:1px;border:1px solid #ccc;border-radius:8px;overflow:hidden;background:#ccc"><div style="background:#fff;padding:16px"><span>Orders</span><b style="font-size:28px;display:block">1,200</b></div><div style="background:#fff;padding:16px"><span>Late</span><b style="font-size:28px;display:block">3</b></div></section><div style="margin-top:24px">${panel('<h2 style="margin:0 0 12px">Title</h2><p style="margin:0">Body</p>')}</div></main>` },
      { name: 'children of a stretched column pinned with margin-top:auto', expected: '', html: '<main style="padding:24px"><div style="display:flex;gap:24px;align-items:stretch">' + [1, 2].map((i) => `<div style="width:400px;height:300px;box-sizing:border-box;border:1px solid #ccc;border-radius:8px;padding:24px;display:flex;flex-direction:column"><h2 style="margin:0">Could not load ${i}</h2><button style="margin-top:auto;align-self:flex-start">Retry</button></div>`).join('') + '</div><p style="margin-top:24px">Below</p></main>' },
      { name: 'ignore marker covering a panel', expected: 'ignoreMarker', html: `<main style="padding:24px"><div data-layout-ignore="">${panel('<h2 style="margin:0 0 12px">Title</h2><p style="margin:0">Body</p>')}</div><p>Tail</p></main>` },
      { name: 'a date and a count badge are not figures', expected: '', html: `<main style="padding:24px"><div>${[1, 2].map((i) => `<div style="display:flex;align-items:flex-start;gap:16px;height:60px"><span>Row ${i}</span><span>15 Nov</span><span>${i + 2}</span><button style="margin-top:30px;height:28px">Pay</button></div>`).join('')}</div></main>` },
      { name: 'heading far from its content', expected: 'heading content', html: '<main style="padding:24px"><h2>Section</h2><p style="margin-top:36px">Body</p><p>Tail</p></main>' },
      { name: 'columns end level', expected: '', html: '<main style="padding:24px"><div style="display:flex;gap:24px"><div style="width:400px;height:200px;border:1px solid #ccc">Left</div><div style="width:400px;height:200px;border:1px solid #ccc">Right</div></div><p>Below</p></main>' },
      { name: 'column ends high', expected: 'columnsLevel', html: '<main style="padding:24px"><div style="display:flex;gap:24px"><div style="width:400px;height:300px;border:1px solid #ccc"><p>Short</p></div><div style="width:400px;height:300px;border:1px solid #ccc"><p>Short</p><p style="margin-top:220px">Tall</p></div></div><p>Below</p></main>' },
      { name: 'row figure and action share a centre', expected: '', html: `<main style="padding:24px"><ul>${[1, 2].map((i) => `<li style="display:flex;align-items:center;gap:16px;height:48px"><span>Row ${i}</span><span>$1${i}0</span><button>Pay</button></li>`).join('')}</ul></main>` },
      { name: 'row figure off the action centre', expected: 'rowCentre', html: `<main style="padding:24px"><div>${[1, 2].map((i) => `<div style="display:flex;align-items:flex-start;gap:16px;height:60px"><span style="margin-top:0">Row ${i}</span><span>$1${i}0</span><button style="margin-top:30px;height:28px">Pay</button></div>`).join('')}</div></main>` },
      { name: 'figure in a shared right-aligned column is exempt', expected: '', html: `<main style="padding:24px"><div>${[1, 2].map((i) => `<div style="display:flex;align-items:flex-start;gap:16px;height:60px"><span>Row ${i}</span><span style="margin-left:auto;width:80px;text-align:right">$1${i}0</span><button style="margin-top:30px;height:28px">Pay</button></div>`).join('')}</div></main>` },
    ];
    for (const fixture of layoutCases) {
      await page.setContent(fixture.html);
      const report = layoutReport(await page.evaluate(measureLayout, LAYOUT_NUMBERS), 'fixture @1440');
      const hit = fixture.expected ? report.failures.some((failure) => failure.includes(fixture.expected)) : report.failures.length === 0;
      if (!hit) throw new Error(`Self-test failed: layout fixture "${fixture.name}" expected ${fixture.expected || 'clean'}, got ${report.failures.join('; ') || 'clean'}`);
    }
    await page.setContent('<main style="padding:24px"><h2 style="margin:0 0 12px">Owner</h2><div><span>Name</span> <span>Ada</span></div><p>Tail</p></main>');
    const lone = layoutReport(await page.evaluate(measureLayout, LAYOUT_NUMBERS), 'fixture @1440');
    if (lone.failures.length || !lone.warnings.some((warning) => warning.includes('Ada'))) throw new Error(`Self-test failed: a one-value section must warn with its value, not fail (${JSON.stringify(lone)})`);
    // Counts do not grow with data: one bad row group is one fingerprint whether it has 2 rows or 10.
    const rowsPage = (n) => `<main style="padding:24px"><div>${Array.from({ length: n }, (_, i) => `<div style="display:flex;align-items:flex-start;gap:16px;height:60px"><span>Row ${i}</span><span>$1${i}0</span><button style="margin-top:30px;height:28px">Pay</button></div>`).join('')}</div></main>`;
    await page.setContent(rowsPage(2));
    const two = layoutReport(await page.evaluate(measureLayout, LAYOUT_NUMBERS), 'fixture @1440');
    await page.setContent(rowsPage(10));
    const ten = layoutReport(await page.evaluate(measureLayout, LAYOUT_NUMBERS), 'fixture @1440');
    if (!two.fingerprints.length || two.fingerprints.join() !== ten.fingerprints.join()) throw new Error(`Self-test failed: repeats of one row group must share one fingerprint (${two.fingerprints.length} vs ${ten.fingerprints.length})`);
    // The baseline is a list of fingerprints: it blocks a new defect even when the count stays the same.
    const bad = { layout: { leftEdges: [], gaps: [{ kind: 'gap', gap: 80, above: 'a', below: 'b', aboveSel: 'main>p', belowSel: 'main>p.next' }], columnsLevel: [], rowCentre: [], loneSection: [] }, smallTextSamples: {} };
    const fps = layoutReport(bad.layout, 'fixture @1440').fingerprints;
    if (!violations(bad, undefined, 'fixture @1440').some((failure) => failure.includes('layoutFingerprints=1')) || violations(bad, undefined, 'fixture @1440', undefined, undefined, fps).length) {
      throw new Error('Self-test failed: the layout baseline must list the fingerprints a route may carry');
    }
    if (!violations(bad, undefined, 'fixture @1440', undefined, undefined, ['gaps-gap|main>p|main>p.other']).some((failure) => failure.includes('layoutFingerprints=1'))) {
      throw new Error('Self-test failed: fixing one defect and adding another must not pass on an equal count');
    }
    // Fixed rules R1-R5: each fixture passes or fails on its own, whatever any baseline says. `expected` is the rule that
    // must fire ('' = no rule fires at all).
    const card = (body, extra = '') => `<section style="border:1px solid #ccc;border-radius:8px;padding:24px;${extra}">${body}</section>`;
    const option = (name, tag, tagStyle = '') => `<li role="option" style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 12px;list-style:none"><span>${name}</span><span style="border:1px solid #888;border-radius:999px;padding:2px 8px;white-space:nowrap;${tagStyle}">${tag}</span></li>`;
    const bar = (width, extra = '') => `<div role="progressbar" style="height:8px;width:${width};border-radius:4px;overflow:hidden;background:#eee;margin-bottom:12px;${extra}"><div style="width:60%;height:100%;background:#36c"></div></div>`;
    const ruleCases = [
      { name: 'R1 content at the heading edge', expected: '', html: `<main>${card('<h2 style="margin:0 0 12px">Title</h2><p style="margin:0 0 12px">Body</p><input style="display:block;border:1px solid #888">')}</main>` },
      { name: 'R1 block inset from the heading edge', expected: 'R1', html: `<main>${card('<h2 style="margin:0 0 12px">Title</h2><p style="margin:0 0 12px;padding-left:16px">Body</p>')}</main>` },
      { name: 'R1 bullets hang at the heading edge', expected: '', html: `<main>${card('<h2 style="margin:0 0 12px">Title</h2><ul style="margin:0;padding-left:20px"><li>One</li><li>Two</li></ul>')}</main>` },
      { name: 'R1 avatar leads the heading row', expected: '', html: `<main>${card('<div style="display:flex;gap:12px;align-items:center"><span style="width:40px;height:40px;background:#36c;color:#fff;border-radius:8px;display:inline-flex;align-items:center;justify-content:center">E</span><h1 style="margin:0">Name</h1></div><p style="margin:12px 0 0">Company</p>')}</main>` },
      { name: 'R1 a full-width footer band is not content', expected: '', html: `<main><div style="border:1px solid #ccc;border-radius:8px;width:400px"><div style="padding:16px"><h2 style="margin:0 0 12px">Title</h2><p style="margin:0">Body</p></div><div style="border-top:1px solid #ccc;background:#f4f4f4;padding:12px 16px"><button>Save</button></div></div></main>` },
      { name: 'R1 full-bleed table', expected: '', html: `<main>${card('<h2 style="margin:0 0 12px">Title</h2><div style="margin:0 -24px"><table style="width:100%;border-collapse:collapse"><tr><td style="padding:8px 24px">A</td></tr></table></div>')}</main>` },
      { name: 'R1 table bleeding on one side only', expected: 'R1', html: `<main>${card('<h2 style="margin:0 0 12px">Title</h2><div style="margin:0 0 0 -24px"><table style="width:100%;border-collapse:collapse"><tr><td style="padding:8px 24px">A</td></tr></table></div>')}</main>` },
      { name: 'R2 tags share a right edge on one line', expected: '', html: `<main><ul role="listbox" style="width:300px;padding:0">${option('Alpha', 'Open')}${option('A much longer option name', 'Closed')}</ul></main>` },
      { name: 'R2 tag wraps onto two lines', expected: 'R2', html: `<main><ul role="listbox" style="width:300px;padding:0">${option('Alpha', 'In progress now', 'white-space:normal;width:60px')}${option('Beta', 'Open')}</ul></main>` },
      { name: 'R2 tags follow the text and end apart', expected: 'R2', html: `<main><ul role="listbox" style="width:300px;padding:0">${['Alpha', 'A much longer name'].map((n) => `<li role="option" style="padding:8px 12px;list-style:none"><span>${n}</span> <span style="border:1px solid #888;border-radius:999px;padding:2px 8px;margin-left:80px">Open</span></li>`).join('')}</ul></main>` },
      { name: 'R2 plain trailing codes in one column', expected: '', html: `<main><div role="listbox" style="width:300px">${[['Alpha', 'P001'], ['A much longer option name', 'SP-2401']].map(([n, c]) => `<div role="option" style="display:flex;justify-content:space-between;gap:8px"><span>${n}</span><span>${c}</span></div>`).join('')}</div></main>` },
      { name: 'R2 plain trailing codes follow the text', expected: 'R2', html: `<main><div role="listbox" style="width:300px">${[['Alpha', 'P001'], ['A much longer option name', 'SP-2401']].map(([n, c]) => `<div role="option" style="display:flex;gap:8px"><span>${n}</span><span style="margin-left:60px">${c}</span></div>`).join('')}</div></main>` },
      { name: 'R2 a timeline row ends in content, not a tag', expected: '', html: `<main><ol style="width:400px;padding:0">${['One', 'Two'].map((n) => `<li style="display:flex;gap:8px;list-style:none"><span>16 Nov</span><span>Procurement raised by somebody ${n}</span></li>`).join('')}</ol></main>` },
      { name: 'R4 lone row at the top of its container', expected: '', html: '<main><div style="min-height:240px;padding:16px;border:1px solid #ccc"><div>Only row</div></div></main>' },
      { name: 'R4 lone row centred in a tall container', expected: 'R4', html: '<main><div style="min-height:240px;padding:16px;border:1px solid #ccc;display:flex;align-items:center"><div>Only row</div></div></main>' },
      { name: 'R5 bars share their ends', expected: '', html: `<main style="padding:24px"><div>${bar('300px')}${bar('300px')}${bar('300px')}</div></main>` },
      { name: 'R5 one bar ends early', expected: 'R5', html: `<main style="padding:24px"><div>${bar('300px')}${bar('260px')}${bar('300px')}</div></main>` },
      { name: 'R5 figures share a right edge', expected: '', html: `<main style="padding:24px"><div>${[1, 2, 3].map((i) => `<div style="display:flex;width:400px"><span>Row ${i}</span><span style="margin-left:auto;width:100px;text-align:right">1,2${i}0.00</span></div>`).join('')}</div></main>` },
      { name: 'R5 figures end apart', expected: 'R5', html: `<main style="padding:24px"><div>${[1, 2, 3].map((i) => `<div style="display:flex;width:400px"><span>Row ${i}</span><span style="margin-left:auto;width:100px;text-align:right;padding-right:${i * 6}px">1,2${i}0.00</span></div>`).join('')}</div></main>` },
    ];
    for (const fixture of ruleCases) {
      await page.setContent(fixture.html);
      const report = rulesReport(await page.evaluate(measureRules, RULE_NUMBERS), 'fixture @1440');
      const rules = [...new Set(report.findings.map((f) => f.rule))];
      const hit = fixture.expected ? rules.includes(fixture.expected) : rules.length === 0;
      if (!hit) throw new Error(`Self-test failed: rule fixture "${fixture.name}" expected ${fixture.expected || 'no finding'}, got ${report.failures.join('; ') || 'none'}`);
    }
    // R3 needs two routes: the same tab labels at the same frame pass; a moved bar fails and names its route.
    const tabs = (left, top) => `<main><nav style="position:absolute;left:${left}px;top:${top}px;width:400px;display:flex;gap:8px"><a href="/a">List</a><a href="/b">Budget</a></nav></main>`;
    const barsAt = async (route, html) => { await page.setContent(html); return (await page.evaluate(measureRules, RULE_NUMBERS)).tabBars.map((b) => ({ ...b, route, width: 1440 })); };
    const sameFrame = tabFrameFindings([...await barsAt('/projects', tabs(24, 100)), ...await barsAt('/projects/1', tabs(24, 100))]);
    const movedFrame = tabFrameFindings([...await barsAt('/projects', tabs(24, 100)), ...await barsAt('/projects/1', tabs(24, 100)), ...await barsAt('/projects/new', tabs(40, 100))]);
    if (sameFrame.length || movedFrame.length !== 1 || movedFrame[0].route !== '/projects/new') throw new Error(`Self-test failed: R3 must pass an equal frame and name the route whose tab bar moved (${JSON.stringify({ sameFrame, movedFrame })})`);
    console.log('ux-proof self-test passed');
  } finally { await browser.close(); }
}
// Measure a static HTML fixture with the shipped measureText — the shape proofs in
// scripts/ux-proof.test.mjs (extra rows must not move the count; an extra heading must).
async function measureHtml(file) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(fs.readFileSync(file, 'utf8'));
    console.log(JSON.stringify(await page.evaluate(measureText, CHART_SELECTOR)));
  } finally { await browser.close(); }
}
// Measure a static HTML fixture with the shipped measureLayout at a given width (default 1440) and print the
// layoutReport as JSON — the per-class fixtures in scripts/ux-proof.test.mjs.
async function measureLayoutHtml(file, width) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(fs.readFileSync(file, 'utf8'));
    console.log(JSON.stringify(layoutReport(await page.evaluate(measureLayout, LAYOUT_NUMBERS), `fixture @${width}`)));
  } finally { await browser.close(); }
}
if (process.argv.includes('--self-test')) { await selfTest(); process.exit(0); }
if (process.argv.includes('--layout-html')) {
  const at = process.argv.indexOf('--layout-html');
  await measureLayoutHtml(process.argv[at + 1], Number(process.argv[at + 2]) || 1440);
  process.exit(0);
}
if (process.argv.includes('--measure-html')) { await measureHtml(process.argv[process.argv.indexOf('--measure-html') + 1]); process.exit(0); }
const updateBudget = process.argv.includes('--update-word-budget');
// --layout-only: measure only the layout checks (light theme; no screenshots, detector or axe) — the
// fast sweep behind docs/ux/layout-baseline.*. --update-layout-baseline rewrites each key's fingerprint
// list shrink-only; a key not in the baseline yet is written only with --seed-new (the guard
// scripts/check-layout-baseline.mjs fails a seeded key that is not empty once dev has the file).
const layoutOnly = process.argv.includes('--layout-only');
const updateLayout = process.argv.includes('--update-layout-baseline');
const seedNew = process.argv.includes('--seed-new');
// --rules-only: the five fixed rules (R1-R5, ux-proof-metrics.mjs) at 1440, 1024 and 390, printed as findings. No
// screenshots, detector, axe, word budget or layout baseline is read or written; exits 1 when any rule fires.
// A plain run prints the same findings as warnings (they do not fail it until the screens are fixed).
const rulesOnly = process.argv.includes('--rules-only');
const FLAGS = ['--update-word-budget', '--layout-only', '--update-layout-baseline', '--seed-new', '--rules-only'];
const routes = process.argv.slice(2).filter((arg) => !FLAGS.includes(arg));
if (!routes.length || routes.some((route) => !route.startsWith('/'))) {
  console.error('usage: scripts/ux-proof.sh /route [/route ...]');
  process.exit(2);
}
const widths = process.env.UX_PROOF_WIDTHS
  ? process.env.UX_PROOF_WIDTHS.split(',').map((value) => Number(value.trim()))
  : rulesOnly ? [1440, 1024, 390] : [390, 1440];
if (!widths.length || widths.some((width) => !Number.isInteger(width) || width < 320)) {
  throw new Error('UX_PROOF_WIDTHS must be a comma-separated list of integer viewport widths >= 320.');
}

const base = (process.env.SHOT_BASE || 'http://localhost:5173').replace(/\/$/, '');
const area = (process.env.AREA || 'misc').replace(/[^a-zA-Z0-9_-]/g, '-');
const output = path.join(ROOT, 'docs/private/ux-shots', area);
const detector = path.join(ROOT, '.claude/skills/impeccable/scripts/impeccable');
const authFile = process.env.UX_PROOF_AUTH
  ? path.join(APP, 'e2e/.auth', process.env.UX_PROOF_AUTH)
  : path.join(APP, 'e2e/.auth/exec@acme.test.json');
if (!layoutOnly && !rulesOnly && !fs.existsSync(detector)) throw new Error(`Vendored detector missing: ${detector}; run scripts/vendor-skills.sh.`);
if (!fs.existsSync(authFile)) throw new Error(`Auth storage state missing: ${authFile}; run the Playwright setup project first.`);

const budgetPath = path.join(ROOT, 'docs/ux/word-budget.json');
const budget = fs.existsSync(budgetPath) ? JSON.parse(fs.readFileSync(budgetPath, 'utf8')) : {};
budget.targets ||= {};
const login = path.basename(authFile).replace(/\.json$/, '');
// Page state under test. UX_PROOF_BLOCK_READS=1 fails every data read (profile and org lookups still
// load), so the screens' error states are what gets measured.
const blockReads = process.env.UX_PROOF_BLOCK_READS === '1';
const state = blockReads ? 'reads-failing' : 'default';
const layoutBaselinePath = path.join(ROOT, 'docs/ux/layout-baseline.json');
const layoutBaseline = fs.existsSync(layoutBaselinePath) ? JSON.parse(fs.readFileSync(layoutBaselinePath, 'utf8')) : {};
const reusedTools = rulesOnly ? null : await loadReusedChecks();
const layoutFound = {};
const unsettled = [];
const ruleBars = [];
const measurements = [];

const auth = JSON.parse(fs.readFileSync(authFile, 'utf8'));
const localStorage = (auth.origins || []).flatMap((origin) => origin.localStorage || []);
if (!localStorage.length) throw new Error(`No localStorage session found in ${authFile}`);
if (!rulesOnly) fs.mkdirSync(output, { recursive: true });

const slug = (route) => route.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9]+/g, '-') || 'root';
const countDetectorFindings = (value) => {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return 0;
  if (Array.isArray(value.findings)) return value.findings.length;
  if (Array.isArray(value.results)) return value.results.reduce((sum, item) => sum + countDetectorFindings(item), 0);
  return Object.entries(value).reduce((sum, [key, item]) => sum + (key === 'advisories' ? 0 : countDetectorFindings(item)), 0);
};

let failed = false;
if (!rulesOnly) console.log('route | width | charts | min px | chars <14% | font sizes | inputs <16 | targets <44 | overflow | words');
const cdpServer = net.createServer();
await new Promise((resolve, reject) => cdpServer.listen(0, '127.0.0.1', resolve).once('error', reject));
const cdpPort = cdpServer.address().port;
await new Promise((resolve, reject) => cdpServer.close((error) => error ? reject(error) : resolve()));
const browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${cdpPort}`] });
try {
  for (const route of routes) {
    let detectorCount = 0;
    let seriousAxe = 0;
    for (const width of widths) {
      const height = width === 390 ? 844 : width === 1024 ? 768 : 900;
      for (const theme of layoutOnly || rulesOnly ? ['light'] : ['light', 'dark']) {
        const stem = `${slug(route)}-${width}-${theme}`;
        const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
        const page = await context.newPage();
        await page.addInitScript((nextTheme) => {
          localStorage.setItem('theme', nextTheme);
        }, theme);
        await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
        await page.evaluate((items) => {
          for (const { name, value } of items) localStorage.setItem(name, value);
        }, localStorage);
        if (blockReads) await blockDataReads(page);
        await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
        // One settle step before every measurement, in both modes, and every measurement before any screenshot.
        try { await settlePage(page, { readsFailing: blockReads }); } catch (error) {
          unsettled.push(`${route} @${width}`);
          console.error(`${route} @${width} [${state}]: ${error.message}; nothing measured, nothing baselined`);
          failed = true;
          await context.close();
          continue;
        }
        if (rulesOnly) {
          const measured = await page.evaluate(measureRules, RULE_NUMBERS);
          if (measured.skipped) console.log(`${route} @${width} [${login}]: no <main>: skipped`);
          const report = rulesReport(measured, `${route} @${width} [${login}]`);
          report.failures.forEach((line) => console.error(line));
          if (report.failures.length) failed = true;
          ruleBars.push(...measured.tabBars.map((bar) => ({ ...bar, route, width, role: login })));
          await context.close();
          continue;
        }
        const language = await pageLanguage(page);
        const layoutKey = `${route}@${width}@${login}${state === 'default' ? '' : `#${state}`}${language === 'en' ? '' : `~${language}`}`;
        const hasMain = await page.evaluate(() => !!document.querySelector('main'));
        const layout = hasMain ? await measureSettledLayout(page, reusedTools, width) : null;
        const metrics = !layoutOnly && theme === 'light' ? await page.evaluate(measureText, CHART_SELECTOR) : null;
        if (!layoutOnly && theme === 'light' && hasMain) rulesReport(await page.evaluate(measureRules, RULE_NUMBERS), `${route} @${width}`).failures.forEach((line) => console.warn(`warning: ${line}`));
        if (layoutOnly) {
          if (layout) {
            const report = layoutReport(layout, `${route} @${width}`, state);
            layoutFound[layoutKey] = report.fingerprints;
            console.log(`${layoutKey} | layout fingerprints=${report.fingerprints.length}`);
            const allowed = new Set(layoutBaseline[layoutKey] ?? []);
            const fresh = report.fingerprints.filter((fp) => !allowed.has(fp));
            if ((!updateLayout || seedNew) && fresh.length) {
              if (!updateLayout) failed = true; // a seeding run lists what it writes; only a plain run fails
              console.error(`${route} @${width} [${state}]: ${fresh.length} layout fingerprint(s) not in the baseline`);
              new Set(fresh.map((fp) => report.items[fp])).forEach((message) => console.error(message));
            }
            report.warnings.forEach((warning) => console.warn(`warning: ${warning}`));
          } else console.log(`${layoutKey} | no <main>: skipped`);
          await context.close();
          continue;
        }
        await page.screenshot({ path: path.join(output, `${stem}.png`), fullPage: true });
        if (theme === 'light') {
          if (layout) metrics.layout = layout;
          const key = `${route}@${width}@${login}`;
          measurements.push({ route, width, login, ...metrics });
          console.log(`${route} | ${width} | ${metrics.chartCount} | ${metrics.minFontPx} | ${metrics.pctCharsUnder14.toFixed(2)} | ${metrics.distinctFontSizes.join(', ')} | ${metrics.smallInputCount} | ${metrics.smallTargetCount} | ${metrics.horizontalOverflow} | ${metrics.wordCount}`);
          const oldTargetBaseline = budget.targets[key];
          const targetBaseline = updateBudget && oldTargetBaseline === undefined ? metrics.smallTargetCount : oldTargetBaseline;
          const errors = violations(metrics, budget[key], `${route} @${width}`, budget.charts?.[key], targetBaseline, layoutBaseline[layoutKey], state);
          if (!updateBudget && targetBaseline === undefined) errors.push(`${route} @${width}: missing shrink-only target baseline; run the measured seed after fixes.`);
          for (const error of errors) console.error(error);
          if (errors.length) failed = true;
          if (updateBudget) {
            budget[key] = Math.min(budget[key] ?? metrics.wordCount, metrics.wordCount);
            if (!errors.some((error) => /smallInputCount|horizontalOverflow/.test(error))) {
              budget.targets[key] = Math.min(oldTargetBaseline ?? metrics.smallTargetCount, metrics.smallTargetCount);
            }
          }
        }

        const detect = spawnSync(detector, ['detect', '--cdp', `${cdpPort}`, '--target', page.url(), '--json', '--no-advisory'], {
          cwd: ROOT, encoding: 'utf8', timeout: 120_000,
        });
        if (detect.error) throw detect.error;
        let detectorJson;
        try { detectorJson = JSON.parse(detect.stdout); }
        catch { throw new Error(`Impeccable returned invalid JSON for ${route} @${width}: ${detect.stderr || detect.stdout}`); }
        fs.writeFileSync(path.join(output, `${stem}.detector.json`), `${JSON.stringify(detectorJson, null, 2)}\n`);
        const currentDetectorFindings = countDetectorFindings(detectorJson);
        detectorCount += currentDetectorFindings;
        if (detect.status !== 0 || currentDetectorFindings > 0) failed = true;

        const axeJson = await new AxeBuilder({ page }).analyze();
        fs.writeFileSync(path.join(output, `${stem}.axe.json`), `${JSON.stringify(axeJson, null, 2)}\n`);
        const serious = axeJson.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
        seriousAxe += serious.length;
        if (serious.length) failed = true;
        await context.close();
      }
    }
    if (!layoutOnly && !rulesOnly) console.log(`${route}: impeccable findings=${detectorCount}; axe serious/critical=${seriousAxe}`);
  }
} finally {
  await browser.close();
}
if (rulesOnly) {
  const frames = tabFrameFindings(ruleBars);
  frames.forEach((finding) => console.error(`${finding.message} [${finding.role}]`));
  if (frames.length) failed = true;
  console.log(`rules-only: ${routes.length} route(s) x ${widths.length} viewport(s); ${failed ? 'findings above' : 'no findings'}`);
  process.exit(failed ? 1 : 0);
}
fs.writeFileSync(path.join(output, 'measurements.json'), `${JSON.stringify(measurements, null, 2)}\n`);
if (updateBudget) {
  fs.mkdirSync(path.dirname(budgetPath), { recursive: true });
  fs.writeFileSync(budgetPath, `${JSON.stringify(budget, null, 2)}\n`);
}
if (updateLayout) {
  // Shrink-only: an existing key keeps only the fingerprints it still shows. A key that is not in the baseline
  // is written only with --seed-new; otherwise it is reported and left out.
  const refused = [];
  for (const [key, found] of Object.entries(layoutFound)) {
    if (Array.isArray(layoutBaseline[key])) layoutBaseline[key] = layoutBaseline[key].filter((fp) => found.includes(fp));
    else if (seedNew) layoutBaseline[key] = found;
    else refused.push(key);
  }
  if (refused.length) console.error(`${refused.length} key(s) are not in the layout baseline and were not written (pass --seed-new to seed them): ${refused.join(', ')}`);
  const sorted = Object.fromEntries(Object.entries(layoutBaseline).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(layoutBaselinePath, `${JSON.stringify(sorted, null, 2)}\n`);
  const byRoute = {};
  for (const [key, fps] of Object.entries(sorted)) {
    const m = key.match(/^(.*)@(\d+)@([^@]+@[^#~]*)(#[^~]*)?(~.*)?$/);
    (byRoute[m[1]] ||= []).push({ width: m[2], who: `${m[3]}${m[4] ? ` ${m[4].slice(1)}` : ''}${m[5] ? ` ${m[5].slice(1)}` : ''}`, count: fps.length });
  }
  const lines = [
    '# Layout baseline',
    '',
    'Failure fingerprints of the rendered layout checks (`measureLayout` in `scripts/ux-proof-metrics.mjs` and the reused taste and stageshow checks) per route, width and login.',
    'The counts here are for reading only; `layout-baseline.json` lists the fingerprints, and the gate fails on any fingerprint that is not listed there.',
    'Shrink-only: a touched route may not gain a fingerprint, and a route under redesign must reach none. Regenerate with `scripts/ux-proof-layout-sweep.sh`.',
    '',
    '| Route | Login | Width | Fingerprints |',
    '| --- | --- | --- | --- |',
    ...Object.entries(byRoute).sort(([a], [b]) => a.localeCompare(b)).flatMap(([route, rows]) => rows.map((row) => `| \`${route}\` | ${row.who} | ${row.width} | ${row.count} |`)),
    '',
    `Routes measured: ${Object.keys(byRoute).length}. Routes with failures: ${Object.entries(byRoute).filter(([, rows]) => rows.some((row) => row.count > 0)).length}. Total fingerprints: ${Object.values(sorted).reduce((sum, list) => sum + list.length, 0)}.`,
    '',
  ];
  fs.writeFileSync(path.join(ROOT, 'docs/ux/layout-baseline.md'), lines.join('\n'));
}
process.exitCode = failed ? 1 : 0;
