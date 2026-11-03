// #1506 O3 C2 (AC-OCI-001, 003, 005, 051, FR-OCI-001/002/004/055, DD-OCI-1, DD-OCI-8): every dispatch gate refuses a revenue command for an org that
// employs revenue under tier `odoo` exactly as it does for ERPNext, and the Odoo-side pre-flight (connection, capability snapshot, links, project
// cost account, receipt scope) refuses before any outbox row and any Odoo request. Shared gates run the SAME command under each tier through the
// SHIPPED handler (`./index.ts`, fetch mocked) and compare the two answers; ERPNext's own link/factory refusals stay with its suites.
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, withFetchMock } from '../_shared/testing/edgeTestKit.ts';
import type { FetchCall } from '../_shared/testing/edgeTestKit.ts';
import {
  AUTHOR_ID, CUSTOMER_ID, FOREIGN_ORG_ID, INVOICE_ID, ODOO_HOST, PROJECT_ID, REVENUE_SNAPSHOT, WORK_ORDER_ID, invoiceCommand, receiptCommand, revenueRoutes,
  type Tier, type World,
} from './odooRevenueFixtures.ts';

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

async function dispatch(command: Record<string, unknown>, caller: string, world: World) {
  const unexpected: FetchCall[] = [];
  const result = await withFetchMock(revenueRoutes(unexpected, caller, world), async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: caller });
    const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
      method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(command),
    }));
    return { status: res.status, body: await res.text(), calls };
  });
  return { ...result, unexpected };
}

const untouched = (r: Awaited<ReturnType<typeof dispatch>>, label: string) => {
  assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], `${label}: every read is mocked`);
  assertEquals(r.calls.filter((c) => c.url.pathname.includes('external_command_outbox') && c.method !== 'GET').length, 0, `${label}: no outbox row written`);
  assertEquals(r.calls.filter((c) => c.url.host === ODOO_HOST).length, 0, `${label}: no Odoo request`);
};

/** The same command and facts under each tier: the refusal must be identical and must touch neither the outbox nor an ERP. */
async function refusedAlike(command: Record<string, unknown>, world: World, status: number, body: unknown) {
  const odoo = await dispatch(command, AUTHOR_ID, { ...world, owns: ['odoo'] });
  const erpnext = await dispatch(command, AUTHOR_ID, { ...world, owns: ['erpnext'] });
  for (const [tier, r] of [['odoo', odoo], ['erpnext', erpnext]] as const) {
    untouched(r, tier);
    assertEquals(r.status, status, `${tier}: ${r.body}`);
    assertEquals(JSON.parse(r.body), body, tier);
  }
  assertEquals(odoo.body, erpnext.body, 'a client cannot tell which tier answered');
}

describe('AC-OCI-051 / FR-OCI-004 the shared dispatch gates refuse a tier-odoo revenue command as they do an ERPNext one', () => {
  it('authGuard: a role outside the revenue write set is refused 403 with the shipped wording', async () => {
    for (const role of ['Engineer', 'Executive', 'Project Manager']) {
      await refusedAlike(invoiceCommand(), { role }, 403, { error: 'commit-rejected', message: `role "${role}" not authorized for a "revenue" money write` });
    }
  });

  it('authGuard: Admin and Finance pass the role gate (the ERPNext set, no widening, no narrowing)', async () => {
    for (const role of ['Admin', 'Finance']) {
      const r = await dispatch(invoiceCommand(), AUTHOR_ID, { owns: ['odoo'], role });
      assert(!r.body.includes('not authorized'), `${role}: ${r.body}`);
    }
  });

  it('authGuard: an org that employs revenue on neither tier is refused 403 as before', async () => {
    const r = await dispatch(invoiceCommand(), AUTHOR_ID, { owns: [] });
    assertEquals(r.status, 403, r.body);
    assertEquals(JSON.parse(r.body).message, `org ${'11111111-1111-4111-8111-111111111111'} does not own domain "revenue" on the "erpnext" tier`);
    untouched(r, 'unowned');
  });

  it('AC-OCI-005 require_project_on_si on: an invoice with no project is refused 422 project-required', async () => {
    await refusedAlike(invoiceCommand({ projectId: null }), {}, 422, { error: 'commit-rejected', message: 'project-required' });
  });

  it('process gates that cannot be read refuse closed: 422 gate-check-failed', async () => {
    await refusedAlike(invoiceCommand(), { gates: 'unreadable' }, 422, { error: 'commit-rejected', message: 'gate-check-failed' });
  });

  it('AC-OCI-005 require_project_on_si off: an invoice with no project passes the gate and reaches the Odoo adapter, not the ERPNext one', async () => {
    const r = await dispatch(invoiceCommand({ projectId: null }), AUTHOR_ID, { owns: ['odoo'], gates: { require_project_on_si: false } });
    untouched(r, 'gate off');
    assertEquals([r.status, JSON.parse(r.body).error], [422, 'config-rejected']);
    assert(JSON.parse(r.body).message.includes('not available yet'), r.body);
  });
});

describe('AC-OCI-001 / FR-OCI-002 the Odoo connection and capability snapshot are checked before any outbox row or Odoo request', () => {
  const refused = async (world: World, expected: (message: string) => boolean, command: Record<string, unknown> = invoiceCommand()) => {
    const r = await dispatch(command, AUTHOR_ID, { owns: ['odoo'], ...world });
    untouched(r, 'refusal');
    assertEquals([r.status, JSON.parse(r.body).error], [422, 'config-rejected']);
    assert(expected(JSON.parse(r.body).message), r.body);
  };

  it('a snapshot missing a model refuses and names it (each of the six)', async () => {
    for (const model of ['account.move', 'account.move.line', 'account.payment']) {
      await refused({ snapshot: { ...REVENUE_SNAPSHOT, later: { ...REVENUE_SNAPSHOT.later, [model]: false } } }, (m) => m.includes(model));
    }
    for (const model of ['account.journal', 'account.tax', 'account.account']) {
      await refused({ snapshot: { ...REVENUE_SNAPSHOT, models: { ...REVENUE_SNAPSHOT.models, [model]: { exists: true, read: false } } } }, (m) => m.includes(model));
    }
  });

  it('a snapshot without account.payment refuses a RECEIPT too', async () => {
    await refused({ snapshot: { ...REVENUE_SNAPSHOT, later: { ...REVENUE_SNAPSHOT.later, 'account.payment': false } } }, (m) => m.includes('account.payment'), receiptCommand());
  });

  it('no stored snapshot refuses closed', async () => { await refused({ snapshot: null }, (m) => m.includes('account.move')); });
  it('a binding that is not activated refuses', async () => { await refused({ odooBinding: { activated_at: null } }, (m) => m.includes('inactive')); });
  it('no Odoo binding at all refuses', async () => { await refused({ odooBinding: null }, (m) => m.includes('not-found')); });

  it('the operator kill-switch refuses', async () => {
    Deno.env.set('EXTERNAL_CONNECT_ENABLED', 'false');
    try { await refused({}, (m) => m.includes('kill-switch')); } finally { Deno.env.delete('EXTERNAL_CONNECT_ENABLED'); }
  });

  it('a ready connection is refused for a step Odoo does not push yet: fail closed, nothing sent', async () => {
    await refused({ projectLink: '101' }, (m) => m.includes('not available yet'));
    await refused({ projectLink: '101' }, (m) => m.includes('not available yet'), receiptCommand());
  });
});

describe('AC-OCI-003 / FR-OCI-004 a link that is not the caller\'s tenant\'s refuses cross-org-link-rejected, zero calls', () => {
  const refused = async (world: World, command: Record<string, unknown>) => {
    const r = await dispatch(command, AUTHOR_ID, { owns: ['odoo'], ...world });
    untouched(r, 'link');
    assertEquals([r.status, JSON.parse(r.body).error], [422, 'cross-org-link-rejected']);
    assert(JSON.parse(r.body).message.startsWith('cross-org link rejected'), r.body);
  };

  it('another tenant\'s customer, project, work order or invoice, and an absent one, refuse an invoice', async () => {
    await refused({ rows: { [`companies:${CUSTOMER_ID}`]: FOREIGN_ORG_ID } }, invoiceCommand());
    await refused({ rows: { [`projects:${PROJECT_ID}`]: FOREIGN_ORG_ID } }, invoiceCommand());
    await refused({ rows: { [`work_orders:${WORK_ORDER_ID}`]: FOREIGN_ORG_ID } }, invoiceCommand());
    await refused({ rows: { [`companies:${CUSTOMER_ID}`]: null } }, invoiceCommand());
  });

  it('another tenant\'s invoice or customer, and an absent invoice, refuse a receipt', async () => {
    await refused({ rows: { [`sales_invoices:${INVOICE_ID}`]: FOREIGN_ORG_ID } }, receiptCommand());
    await refused({ rows: { [`companies:${CUSTOMER_ID}`]: FOREIGN_ORG_ID } }, receiptCommand());
    await refused({ rows: { [`sales_invoices:${INVOICE_ID}`]: null } }, receiptCommand());
  });
});

describe('FR-OCI-020 an invoice that names a project needs its Odoo cost account', () => {
  const refused = async (world: World, message: string) => {
    const r = await dispatch(invoiceCommand(), AUTHOR_ID, { owns: ['odoo'], ...world });
    untouched(r, 'project');
    assertEquals([r.status, JSON.parse(r.body)], [422, { error: 'commit-rejected', message }]);
  };
  it('an unlinked project refuses project-unlinked', async () => { await refused({ projectLink: null }, 'project-unlinked'); });
  it('a link whose account is archived, tombstoned or gone refuses project-needs-attention', async () => {
    await refused({ projectLink: '101', account: { active: false, tombstoned_at: null } }, 'project-needs-attention');
    await refused({ projectLink: '101', account: { active: true, tombstoned_at: '2026-11-01T00:00:00Z' } }, 'project-needs-attention');
    await refused({ projectLink: '101', account: null }, 'project-needs-attention');
  });
  it('a resolved account passes on to the adapter step', async () => {
    const r = await dispatch(invoiceCommand(), AUTHOR_ID, { owns: ['odoo'], projectLink: '101' });
    assert(JSON.parse(r.body).message.includes('not available yet'), r.body);
  });
});

describe('FR-OCI-050 / FR-OCI-055 a receipt settles one invoice, in the same revenue scope', () => {
  const refused = async (world: World, command: Record<string, unknown>, message: string) => {
    const r = await dispatch(command, AUTHOR_ID, { owns: ['odoo'], ...world });
    untouched(r, 'receipt');
    assertEquals([r.status, JSON.parse(r.body)], [422, { error: 'commit-rejected', message }]);
  };
  it('a receipt naming no invoice is refused', async () => { await refused({}, receiptCommand({ salesInvoiceId: null }), 'receipt-invoice-required'); });
  it('an invoice Odoo does not hold is refused', async () => { await refused({ invoiceInOdoo: false }, receiptCommand(), 'receipt-invoice-not-in-odoo'); });
  it('an invoice whose only reference is an ERPNext mapping is refused (FR-OCI-055)', async () => { await refused({ invoiceRefTier: 'erpnext' }, receiptCommand(), 'receipt-invoice-not-in-odoo'); });
  it('a customer other than the invoice\'s is refused', async () => {
    await refused({ invoiceCustomer: '12121212-1212-4121-8121-121212121212' }, receiptCommand(), 'receipt-customer-mismatch');
  });
  it('a receipt in the invoice\'s own scope passes on to the adapter step', async () => {
    const r = await dispatch(receiptCommand(), AUTHOR_ID, { owns: ['odoo'], projectLink: '101' });
    untouched(r, 'scope');
    assert(JSON.parse(r.body).message.includes('not available yet'), r.body);
  });
});

describe('ERPNext keeps the shipped behaviour', () => {
  it('an ERPNext-owned org\'s revenue command is not answered by the Odoo resolver', async () => {
    const r = await dispatch(invoiceCommand(), AUTHOR_ID, { owns: ['erpnext'] satisfies Tier[] });
    assert(!r.body.includes('Odoo') && !r.body.includes('not available yet'), r.body);
  });
});
