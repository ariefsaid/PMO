import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { violations } from './ux-proof-metrics.mjs';

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
function wordCount(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ux-proof-'));
  const file = path.join(dir, 'fixture.html');
  fs.writeFileSync(file, `<main style="font-size:16px">${body}</main>`);
  const result = spawnSync(process.execPath, [SCRIPT, '--measure-html', file], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).wordCount;
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
