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
