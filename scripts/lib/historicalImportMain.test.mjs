import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../import-historical.mjs';

test('procurement apply obtains and uses a registered server run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-import-'));
  const file = join(dir, 'procurement_cases.csv');
  writeFileSync(file, 'case_ref,type,title,terminal_status,total_value,reference_number,status,date,amount\n  C  ,PR,Case,Cancelled,,PR,Draft,2026-01-01,1\n');
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'http://localhost:8888';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, method, body });
    let data = [];
    if (url.pathname.endsWith('/organizations')) data = { id: 'org', name: 'Example' };
    if (url.pathname.endsWith('/start_procurement_import_run')) data = '39900000-0000-0000-0000-000000000001';
    if (url.pathname.endsWith('/normalize_procurement_import_refs')) data = body.p_refs.map(ref => ({ input_ref: ref, normalized_ref: ref.trim().toLowerCase() }));
    if (method === 'POST' && url.pathname.endsWith('/procurements')) data = { id: 'case' };
    if (method === 'POST' && url.pathname.endsWith('/purchase_requests')) data = { id: 'record' };
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await main(['--org-id', 'org', '--file', file], { promptConfirmFn: async () => 'Example' });
    const run = calls.find(call => call.path.endsWith('/start_procurement_import_run'));
    assert.ok(run);
    const record = calls.find(call => call.path.endsWith('/purchase_requests') && call.method === 'POST');
    assert.equal(record.body.import_batch_id, '39900000-0000-0000-0000-000000000001');
    assert.equal(record.body.import_key, 'pcy2:["r","PR"]');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('procurement apply retains an unknown candidate for reconciliation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-import-'));
  const file = join(dir, 'procurement_cases.csv');
  writeFileSync(file, 'case_ref,type,title,terminal_status,total_value,reference_number,status,date,amount\nC,PR,Case,Cancelled,,PR,Draft,2026-01-01,1\n');
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'http://localhost:8888';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  const calls = [];
  const errors = [];
  const oldError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, method, body });
    let data = [];
    if (url.pathname.endsWith('/organizations')) data = { id: 'org', name: 'Example' };
    if (url.pathname.endsWith('/start_procurement_import_run')) data = '39900000-0000-0000-0000-000000000001';
    if (url.pathname.endsWith('/normalize_procurement_import_refs')) data = body.p_refs.map(ref => ({ input_ref: ref, normalized_ref: ref.toLowerCase() }));
    if (url.pathname.endsWith('/lookup_procurement_import_cases')) data = [{ id: 'case', import_key: 'C', normalized_ref: 'c', import_batch_id: null }];
    if (method === 'GET' && url.pathname.endsWith('/purchase_requests')) data = [{ id: 'old', import_key: 'PR', import_batch_id: null, import_identity_version: null, import_identity_facts: null }];
    if (method === 'POST' && url.pathname.endsWith('/procurements')) data = { id: 'case' };
    if (method === 'POST' && url.pathname.endsWith('/purchase_requests')) data = { id: 'record' };
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await main(['--org-id', 'org', '--file', file], { promptConfirmFn: async () => 'Example' });
    assert.equal(calls.filter(call => call.method === 'POST' && call.path.endsWith('/purchase_requests')).length, 0);
    assert.equal(calls.filter(call => call.method === 'POST' && call.path.endsWith('/procurements')).length, 0);
    assert.ok(errors.some(message => /reconcil/i.test(message)));
  } finally {
    globalThis.fetch = oldFetch;
    console.error = oldError;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('duplicate historical identities are refused before the case insert', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-import-'));
  const file = join(dir, 'procurement_cases.csv');
  writeFileSync(file, 'case_ref,type,title,terminal_status,total_value,reference_number,status,date,amount\nC,PR,Case,Cancelled,,PR,Draft,2026-01-01,1\nC,PR,Case,Cancelled,,PR,Draft,2026-01-01,2\n');
  const oldFetch = globalThis.fetch, oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY, oldError = console.error;
  const calls = [], errors = [];
  process.env.SUPABASE_URL = 'http://localhost:8888'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  console.error = (...args) => errors.push(args.join(' '));
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, method, body });
    let data = [];
    if (url.pathname.endsWith('/organizations')) data = { id: 'org', name: 'Example' };
    if (url.pathname.endsWith('/start_procurement_import_run')) data = '39900000-0000-0000-0000-000000000001';
    if (url.pathname.endsWith('/normalize_procurement_import_refs')) data = body.p_refs.map(ref => ({ input_ref: ref, normalized_ref: ref.toLowerCase() }));
    if (method === 'POST' && url.pathname.endsWith('/procurements')) data = { id: 'case' };
    if (method === 'POST' && url.pathname.endsWith('/purchase_requests')) data = { id: 'record' };
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await main(['--org-id', 'org', '--file', file], { promptConfirmFn: async () => 'Example' });
    assert.equal(calls.filter(call => call.method === 'POST' && call.path.endsWith('/procurements')).length, 0);
    assert.ok(errors.some(message => /duplicate/i.test(message)));
  } finally {
    globalThis.fetch = oldFetch; console.error = oldError;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('database-normalized case ambiguity blocks all affected header inserts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-import-'));
  const file = join(dir, 'procurement_cases.csv');
  writeFileSync(file, 'case_ref,type,title,terminal_status,total_value,reference_number,status,date,amount\nA,PR,Case,Cancelled,,PR1,Draft,2026-01-01,1\nB,PR,Case,Cancelled,,PR2,Draft,2026-01-01,1\n');
  const oldFetch = globalThis.fetch, oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY, oldError = console.error;
  const calls = [], errors = [];
  process.env.SUPABASE_URL = 'http://localhost:8888'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  console.error = (...args) => errors.push(args.join(' '));
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, method, body });
    let data = [];
    if (url.pathname.endsWith('/organizations')) data = { id: 'org', name: 'Example' };
    if (url.pathname.endsWith('/start_procurement_import_run')) data = '39900000-0000-0000-0000-000000000001';
    if (url.pathname.endsWith('/normalize_procurement_import_refs')) data = body.p_refs.map(ref => ({ input_ref: ref, normalized_ref: 'same' }));
    if (method === 'POST' && url.pathname.endsWith('/procurements')) data = { id: 'case' };
    if (method === 'POST' && url.pathname.endsWith('/purchase_requests')) data = { id: 'record' };
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await main(['--org-id', 'org', '--file', file], { promptConfirmFn: async () => 'Example' });
    assert.equal(calls.filter(call => call.method === 'POST' && call.path.endsWith('/procurements')).length, 0);
    assert.ok(errors.some(message => /ambiguous/i.test(message)));
  } finally {
    globalThis.fetch = oldFetch; console.error = oldError;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('historical payment is not written when its invoice requires reconciliation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-import-'));
  const file = join(dir, 'procurement_cases.csv');
  writeFileSync(file, 'case_ref,type,title,terminal_status,total_value,reference_number,status,date,amount,tax_treatment,tax_amount\nC,VI,Case,Cancelled,,VI,Received,2026-01-01,1,exclusive,0\nC,Payment,Case,Cancelled,,PAY,Scheduled,2026-01-01,1,,\n');
  const oldFetch = globalThis.fetch, oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY, oldError = console.error;
  const calls = [];
  process.env.SUPABASE_URL = 'http://localhost:8888'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  console.error = () => {};
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, method, body });
    let data = [];
    if (url.pathname.endsWith('/organizations')) data = { id: 'org', name: 'Example' };
    if (url.pathname.endsWith('/start_procurement_import_run')) data = '39900000-0000-0000-0000-000000000001';
    if (url.pathname.endsWith('/normalize_procurement_import_refs')) data = body.p_refs.map(ref => ({ input_ref: ref, normalized_ref: ref.toLowerCase() }));
    if (url.pathname.endsWith('/lookup_procurement_import_cases')) data = [{ id: 'case', import_key: 'C', normalized_ref: 'c', import_batch_id: null }];
    if (method === 'GET' && url.pathname.endsWith('/procurement_invoices')) data = [{ id: 'old', import_key: 'VI', import_batch_id: null, import_identity_version: null, import_identity_facts: null }];
    if (method === 'POST' && url.pathname.endsWith('/payments')) data = { id: 'payment' };
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await main(['--org-id', 'org', '--file', file], { promptConfirmFn: async () => 'Example' });
    assert.equal(calls.filter(call => call.method === 'POST' && call.path.endsWith('/payments')).length, 0);
  } finally {
    globalThis.fetch = oldFetch; console.error = oldError;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('historical CSV preserves quoted commas, quotes and Unicode in reference identity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-import-'));
  const file = join(dir, 'procurement_cases.csv');
  writeFileSync(file, 'case_ref,type,title,terminal_status,total_value,reference_number,status,date,amount\nC,PR,Case,Cancelled,,"a,""字|b",Draft,2026-01-01,1\n');
  const oldFetch = globalThis.fetch, oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const calls = [];
  process.env.SUPABASE_URL = 'http://localhost:8888'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, method, body });
    let data = [];
    if (url.pathname.endsWith('/organizations')) data = { id: 'org', name: 'Example' };
    if (url.pathname.endsWith('/start_procurement_import_run')) data = '39900000-0000-0000-0000-000000000001';
    if (url.pathname.endsWith('/normalize_procurement_import_refs')) data = body.p_refs.map(ref => ({ input_ref: ref, normalized_ref: ref.toLowerCase() }));
    if (method === 'POST' && url.pathname.endsWith('/procurements')) data = { id: 'case' };
    if (method === 'POST' && url.pathname.endsWith('/purchase_requests')) data = { id: 'record' };
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await main(['--org-id', 'org', '--file', file], { promptConfirmFn: async () => 'Example' });
    const row = calls.find(call => call.method === 'POST' && call.path.endsWith('/purchase_requests'));
    assert.equal(row.body.reference_number, 'a,"字|b');
    assert.equal(row.body.import_key, `pcy2:${JSON.stringify(['r', 'a,"字|b'])}`);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('historical preview performs no metadata or business writes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-import-'));
  const file = join(dir, 'procurement_cases.csv');
  writeFileSync(file, 'case_ref,type,title,terminal_status,total_value,reference_number,status,date,amount\nC,PR,Case,Cancelled,,PR,Draft,2026-01-01,1\n');
  const oldFetch = globalThis.fetch, oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const calls = [];
  process.env.SUPABASE_URL = 'http://localhost:8888'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, method, body });
    let data = [];
    if (url.pathname.endsWith('/organizations')) data = { id: 'org', name: 'Example' };
    if (url.pathname.endsWith('/normalize_procurement_import_refs')) data = body.p_refs.map(ref => ({ input_ref: ref, normalized_ref: ref.toLowerCase() }));
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await main(['--org-id', 'org', '--file', file, '--dry-run']);
    assert.equal(calls.filter(call => call.method !== 'GET' && !call.path.endsWith('/normalize_procurement_import_refs') && !call.path.endsWith('/lookup_procurement_import_cases')).length, 0);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('vendor lookup errors do not create stubs or cases', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-import-'));
  const file = join(dir, 'procurement_cases.csv');
  writeFileSync(file, 'case_ref,type,title,terminal_status,total_value,reference_number,status,date,amount,vendor\nC,Quotation,Case,Cancelled,,Q,,2026-01-01,1,Supplier\n');
  const oldFetch = globalThis.fetch, oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY, oldError = console.error;
  const calls = [];
  process.env.SUPABASE_URL = 'http://localhost:8888'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'; console.error = () => {};
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, method, query: url.search, body });
    if (url.pathname.endsWith('/companies') && method === 'GET') return new Response(JSON.stringify({ message: 'unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
    let data = [];
    if (url.pathname.endsWith('/organizations')) data = { id: 'org', name: 'Example' };
    if (url.pathname.endsWith('/start_procurement_import_run')) data = '39900000-0000-0000-0000-000000000001';
    if (url.pathname.endsWith('/normalize_procurement_import_refs')) data = body.p_refs.map(ref => ({ input_ref: ref, normalized_ref: ref.toLowerCase() }));
    if (method === 'POST' && url.pathname.endsWith('/companies')) data = { id: 'vendor' };
    if (method === 'POST' && url.pathname.endsWith('/procurements')) data = { id: 'case' };
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await main(['--org-id', 'org', '--file', file], { promptConfirmFn: async () => 'Example' }).catch(() => {});
    assert.equal(calls.filter(call => call.method === 'POST' && (call.path.endsWith('/companies') || call.path.endsWith('/procurements'))).length, 0);
    assert.ok(calls.find(call => call.method === 'GET' && call.path.endsWith('/companies')).query.includes('org_id='));
  } finally {
    globalThis.fetch = oldFetch; console.error = oldError;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unregistered supplied batch is refused before any write', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-import-'));
  const file = join(dir, 'procurement_cases.csv');
  writeFileSync(file, 'case_ref,type,title,terminal_status,total_value,reference_number,status,date,amount\nC,PR,Case,Cancelled,,PR,Draft,2026-01-01,1\n');
  const oldFetch = globalThis.fetch, oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY, oldError = console.error, oldExit = process.exitCode;
  const calls = [], errors = [];
  process.env.SUPABASE_URL = 'http://localhost:8888'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'; console.error = (...args) => errors.push(args.join(' '));
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method ?? 'GET';
    calls.push({ path: url.pathname, method });
    const data = url.pathname.endsWith('/organizations') ? { id: 'org', name: 'Example' } : null;
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await main(['--org-id', 'org', '--file', file, '--batch-id', 'legacy'], { promptConfirmFn: async () => 'Example' });
    assert.equal(process.exitCode, 1);
    assert.ok(errors.some(message => /registered current run/i.test(message)));
    assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
  } finally {
    globalThis.fetch = oldFetch; console.error = oldError; process.exitCode = oldExit;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a fresh historical probe gives unknown candidates precedence over an earlier match', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-import-'));
  const file = join(dir, 'procurement_cases.csv');
  writeFileSync(file, 'case_ref,type,title,terminal_status,total_value,reference_number,status,date,amount\nC,PR,Case,Cancelled,,PR,Draft,2026-01-01,1\n');
  const oldFetch = globalThis.fetch, oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY, oldError = console.error;
  const calls = [], errors = []; let reads = 0;
  process.env.SUPABASE_URL = 'http://localhost:8888'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'; console.error = (...args) => errors.push(args.join(' '));
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, method, body });
    let data = [];
    if (url.pathname.endsWith('/organizations')) data = { id: 'org', name: 'Example' };
    if (url.pathname.endsWith('/start_procurement_import_run')) data = '39900000-0000-0000-0000-000000000001';
    if (url.pathname.endsWith('/normalize_procurement_import_refs')) data = body.p_refs.map(ref => ({ input_ref: ref, normalized_ref: ref.toLowerCase() }));
    if (url.pathname.endsWith('/lookup_procurement_import_cases')) data = [{ id: 'case', import_key: 'C', normalized_ref: 'c', import_batch_id: null }];
    if (method === 'GET' && url.pathname.endsWith('/purchase_requests')) {
      reads++;
      data = [{ id: 'same', import_key: 'pcy2:["r","PR"]', import_batch_id: 'other', import_identity_version: 2, import_identity_facts: ['PR', 'Draft', '2026-01-01', '1.00'] }];
      if (reads > 1) data.push({ id: 'unknown', import_key: 'PR', import_batch_id: null, import_identity_version: null, import_identity_facts: null });
    }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await main(['--org-id', 'org', '--file', file], { promptConfirmFn: async () => 'Example' });
    assert.equal(reads, 2);
    assert.ok(errors.some(message => /reconciliation/i.test(message)));
    assert.equal(calls.filter(call => call.method === 'POST' && call.path.endsWith('/purchase_requests')).length, 0);
  } finally {
    globalThis.fetch = oldFetch; console.error = oldError;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('historical preview distinguishes missing vendors and rejected duplicates create no stubs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-vendors-'));
  const file = join(dir, 'procurement_cases.csv');
  const oldFetch = globalThis.fetch, oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY, oldError = console.error, oldLog = console.log;
  const calls = [], errors = [], logs = [];
  let failCreate = false;
  process.env.SUPABASE_URL = 'http://localhost:8888'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  console.error = (...args) => errors.push(args.join(' ')); console.log = (...args) => logs.push(args.join(' '));
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, method, body });
    if (failCreate && method === 'POST' && url.pathname.endsWith('/companies')) return new Response(JSON.stringify({ message: 'creation refused' }), { status: 400, headers: { 'content-type': 'application/json' } });
    let data = [];
    if (url.pathname.endsWith('/organizations')) data = { id: 'org', name: 'Example' };
    if (url.pathname.endsWith('/companies') && method === 'GET') data = url.searchParams.get('name') === 'ilike.Known' ? { id: 'known-id' } : null;
    if (url.pathname.endsWith('/companies') && method === 'POST') data = { id: `vendor-${body.name}` };
    if (method === 'POST' && url.pathname.endsWith('/procurements')) data = { id: 'case' };
    if (method === 'POST' && url.pathname.endsWith('/procurement_quotations')) data = { id: `quote-${body.vendor_id}` };
    if (url.pathname.endsWith('/start_procurement_import_run')) data = '39900000-0000-0000-0000-000000000001';
    if (url.pathname.endsWith('/normalize_procurement_import_refs')) data = body.p_refs.map(ref => ({ input_ref: ref, normalized_ref: ref.toLowerCase() }));
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const csv = (second) => `case_ref,type,title,terminal_status,total_value,vendor,date,amount\nC,Quotation,Case,Cancelled,,Alpha,2026-01-01,1\nC,Quotation,Case,Cancelled,,${second},2026-01-01,1\n`;
  try {
    writeFileSync(file, csv('Beta'));
    await main(['--org-id', 'org', '--file', file, '--dry-run']);
    assert.ok(logs.some(line => /Quotation: created: 2, skipped: 0, failed: 0/.test(line)), logs.join('\n'));
    assert.equal(calls.filter(call => call.method === 'POST' && !call.path.includes('/rpc/')).length, 0);
    calls.length = 0; errors.length = 0; logs.length = 0;
    await main(['--org-id', 'org', '--file', file], { promptConfirmFn: async () => 'Example' });
    assert.equal(calls.filter(call => call.method === 'POST' && call.path.endsWith('/companies')).length, 2);
    assert.equal(calls.filter(call => call.method === 'POST' && call.path.endsWith('/procurement_quotations')).length, 2);
    calls.length = 0; errors.length = 0; logs.length = 0;
    writeFileSync(file, csv('Known'));
    await main(['--org-id', 'org', '--file', file, '--dry-run']);
    assert.ok(logs.some(line => /Quotation: created: 2, skipped: 0, failed: 0/.test(line)));
    assert.equal(calls.filter(call => call.method === 'POST' && !call.path.includes('/rpc/')).length, 0);
    calls.length = 0; errors.length = 0; logs.length = 0;
    writeFileSync(file, csv('Alpha'));
    await main(['--org-id', 'org', '--file', file, '--dry-run']);
    assert.ok(errors.some(line => /duplicate/.test(line)));
    assert.equal(calls.filter(call => call.method === 'POST' && !call.path.includes('/rpc/')).length, 0);
    calls.length = 0; errors.length = 0;
    await main(['--org-id', 'org', '--file', file], { promptConfirmFn: async () => 'Example' });
    assert.ok(errors.some(line => /duplicate/.test(line)));
    assert.equal(calls.filter(call => call.method === 'POST' && call.path.endsWith('/companies')).length, 0);
    calls.length = 0; errors.length = 0;
    writeFileSync(file, csv('Beta').replace('2026-01-01,1\n', '2026-01-01,0.30000000000000004\n'));
    await main(['--org-id', 'org', '--file', file], { promptConfirmFn: async () => 'Example' });
    assert.ok(errors.length > 0);
    assert.equal(calls.filter(call => call.method === 'POST' && call.path.endsWith('/companies')).length, 0);
    calls.length = 0; errors.length = 0; failCreate = true;
    writeFileSync(file, csv('Beta'));
    await main(['--org-id', 'org', '--file', file], { promptConfirmFn: async () => 'Example' });
    assert.ok(errors.some(line => /vendor creation failed/i.test(line)));
    assert.equal(calls.filter(call => call.method === 'POST' && call.path.endsWith('/procurements')).length, 0);
  } finally {
    globalThis.fetch = oldFetch; console.error = oldError; console.log = oldLog;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('historical caller rejects excess precision and probes no provisional vendor UUID', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-exact-')), file = join(dir, 'procurement_cases.csv');
  const oldFetch = globalThis.fetch, oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY, oldLog = console.log, oldError = console.error;
  const urls = [], logs = [], errors = [];
  process.env.SUPABASE_URL = 'http://localhost:8888'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  console.log = (...args) => logs.push(args.join(' ')); console.error = (...args) => errors.push(args.join(' '));
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : null;
    urls.push({ url: url.toString(), method });
    let data = [];
    if (url.pathname.endsWith('/organizations')) data = { id: 'org', name: 'Example' };
    if (url.pathname.endsWith('/companies') && method === 'GET') data = null;
    if (url.pathname.endsWith('/normalize_procurement_import_refs')) data = body.p_refs.map(ref => ({ input_ref: ref, normalized_ref: ref.toLowerCase() }));
    if (url.pathname.endsWith('/lookup_procurement_import_cases')) data = [{ id: 'case', import_key: 'C', normalized_ref: 'c', import_batch_id: null }];
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    for (const [amount, valid] of [['300000000000.0001', false], ['0.30000000000000004', false], ['1.2300', true], ['999999999999.99', true], ['1000000000000', false]]) {
      logs.length = 0; errors.length = 0; urls.length = 0;
      writeFileSync(file, `case_ref,type,title,terminal_status,total_value,vendor,date,amount\nC,Quotation,Case,Cancelled,,Missing,2026-01-01,${amount}\n`);
      await main(['--org-id', 'org', '--file', file, '--dry-run']);
      assert.equal(logs.some(line => /Quotation: created: 1, skipped: 0, failed: 0/.test(line)), valid, amount);
      assert.ok(!urls.some(item => decodeURIComponent(item.url).includes('provisional-vendor:')), amount);
      assert.ok(!urls.some(item => item.method === 'POST' && !item.url.includes('/rpc/')), amount);
    }
  } finally {
    globalThis.fetch = oldFetch; console.log = oldLog; console.error = oldError;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    rmSync(dir, { recursive: true, force: true });
  }
});
