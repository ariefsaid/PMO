// #2807 — a parent's own status and due date feed no figure: the assistant's "what's overdue" lists leaves only.
//
// Drives the SHIPPED served handler (./index.ts) end-to-end with real JWT verification and a mocked wire
// (globalThis.fetch). The tasks mock is FAITHFUL to every filter the shipped code requests: it applies each
// PostgREST operator exactly as PostgREST would, and the computed field task_counts_toward_progress as the
// database defines it (live, and no child that is neither archived nor deleted); an unknown filter throws.
// So the rule under test is the request the shipped code makes:
//   - a parent past its due date, stored "To Do", whose subtasks are all Done, is NOT overdue;
//   - a late leaf still is.
// The SQL side of the same leaf test is proved in supabase/tests/1971_task_leaf_readers.test.sql.
//
// Deno-native. Verify: scripts/deno-test-edge-fns.sh agent-chat
import { assertEquals } from 'jsr:@std/assert@1.0.0';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { AgentEvent } from '../../../pmo-portal/src/lib/agent/runtime/transport.ts';

const SUPABASE_URL = 'https://edge-test.supabase.test';
const ORG_ID = 'a9280700-0000-4000-8000-00000000a807';
const USER_ID = 'a9280700-0000-4000-8000-00000000b807';
const RUN_ID = 'a9280700-0000-4000-8000-00000000c807';
const THREAD_ID = 'a9280700-0000-4000-8000-00000000d807';
const PROJECT_ID = 'a9280700-0000-4000-8000-00000000e807';

const { handleAgentChatRequest, setTestJwks } = await import('./index.ts');
const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = 'edge-test-key';
publicJwk.alg = 'ES256';
publicJwk.use = 'sig';
setTestJwks(createLocalJWKSet({ keys: [publicJwk] }));

const day = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const uuid = (tail: string): string => `a9280700-0000-4000-8000-${tail.padStart(12, '0')}`;

type Row = Record<string, unknown>;
const task = (id: string, name: string, status: string, end: string, parent: string | null = null): Row => ({
  id: uuid(id), name, status, end_date: end, project_id: PROJECT_ID, assignee_id: null,
  parent_task_id: parent ? uuid(parent) : null, archived_at: null, tombstoned_at: null,
});
const TASK_ROWS: Row[] = [
  task('1', 'Foundations parent', 'To Do', day(-10)),          // its own date is past, its subtasks are all Done
  task('2', 'Excavate', 'Done', day(-12), '1'),
  task('3', 'Pour', 'Done', day(-11), '1'),
  task('4', 'Steel erection', 'In Progress', day(-3)),          // a late leaf
  task('5', 'Roofing', 'To Do', day(5)),                        // not due yet
];

/** The computed field as the database defines it (1971): live, and no live, not-deleted child. */
const countsTowardProgress = (row: Row, rows: Row[]): boolean =>
  row.archived_at === null && !rows.some((c) => c.parent_task_id === row.id && c.archived_at === null && c.tombstoned_at === null);

/** PostgREST-faithful filters for the operators the overdue read uses; anything else is a test failure. */
function applyTaskFilters(rows: Row[], params: URLSearchParams): Row[] {
  let out = rows;
  for (const [column, filter] of params) {
    if (['select', 'order', 'limit'].includes(column)) continue;
    const value = (row: Row) => (column === 'task_counts_toward_progress' ? countsTowardProgress(row, rows) : row[column]);
    let keep: (row: Row) => boolean;
    let m: RegExpExecArray | null;
    if ((m = /^in\.\((.*)\)$/.exec(filter))) { const set = new Set(m[1].split(',').map((v) => v.replace(/^"|"$/g, ''))); keep = (r) => set.has(String(value(r))); }
    else if ((m = /^lt\.(.+)$/.exec(filter))) { const bound = m[1]; keep = (r) => value(r) !== null && String(value(r)) < bound; }
    else if ((m = /^eq\.(.+)$/.exec(filter))) { const want = m[1]; keep = (r) => String(value(r)) === want; }
    else if (filter === 'is.null') keep = (r) => value(r) === null;
    else if (filter === 'is.true') keep = (r) => value(r) === true;
    else if (filter === 'is.false') keep = (r) => value(r) === false;
    else throw new Error(`mock: unsupported tasks filter ${column}=${filter}`);
    out = out.filter(keep);
  }
  return out;
}

async function token(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'edge-test-key' })
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setAudience('authenticated')
    .setSubject(USER_ID)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);
}

interface ModelScriptStep {
  finish_reason: string;
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

interface DriveResult {
  events: AgentEvent[];
  /** Every query string the shipped code sent to the tasks endpoint. */
  taskQueries: string[];
}

async function drive(): Promise<DriveResult> {
  const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'OPENROUTER_API_KEY', 'AGENT_PERSISTENCE', 'AGENT_VERIFY_ANSWER'];
  const previous = Object.fromEntries(names.map((name) => [name, Deno.env.get(name)]));
  Deno.env.set('SUPABASE_URL', SUPABASE_URL);
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key');
  Deno.env.set('SUPABASE_ANON_KEY', 'synthetic-anon-key');
  Deno.env.set('OPENROUTER_API_KEY', 'synthetic-model-key');
  Deno.env.set('AGENT_PERSISTENCE', 'false');
  Deno.env.set('AGENT_VERIFY_ANSWER', 'false');

  const originalFetch = globalThis.fetch;
  const taskQueries: string[] = [];
  let modelCalls = 0;
  const script: ModelScriptStep[] = [
    {
      finish_reason: 'tool_calls',
      content: null,
      tool_calls: [{ id: 'call-2807', type: 'function', function: { name: 'whats_overdue', arguments: '{}' } }],
    },
    { finish_reason: 'stop', content: 'Here is what is overdue.' },
  ];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    const body = request.method === 'GET' ? '' : await request.clone().text();
    if (route === 'POST /api/v1/chat/completions') {
      const step = script[modelCalls++];
      if (!step) throw new Error('mock: unexpected extra model call');
      return Response.json({
        model: 'test-model-2807',
        choices: [{ finish_reason: step.finish_reason, message: { role: 'assistant', content: step.content, ...(step.tool_calls ? { tool_calls: step.tool_calls } : {}) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    }
    switch (route) {
      case 'POST /rest/v1/rpc/rate_limit_hit':
        return Response.json(true); // TRUE = under the limit (fail-open guard's contract)
      case 'POST /rest/v1/rpc/service_feature_enabled': {
        const key = (JSON.parse(body) as { p_key: string }).p_key;
        return Response.json(key === 'agent_assistant');
      }
      case 'POST /rest/v1/rpc/resolved_org_features':
        return Response.json([
          { feature_key: 'agent_assistant', enabled: true },
          { feature_key: 'revenue', enabled: true },
        ]);
      case 'GET /rest/v1/profiles': {
        const select = url.searchParams.get('select') ?? '';
        if (select === 'org_id') return Response.json({ org_id: ORG_ID });
        if (select === 'org_id,role') return Response.json({ org_id: ORG_ID, role: 'Admin' });
        if (select === 'timezone') return Response.json({ timezone: 'UTC' });
        throw new Error(`mock: unexpected profiles select: ${select}`);
      }
      case 'GET /rest/v1/organizations':
        return Response.json({ default_timezone: 'UTC', default_locale: null, default_number_locale: null });
      case 'GET /rest/v1/tasks':
        taskQueries.push(url.searchParams.toString());
        return Response.json(applyTaskFilters(TASK_ROWS, url.searchParams));
      case 'GET /rest/v1/sales_invoices':
        return Response.json([]);
      case 'GET /rest/v1/projects':
        return Response.json([{ id: PROJECT_ID, name: 'Warehouse' }]);
      case 'GET /rest/v1/agent_runs':
        return Response.json({ id: RUN_ID, owner_id: USER_ID, org_id: ORG_ID, thread_id: THREAD_ID });
      case 'GET /rest/v1/agent_threads':
        return Response.json({ id: THREAD_ID, owner_id: USER_ID, org_id: ORG_ID });
      case 'POST /rest/v1/agent_usage':
      case 'POST /rest/v1/error_events':
        return new Response(null, { status: 201 });
      default:
        throw new Error(`mock: unexpected fetch ${route} (query: ${url.search})`);
    }
  }) as typeof fetch;

  try {
    const jwt = await token();
    const response = await handleAgentChatRequest(new Request('http://edge.test/agent-chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: RUN_ID,
        threadId: THREAD_ID,
        messages: [{ role: 'user', content: 'What is overdue?' }],
      }),
    }));
    assertEquals(response.status, 200);
    const text = await response.text();
    const events = text.split('\n\n').filter((frame) => frame.startsWith('data: ')).map((frame) => JSON.parse(frame.slice(6)) as AgentEvent);
    return { events, taskQueries };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value as string);
    }
  }
}

Deno.test('#2807 whats_overdue lists a late leaf and never a parent whose subtasks are all Done', async () => {
  const { events, taskQueries } = await drive();
  assertEquals(taskQueries.length > 0, true, 'the shipped overdue read queried tasks');
  assertEquals(taskQueries.every((q) => q.includes('task_counts_toward_progress=is.true')), true, 'every overdue task read asks for leaves only');

  const toolEvent = events.find((ev) => ev.type === 'tool' && (ev.payload as { name?: string } | undefined)?.name === 'whats_overdue');
  const result = (toolEvent?.payload as { result?: { overdueTasks?: number; tasks?: Array<{ name: string }> } } | undefined)?.result;
  assertEquals(result?.overdueTasks, 1, 'only the late leaf is overdue');
  assertEquals(result?.tasks?.map((t) => t.name), ['Steel erection']);

  const rendered = events.filter((ev) => ev.type === 'assistant').map((ev) => ev.text ?? '').join('\n');
  assertEquals(rendered.includes('Steel erection'), true, 'the rendered answer lists the late leaf');
  assertEquals(rendered.includes('Foundations parent'), false, 'the rendered answer never lists the parent');
});
