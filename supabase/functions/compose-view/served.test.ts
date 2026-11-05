// #1295 — served Deno tests for compose-view (FR-AUC-002, FR-AUC-015, ADR-0050, ADR-0052).
//
// Proves against the SHIPPED index.ts handler:
//   1. Authenticated request reaches handler and a successful model call records exactly
//      one usage row through the real shared usage writer (recordTrustedUsage -> agent_usage).
//   2. Failed authentication boundary: missing or invalid JWT returns 401 with no model call and 0 usage rows.
//   3. Model failure boundary: upstream model failure returns 502 with 0 usage rows.

function assert(cond: boolean, msg?: string): void {
  if (!cond) throw new Error(msg ?? 'assertion failed');
}

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error(msg ?? `Expected ${expected} but got ${actual}`);
  }
}

import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';

// Stub Deno.serve before dynamic import (prevent server bind on import).
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { handleComposeViewRequest, setTestJwks } = await import('./index.ts');

const SUPABASE_URL = 'https://edge-test.supabase.test';
const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = 'edge-test-key';
publicJwk.alg = 'ES256';
publicJwk.use = 'sig';
setTestJwks(createLocalJWKSet({ keys: [publicJwk] }));

async function mintJwt(userId: string = 'test-user-1', expSeconds: number = 3600): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'edge-test-key' })
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setAudience('authenticated')
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + expSeconds)
    .sign(privateKey);
}

interface RunOptions {
  modelFails?: boolean;
  modelStatus?: number;
}

interface RunResult {
  response: Response;
  body: Record<string, unknown>;
  calls: Array<{ path: string; method: string; body: string }>;
  usageRows: Array<Record<string, unknown>>;
}

async function runComposeViewServed(
  request: Request,
  opts: RunOptions = {},
): Promise<RunResult> {
  const envVars = {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key',
    SUPABASE_ANON_KEY: 'synthetic-anon-key',
    OPENROUTER_API_KEY: 'synthetic-openrouter-key',
  };
  const prevEnv = Object.fromEntries(
    Object.keys(envVars).map((k) => [k, Deno.env.get(k)]),
  );
  for (const [k, v] of Object.entries(envVars)) Deno.env.set(k, v);

  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; method: string; body: string }> = [];
  const usageRows: Array<Record<string, unknown>> = [];

  const VALID_SPEC = {
    version: 1,
    panels: [
      {
        id: 'p1',
        primitive: 'KPITile',
        querySpec: {
          entity: 'projects',
          select: ['id'],
          aggregate: { fn: 'count', column: 'id', alias: 'count' },
        },
      },
    ],
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const body = method === 'GET' ? '' : await req.clone().text();
    calls.push({ path: url.pathname, method, body });

    // Request-rate throttle gate
    if (url.pathname === '/rest/v1/rpc/rate_limit_hit') {
      return Response.json(true);
    }

    // Profiles query (both callerClient and verifierClient use this)
    if (url.pathname === '/rest/v1/profiles') {
      return new Response(JSON.stringify({ org_id: 'org-test-1' }), {
        status: 200,
        headers: { 'content-type': 'application/vnd.pgrst.object+json' },
      });
    }

    // Feature entitlement check (user_views)
    if (url.pathname === '/rest/v1/rpc/service_feature_enabled') {
      return Response.json(true);
    }

    // OpenRouter chat completions endpoint
    if (url.hostname === 'openrouter.ai' && url.pathname === '/api/v1/chat/completions') {
      if (opts.modelFails) {
        return new Response(JSON.stringify({ error: { message: 'upstream model unavailable' } }), {
          status: opts.modelStatus ?? 502,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        model: 'deepseek/deepseek-v4.1-flash-1017',
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: {
                    name: 'compose_view',
                    arguments: JSON.stringify(VALID_SPEC),
                  },
                },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 110,
          completion_tokens: 40,
          total_tokens: 150,
          cost: 0.0003,
          total_cost: 0.0003,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Shared usage writer: agent_usage insert
    if (url.pathname === '/rest/v1/agent_usage') {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      usageRows.push(parsed);
      return new Response(JSON.stringify(parsed), {
        status: 201,
        headers: { 'content-type': 'application/vnd.pgrst.object+json' },
      });
    }

    // Error events telemetry
    if (url.pathname === '/rest/v1/error_events') {
      return new Response(null, { status: 201 });
    }

    throw new Error(`unexpected fetch: ${method} ${url.href}`);
  }) as typeof fetch;

  try {
    const response = await handleComposeViewRequest(request);
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      // Non-JSON response
    }
    return { response, body, calls, usageRows };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v as string);
    }
  }
}

Deno.test('AC-CV-SERVED-001: authenticated compose-view request executes model call and writes exactly one usage row', async () => {
  const jwt = await mintJwt('test-user-1');
  const request = new Request('http://edge.test/compose-view', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt: 'show active projects', orgId: 'org-test-1' }),
  });

  const { response, body, usageRows, calls } = await runComposeViewServed(request);

  assertEquals(response.status, 200);
  assert(body.spec !== undefined, 'response body must include compiled spec');
  assertEquals(body.repairAttempts, 0);
  assertEquals(body.tokensUsed, 150);

  // Model call was made to OpenRouter
  assert(
    calls.some((c) => c.path === '/api/v1/chat/completions'),
    'handler must call upstream model',
  );

  // Exactly one usage row was written via the shared usage writer
  assertEquals(usageRows.length, 1, 'must write exactly one agent_usage row');
  const usage = usageRows[0];
  assertEquals(usage.owner_id, 'test-user-1');
  assertEquals(usage.org_id, 'org-test-1');
  assertEquals(usage.action, 'compose');
  assertEquals(usage.model, 'deepseek/deepseek-v4.1-flash-1017');
  assertEquals(usage.completion_tokens, 150);
  assertEquals(usage.cost, 0.0003);
});

Deno.test('AC-CV-SERVED-002: missing Authorization header returns 401 with no model call and 0 usage rows', async () => {
  const request = new Request('http://edge.test/compose-view', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'show active projects', orgId: 'org-test-1' }),
  });

  const { response, body, usageRows, calls } = await runComposeViewServed(request);

  assertEquals(response.status, 401);
  assertEquals(body.error, 'UNAUTHORIZED');
  assertEquals(calls.filter((c) => c.path === '/api/v1/chat/completions').length, 0);
  assertEquals(usageRows.length, 0, 'unauthorized request must record 0 usage rows');
});

Deno.test('AC-CV-SERVED-003: invalid JWT returns 401 with no model call and 0 usage rows', async () => {
  const request = new Request('http://edge.test/compose-view', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer invalid.bogus.jwt',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt: 'show active projects', orgId: 'org-test-1' }),
  });

  const { response, body, usageRows, calls } = await runComposeViewServed(request);

  assertEquals(response.status, 401);
  assertEquals(body.error, 'UNAUTHORIZED');
  assertEquals(calls.filter((c) => c.path === '/api/v1/chat/completions').length, 0);
  assertEquals(usageRows.length, 0, 'invalid JWT request must record 0 usage rows');
});

Deno.test('AC-CV-SERVED-004: upstream model failure returns 502 with 0 usage rows', async () => {
  const jwt = await mintJwt('test-user-1');
  const request = new Request('http://edge.test/compose-view', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt: 'show active projects', orgId: 'org-test-1' }),
  });

  const { response, body, usageRows } = await runComposeViewServed(request, { modelFails: true });

  assertEquals(response.status, 502);
  assertEquals(body.error, 'UPSTREAM_ERROR');
  assertEquals(usageRows.length, 0, 'failed model call must record 0 usage rows');
});
