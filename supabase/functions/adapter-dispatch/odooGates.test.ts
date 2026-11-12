// #1505 O2 P2 (AC-OPP-054 gate half, AC-OPP-061, AC-OPP-064 D half, FR-OPP-004/060/061, DD-OPP-1, DD-OPP-8): every dispatch gate
// refuses a procurement command for an org that employs procurement under tier `odoo` exactly as it does for ERPNext: the
// same status, the same wording, no outbox row and no ERP request. The gates are keyed on the command's PMO shape, not on the
// tier name, so each case runs the SAME command twice (once per tier) through the SHIPPED handler (`./index.ts`, fetch mocked)
// and compares the two answers.
//
// Every route below is a FACT about the world the handler reads; `unexpected` names any read not mocked (add a route that
// answers it as a fact; never loosen an assertion).
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import {
  createJwtAuthority,
  createTestJwksResolver,
  installEdgeEnv,
  jsonResponse,
  supabaseRpc,
  supabaseSelect,
  withFetchMock,
  type FetchCall,
  type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const auth = await createJwtAuthority(env.SUPABASE_URL);

let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = (h: unknown) => {
  servedHandler = h as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));
addEventListener('unload', () => env.restore());

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const APPROVER_ID = '22222222-2222-4222-8222-222222222222';
const PAYER_ID = '66666666-6666-4666-8666-666666666666';
const PROC_ID = '33333333-3333-4333-8333-333333333333';
const INV_ID = '55555555-5555-4555-8555-555555555555';
const VENDOR_ID = '44444444-4444-4444-8444-444444444444';
const ODOO_HOST = 'odoo.example.test';
const SNAPSHOT = {
  later: { 'purchase.order': true, 'purchase.order.line': true, 'stock.picking': true, 'stock.move': true, 'account.move': true, 'account.payment': true },
  models: { 'account.journal': { exists: true, read: true } },
};

type Tier = 'odoo' | 'erpnext';
interface World {
  /** Which tier(s) own `procurement` for the org. */
  owns?: Tier[];
  role?: string;
  caseRow?: Record<string, unknown> | null;
  gateViolation?: string | null;
  paymentAllowed?: string | null;
  ceilingOk?: boolean;
  amountApproverId?: string | null;
  poRevise?: string | null;
  snapshot?: unknown;
  /** The Odoo cost account the case's project is linked to (null: unlinked) and what the mirror says about it. */
  projectLink?: string | null;
  account?: { active: boolean; tombstoned_at: string | null } | null;
  odooBinding?: Record<string, unknown> | null;
  /** Tables whose linked row belongs to another organisation. */
  foreign?: Array<'procurements' | 'procurement_invoices' | 'companies'>;
}
const OTHER_ORG_ID = '99999999-9999-4999-8999-999999999999';

const objectResponse = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const nullObjectResponse = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const param = (call: FetchCall, key: string): string | null => {
  const raw = call.url.searchParams.get(key);
  return raw?.startsWith('eq.') ? decodeURIComponent(raw.slice(3)) : raw;
};

const paymentCommand = () => ({
  domain: 'procurement', operation: 'create', idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-000000001505',
  record: { id: 'dddddddd-dddd-4ddd-8ddd-000000001505', erp_doc_kind: 'payment', procurementId: PROC_ID, invoiceId: INV_ID, supplier: VENDOR_ID, paid_amount: 98000, date: '2026-11-03' },
});
const orderCommand = () => ({
  domain: 'procurement', operation: 'create', idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-000000001506',
  record: { id: 'dddddddd-dddd-4ddd-8ddd-000000001506', erp_doc_kind: 'purchase-order', procurementId: PROC_ID },
});
const billCommand = () => ({
  domain: 'procurement', operation: 'create', idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-000000001508',
  record: { id: 'dddddddd-dddd-4ddd-8ddd-000000001508', erp_doc_kind: 'purchase-invoice', procurementId: PROC_ID, referenceNumber: 'INV-1', invoiceDate: '2026-11-03' },
});
const reviseCommand = () => ({
  domain: 'procurement', operation: 'revise', idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-000000001507',
  record: { id: 'dddddddd-dddd-4ddd-8ddd-000000001507', erp_doc_kind: 'purchase-order', poId: 'eeeeeeee-eeee-4eee-8eee-000000001507', revision: 2 },
});

function routes(unexpected: FetchCall[], caller: string, world: World): MockRoute[] {
  const owns = world.owns ?? ['odoo'];
  const outbox = new Map<string, Record<string, unknown>>();
  return [
    supabaseSelect('profiles', (call) => call.url.searchParams.has('role') ? jsonResponse([{ id: caller }]) : objectResponse({ org_id: ORG_ID })),
    supabaseRpc('domain_owned_by_tier', (call) => jsonResponse(owns.includes((call.bodyJson as { p_tier: Tier }).p_tier))),
    supabaseRpc('org_has_active_erpnext_binding', () => jsonResponse(owns.includes('erpnext'))),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: world.role ?? 'Finance', active: true })),
    supabaseRpc('pre_cutover_procurement', () => jsonResponse(false)),
    supabaseRpc('linked_step_state', () => jsonResponse('not_applicable')),
    supabaseRpc('procurement_gate_violation', () => jsonResponse(world.gateViolation ?? null)),
    supabaseRpc('procurement_payment_allowed', () => jsonResponse(world.paymentAllowed ?? null)),
    supabaseRpc('procurement_payment_within_ceiling', () => jsonResponse([{
      ok: world.ceilingOk ?? true, reason: world.ceilingOk === false ? 'vendor bill exceeds approved amount' : null, billed_net: 98000, approved_amount: 100000,
    }])),
    supabaseRpc('po_revision_push_refusal', () => jsonResponse(world.poRevise ?? null)),
    supabaseRpc('read_vault_secret', () => jsonResponse('odoo-test-key')),
    supabaseSelect('external_org_bindings', (call) => param(call, 'external_tier') === 'odoo'
      ? (world.odooBinding === null ? nullObjectResponse() : objectResponse({
          id: 'b0000000-0000-4000-8000-000000000001', site_url: `https://${ODOO_HOST}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z',
          config: { database: 'db1', odoo_company_id: 1, capabilities: world.snapshot === undefined ? SNAPSHOT : world.snapshot },
          ...world.odooBinding,
        }))
      : nullObjectResponse()),
    supabaseSelect('organizations', () => objectResponse({ default_currency: 'IDR' })),
    // Honours the org_id filter like PostgREST: a row of another tenant is not returned to an org-scoped read.
    supabaseSelect('procurements', (call) => {
      if (world.caseRow === null) return nullObjectResponse();
      const row = {
        id: PROC_ID, org_id: ORG_ID, status: 'Vendor Invoiced', approved_by_id: APPROVER_ID, amount_approved_by_id: world.amountApproverId ?? null,
        approved_total_value: 100000, vendor_id: VENDOR_ID, ...(world.foreign?.includes('procurements') ? { org_id: OTHER_ORG_ID } : {}), ...world.caseRow,
      };
      const scope = param(call, 'org_id');
      return scope !== null && scope !== row.org_id ? nullObjectResponse() : objectResponse(row);
    }),
    supabaseSelect('procurement_invoices', () => objectResponse({ org_id: world.foreign?.includes('procurement_invoices') ? OTHER_ORG_ID : ORG_ID })),
    supabaseSelect('companies', () => objectResponse({ org_id: world.foreign?.includes('companies') ? OTHER_ORG_ID : ORG_ID })),
    supabaseSelect('external_project_bindings', () => world.projectLink ? objectResponse({ external_container_id: world.projectLink }) : nullObjectResponse()),
    supabaseSelect('external_master_records', () => world.account === null ? nullObjectResponse() : objectResponse(world.account ?? { active: true, tombstoned_at: null })),
    supabaseSelect('external_refs', () => nullObjectResponse()),
    { label: 'outbox read', method: 'GET', pathname: '/rest/v1/external_command_outbox', response: (call) => {
      const row = outbox.get(`${param(call, 'pmo_record_id')}|${param(call, 'idempotency_key')}`);
      return row ? objectResponse(row) : nullObjectResponse();
    } },
    { label: 'outbox insert', method: 'POST', pathname: '/rest/v1/external_command_outbox', response: (call) => {
      const body = call.bodyJson as Record<string, unknown>;
      const row = { id: 'outbox-1', domain: body.domain, pmo_record_id: body.pmo_record_id, idempotency_key: body.idempotency_key, state: 'pending',
        external_record_id: null, canonical: null, claim_generation: 0, payload_digest: body.payload_digest ?? null, payload: body.payload ?? null };
      outbox.set(`${String(body.pmo_record_id)}|${String(body.idempotency_key)}`, row);
      return objectResponse(row);
    } },
    { label: 'notifications', pathname: '/rest/v1/notifications', response: () => jsonResponse([]) },
    { label: 'unexpected', response: (call) => { unexpected.push(call); return jsonResponse({ message: 'unmocked' }, { status: 404 }); } },
  ];
}

async function dispatch(command: Record<string, unknown>, caller: string, world: World) {
  const unexpected: FetchCall[] = [];
  const result = await withFetchMock(routes(unexpected, caller, world), async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: caller });
    const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
      method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(command),
    }));
    return { status: res.status, body: await res.text(), calls };
  });
  return { ...result, unexpected };
}

/** The same command and facts under each tier: the refusal must be identical and must touch neither the outbox nor an ERP. */
async function refusedAlike(command: Record<string, unknown>, caller: string, world: World, status: number, message: string) {
  const odoo = await dispatch(command, caller, { ...world, owns: ['odoo'] });
  const erpnext = await dispatch(command, caller, { ...world, owns: ['erpnext'] });
  for (const [tier, r] of [['odoo', odoo], ['erpnext', erpnext]] as const) {
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], `${tier}: every read is mocked`);
    assertEquals(r.status, status, `${tier}: ${r.body}`);
    assertEquals(JSON.parse(r.body), { error: 'commit-rejected', message }, tier);
    assertEquals(r.calls.filter((c) => c.url.pathname.includes('external_command_outbox')).length, 0, `${tier}: no outbox row`);
    assertEquals(r.calls.filter((c) => c.url.host === ODOO_HOST).length, 0, `${tier}: no Odoo request`);
  }
  assertEquals(odoo.body, erpnext.body, 'a client cannot tell which tier answered');
}

describe('AC-OPP-061 the dispatch gates refuse a tier-odoo procurement command as they do an ERPNext one', () => {
  it('authGuard: a role outside the money-write set is refused 403 with the shipped wording', async () => {
    await refusedAlike(paymentCommand(), PAYER_ID, { role: 'Engineer' }, 403, 'role "Engineer" not authorized for a "procurement" money write');
  });

  it('authGuard: an org that employs procurement on neither tier is refused 403 as before', async () => {
    const r = await dispatch(paymentCommand(), PAYER_ID, { owns: [] });
    assertEquals(r.status, 403, r.body);
    assertEquals(JSON.parse(r.body).message, `org ${ORG_ID} does not own domain "procurement" on the "erpnext" tier`);
    assertEquals(r.calls.filter((c) => c.url.pathname.includes('external_command_outbox')).length, 0);
  });

  it('FR-OPP-004 a case that is not in the caller\'s org (another tenant, or no such case) is refused 422 purchase_not_found', async () => {
    await refusedAlike(paymentCommand(), PAYER_ID, { caseRow: null }, 422, 'purchase_not_found');
    await refusedAlike(orderCommand(), PAYER_ID, { caseRow: null }, 422, 'purchase_not_found');
  });

  it('a closed case is refused 422 purchase_closed before the separation-of-duties check', async () => {
    await refusedAlike(paymentCommand(), APPROVER_ID, { caseRow: { status: 'Cancelled' } }, 422, 'purchase_closed');
  });

  it('AC-OPP-054 the case approver paying is refused 403 with 0006\'s exact wording', async () => {
    await refusedAlike(paymentCommand(), APPROVER_ID, {}, 403, 'separation of duties: approver cannot pay own procurement');
  });

  it('AC-OPP-054 the approver of a raised amount paying is refused 403 with the same wording', async () => {
    await refusedAlike(paymentCommand(), PAYER_ID, { amountApproverId: PAYER_ID }, 403, 'separation of duties: approver cannot pay own procurement');
  });

  it('AC-OPP-054 a payload that names another payer changes nothing: the verified caller decides', async () => {
    const command = paymentCommand();
    (command.record as Record<string, unknown>).paid_by = PAYER_ID;
    (command.record as Record<string, unknown>).approved_by = PAYER_ID;
    await refusedAlike(command, APPROVER_ID, {}, 403, 'separation of duties: approver cannot pay own procurement');
  });

  it('procurement_payment_allowed: an approval the database does not accept is refused 422 with its reason code', async () => {
    await refusedAlike(paymentCommand(), PAYER_ID, { paymentAllowed: 'approval_missing' }, 422, 'approval_missing');
  });

  it('the approved-amount ceiling refuses 422 before any outbox row', async () => {
    await refusedAlike(paymentCommand(), PAYER_ID, { ceilingOk: false }, 422, 'vendor payment: vendor bill exceeds approved amount');
  });

  it('FR-PFE-010 the org\'s purchase rules refuse a purchase-order create 422', async () => {
    await refusedAlike(orderCommand(), PAYER_ID, { gateViolation: 'gate_approval_before_payment' }, 422, 'gate_approval_before_payment');
  });

  it('AC-OPP-004 a vendor bill: a role outside the money-write set is refused 403, a case of another tenant 422 purchase_not_found, the org\'s purchase rules 422', async () => {
    await refusedAlike(billCommand(), PAYER_ID, { role: 'Engineer' }, 403, 'role "Engineer" not authorized for a "procurement" money write');
    await refusedAlike(billCommand(), PAYER_ID, { caseRow: null }, 422, 'purchase_not_found');
    await refusedAlike(billCommand(), PAYER_ID, { gateViolation: 'gate_approval_before_payment' }, 422, 'gate_approval_before_payment');
  });

  it('AC-SCA-012 a revise that would cancel a billed order is refused 422 before any outbox row', async () => {
    await refusedAlike(reviseCommand(), PAYER_ID, { poRevise: 'po_has_submitted_bill' }, 422, 'po_has_submitted_bill');
  });
});

describe('AC-OPP-003 Odoo procurement runs the shared link check before adapter selection', () => {
  const quotationCommand = () => ({
    domain: 'procurement', operation: 'create', idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-000000001509',
    record: { id: 'dddddddd-dddd-4ddd-8ddd-000000001509', erp_doc_kind: 'quotation', procurementId: PROC_ID, vendorId: VENDOR_ID },
  });
  const cases: Array<[string, () => Record<string, unknown>, NonNullable<World['foreign']>]> = [
    ['a quotation naming another tenant\'s vendor', quotationCommand, ['companies']],
    ['a payment settling another tenant\'s bill', paymentCommand, ['procurement_invoices']],
  ];
  const assertNothingSent = (r: Awaited<ReturnType<typeof dispatch>>) => {
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals(r.calls.filter((c) => c.url.host === ODOO_HOST).length, 0, 'no Odoo request');
    assertEquals(r.calls.filter((c) => c.method === 'POST' && c.url.pathname.includes('external_command_outbox')).length, 0, 'no outbox row');
  };
  for (const [name, command, foreign] of cases) {
    it(`${name} is refused 422 cross-org-link-rejected with no Odoo request and no outbox row`, async () => {
      const r = await dispatch(command(), PAYER_ID, { owns: ['odoo'], foreign, projectLink: '101', caseRow: { project_id: '77777777-7777-4777-8777-777777777777' } });
      assertNothingSent(r);
      assertEquals([r.status, JSON.parse(r.body).error], [422, 'cross-org-link-rejected'], r.body);
    });
  }
  // The project gate reads the case org-scoped before selection, so another tenant's case is answered there (the link check
  // itself is proved at the resolver by the shared push suites).
  for (const [name, command] of [['an order', orderCommand], ['a bill', billCommand]] as const) {
    it(`${name} for another tenant's case is refused 422 purchase_not_found with no Odoo request and no outbox row`, async () => {
      const r = await dispatch(command(), PAYER_ID, { owns: ['odoo'], foreign: ['procurements'], projectLink: '101', caseRow: { project_id: '77777777-7777-4777-8777-777777777777' } });
      assertNothingSent(r);
      assertEquals([r.status, JSON.parse(r.body)], [422, { error: 'commit-rejected', message: 'purchase_not_found' }]);
    });
  }
});

describe('AC-OPP-014 / FR-OPP-020 an Odoo purchase needs its project\'s cost account', () => {
  const PROJECT = '77777777-7777-4777-8777-777777777777';
  const withProject = (world: World): World => ({ ...world, caseRow: { project_id: PROJECT, ...(world.caseRow ?? {}) } });
  const refused = async (world: World, message: string, command: Record<string, unknown> = orderCommand()) => {
    const r = await dispatch(command, PAYER_ID, { owns: ['odoo'], ...withProject(world) });
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals([r.status, JSON.parse(r.body)], [422, { error: 'commit-rejected', message }]);
    assertEquals(r.calls.filter((c) => c.url.host === ODOO_HOST).length, 0, 'no Odoo request');
    assertEquals(r.calls.filter((c) => c.url.pathname.includes('external_command_outbox')).length, 0, 'no outbox row');
  };

  it('an unlinked project refuses 422 project-unlinked', async () => { await refused({ projectLink: null }, 'project-unlinked'); });
  it('a link whose Odoo account is archived, tombstoned or gone refuses 422 project-needs-attention', async () => {
    await refused({ projectLink: '101', account: { active: false, tombstoned_at: null } }, 'project-needs-attention');
    await refused({ projectLink: '101', account: { active: true, tombstoned_at: '2026-11-01T00:00:00Z' } }, 'project-needs-attention');
    await refused({ projectLink: '101', account: null }, 'project-needs-attention');
  });
  it('a command naming another project than the case refuses 422 multiple-projects', async () => {
    const command = orderCommand();
    (command.record as Record<string, unknown>).projectId = '88888888-8888-4888-8888-888888888888';
    await refused({ projectLink: '101' }, 'multiple-projects', command);
  });
  it('AC-OPP-014 a vendor bill needs the project\'s cost account too: unlinked refuses 422 project-unlinked, with no outbox row and no Odoo request', async () => {
    await refused({ projectLink: null }, 'project-unlinked', billCommand());
    await refused({ projectLink: '101', account: null }, 'project-needs-attention', billCommand());
  });
  it('the gate is Odoo\'s: the same unlinked project does not stop an ERPNext order here', async () => {
    const r = await dispatch(orderCommand(), PAYER_ID, { owns: ['erpnext'], ...withProject({ projectLink: null }) });
    assert(!r.body.includes('project-unlinked'), r.body);
  });
});

describe('AC-OPP-017 the revise guard takes its cancel flag from the tier', () => {
  const revisePath = async (owns: Tier) => {
    const r = await dispatch(reviseCommand(), PAYER_ID, { owns: [owns], poRevise: 'po_has_submitted_bill' });
    const refusal = r.calls.find((c) => c.url.pathname.endsWith('/rpc/po_revision_push_refusal'));
    return { body: r.body, cancels: (refusal?.bodyJson as { p_revise_cancels?: boolean } | undefined)?.p_revise_cancels };
  };
  it('ERPNext evaluates the cancel path (cancel-and-amend); Odoo does not (edit in place), and both refuse as the database answers', async () => {
    const erpnext = await revisePath('erpnext');
    const odoo = await revisePath('odoo');
    assertEquals([erpnext.cancels, odoo.cancels], [true, false]);
    assertEquals(odoo.body, erpnext.body);
  });
});

describe('AC-OPP-001 a command that passes every gate still reaches no Odoo request until the Odoo adapter exists', () => {
  const refusal = async (world: World, command: Record<string, unknown> = paymentCommand()) => {
    const r = await dispatch(command, PAYER_ID, { owns: ['odoo'], ...world });
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals(r.calls.filter((c) => c.url.host === ODOO_HOST).length, 0, 'no Odoo request');
    assertEquals(r.calls.filter((c) => c.url.pathname.includes('external_command_outbox') && c.method !== 'GET').length, 0, 'no outbox row written');
    return { status: r.status, body: JSON.parse(r.body) as { error: string; message: string } };
  };

  it('a snapshot missing a model refuses 422 config-rejected and names the model', async () => {
    const r = await refusal({ snapshot: { ...SNAPSHOT, later: { ...SNAPSHOT.later, 'account.payment': false } } });
    assertEquals(r.status, 422);
    assertEquals(r.body.error, 'config-rejected');
    assert(r.body.message.includes('account.payment'), r.body.message);
  });

  it('no stored snapshot refuses closed', async () => {
    const r = await refusal({ snapshot: null });
    assertEquals(r.status, 422);
    assertEquals(r.body.error, 'config-rejected');
  });

  it('a binding that is not activated refuses 422 config-rejected', async () => {
    const r = await refusal({ odooBinding: { activated_at: null } });
    assertEquals(r.status, 422);
    assertEquals(r.body.error, 'config-rejected');
  });

  it('the operator kill-switch refuses 422 config-rejected', async () => {
    Deno.env.set('EXTERNAL_CONNECT_ENABLED', 'false');
    try {
      const r = await refusal({});
      assertEquals(r.status, 422);
      assertEquals(r.body.error, 'config-rejected');
    } finally { Deno.env.delete('EXTERNAL_CONNECT_ENABLED'); }
  });

  it('a ready connection is refused for a step Odoo does not push yet (an RFQ): fail closed, nothing sent', async () => {
    const command = paymentCommand();
    const r = await refusal({}, { ...command, record: { ...command.record, erp_doc_kind: 'rfq' } });
    assertEquals(r.status, 422);
    assertEquals(r.body.error, 'config-rejected');
    assert(r.body.message.includes('not available'), r.body.message);
  });
});
