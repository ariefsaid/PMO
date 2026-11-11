// #1295 — served Deno tests for agent-dispatch (FR-AUC-002, FR-AUC-018, ADR-0044, ADR-0050, ADR-0052).
//
// Proves against the SHIPPED index.ts handler via Deno.serve capture:
//   1. Authenticated request reaches handler and a successful model call records exactly
//      one usage row through the real shared usage writer (recordTrustedUsage -> agent_usage).
//   2. Failed authentication boundary: missing or wrong secret returns 401 with no model call and 0 usage rows.
//   3. Model failure boundary: upstream model failure during fire records 0 usage rows.

function assert(cond: boolean, msg?: string): void {
  if (!cond) throw new Error(msg ?? 'assertion failed');
}

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error(msg ?? `Expected ${expected} but got ${actual}`);
  }
}

// Stub Deno.serve before dynamic import to capture the shipped served handler.
let servedHandler: ((req: Request) => Promise<Response>) | undefined;
(Deno as unknown as { serve: (h: (req: Request) => Promise<Response>) => unknown }).serve = (h) => {
  servedHandler = h;
  return { finished: Promise.resolve() };
};
await import('./index.ts');

const SUPABASE_URL = 'https://edge-test.supabase.test';
const DISPATCH_SECRET = 'synthetic-dispatch-secret';
const OWNER_UUID = '11111111-1111-4111-a111-111111111111';

interface RunOptions {
  modelFails?: boolean;
  modelStatus?: number;
  automationsFlag?: string;
}

interface RunResult {
  response: Response;
  body: Record<string, unknown>;
  calls: Array<{ path: string; method: string; body: string }>;
  usageRows: Array<Record<string, unknown>>;
}

async function runAgentDispatchServed(
  request: Request,
  opts: RunOptions = {},
): Promise<RunResult> {
  const envVars = {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key',
    SUPABASE_ANON_KEY: 'synthetic-anon-key',
    OPENROUTER_API_KEY: 'synthetic-openrouter-key',
    AGENT_DISPATCH_SECRET: DISPATCH_SECRET,
    AGENT_AUTOMATIONS: opts.automationsFlag ?? 'true',
    AGENT_VERIFY_ANSWER: 'false',
  };
  const prevEnv = Object.fromEntries(
    Object.keys(envVars).map((k) => [k, Deno.env.get(k)]),
  );
  for (const [k, v] of Object.entries(envVars)) Deno.env.set(k, v);

  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; method: string; body: string }> = [];
  const usageRows: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const body = method === 'GET' ? '' : await req.clone().text();
    calls.push({ path: url.pathname, method, body });

    // ── 1. Selection queries: agent_automations (schedule + trigger) ────────
    if (url.pathname === '/rest/v1/agent_automations') {
      const kind = url.searchParams.get('kind');
      if (kind === 'eq.schedule') {
        return new Response('[]', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (kind === 'eq.trigger') {
        return new Response(JSON.stringify([{
          id: 'automation-1',
          kind: 'trigger',
          owner_id: OWNER_UUID,
          org_id: 'org-test-1',
          prompt: 'Summarize updates',
          trigger_on: { source: 'procurement_status_events', event: 'Approved' },
          condition: null,
          enabled: true,
          archived_at: null,
          timeout_s: 60,
        }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      // last_fired_at update on trigger automation
      return new Response(JSON.stringify([{ id: 'automation-1' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Entitlement resolver: service_feature_enabled
    if (url.pathname === '/rest/v1/rpc/service_feature_enabled') {
      return Response.json(true);
    }

    // Watermark check
    if (url.pathname === '/rest/v1/agent_dispatch_watermarks') {
      if (method === 'GET') {
        return new Response('[]', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      // POST watermark advance
      return new Response(JSON.stringify([{ source: 'procurement_status_events' }]), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }

    // select_trigger_events RPC
    if (url.pathname === '/rest/v1/rpc/select_trigger_events') {
      return Response.json([{
        id: 'event-1',
        created_at: '2026-11-04T10:00:00Z',
        to_status: 'Approved',
        org_id: 'org-test-1',
      }]);
    }

    // ── 2. Claim query: agent_automation_fires ──────────────────────────────
    if (url.pathname === '/rest/v1/agent_automation_fires') {
      return new Response(JSON.stringify([{ id: 'fire-1' }]), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }

    // ── 3. Mint queries: admin.getUserById, generateLink, verifyOtp ─────────
    if (url.pathname === `/auth/v1/admin/users/${OWNER_UUID}`) {
      return Response.json({ user: { id: OWNER_UUID, email: 'owner@example.com' } });
    }
    if (url.pathname === '/auth/v1/admin/generate_link') {
      return Response.json({ hashed_token: 'valid-hashed-token', action_link: 'http://link' });
    }
    if (url.pathname === '/auth/v1/verify') {
      return Response.json({
        access_token: 'minted-owner-token',
        refresh_token: 'valid-refresh-token',
        expires_in: 3600,
        user: { id: OWNER_UUID, email: 'owner@example.com' },
      });
    }

    // ── 4. Audit queries: agent_threads, agent_runs, agent_events ───────────
    if (url.pathname === '/rest/v1/agent_threads') {
      return new Response(JSON.stringify({
        id: 'thread-1',
        owner_id: OWNER_UUID,
        org_id: 'org-test-1',
      }), {
        status: 201,
        headers: { 'content-type': 'application/vnd.pgrst.object+json' },
      });
    }

    if (url.pathname === '/rest/v1/agent_runs') {
      if (method === 'POST') {
        return new Response(JSON.stringify({
          id: 'run-1',
          owner_id: OWNER_UUID,
          org_id: 'org-test-1',
          thread_id: 'thread-1',
        }), {
          status: 201,
          headers: { 'content-type': 'application/vnd.pgrst.object+json' },
        });
      }
      if (method === 'GET') {
        return new Response(JSON.stringify({
          id: 'run-1',
          owner_id: OWNER_UUID,
          org_id: 'org-test-1',
          thread_id: 'thread-1',
        }), {
          status: 200,
          headers: { 'content-type': 'application/vnd.pgrst.object+json' },
        });
      }
      // PATCH run status update
      return new Response(JSON.stringify([{ id: 'run-1' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname === '/rest/v1/agent_events') {
      return new Response(JSON.stringify({ id: 'event-persisted-1' }), {
        status: 201,
        headers: { 'content-type': 'application/vnd.pgrst.object+json' },
      });
    }

    // ── 5. Handler deputy context: profiles, resolved_org_features ──────────
    if (url.pathname === '/rest/v1/profiles') {
      return new Response(JSON.stringify({
        org_id: 'org-test-1',
        role: 'owner',
      }), {
        status: 200,
        headers: { 'content-type': 'application/vnd.pgrst.object+json' },
      });
    }

    if (url.pathname === '/rest/v1/rpc/resolved_org_features') {
      return Response.json([{ feature_key: 'agent_assistant', enabled: true }]);
    }

    // ── 6. OpenRouter model call ────────────────────────────────────────────
    if (url.hostname === 'openrouter.ai' && url.pathname === '/api/v1/chat/completions') {
      if (opts.modelFails) {
        return new Response(JSON.stringify({ error: { message: 'upstream model unavailable' } }), {
          status: opts.modelStatus ?? 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        model: 'deepseek/deepseek-v4.1-flash-1017',
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'Updates summarized.' },
          },
        ],
        usage: {
          prompt_tokens: 80,
          completion_tokens: 20,
          total_tokens: 100,
          cost: 0.0001,
          total_cost: 0.0001,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // ── 7. Shared usage writer: agent_usage ─────────────────────────────────
    if (url.pathname === '/rest/v1/agent_usage') {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      usageRows.push(parsed);
      return new Response(JSON.stringify(parsed), {
        status: 201,
        headers: { 'content-type': 'application/vnd.pgrst.object+json' },
      });
    }

    // Telemetry / error events
    if (url.pathname === '/rest/v1/error_events') {
      return new Response(null, { status: 201 });
    }

    throw new Error(`unexpected fetch: ${method} ${url.href}`);
  }) as typeof fetch;

  try {
    if (!servedHandler) throw new Error('shipped agent-dispatch handler was not captured by Deno.serve');
    const response = await servedHandler(request);
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

Deno.test('AC-DISP-SERVED-001: authenticated agent-dispatch tick executes due automation and writes exactly one usage row', async () => {
  const request = new Request('http://edge.test/agent-dispatch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${DISPATCH_SECRET}` },
    body: '{}',
  });

  const { response, body, usageRows, calls } = await runAgentDispatchServed(request);

  assertEquals(response.status, 200);
  assertEquals(body.ok, true);

  // Model call was made to OpenRouter
  assert(
    calls.some((c) => c.path === '/api/v1/chat/completions'),
    'handler must invoke model on due automation fire',
  );

  // Exactly one usage row was written via the real shared usage writer
  assertEquals(usageRows.length, 1, 'must write exactly one agent_usage row');
  const usage = usageRows[0];
  assertEquals(usage.owner_id, OWNER_UUID);
  assertEquals(usage.org_id, 'org-test-1');
  assertEquals(usage.action, 'automation');
  assertEquals(usage.model, 'deepseek/deepseek-v4.1-flash-1017');
  assertEquals(usage.prompt_tokens, 80);
  assertEquals(usage.completion_tokens, 20);
  assertEquals(usage.cost, 0.0001);
});

Deno.test('AC-DISP-SERVED-002: missing or incorrect Authorization secret returns 401 with no model call and 0 usage rows', async () => {
  const request = new Request('http://edge.test/agent-dispatch', {
    method: 'POST',
    headers: { Authorization: 'Bearer wrong-secret' },
    body: '{}',
  });

  const { response, body, usageRows, calls } = await runAgentDispatchServed(request);

  assertEquals(response.status, 401);
  assertEquals(body.error, 'UNAUTHORIZED');
  assertEquals(calls.filter((c) => c.path === '/api/v1/chat/completions').length, 0);
  assertEquals(usageRows.length, 0, 'unauthorized tick must record 0 usage rows');
});

Deno.test('AC-DISP-SERVED-003: upstream model failure during fire records 0 usage rows and isolates failure', async () => {
  const request = new Request('http://edge.test/agent-dispatch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${DISPATCH_SECRET}` },
    body: '{}',
  });

  const { response, body, usageRows, calls } = await runAgentDispatchServed(request, { modelFails: true });

  // Dispatched tick isolates unit failure and finishes with 200 ok: true
  assertEquals(response.status, 200);
  assertEquals(body.ok, true);

  // Model was attempted
  assert(
    calls.some((c) => c.path === '/api/v1/chat/completions'),
    'handler attempted model call before upstream failure',
  );

  // 0 usage rows written because model call failed
  assertEquals(usageRows.length, 0, 'failed model call must record 0 usage rows');
});

Deno.test('AC-DISP-SERVED-004: AGENT_AUTOMATIONS off returns 200 skipped with no model call and 0 usage rows', async () => {
  const request = new Request('http://edge.test/agent-dispatch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${DISPATCH_SECRET}` },
    body: '{}',
  });

  const { response, body, usageRows, calls } = await runAgentDispatchServed(request, { automationsFlag: 'false' });

  assertEquals(response.status, 200);
  assertEquals(body.ok, true);
  assertEquals(body.skipped, 'flag off');
  assertEquals(calls.filter((c) => c.path === '/api/v1/chat/completions').length, 0);
  assertEquals(usageRows.length, 0, 'flag-off tick must record 0 usage rows');
});
