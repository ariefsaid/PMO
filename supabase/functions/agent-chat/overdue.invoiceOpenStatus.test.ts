// #2015 — the assistant's overdue invoice rule is the SHARED open-client-invoice rule (#1457).
//
// Drives the SHIPPED served handler (./index.ts) end-to-end with real JWT verification and a mocked
// wire (globalThis.fetch): the model is scripted to call whats_overdue, and the PostgREST mock is
// FAITHFUL to the status filter the shipped code requests — i.e. it applies `status=in.(...)` /
// `status=eq.X` exactly like PostgREST would. That makes the requested filter the shipped rule, so:
//   - a 'Submitted' (open, non-Unpaid) invoice past due IS counted overdue, and
//   - a 'Paid' invoice past due is NOT (the requested open set excludes it; it never reaches the
//     receipt, let alone the rendered answer),
//   - a 'Submitted' invoice NOT past due is NOT (the handler-side due-date rule still decides).
//
// Deno-native. Verify: scripts/deno-test-edge-fns.sh agent-chat
import { assertEquals } from 'jsr:@std/assert@1.0.0';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { OPEN_CLIENT_INVOICE_STATUSES } from '../../../pmo-portal/src/lib/revenue/clientInvoiceStatus.ts';
import type { AgentEvent } from '../../../pmo-portal/src/lib/agent/runtime/transport.ts';

const SUPABASE_URL = 'https://edge-test.supabase.test';
const ORG_ID = 'a9201500-0000-4000-8000-00000000a015';
const USER_ID = 'a9201500-0000-4000-8000-00000000b201';
const RUN_ID = 'a9201500-0000-4000-8000-00000000c515';
const THREAD_ID = 'a9201500-0000-4000-8000-00000000d0ca';

const { handleAgentChatRequest, setTestJwks } = await import('./index.ts');
const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = 'edge-test-key';
publicJwk.alg = 'ES256';
publicJwk.use = 'sig';
setTestJwks(createLocalJWKSet({ keys: [publicJwk] }));

/** UTC calendar day N days from now — the same anchoring the overdue helper uses (org day = UTC). */
const day = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const uuid = (tail: string): string => `a9201500-0000-4000-8000-${tail.padStart(12, '0')}`;

/** Seeded sales_invoices rows. The mock applies ONLY the requested wire filter to these. */
const INVOICE_ROWS = [
  {
    id: uuid('100000000001'), si_number: 'SI-2015-SUB', status: 'Submitted',
    invoice_date: day(-45), received_date: null, erp_due_date: day(-15), erp_outstanding_amount: 1500,
    currency: 'USD', tax_treatment: 'exclusive', project_id: null, paired_erp_invoice_id: null,
    companies: { name: 'Alpha Build Co', erp_payment_terms_days: null },
  },
  {
    id: uuid('100000000002'), si_number: 'SI-2015-PAID', status: 'Paid',
    invoice_date: day(-45), received_date: null, erp_due_date: day(-15), erp_outstanding_amount: 900,
    currency: 'USD', tax_treatment: 'exclusive', project_id: null, paired_erp_invoice_id: null,
    companies: { name: 'Paid Once Ltd', erp_payment_terms_days: null },
  },
  {
    id: uuid('100000000003'), si_number: 'SI-2015-FUT', status: 'Submitted',
    invoice_date: day(-5), received_date: null, erp_due_date: day(5), erp_outstanding_amount: 700,
    currency: 'USD', tax_treatment: 'exclusive', project_id: null, paired_erp_invoice_id: null,
    companies: { name: 'Future Terms Bv', erp_payment_terms_days: null },
  },
];

/** PostgREST-faithful `status` filter: `eq.V` keeps V; `in.(A,B)` keeps {A,B}; absent keeps all. */
function applyStatusFilter(rows: Array<Record<string, unknown>>, filter: string | null): Array<Record<string, unknown>> {
  if (!filter) return rows;
  const inMatch = /^in\.\((.*)\)$/.exec(filter);
  if (inMatch) {
    const allowed = new Set(inMatch[1].split(','));
    return rows.filter((row) => allowed.has(String(row.status)));
  }
  const eqMatch = /^eq\.(.+)$/.exec(filter);
  if (eqMatch) return rows.filter((row) => String(row.status) === eqMatch[1]);
  throw new Error(`mock: unsupported sales_invoices status filter: ${filter}`);
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
  /** The status filter string the shipped code requested on sales_invoices (null if it never read). */
  invoiceStatusFilter: string | null;
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
  let invoiceStatusFilter: string | null = null;
  let modelCalls = 0;
  const script: ModelScriptStep[] = [
    {
      finish_reason: 'tool_calls',
      content: null,
      tool_calls: [{ id: 'call-2015', type: 'function', function: { name: 'whats_overdue', arguments: '{}' } }],
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
        model: 'test-model-2015',
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
        return Response.json([]);
      case 'GET /rest/v1/sales_invoices': {
        invoiceStatusFilter = url.searchParams.get('status');
        return Response.json(applyStatusFilter(INVOICE_ROWS, invoiceStatusFilter));
      }
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
    return { events, invoiceStatusFilter };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value as string);
    }
  }
}

Deno.test('#2015 whats_overdue requests the SHARED open-client-invoice status set and counts a Submitted past-due invoice overdue (Paid never appears)', async () => {
  const { events, invoiceStatusFilter } = await drive();

  // The shipped code asked the wire for the shared open set (#1457) — not Unpaid only.
  assertEquals(
    invoiceStatusFilter,
    `in.(${OPEN_CLIENT_INVOICE_STATUSES.join(',')})`,
    'sales_invoices read must request OPEN_CLIENT_INVOICE_STATUSES (the shared #1457 rule), not Unpaid only',
  );

  const toolEvent = events.find((ev) => ev.type === 'tool' && (ev.payload as { name?: string } | undefined)?.name === 'whats_overdue');
  const payload = toolEvent?.payload as
    | { result?: { overdueInvoices?: number | null; invoices?: Array<{ siNumber?: string | null }> | null } }
    | undefined;
  assertEquals(toolEvent !== undefined, true, 'the run must dispatch whats_overdue and emit its tool event');
  assertEquals(payload?.result?.overdueInvoices, 1, 'exactly the Submitted past-due invoice counts as overdue');
  assertEquals(
    payload?.result?.invoices?.map((invoice) => invoice.siNumber),
    ['SI-2015-SUB'],
    'the overdue list holds the Submitted past-due invoice; the Paid and not-yet-due rows never appear',
  );

  const assistantTexts = events.filter((ev) => ev.type === 'assistant').map((ev) => ev.text ?? '');
  const rendered = assistantTexts.join('\n');
  assertEquals(rendered.includes('SI-2015-SUB'), true, 'the rendered overdue answer lists the Submitted past-due invoice');
  assertEquals(rendered.includes('SI-2015-PAID'), false, 'the rendered overdue answer never lists the Paid invoice');
  assertEquals(rendered.includes('SI-2015-FUT'), false, 'the rendered overdue answer never lists the not-yet-due invoice');

  const terminal = events.filter((ev) => ev.type === 'status').at(-1)?.payload as { status?: string } | undefined;
  assertEquals(terminal?.status, 'completed');
});
