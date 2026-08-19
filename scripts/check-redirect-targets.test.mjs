import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { auditRedirectTargets } from './check-redirect-targets.mjs';

async function fixture({ routes = ['/update-password', '/projects/:projectId/tasks'], functionSource, constants = '' }) {
  const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'redirect-targets-'));
  await mkdir(join(root, 'pmo-portal'), { recursive: true });
  await mkdir(join(root, 'supabase/functions/example'), { recursive: true });
  await writeFile(join(root, 'pmo-portal/App.tsx'), routes.map((path) => `{ path: '${path}', element: null },`).join('\n'));
  if (constants) await writeFile(join(root, 'supabase/functions/paths.ts'), constants);
  await writeFile(join(root, 'supabase/functions/example/index.ts'), functionSource);
  return root;
}

const clean = async (root) => rm(root, { recursive: true, force: true });

test('AC-RDR-001: accepts direct and one-hop static redirect targets that resolve to live router routes', async () => {
  const root = await fixture({
    functionSource: `import { UPDATE_PATH } from '../paths.ts';\nconst siteUrl = 'https://frontend.test';\nexport const x = { redirectTo: \`${'${siteUrl}'}/update-password\` };\nexport const y = { redirectTo: UPDATE_PATH };`,
    constants: "export const UPDATE_PATH = '/projects/:id/tasks';",
  });
  try { assert.deepEqual(auditRedirectTargets(root), []); } finally { await clean(root); }
});

test('AC-RDR-002: rejects an absent route and reports its function and path', async () => {
  const root = await fixture({ functionSource: "export const x = { redirectTo: '/missing-route' }; export const y = { headers: { Location: '/missing-header-route' } };" });
  try {
    const findings = auditRedirectTargets(root);
    assert.ok(findings.some((f) => f.message.includes('example') && f.message.includes('/missing-route')));
    assert.ok(findings.some((f) => f.message.includes('example') && f.message.includes('/missing-header-route')));
  } finally { await clean(root); }
});

test('AC-RDR-003: matches parameterised redirect targets against parameterised router patterns', async () => {
  const root = await fixture({ routes: ['/projects/:id/tasks'], functionSource: "export const x = { redirectTo: '/projects/actual/tasks' };" });
  try { assert.deepEqual(auditRedirectTargets(root), []); } finally { await clean(root); }
});

test('AC-RDR-004: rejects an unresolved redirect expression without a reasoned allowlist entry', async () => {
  const root = await fixture({ functionSource: "const value = getTarget(); export const x = { redirectTo: `/${value}` };" });
  try { assert.match(auditRedirectTargets(root)[0].message, /allowlist entry with a reason/i); } finally { await clean(root); }
});

test('AC-RDR-005: rejects stale allowlist entries', async () => {
  const root = await fixture({ functionSource: "const target = getTarget(); export const x = { redirectTo: target };" });
  const entry = { function: 'example', expression: 'target', path: '/update-password', reason: 'runtime configuration' };
  try {
    assert.deepEqual(auditRedirectTargets(root, [entry]), []);
    assert.match(auditRedirectTargets(root, [{ ...entry, function: 'gone' }])[0].message, /function.*gone|stale/i);
    assert.match(auditRedirectTargets(root, [{ ...entry, path: '/gone' }])[0].message, /route|stale/i);
    const noSink = await fixture({ functionSource: 'export const x = 1;' });
    try { assert.match(auditRedirectTargets(noSink, [entry])[0].message, /stale/i); } finally { await clean(noSink); }
  } finally { await clean(root); }
});

test('AC-RDR-006: --self-test proves known-good and known-bad fixture polarity', async () => {
  const { spawn } = await import('node:child_process');
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/check-redirect-targets.mjs', '--self-test'], { cwd: join(import.meta.dirname, '..') });
    let stdout = ''; child.stdout.on('data', (d) => { stdout += d; });
    child.on('close', (status) => resolve({ status, stdout }));
  });
  assert.equal(result.status, 0); assert.match(result.stdout, /known-good/); assert.match(result.stdout, /known-bad/);
});
