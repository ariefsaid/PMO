/**
 * pmo-receipts.test.mjs — `pmo purchases receive` (#1866): whole-purchase (Basic) and line-level (Full) goods receipts
 * through the same adapter-dispatch command the app sends. Fake Supabase served by node:http.
 *
 * Run:  node --test scripts/pmo-receipts.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { run, writeCredentials } from './pmo.mjs';
import { parseLineFlags } from './lib/pmo-receipts.mjs';

const PROC = '11111111-1111-1111-1111-111111111111';
const INTENT = '22222222-2222-2222-2222-222222222222';
const OWNED = [200, [{ domain: 'procurement', external_tier: 'odoo' }]];
const DISPATCH = 'POST /functions/v1/adapter-dispatch';
const OK = [200, { externalRecordId: 'WH/IN/1', canonical: { id: INTENT, gr_number: 'GR-1', status: 'Partial' } }];

async function fake(handlers = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, 'http://localhost');
    requests.push({ method: req.method, path: url.pathname, body: body ? JSON.parse(body) : undefined });
    const answer = handlers[`${req.method} ${url.pathname}`];
    const [status, json] = answer === undefined ? [404, { message: `unexpected ${req.method} ${url.pathname}` }] : answer;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(json));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => server.close(r)) };
}

async function cli(argv, server) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-rcv-'));
  writeCredentials({ PMO_CONFIG_DIR: dir }, server.url, {
    client_id: 'c', access_token: 'a', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u', email: 'a@example.test' },
  });
  let out = ''; let err = '';
  const code = await run([...argv, '--url', server.url], {
    env: { PMO_CONFIG_DIR: dir, PMO_SUPABASE_KEY: 'k' },
    stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) },
    stdin: (async function* () {})(),
    now: () => Date.parse('2026-11-06T03:00:00Z'),
  });
  fs.rmSync(dir, { recursive: true, force: true });
  let json = null; try { json = JSON.parse(out); } catch { /* text */ }
  let error = null; try { error = JSON.parse(err.trim().split('\n').pop()).error; } catch { /* none */ }
  return { code, json, error };
}
const dispatched = (s) => s.requests.filter((r) => r.path === '/functions/v1/adapter-dispatch');

test('AC-RCV-001 whole-purchase receipt sends the app\'s goods-receipt command with one intent id as record id and key', async () => {
  const s = await fake({ 'GET /rest/v1/external_domain_ownership': OWNED, [DISPATCH]: OK });
  try {
    const r = await cli(['purchases', 'receive', PROC, '--intent', INTENT], s);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(dispatched(s)[0].body, {
      domain: 'procurement', operation: 'create', idempotencyKey: INTENT,
      record: { id: INTENT, procurementId: PROC, status: 'Complete', receiptDate: '2026-11-06', erp_doc_kind: 'goods-receipt' },
    });
    assert.equal(r.json.intent, INTENT);
    assert.equal(r.json.receipt.gr_number, 'GR-1');
  } finally { await s.close(); }
});

test('AC-RCV-002 line-level receipt carries itemRef/quantity lines and defaults to Partial', async () => {
  const s = await fake({ 'GET /rest/v1/external_domain_ownership': OWNED, [DISPATCH]: OK });
  try {
    const r = await cli(['purchases', 'receive', PROC, '--line', 'Pump=3', '--line', 'Valve=1.5', '--date', '2026-11-01', '--intent', INTENT], s);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    const { record } = dispatched(s)[0].body;
    assert.deepEqual(record.receiptLines, [{ itemRef: 'Pump', quantity: 3 }, { itemRef: 'Valve', quantity: 1.5 }]);
    assert.equal(record.status, 'Partial');
    assert.equal(record.receiptDate, '2026-11-01');
  } finally { await s.close(); }
});

test('AC-RCV-003 without --intent a fresh one is minted and printed; re-running with it sends the identical identity', async () => {
  const s = await fake({ 'GET /rest/v1/external_domain_ownership': OWNED, [DISPATCH]: OK });
  try {
    const first = await cli(['purchases', 'receive', PROC], s);
    assert.match(first.json.intent, /^[0-9a-f-]{36}$/i);
    await cli(['purchases', 'receive', PROC, '--intent', first.json.intent], s);
    const [a, b] = dispatched(s).map((d) => [d.body.idempotencyKey, d.body.record.id]);
    assert.deepEqual(a, b);
    assert.deepEqual(a, [first.json.intent, first.json.intent]);
  } finally { await s.close(); }
});

test('AC-RCV-004 a purchase PMO owns is refused before any dispatch, pointing at the app', async () => {
  const s = await fake({ 'GET /rest/v1/external_domain_ownership': [200, []] });
  try {
    const r = await cli(['purchases', 'receive', PROC], s);
    assert.equal(r.code, 1);
    assert.equal(r.error.code, 'procurement_not_erp_owned');
    assert.match(r.error.hint, /Procurement/);
    assert.equal(dispatched(s).length, 0);
  } finally { await s.close(); }
});

test('AC-RCV-005 plan off: the server refusal gets an actionable hint and the intent to reuse', async () => {
  const s = await fake({ 'GET /rest/v1/external_domain_ownership': OWNED,
    [DISPATCH]: [422, { error: 'commit-rejected', message: 'Receipt line quantities require procurement full' }] });
  try {
    const r = await cli(['purchases', 'receive', PROC, '--line', 'Pump=3', '--intent', INTENT], s);
    assert.equal(r.code, 1);
    assert.match(r.error.message, /require procurement full/);
    assert.match(r.error.hint, /Full plan.*without --line/s);
    assert.equal(r.error.details.intent, INTENT);
  } finally { await s.close(); }
});

test('AC-RCV-006 quantity over what is open is refused with the line named and a hint', async () => {
  const s = await fake({ 'GET /rest/v1/external_domain_ownership': OWNED,
    [DISPATCH]: [422, { error: 'commit-rejected', message: 'over-receipt: Pump' }] });
  try {
    const r = await cli(['purchases', 'receive', PROC, '--line', 'Pump=99'], s);
    assert.equal(r.code, 1);
    assert.match(r.error.hint, /open quantity/);
  } finally { await s.close(); }
});

test('AC-RCV-007 wrong state (nothing open / no order) and unreachable ERP carry hints; unreachable says to re-run with the same intent', async () => {
  for (const [message, error, hint] of [
    ['receipt-nothing-open', 'commit-rejected', /already fully received/],
    ['po-missing', 'commit-rejected', /purchase order/],
    ['The external system could not be reached', 'external-unreachable', /--intent/],
  ]) {
    const s = await fake({ 'GET /rest/v1/external_domain_ownership': OWNED, [DISPATCH]: [error === 'commit-rejected' ? 422 : 502, { error, message }] });
    try {
      const r = await cli(['purchases', 'receive', PROC, '--intent', INTENT], s);
      assert.equal(r.code, 1);
      assert.match(r.error.hint, hint);
      assert.equal(r.error.details.intent, INTENT);
    } finally { await s.close(); }
  }
});

test('AC-RCV-008 --dry-run sends nothing and prints the command', async () => {
  const s = await fake({ 'GET /rest/v1/external_domain_ownership': OWNED });
  try {
    const r = await cli(['purchases', 'receive', PROC, '--line', 'Pump=3', '--dry-run', '--intent', INTENT], s);
    assert.equal(r.code, 0);
    assert.equal(r.json.dry_run, true);
    assert.equal(r.json.command.record.receiptLines.length, 1);
    assert.equal(dispatched(s).length, 0);
  } finally { await s.close(); }
});

test('AC-RCV-009 bad input is refused before anything is sent', async () => {
  const s = await fake({});
  try {
    for (const argv of [
      ['purchases', 'receive'],
      ['purchases', 'receive', 'nope'],
      ['purchases', 'receive', PROC, '--line', 'Pump'],
      ['purchases', 'receive', PROC, '--line', 'Pump=0'],
      ['purchases', 'receive', PROC, '--line', 'Pump=abc'],
      ['purchases', 'receive', PROC, '--line', 'Pump=1', '--line', 'Pump=2'],
      ['purchases', 'receive', PROC, '--status', 'Done'],
      ['purchases', 'receive', PROC, '--date', '06/11/2026'],
      ['purchases', 'receive', PROC, '--intent', 'x'],
    ]) {
      const r = await cli(argv, s);
      assert.equal(r.code, 2, argv.join(' '));
    }
    assert.equal(s.requests.length, 0);
  } finally { await s.close(); }
});

test('AC-RCV-009 parseLineFlags splits on the last = so item names may contain one', () => {
  assert.deepEqual(parseLineFlags(['A=B=2']), { lines: [{ itemRef: 'A=B', quantity: 2 }] });
});
