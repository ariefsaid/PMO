/**
 * pmo-documents.test.mjs — `pmo documents create|upload` (#1857): a preview-first document register entry and a private
 * file upload, by the same rules the app's register uses. Fake Supabase served by node:http.
 *
 * Run:  node --test scripts/pmo-documents.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { run, writeCredentials } from './pmo.mjs';
import { ALLOWED_EXTENSIONS, DENIED_EXTENSIONS, MAX_FILE_BYTES, sanitizeFilename, storagePath } from './lib/pmo-documents.mjs';

const ORG = '18570000-0000-0000-0000-00000000000a';
const PROJECT = '18570000-0000-0000-0000-0000000000d1';
const DOC = '18570000-0000-0000-0000-0000000000e1';
const USER = '18570000-0000-0000-0000-0000000000a3';
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

async function fake(handlers = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://localhost');
    const json = /json/.test(req.headers['content-type'] ?? '') && raw.length ? JSON.parse(raw.toString('utf8')) : undefined;
    requests.push({ method: req.method, path: url.pathname, search: url.search, headers: req.headers, raw, body: json });
    const answer = handlers[`${req.method} ${url.pathname}`];
    const [status, body] = typeof answer === 'function' ? answer(url) : answer ?? [404, { message: `unexpected ${req.method} ${url.pathname}` }];
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => server.close(r)) };
}

async function cli(argv, server) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-doc-'));
  writeCredentials({ PMO_CONFIG_DIR: dir }, server.url, {
    client_id: 'c', access_token: 'a', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: USER, email: 'a@example.test' },
  });
  let out = ''; let err = '';
  const code = await run([...argv, '--url', server.url], {
    env: { PMO_CONFIG_DIR: dir, PMO_SUPABASE_KEY: 'k' },
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
    stdin: (async function* () {})(),
  });
  fs.rmSync(dir, { recursive: true, force: true });
  let json = null; try { json = JSON.parse(out); } catch { /* text */ }
  let error = null; try { error = JSON.parse(err.trim().split('\n').pop()).error; } catch { /* none */ }
  return { code, json, error, out, err };
}

function tmpFile(name, bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-doc-file-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
}

const PROJECT_FOUND = [200, [{ id: PROJECT, name: 'DOC project', code: 'DOC-1857' }]];
const draft = (over = {}) => [200, [{ id: DOC, org_id: ORG, project_id: PROJECT, status: 'Draft', source: null, file_path: null, title: 'Method statement', ...over }]];
const writes = (s) => s.requests.filter((r) => r.method !== 'GET');

test('AC-DOC-CLI-010 documents create without --confirm previews the entry and writes nothing', async () => {
  const s = await fake({ 'GET /rest/v1/projects': PROJECT_FOUND });
  try {
    const r = await cli(['documents', 'create', '--project', PROJECT, '--category', 'Method Statement', '--title', ' Lifting plan ', '--code', 'MS-01', '--revision', 'A', '--date', '2026-11-10'], s);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json, {
      dry_run: true,
      project: { id: PROJECT, name: 'DOC project', code: 'DOC-1857' },
      document: { project_id: PROJECT, category: 'Method Statement', title: 'Lifting plan', code: 'MS-01', revision: 'A', doc_date: '2026-11-10', status: 'Draft' },
      file: null,
      next: 'Pass --confirm to create this entry.',
    });
    assert.deepEqual(writes(s), []);
  } finally { await s.close(); }
});

test('AC-DOC-CLI-011 documents create --confirm posts one register row, stamped with the signed-in author', async () => {
  const s = await fake({
    'GET /rest/v1/projects': PROJECT_FOUND,
    'POST /rest/v1/project_documents': [201, [{ id: DOC, project_id: PROJECT, status: 'Draft', title: 'Lifting plan' }]],
  });
  try {
    const r = await cli(['documents', 'create', '--project', PROJECT, '--category', 'Method Statement', '--title', 'Lifting plan', '--confirm'], s);
    assert.equal(r.code, 0, r.err);
    const post = s.requests.find((q) => q.method === 'POST');
    assert.equal(post.path, '/rest/v1/project_documents');
    assert.equal(post.headers.prefer, 'return=representation');
    assert.deepEqual(post.body, { project_id: PROJECT, category: 'Method Statement', title: 'Lifting plan', code: null, revision: null, doc_date: null, author_id: USER });
    assert.equal(Object.hasOwn(post.body, 'org_id'), false, 'org_id is never sent; the server stamps it');
    assert.equal(Object.hasOwn(post.body, 'status'), false, 'status is never sent; entries start as Draft');
    assert.deepEqual(r.json, { dry_run: false, document: { id: DOC, project_id: PROJECT, status: 'Draft', title: 'Lifting plan' }, file: null });
  } finally { await s.close(); }
});

test('AC-DOC-CLI-012 documents create refuses bad input before any request', async () => {
  const s = await fake({});
  try {
    for (const [argv, why] of [
      [['--category', 'X', '--title', 'T'], 'project missing'],
      [['--project', 'nope', '--category', 'X', '--title', 'T'], 'project not a uuid'],
      [['--project', PROJECT, '--title', 'T'], 'category missing'],
      [['--project', PROJECT, '--category', 'X', '--title', '  '], 'title blank'],
      [['--project', PROJECT, '--category', 'X', '--title', 'T', '--date', '2026-02-30'], 'impossible date'],
      [['--project', PROJECT, '--category', 'X', '--title', 'T', '--file', '/no/such/file.pdf'], 'missing file'],
      [['--project', PROJECT, '--category', 'X', '--title', 'T', '--file', tmpFile('tool.exe', 'x')], 'denied type'],
    ]) {
      const r = await cli(['documents', 'create', ...argv, '--confirm'], s);
      assert.equal(r.code, 2, `${why}: ${r.err}`);
    }
    assert.deepEqual(s.requests, []);
  } finally { await s.close(); }
});

test('AC-DOC-CLI-012 documents create reports a project the caller cannot see and writes nothing', async () => {
  const s = await fake({ 'GET /rest/v1/projects': [200, []] });
  try {
    const r = await cli(['documents', 'create', '--project', PROJECT, '--category', 'X', '--title', 'T', '--confirm'], s);
    assert.equal(r.code, 1);
    assert.equal(r.error.code, 'project_not_found');
    assert.deepEqual(writes(s), []);
  } finally { await s.close(); }
});

test('AC-DOC-CLI-013 documents upload without --confirm previews the storage path and writes nothing', async () => {
  const file = tmpFile('Lifting Plan_rev A.pdf', Buffer.from('%PDF-1.4 test'));
  const s = await fake({ 'GET /rest/v1/project_documents': draft() });
  try {
    const r = await cli(['documents', 'upload', DOC, file], s);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json, {
      dry_run: true,
      document: { id: DOC, title: 'Method statement', status: 'Draft' },
      file: { name: 'Lifting Plan_rev A.pdf', bytes: 13, content_type: 'application/pdf', path: `${ORG}/${PROJECT}/${DOC}/lifting-plan-rev-a.pdf`, replaces: null },
      next: 'Pass --confirm to upload this file.',
    });
    assert.deepEqual(writes(s), []);
  } finally { await s.close(); }
});

test('AC-DOC-CLI-014 documents upload --confirm stores the file, then records it on the entry, then removes the replaced file', async () => {
  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]);
  const file = tmpFile('plan.PDF', bytes);
  const old = `${ORG}/${PROJECT}/${DOC}/old.pdf`;
  const want = `${ORG}/${PROJECT}/${DOC}/plan.pdf`;
  const s = await fake({
    'GET /rest/v1/project_documents': draft({ source: 'upload', file_path: old }),
    [`POST /storage/v1/object/project-documents/${want}`]: [200, { Key: `project-documents/${want}` }],
    'PATCH /rest/v1/project_documents': [200, [{ id: DOC }]],
    'DELETE /storage/v1/object/project-documents': [200, [{ name: old }]],
  });
  try {
    const r = await cli(['documents', 'upload', DOC, file, '--confirm'], s);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(writes(s).map((q) => `${q.method} ${q.path}`), [
      `POST /storage/v1/object/project-documents/${want}`,
      'PATCH /rest/v1/project_documents',
      'DELETE /storage/v1/object/project-documents',
    ]);
    const [put, patch, del] = writes(s);
    assert.equal(put.headers['content-type'], 'application/pdf');
    assert.equal(put.headers.authorization, 'Bearer a');
    assert.equal(put.headers['x-upsert'], 'false');
    assert.deepEqual([...put.raw], [...bytes], 'the bytes arrive unchanged');
    assert.equal(patch.search, `?id=eq.${DOC}`);
    assert.deepEqual(patch.body, { file_path: want, source: 'upload' });
    assert.deepEqual(del.body, { prefixes: [old] });
    assert.deepEqual(r.json, { dry_run: false, document: { id: DOC, title: 'Method statement', status: 'Draft' }, file: { path: want, bytes: 7, replaced: old } });
  } finally { await s.close(); }
});

test('AC-DOC-CLI-015 documents upload refuses a non-Draft entry, a Microsoft-linked entry and an unseen entry before storing anything', async () => {
  const file = tmpFile('plan.pdf', 'x');
  for (const [row, code] of [[draft({ status: 'Issued' }), 'document_not_draft'], [draft({ source: 'onedrive' }), 'document_has_microsoft_reference'], [[200, []], 'document_not_found']]) {
    const s = await fake({ 'GET /rest/v1/project_documents': row });
    try {
      const r = await cli(['documents', 'upload', DOC, file, '--confirm'], s);
      assert.equal(r.code, 1, r.err);
      assert.equal(r.error.code, code);
      assert.deepEqual(writes(s), []);
    } finally { await s.close(); }
  }
});

test('AC-DOC-CLI-015 documents upload refuses a disallowed or oversized file before any request', async () => {
  const s = await fake({});
  try {
    for (const f of [tmpFile('run.sh', 'x'), tmpFile('notes.md', 'x'), tmpFile('big.pdf', Buffer.alloc(MAX_FILE_BYTES + 1))]) {
      const r = await cli(['documents', 'upload', DOC, f, '--confirm'], s);
      assert.equal(r.code, 2, r.err);
    }
    const r = await cli(['documents', 'upload', 'not-a-uuid', tmpFile('a.pdf', 'x')], s);
    assert.equal(r.code, 2);
    assert.deepEqual(s.requests, []);
  } finally { await s.close(); }
});

test('AC-DOC-CLI-016 documents upload reports a record step that landed on no row, after the file was stored', async () => {
  const file = tmpFile('plan.pdf', 'x');
  const want = `${ORG}/${PROJECT}/${DOC}/plan.pdf`;
  const s = await fake({
    'GET /rest/v1/project_documents': draft(),
    [`POST /storage/v1/object/project-documents/${want}`]: [200, { Key: want }],
    'PATCH /rest/v1/project_documents': [200, []],
  });
  try {
    const r = await cli(['documents', 'upload', DOC, file, '--confirm'], s);
    assert.equal(r.code, 1);
    assert.equal(r.error.code, 'document_not_updated');
    assert.equal(writes(s).some((q) => q.method === 'DELETE'), false, 'nothing is removed when the entry was not updated');
  } finally { await s.close(); }
});

test('AC-DOC-CLI-017 documents create --file --confirm creates the entry and uploads the file to it', async () => {
  const file = tmpFile('drawing.dwg', 'dwg');
  const want = `${ORG}/${PROJECT}/${DOC}/drawing.dwg`;
  const s = await fake({
    'GET /rest/v1/projects': PROJECT_FOUND,
    'POST /rest/v1/project_documents': [201, [{ id: DOC, project_id: PROJECT, status: 'Draft', title: 'GA drawing' }]],
    'GET /rest/v1/project_documents': draft({ title: 'GA drawing' }),
    [`POST /storage/v1/object/project-documents/${want}`]: [200, { Key: want }],
    'PATCH /rest/v1/project_documents': [200, [{ id: DOC }]],
  });
  try {
    const r = await cli(['documents', 'create', '--project', PROJECT, '--category', 'Drawing', '--title', 'GA drawing', '--file', file, '--confirm'], s);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(writes(s).map((q) => `${q.method} ${q.path}`), ['POST /rest/v1/project_documents', `POST /storage/v1/object/project-documents/${want}`, 'PATCH /rest/v1/project_documents']);
    assert.equal(writes(s)[1].headers['content-type'], 'application/acad');
    assert.deepEqual(r.json.file, { path: want, bytes: 3, replaced: null });
  } finally { await s.close(); }
});

test('AC-DOC-CLI-018 the CLI file rules and storage key match the app', () => {
  const src = fs.readFileSync(path.join(root, 'pmo-portal/src/lib/fileConstants.ts'), 'utf8');
  const list = (name) => [...src.match(new RegExp(`${name}[^=]*=\\s*\\[([^\\]]*)\\]`))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual([...ALLOWED_EXTENSIONS].sort(), list('ALLOWED_FILE_TYPES'));
  assert.deepEqual([...DENIED_EXTENSIONS].sort(), list('DENIED_EXTENSIONS'));
  assert.equal(MAX_FILE_BYTES, 5 * 1024 * 1024);
  assert.match(src, /MAX_FILE_SIZE_BYTES = 5 \* 1024 \* 1024/);
  // the same cases the app's storageKey tests pin
  assert.equal(sanitizeFilename('My Report_v2.PDF'), 'my-report-v2.pdf');
  assert.equal(sanitizeFilename('../../etc/passwd'), 'etcpasswd');
  assert.equal(sanitizeFilename('---'), 'file');
  assert.equal(sanitizeFilename('a  --  b.txt'), 'a-b.txt');
  assert.equal(storagePath(ORG, PROJECT, DOC, 'A B.pdf'), `${ORG}/${PROJECT}/${DOC}/a-b.pdf`);
});
