/**
 * pmo-org.test.mjs — tests for `pmo org add` and organization readiness (#2257, slice 2 of 2).
 *
 * Run: node --test scripts/pmo-org.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { run, writeCredentials } from './pmo.mjs';
import { classifyOrgReadiness, OPERATOR_ORG_RPCS } from './lib/pmo-org.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-org-test-'));
}

async function fakeServer(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, 'http://x');
    const parsedBody = body ? JSON.parse(body) : undefined;
    const rec = { method: req.method, path: url.pathname, search: url.search, body: parsedBody };
    requests.push(rec);

    const send = (status, json) => {
      if (res.headersSent) return true;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(json === undefined ? '' : JSON.stringify(json));
      return true;
    };

    if (handler) {
      await handler({ req, res, url, body: parsedBody, send, requests });
      if (res.headersSent) return;
    }

    send(404, { error: 'NOT_FOUND' });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}

async function runCli(argv, serverUrl) {
  const dir = tmpDir();
  writeCredentials({ PMO_CONFIG_DIR: dir }, serverUrl, {
    client_id: 'client-1',
    access_token: 'token-1',
    refresh_token: 'refresh-1',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'u1', email: 'operator@example.test' },
  });

  let out = '';
  let err = '';
  const code = await run([...argv, '--url', serverUrl], {
    env: { PMO_CONFIG_DIR: dir, PMO_SUPABASE_KEY: 'test-key' },
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
    stdin: (async function* () {})(),
  });

  fs.rmSync(dir, { recursive: true, force: true });
  return { code, out, err };
}

const REQUIRED_FLAGS = [
  '--name', 'Acme Corp',
  '--admin-email', 'admin@acme.test',
  '--admin-name', 'Alice Admin',
  '--currency', 'USD',
  '--locale', 'en-US',
  '--timezone', 'America/New_York',
  '--plan', 'pro',
];

// ── AC-ONB-012: Classifier truth table ──────────────────────────────────────────────────────────

test('AC-ONB-012: classifier truth table: healthy only when organization, plan, admin and stage config are all present', () => {
  // healthy case
  const healthyStatus = {
    exists: true,
    plan_id: 'pro',
    admins: { active: 1, pending: 0 },
    stage_config_count: 3,
  };
  const v1 = classifyOrgReadiness(healthyStatus);
  assert.equal(v1.healthy, true);
  assert.deepEqual(v1.failed, []);

  // pending admin also counts
  const pendingAdminStatus = {
    exists: true,
    plan_id: 'pro',
    admins: { active: 0, pending: 1 },
    stage_config_count: 1,
  };
  const v2 = classifyOrgReadiness(pendingAdminStatus);
  assert.equal(v2.healthy, true);
  assert.deepEqual(v2.failed, []);

  // missing organization (exists: false)
  const noOrg = { exists: false, plan_id: 'pro', admins: { active: 1, pending: 0 }, stage_config_count: 1 };
  const v3 = classifyOrgReadiness(noOrg);
  assert.equal(v3.healthy, false);
  assert.deepEqual(v3.failed, ['organization']);

  // missing plan (plan_id: null)
  const noPlan = { exists: true, plan_id: null, admins: { active: 1, pending: 0 }, stage_config_count: 1 };
  const v4 = classifyOrgReadiness(noPlan);
  assert.equal(v4.healthy, false);
  assert.deepEqual(v4.failed, ['plan']);

  // missing admin (both active and pending 0)
  const noAdmin = { exists: true, plan_id: 'pro', admins: { active: 0, pending: 0 }, stage_config_count: 1 };
  const v5 = classifyOrgReadiness(noAdmin);
  assert.equal(v5.healthy, false);
  assert.deepEqual(v5.failed, ['admin']);

  // missing stage config (stage_config_count: 0)
  const noStage = { exists: true, plan_id: 'pro', admins: { active: 1, pending: 0 }, stage_config_count: 0 };
  const v6 = classifyOrgReadiness(noStage);
  assert.equal(v6.healthy, false);
  assert.deepEqual(v6.failed, ['stage-config']);

  // all failed
  const allFailed = { exists: false, plan_id: null, admins: { active: 0, pending: 0 }, stage_config_count: 0 };
  const v7 = classifyOrgReadiness(allFailed);
  assert.equal(v7.healthy, false);
  assert.deepEqual(v7.failed, ['organization', 'plan', 'admin', 'stage-config']);
});

// ── AC-ONB-008: Dry run ──────────────────────────────────────────────────────────────────────────

test('AC-ONB-008: no --confirm → zero non-GET requests / zero function or RPC calls', async () => {
  const server = await fakeServer(async () => {
    assert.fail('Zero requests expected during dry run');
  });
  try {
    const res = await runCli(['org', 'add', ...REQUIRED_FLAGS], server.url);
    assert.equal(res.code, 0);
    assert.match(res.out, /Dry run\. Add --confirm to run\./);
    assert.match(res.out, /1\./);
    assert.match(res.out, /Acme Corp/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
  }
});

// ── AC-ONB-009: Missing required flags ────────────────────────────────────────────────────────────

test('AC-ONB-009: each missing required flag → refusal naming it', async () => {
  const flags = [
    { flag: '--name', val: 'Acme Corp' },
    { flag: '--admin-email', val: 'admin@acme.test' },
    { flag: '--admin-name', val: 'Alice Admin' },
    { flag: '--currency', val: 'USD' },
    { flag: '--locale', val: 'en-US' },
    { flag: '--timezone', val: 'America/New_York' },
    { flag: '--plan', val: 'pro' },
  ];

  const server = await fakeServer(() => {});
  try {
    for (const missing of flags) {
      const remainingArgs = flags
        .filter((f) => f.flag !== missing.flag)
        .flatMap((f) => [f.flag, f.val]);
      const res = await runCli(['org', 'add', ...remainingArgs, '--confirm'], server.url);
      assert.equal(res.code, 2, `Expected usage error (code 2) for missing ${missing.flag}`);
      const errOutput = res.err + res.out;
      assert.match(errOutput, new RegExp(missing.flag), `Error should name missing flag ${missing.flag}`);
      assert.equal(server.requests.length, 0, 'No requests should be sent when a required flag is missing');
    }
  } finally {
    await server.close();
  }
});

test('flag validation: invalid --state, --feature k=maybe, --feature =on, pmo org unknown → usage refusal, zero requests', async () => {
  const cases = [
    {
      name: 'invalid --state',
      args: ['org', 'add', ...REQUIRED_FLAGS, '--state', 'invalid'],
      match: /--state must be 'live', 'demo' or 'test'/,
    },
    {
      name: '--feature k=maybe',
      args: ['org', 'add', ...REQUIRED_FLAGS, '--feature', 'k=maybe'],
      match: /--feature value must be 'on' or 'off'/,
    },
    {
      name: '--feature =on',
      args: ['org', 'add', ...REQUIRED_FLAGS, '--feature', '=on'],
      match: /--feature must be <key>=on\|off/,
    },
    {
      name: 'pmo org unknown',
      args: ['org', 'unknown'],
      match: /Unknown org command 'unknown'/,
    },
  ];

  const server = await fakeServer(() => {});
  try {
    for (const c of cases) {
      server.requests.length = 0;
      const res = await runCli(c.args, server.url);
      assert.equal(res.code, 2, `${c.name}: expected exit code 2 (usage)`);
      const combined = res.err + res.out;
      assert.match(combined, c.match, `${c.name}: expected error output match`);
      assert.equal(server.requests.length, 0, `${c.name}: expected zero requests`);
    }
  } finally {
    await server.close();
  }
});

// ── AC-ONB-010: Confirmed healthy flow ─────────────────────────────────────────────────────────────

test('AC-ONB-010: healthy → lifecycle RPC called exactly once, AFTER the second status call (assert call order)', async () => {
  let statusCallCount = 0;
  const callSequence = [];

  const server = await fakeServer(async ({ url, body, send }) => {
    if (url.pathname === '/functions/v1/operator-org') {
      if (body.action === 'create') {
        callSequence.push('create');
        return send(200, { ok: true, org_id: 'org-uuid-1', created: true });
      }
      if (body.action === 'status') {
        statusCallCount++;
        callSequence.push(`status-${statusCallCount}`);
        if (statusCallCount === 1) {
          return send(200, {
            exists: true,
            name: 'Acme Corp',
            lifecycle_state: 'demo',
            plan_id: null, // trigger operator_set_org_plan
            admins: { active: 0, pending: 1 },
            stage_config_count: 1,
            features: [],
          });
        }
        return send(200, {
          exists: true,
          name: 'Acme Corp',
          lifecycle_state: 'demo',
          plan_id: 'pro',
          admins: { active: 1, pending: 0 },
          stage_config_count: 2,
          features: [{ key: 'equipment_tracking', enabled: true }],
        });
      }
    }
    if (url.pathname === '/rest/v1/rpc/operator_set_org_plan') {
      callSequence.push('set_plan');
      return send(200, null);
    }
    if (url.pathname === '/rest/v1/rpc/operator_toggle_feature') {
      callSequence.push(`toggle_feature:${body.p_key}=${body.p_enabled}`);
      return send(200, null);
    }
    if (url.pathname === '/rest/v1/rpc/operator_set_org_lifecycle_state') {
      callSequence.push(`lifecycle_state:${body.p_lifecycle_state}`);
      return send(200, null);
    }
  });

  try {
    const res = await runCli([
      'org', 'add',
      ...REQUIRED_FLAGS,
      '--feature', 'equipment_tracking=on',
      '--state', 'live',
      '--confirm',
    ], server.url);

    assert.equal(res.code, 0, `Command failed: ${res.err}`);
    assert.deepEqual(callSequence, [
      'create',
      'status-1',
      'set_plan',
      'toggle_feature:equipment_tracking=true',
      'status-2',
      'lifecycle_state:live',
    ]);
    assert.match(res.out, /created/i);
    assert.match(res.out, /org-uuid-1/);
    assert.match(res.out, /live/);
  } finally {
    await server.close();
  }
});

// ── AC-ONB-011: Unhealthy cases ──────────────────────────────────────────────────────────────────

test('AC-ONB-011: unhealthy (no plan after assignment failed) → lifecycle RPC never called, failed names printed, exit code non-zero', async () => {
  let statusCallCount = 0;
  const lifecycleCalls = [];
  const server = await fakeServer(async ({ url, body, send }) => {
    if (url.pathname === '/functions/v1/operator-org') {
      if (body.action === 'create') return send(200, { ok: true, org_id: 'org-uuid-2', created: true });
      if (body.action === 'status') {
        statusCallCount++;
        return send(200, {
          exists: true,
          lifecycle_state: 'demo',
          plan_id: null, // still null
          admins: { active: 1, pending: 0 },
          stage_config_count: 1,
          features: [],
        });
      }
    }
    if (url.pathname === '/rest/v1/rpc/operator_set_org_plan') {
      return send(200, null);
    }
    if (url.pathname === '/rest/v1/rpc/operator_set_org_lifecycle_state') {
      lifecycleCalls.push({ name: 'operator_set_org_lifecycle_state', url: url.pathname, body });
      return send(200, null);
    }
  });

  try {
    const res = await runCli(['org', 'add', ...REQUIRED_FLAGS, '--confirm'], server.url);
    assert.notEqual(res.code, 0);
    assert.deepEqual(lifecycleCalls, [], 'Lifecycle state RPC must never be called when unhealthy');
    const combined = res.out + res.err;
    assert.match(combined, /plan/);
  } finally {
    await server.close();
  }
});

test('AC-ONB-011: unhealthy (no Admin) → lifecycle RPC never called, failed names printed, exit code non-zero', async () => {
  const lifecycleCalls = [];
  const server = await fakeServer(async ({ url, body, send }) => {
    if (url.pathname === '/functions/v1/operator-org') {
      if (body.action === 'create') return send(200, { ok: true, org_id: 'org-uuid-3', created: true });
      if (body.action === 'status') {
        return send(200, {
          exists: true,
          lifecycle_state: 'demo',
          plan_id: 'pro',
          admins: { active: 0, pending: 0 }, // no admin
          stage_config_count: 1,
          features: [],
        });
      }
    }
    if (url.pathname === '/rest/v1/rpc/operator_set_org_lifecycle_state') {
      lifecycleCalls.push({ name: 'operator_set_org_lifecycle_state', url: url.pathname, body });
      return send(200, null);
    }
  });

  try {
    const res = await runCli(['org', 'add', ...REQUIRED_FLAGS, '--confirm'], server.url);
    assert.notEqual(res.code, 0);
    assert.deepEqual(lifecycleCalls, [], 'Lifecycle state RPC must never be called when unhealthy');
    const combined = res.out + res.err;
    assert.match(combined, /admin/);
  } finally {
    await server.close();
  }
});

test('AC-ONB-011: unhealthy (no stage config) → lifecycle RPC never called, failed names printed, exit code non-zero', async () => {
  const lifecycleCalls = [];
  const server = await fakeServer(async ({ url, body, send }) => {
    if (url.pathname === '/functions/v1/operator-org') {
      if (body.action === 'create') return send(200, { ok: true, org_id: 'org-uuid-4', created: true });
      if (body.action === 'status') {
        return send(200, {
          exists: true,
          lifecycle_state: 'demo',
          plan_id: 'pro',
          admins: { active: 1, pending: 0 },
          stage_config_count: 0, // no stage config
          features: [],
        });
      }
    }
    if (url.pathname === '/rest/v1/rpc/operator_set_org_lifecycle_state') {
      lifecycleCalls.push({ name: 'operator_set_org_lifecycle_state', url: url.pathname, body });
      return send(200, null);
    }
  });

  try {
    const res = await runCli(['org', 'add', ...REQUIRED_FLAGS, '--confirm'], server.url);
    assert.notEqual(res.code, 0);
    assert.deepEqual(lifecycleCalls, [], 'Lifecycle state RPC must never be called when unhealthy');
    const combined = res.out + res.err;
    assert.match(combined, /stage-config/);
  } finally {
    await server.close();
  }
});

// ── Re-run safety and plan conflict ──────────────────────────────────────────────────────────────

test('plus: re-run where everything is already done → no writes at all', async () => {
  let rpcCalls = 0;
  const server = await fakeServer(async ({ url, body, send }) => {
    if (url.pathname === '/functions/v1/operator-org') {
      if (body.action === 'create') {
        return send(200, { ok: true, org_id: 'org-uuid-done', created: false });
      }
      if (body.action === 'status') {
        return send(200, {
          exists: true,
          name: 'Acme Corp',
          lifecycle_state: 'live',
          plan_id: 'pro',
          admins: { active: 1, pending: 0 },
          stage_config_count: 2,
          features: [{ key: 'f1', enabled: true }],
        });
      }
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      rpcCalls++;
      return send(200, null);
    }
  });

  try {
    const res = await runCli([
      'org', 'add',
      ...REQUIRED_FLAGS,
      '--feature', 'f1=on',
      '--state', 'live',
      '--confirm',
    ], server.url);

    assert.equal(res.code, 0);
    assert.equal(rpcCalls, 0, 'No RPC writes should be made when everything is already configured');
    assert.match(res.out, /already exists/i);
    assert.match(res.out, /org-uuid-done/);
  } finally {
    await server.close();
  }
});

test('plus: plan differs → stops, no writes after', async () => {
  let writesAfter = 0;
  const server = await fakeServer(async ({ url, body, send }) => {
    if (url.pathname === '/functions/v1/operator-org') {
      if (body.action === 'create') {
        return send(200, { ok: true, org_id: 'org-uuid-conflict', created: false });
      }
      if (body.action === 'status') {
        return send(200, {
          exists: true,
          name: 'Acme Corp',
          lifecycle_state: 'demo',
          plan_id: 'enterprise', // differs from requested 'pro'
          admins: { active: 1, pending: 0 },
          stage_config_count: 2,
          features: [],
        });
      }
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      writesAfter++;
      return send(200, null);
    }
  });

  try {
    const res = await runCli(['org', 'add', ...REQUIRED_FLAGS, '--confirm'], server.url);
    assert.notEqual(res.code, 0);
    assert.equal(writesAfter, 0, 'Must not perform writes after plan mismatch');
    const combined = res.out + res.err;
    assert.match(combined, /enterprise/);
  } finally {
    await server.close();
  }
});

test('stop early when organization is missing: status says exists: false → zero RPC calls, non-zero exit', async () => {
  let rpcCalls = 0;
  const server = await fakeServer(async ({ url, body, send }) => {
    if (url.pathname === '/functions/v1/operator-org') {
      if (body.action === 'create') {
        return send(200, { ok: true, org_id: 'org-missing', created: true });
      }
      if (body.action === 'status') {
        return send(200, { exists: false });
      }
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      rpcCalls++;
      return send(200, null);
    }
  });

  try {
    const res = await runCli(['org', 'add', ...REQUIRED_FLAGS, '--confirm'], server.url);
    assert.notEqual(res.code, 0);
    assert.equal(rpcCalls, 0, 'Zero RPC calls must be made when organization is missing');
    const combined = res.out + res.err;
    assert.match(combined, /organization/);
  } finally {
    await server.close();
  }
});

// ── Function errors ──────────────────────────────────────────────────────────────────────────────

test('live cannot be changed: status2 shows lifecycle_state live and --state is test → fails with plain message and zero RPC writes', async () => {
  let lifecycleRpcCalls = 0;
  const server = await fakeServer(async ({ url, body, send }) => {
    if (url.pathname === '/functions/v1/operator-org') {
      if (body.action === 'create') {
        return send(200, { ok: true, org_id: 'org-live', created: false });
      }
      if (body.action === 'status') {
        return send(200, {
          exists: true,
          name: 'Acme Corp',
          lifecycle_state: 'live',
          plan_id: 'pro',
          admins: { active: 1, pending: 0 },
          stage_config_count: 1,
          features: [],
        });
      }
    }
    if (url.pathname === '/rest/v1/rpc/operator_set_org_lifecycle_state') {
      lifecycleRpcCalls++;
      return send(200, null);
    }
  });

  try {
    const res = await runCli(['org', 'add', ...REQUIRED_FLAGS, '--state', 'test', '--confirm'], server.url);
    assert.notEqual(res.code, 0);
    assert.equal(lifecycleRpcCalls, 0, 'Must make no lifecycle RPC call when org is already live');
    const combined = res.out + res.err;
    assert.match(combined, /This organization is live; its state cannot be changed\./);
  } finally {
    await server.close();
  }
});

test('function error: prints code and step in plain words and exits non-zero', async () => {
  const server = await fakeServer(async ({ url, body, send }) => {
    if (url.pathname === '/functions/v1/operator-org' && body.action === 'create') {
      return send(409, { error: 'ORG_NAME_TAKEN', step: 'operator_create_org', extra_server_field: 'leak' });
    }
  });

  try {
    const res = await runCli(['org', 'add', ...REQUIRED_FLAGS, '--confirm'], server.url);
    assert.notEqual(res.code, 0);
    const errLines = res.err.trim().split('\n');
    assert.equal(errLines.length, 1, 'Exactly one error line written to stderr');
    const parsed = JSON.parse(errLines[0]);
    assert.equal(parsed.error.code, 'ORG_NAME_TAKEN');
    assert.deepEqual(parsed.error.details, { error: 'ORG_NAME_TAKEN', step: 'operator_create_org' });
  } finally {
    await server.close();
  }
});

// ── Operator RPC allowlist ───────────────────────────────────────────────────────────────────────

test('operator RPCs are not available to `pmo rpc` directly', async () => {
  assert.ok(OPERATOR_ORG_RPCS.includes('operator_set_org_plan'));
  assert.ok(OPERATOR_ORG_RPCS.includes('operator_toggle_feature'));
  assert.ok(OPERATOR_ORG_RPCS.includes('operator_set_org_lifecycle_state'));

  const server = await fakeServer(() => {});
  try {
    for (const rpcName of OPERATOR_ORG_RPCS) {
      const res = await runCli(['rpc', rpcName, '{}'], server.url);
      assert.notEqual(res.code, 0);
      assert.match(res.err, new RegExp(rpcName));
      assert.equal(server.requests.length, 0);
    }
  } finally {
    await server.close();
  }
});
