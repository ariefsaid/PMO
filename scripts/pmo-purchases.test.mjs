/**
 * pmo-purchases.test.mjs — `pmo purchases` link-file parsing, validation and batching (#1319, AC-PFE-011/018).
 *
 * Run:  node --test scripts/pmo-purchases.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, rowsFromCsv, validateLinkRows, runLink, PURCHASE_RPCS, PURCHASE_READ_VIEWS, MAX_BATCH } from './lib/pmo-purchases.mjs';

const CSV = 'erp_doctype,erp_name,procurement_id,project_id,group,title,budget_category,sp_drive_id,sp_item_id,sp_web_url,sp_name,sp_kind\n'
  + 'Purchase Invoice,PINV-1,,11111111-1111-1111-1111-111111111111,G,"Steel, batch 1",,,,,,\n'
  + 'Purchase Invoice,PINV-2,,11111111-1111-1111-1111-111111111111,G,,,d1,i1,https://example.sharepoint.com/a.pdf,a.pdf,file\n'
  + ',PINV-3,22222222-2222-2222-2222-222222222222,,,,,,,,,\n';

test('AC-PFE-011: CSV rows become link rows (quoted commas, optional SharePoint item)', () => {
  const rows = rowsFromCsv(CSV);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { erp_doctype: 'Purchase Invoice', erp_name: 'PINV-1', project_id: '11111111-1111-1111-1111-111111111111', group: 'G', title: 'Steel, batch 1' });
  assert.deepEqual(rows[1].sharepoint, { drive_id: 'd1', item_id: 'i1', web_url: 'https://example.sharepoint.com/a.pdf', name: 'a.pdf', kind: 'file' });
  assert.deepEqual(rows[2], { erp_name: 'PINV-3', procurement_id: '22222222-2222-2222-2222-222222222222' });
});

test('AC-PFE-011: a SharePoint folder row is sent as a folder, with no category or status added', () => {
  const rows = rowsFromCsv('erp_name,project_id,sp_drive_id,sp_item_id,sp_web_url,sp_name,sp_kind\n'
    + 'PINV-9,11111111-1111-1111-1111-111111111111,d1,f1,https://example.sharepoint.com/Shared/PINV-9,PINV-9,folder\n');
  assert.deepEqual(rows, [{
    erp_name: 'PINV-9', project_id: '11111111-1111-1111-1111-111111111111',
    sharepoint: { drive_id: 'd1', item_id: 'f1', web_url: 'https://example.sharepoint.com/Shared/PINV-9', name: 'PINV-9', kind: 'folder' },
  }]);
  assert.deepEqual(validateLinkRows(rows), []);
});

test('AC-PFE-011: --dry-run sends p_dry_run true; the real run sends false; outcomes are printed per row', async () => {
  const sent = [];
  const api = { rpc: async (name, body) => { sent.push({ name, body });
    return { dry_run: body.p_dry_run, counts: { link: body.p_rows.length, skip: 0, refused: 0 },
             results: body.p_rows.map((r, i) => ({ row: i + 1, erp_name: r.erp_name, outcome: 'link', reason: null })) }; } };
  const rows = rowsFromCsv(CSV);
  const dry = await runLink(api, rows, { dryRun: true });
  const real = await runLink(api, rows, { dryRun: false });
  assert.equal(sent[0].name, 'link_erp_purchase_documents');
  assert.equal(sent[0].body.p_dry_run, true);
  assert.equal(sent[1].body.p_dry_run, false);
  assert.deepEqual(sent[0].body.p_rows, sent[1].body.p_rows, 'identical rows in both runs');
  assert.equal(dry.dry_run, true);
  assert.equal(real.dry_run, false);
  assert.deepEqual(dry.counts, { link: 3, skip: 0, refused: 0 });
  assert.deepEqual(real.results.map((r) => r.row), [1, 2, 3]);
  assert.deepEqual(real.results.map((r) => r.erp_name), ['PINV-1', 'PINV-2', 'PINV-3']);
});

test('AC-PFE-011: more than 500 rows are sent in batches and renumbered across batches', async () => {
  const sizes = [];
  const api = { rpc: async (_n, body) => { sizes.push(body.p_rows.length);
    return { dry_run: true, counts: { link: body.p_rows.length, skip: 0, refused: 0 }, results: body.p_rows.map((_, i) => ({ row: i + 1, outcome: 'link' })) }; } };
  const rows = Array.from({ length: MAX_BATCH + 2 }, (_, i) => ({ erp_name: `PINV-${i}` }));
  const out = await runLink(api, rows, { dryRun: true });
  assert.equal(MAX_BATCH, 500);
  assert.deepEqual(sizes, [MAX_BATCH, 2]);
  assert.equal(out.results.at(-1).row, MAX_BATCH + 2);
  assert.equal(out.counts.link, MAX_BATCH + 2);
});

test('AC-PFE-011: invalid rows are refused before anything is sent', () => {
  assert.deepEqual(validateLinkRows([{ erp_name: '' }, { erp_name: 'X', procurement_id: 'p', project_id: 'q' }, { erp_name: 'Y', sharepoint: { kind: 'zip' } }]), [
    'row 1: erp_name is required',
    'row 2: give procurement_id or project_id, not both',
    'row 3: sharepoint needs drive_id, item_id, web_url, name and kind file|folder',
  ]);
  assert.deepEqual(validateLinkRows([]), ['the file has no rows']);
  assert.deepEqual(validateLinkRows({ erp_name: 'X' }), ['the file has no rows']);
  assert.deepEqual(validateLinkRows(['PINV-1']), ['row 1: must be an object']);
});

test('AC-PFE-018: the CLI purchase tier matches the latest guard migration', () => {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'supabase', 'migrations');
  const latest = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => /function public\.api_client_request_guard\(\)/.test(fs.readFileSync(path.join(dir, f), 'utf8'))).pop();
  const sql = fs.readFileSync(path.join(dir, latest), 'utf8');
  const decl = (name) => sql.match(new RegExp(`${name}\\s+constant\\s+text\\[\\]\\s*:=\\s*array\\[([^\\]]*)\\]`));
  assert.ok(decl('purchase_rpcs'), `purchase_rpcs is declared in ${latest}`);
  const list = (name) => [...decl(name)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(list('purchase_rpcs'), [...PURCHASE_RPCS].sort());
  assert.deepEqual(list('purchase_read_views'), Object.keys(PURCHASE_READ_VIEWS).sort());
});

test('parseCsv handles CRLF and escaped quotes', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x ""y""",z\r\n'), [['a', 'b'], ['x "y"', 'z']]);
  assert.deepEqual(parseCsv('a,b\nc,d'), [['a', 'b'], ['c', 'd']], 'no trailing newline');
  assert.deepEqual(rowsFromCsv(''), []);
});

// ── review round: batching keeps groups whole, duplicates, mid-run failure, strict CSV ───────────

/** A fake RPC that records each call's erp_names and answers 'link' per row, echoing erp_name by position. */
const recordingApi = (calls, { failOnCall } = {}) => ({
  rpc: async (_n, body) => {
    calls.push(body.p_rows.map((r) => r.erp_name));
    if (failOnCall === calls.length) throw Object.assign(new Error('upstream timeout'), { status: 504 });
    return { dry_run: body.p_dry_run, counts: { link: body.p_rows.length, skip: 0, refused: 0 },
      results: body.p_rows.map((r, i) => ({ row: i + 1, erp_name: r.erp_name, outcome: 'link', reason: null })) };
  },
});
const P = '11111111-1111-1111-1111-111111111111';

test('AC-PFE-011: a group is never split across calls; the report keeps file row numbers', async () => {
  // 499 single rows, then a 3-row group: cutting at 500 rows would put G-1 in call 1 and G-2, G-3 in call 2.
  const rows = [
    ...Array.from({ length: MAX_BATCH - 1 }, (_, i) => ({ erp_name: `PINV-${i}`, project_id: P })),
    { erp_name: 'G-1', project_id: P, group: 'G' }, { erp_name: 'G-2', project_id: P, group: 'G' }, { erp_name: 'G-3', project_id: P, group: 'G' },
  ];
  const calls = [];
  const out = await runLink(recordingApi(calls), rows, { dryRun: true });
  const callOf = (name) => calls.findIndex((c) => c.includes(name));
  assert.equal(callOf('G-1'), callOf('G-2'));
  assert.equal(callOf('G-1'), callOf('G-3'));
  assert.ok(calls.every((c) => c.length <= MAX_BATCH));
  assert.equal(out.results.length, rows.length);
  out.results.forEach((r, i) => { assert.equal(r.row, i + 1); assert.equal(r.erp_name, rows[i].erp_name); });
  assert.equal(out.counts.link, rows.length);
});

test('AC-PFE-011: rows of one group scattered through the file are sent in one call', async () => {
  const rows = [{ erp_name: 'A-1', group: 'A', project_id: P }, { erp_name: 'B-1', group: 'B', project_id: P }, { erp_name: 'A-2', group: 'A', project_id: P }];
  const calls = [];
  const out = await runLink(recordingApi(calls), rows, { dryRun: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(out.results.map((r) => [r.row, r.erp_name]), [[1, 'A-1'], [2, 'B-1'], [3, 'A-2']]);
});

test('AC-PFE-011: a group larger than one call is refused before anything is sent', () => {
  const rows = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ erp_name: `PINV-${i}`, project_id: P, group: 'BIG' }));
  assert.deepEqual(validateLinkRows(rows), [`group 'BIG' (project ${P}) has ${MAX_BATCH + 1} rows; one group must fit in one call of ${MAX_BATCH} rows`]);
});

test('AC-PFE-011: the same ERP document listed twice is refused', () => {
  assert.deepEqual(validateLinkRows([
    { erp_name: 'PINV-1', project_id: P }, { erp_name: 'PINV-2' }, { erp_name: ' PINV-1 ', erp_doctype: 'Purchase Invoice' },
    { erp_name: 'X', erp_doctype: 'Purchase Order' }, { erp_name: 'X', erp_doctype: 'Purchase Invoice' },
  ]), ['row 3: ERP document PINV-1 is already listed on row 1']);
});

test('AC-PFE-011: an unknown field in a JSON row is refused (a typo must not create a purchase)', () => {
  assert.deepEqual(validateLinkRows([{ erp_name: 'PINV-1', procurment_id: 'p' }]), ["row 1: unknown field 'procurment_id'"]);
});

test('AC-PFE-011: a failed call keeps the report of the calls before it', async () => {
  const rows = [
    ...Array.from({ length: MAX_BATCH }, (_, i) => ({ erp_name: `A-${i}`, project_id: P, group: 'A' })),
    { erp_name: 'B-1', project_id: P, group: 'B' }, { erp_name: 'B-2', project_id: P, group: 'B' },
  ];
  const out = await runLink(recordingApi([], { failOnCall: 2 }), rows, { dryRun: false });
  assert.equal(out.results.length, MAX_BATCH);
  assert.equal(out.counts.link, MAX_BATCH);
  assert.equal(out.failed_at_row, MAX_BATCH + 1);
  assert.deepEqual(out.not_saved_rows, [MAX_BATCH + 1, MAX_BATCH + 2]);
  assert.deepEqual(out.error, { message: 'upstream timeout', status: 504 });
});

test('AC-PFE-011: CSV with an unterminated quote, an over-long row or an unknown column is refused', () => {
  assert.throws(() => parseCsv('a,b\n"x,y\n'), /unterminated quote/);
  assert.throws(() => rowsFromCsv('erp_name,project_id\nPINV-1,p,extra\n'), /row 1 has 3 cells; the header has 2/);
  assert.throws(() => rowsFromCsv('erp_name,procurment_id\nPINV-1,p\n'), /unknown column 'procurment_id'/);
});
